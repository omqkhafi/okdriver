// Run orchestration: servers + recording proxy + workerd (or the Bun control) + server-side truth.
import { mkdirSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { PgConn } from './client.ts';
import { RecordingProxy, type ConnRec } from './proxy.ts';
import { SERVERS, DB, USER, secrets, logs, type ServerSpec } from './servers.ts';
import { buildBundle, startWorkerd, type Running } from './workerd.ts';
import { nodeConnect } from './nodesock.ts';
import { pem } from './certs.ts';
import { PROBES, type Ctx } from '../../worker/src/probes.ts';
import { parseUrl } from '../../worker/src/pg.ts';
import { RESULTS } from './paths.ts';

export const LISTEN = (s: ServerSpec) => s.port - 40000; // proxy port of a server
export const HOSTS: Record<string, string> = { 'pg17-selfsigned': 'selfsigned.fs04.test', 'pg17-expired': 'expired.fs04.test' };
export const hostOf = (id: string) => HOSTS[id] ?? 'pg.fs04.test';
export const TOKEN = 'fs04-' + randomBytes(6).toString('hex');
export const WORKER_PORT = 8787;

export const urlFor = (s: ServerSpec, viaProxy = true, host?: string) => `postgres://${USER}:${encodeURIComponent(secrets().password)}@${host ?? hostOf(s.id)}:${viaProxy ? LISTEN(s) : s.port}/${DB}`;

export function bindings(ids: string[]): Record<string, string> {
  const b: Record<string, string> = { PROBE_TOKEN: TOKEN };
  for (const id of ids) { const s = SERVERS.find((x) => x.id === id)!; b['DB_' + id.toUpperCase().replace(/-/g, '_')] = urlFor(s); }
  b.DB_PG17_TLS_IP = urlFor(SERVERS.find((x) => x.id === 'pg17-tls')!, true, '127.0.0.1');
  return b;
}

export interface RunRec {
  run: number; runId: string; mode: 'worker' | 'control' | 'production'; wallMs: number;
  response: any; httpError?: string;
  proxy: ConnRec[]; log: string[]; activity?: { t: number; count: number }[];
  extra?: Record<string, unknown>;
}

/** Direct (not proxied) admin connection used for server-side truth. */
export class Admin {
  private constructor(private c: PgConn) {}
  static async open(s: ServerSpec): Promise<Admin> {
    const c = await PgConn.connect({ host: '127.0.0.1', port: s.port, user: USER, password: secrets().password, database: DB, appName: 'fs04-admin' });
    return new Admin(c);
  }
  async q(sql: string): Promise<(string | null)[][]> {
    const { decodeDataRow } = await import('../../worker/src/wire.ts'); const { query } = await import('../../worker/src/wire.ts');
    this.c.write(query(sql));
    const r = await this.c.collect(1, 10000);
    return r.msgs.filter((m) => m.type === 'D').map((m) => decodeDataRow(m.body));
  }
  close() { this.c.close(); }
}

export class Lab {
  proxy = new RecordingProxy();
  admins = new Map<string, Admin>();
  worker: Running | null = null;
  workerIds: string[] = [];
  async start(ids: string[]): Promise<void> {
    for (const id of ids) { const s = SERVERS.find((x) => x.id === id)!; await this.proxy.addRoute(id, LISTEN(s), s.port, s.engine === 'postgres' ? 'pg' : 'mysql'); }
    this.workerIds = ids; buildBundle();
  }
  async admin(id: string): Promise<Admin> { let a = this.admins.get(id); if (!a) { a = await Admin.open(SERVERS.find((x) => x.id === id)!); this.admins.set(id, a); } return a; }
  async startWorker(opts: { trusted?: string[]; keypair?: { cert: string; key: string } } = {}): Promise<void> {
    await this.worker?.stop();
    this.worker = await startWorkerd({ port: WORKER_PORT, bindings: bindings(this.workerIds), trusted: opts.trusted, keypair: opts.keypair, tag: 'run' });
  }
  async stop(): Promise<void> { await this.worker?.stop(); await this.proxy.stop(); for (const a of this.admins.values()) a.close(); }

  async call(probe: string, params: any, runId: string, mode: 'worker' | 'control', timeoutMs = 240000): Promise<{ response: any; httpError?: string }> {
    if (mode === 'worker') {
      try {
        const r = await fetch(`http://127.0.0.1:${WORKER_PORT}/run`, { method: 'POST', headers: { authorization: `Bearer ${TOKEN}` }, body: JSON.stringify({ probe, params, runId }), signal: AbortSignal.timeout(timeoutMs) });
        return { response: await r.json() };
      } catch (e: any) { return { response: null, httpError: String(e?.message ?? e) }; }
    }
    const globals = (this as any).__ctlGlobals ??= {};
    const ctx: Ctx = {
      connect: nodeConnect({ ca: pem('ca.pem') }), globals, moduleKeys: ['connect'], runId,
      target: (name) => { const ip = name.endsWith('-ip'); const s = SERVERS.find((x) => x.id === name.replace(/-ip$/, ''))!; return parseUrl(urlFor(s, true, ip ? '127.0.0.1' : undefined)); },
    };
    const t0 = performance.now();
    try { const observations = await PROBES[probe]!(ctx, params); return { response: { ok: true, probe, runId, ms: Math.round(performance.now() - t0), observations: JSON.parse(JSON.stringify(observations)) } }; }
    catch (e: any) { return { response: { ok: false, error: { name: e?.name, message: String(e?.message ?? e) } } }; }
  }
}

export const serverLog = (id: string, sinceMs: number): string[] =>
  logs(id, new Date(sinceMs).toISOString()).split('\n').map((l) => l.replace(/^\S+ \S+ \S+ \[\d+\] /, '').trim()).filter((l) => /fs04-|SSL|ALPN|certificate|FATAL|cancel|canceling|protocol|unsupported|could not/i.test(l)).slice(-60);

export const slim = (c: ConnRec): ConnRec => ({ ...c });
/** Raw traces are kept for the first run of a variant only; later runs keep checks, timings and resource samples (what capabilities.ts reads). Idempotent. */
export function compactRuns(runs: any[]): any[] {
  return runs.map((r, i) => i === 0 || r.traceTrimmed ? r : { run: r.run, runId: r.runId, wallMs: r.wallMs, pass: r.pass, checks: r.checks, httpError: r.httpError, activityPeak: r.activityPeak, extra: r.extra && { workerd: r.extra.workerd, closeLagMs: r.extra.closeLagMs, sampled: r.extra.sampled }, traceTrimmed: true });
}
export function save(rel: string, v: unknown): void {
  const p = RESULTS + rel; mkdirSync(p.slice(0, p.lastIndexOf('/')), { recursive: true });
  // compact: the header is indented, each run of runsDetail is one line
  const o = v as any; if (o && Array.isArray(o.runsDetail)) o.runsDetail = compactRuns(o.runsDetail);
  if (o && Array.isArray(o.runsDetail)) { const { runsDetail, ...head } = o; writeFileSync(p, JSON.stringify(head, null, 1).replace(/\n}$/, ',\n "runsDetail": [\n' + runsDetail.map((r: unknown) => '  ' + JSON.stringify(r)).join(',\n') + '\n ]\n}') + '\n'); }
  else writeFileSync(p, JSON.stringify(v, null, 1) + '\n');
}

/** Server CLI inside the container as an independent oracle for MySQL and MariaDB (no wire code of ours is involved). */
export function mysqlCli(id: string, sql: string): string {
  const s = SERVERS.find((x) => x.id === id)!; const bin = s.engine === 'mariadb' ? 'mariadb' : 'mysql';
  const r = Bun.spawnSync(['docker', 'exec', '-e', `MYSQL_PWD=${secrets().password}`, 'fs04-' + id, bin, '-uroot', '-N', '-B', '-e', sql], { stdout: 'pipe', stderr: 'pipe' });
  return r.stdout.toString().trim();
}
export const mysqlPollSql = (id: string): string => {
  const cipher = id === 'my84' ? "(select count(*) from performance_schema.status_by_thread where variable_name='Ssl_cipher' and variable_value<>'')" : '-1';
  return `select (select count(*) from information_schema.processlist where info like '%sleep(30)%' and id <> connection_id()), ${cipher}`;
};
