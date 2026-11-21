// FS-06 study runner: for one target (direct Postgres, or one pooler configuration) runs sequences S1..S7 five times,
// the pinning probes and the prepared-statement readback, and writes raw and compact results.
// Usage: bun scripts/study.ts <target-id>   (targets come from scripts/poolers.ts)
import { mkdirSync, writeFileSync } from 'node:fs';
import { PgConn, nowMs } from './lib/client.ts';
import { RecordingProxy } from './lib/proxy.ts';
import { SEQUENCES, runSteps, ONE_WAY_DELAY_MS, DEADLINE_MS, sql, type SeqDef, type SeqRun, type Step } from './lib/seq.ts';
import { parse, bind, describe, execute, sync, query, u8, decodeDataRow, decodeError } from './lib/wire.ts';
import type { Target } from './lib/target.ts';
import { ROOT, RAW, RESULTS } from './lib/paths.ts';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const RUNS = 5;
export const CLIENT_PROXY_PORT = 55420;

export interface RunRecord {
  run: number;
  seqs: SeqRun[];
  pin: Record<'unnamed' | 'named', PinResult>;
  preparedReadback: { pid: number; count: number; names: string[] }[];
  statsBusy?: unknown; statsIdle?: unknown;
  clientConnectErrors: string[];
}
export interface PinResult {
  txnsPerClient: number; clients: number;
  perClient: { ok: number; errors: Record<string, number>; pids: number[]; timeouts: number }[];
  distinctPids: number[];
}

async function connectAll(t: Target, cproxy: RecordingProxy | null, tag: string, n: number): Promise<{ conns: (PgConn | null)[]; ids: number[]; errors: string[] }> {
  const errors: string[] = [];
  const conns = await Promise.all(Array.from({ length: n }, async (_, i) => {
    try {
      return await PgConn.connect({ host: cproxy ? '127.0.0.1' : t.host, port: cproxy ? cproxy.o.port : t.port, user: t.user, password: t.password, database: t.database, appName: `fs06-${tag}-c${i}`, tls: t.tls ?? false, connectTimeoutMs: 15000 });
    } catch (e: any) { errors.push(`c${i}: ${e.message}`); return null; }
  }));
  await sleep(30);
  const ids = conns.map((_, i) => { if (!cproxy) return 0; for (const c of cproxy.conns.values()) if (c.app === `fs06-${tag}-c${i}`) return c.id; return -1; });
  return { conns, ids, errors };
}

const probeSql = 'SELECT $1::int AS n, pg_backend_pid() AS pid, (SELECT pg_sleep(0.01))::text AS tag';

async function pinProbe(clients: (PgConn | null)[], mode: 'unnamed' | 'named', tag: string, txns: number): Promise<PinResult> {
  const live = clients.map((c, i) => ({ c, i })).filter((x) => x.c && !x.c.ended);
  const perClient = await Promise.all(live.map(async ({ c, i }) => {
    const r = { ok: 0, errors: {} as Record<string, number>, pids: new Set<number>(), timeouts: 0 };
    const nm = `fs06_${tag}_pin_c${i}`;
    for (let k = 0; k < txns; k++) {
      const first = mode === 'unnamed' || k === 0;
      const bytes = mode === 'unnamed'
        ? u8(parse('', probeSql), bind('', '', [String(k)]), describe('P', ''), execute('', 0), sync())
        : u8(...(first ? [parse(nm, probeSql)] : []), bind('', nm, [String(k)]), describe('P', ''), execute('', 0), sync());
      c!.write(bytes);
      const res = await c!.collect(1, DEADLINE_MS);
      if (res.end === 'timeout') { r.timeouts++; c!.destroy(); break; }
      let bad = false;
      for (const m of res.msgs) {
        if (m.type === 'E') { const e = decodeError(m.body); const key = `${e.code} ${e.message}`; r.errors[key] = (r.errors[key] ?? 0) + 1; bad = true; }
        if (m.type === 'D') { const row = decodeDataRow(m.body); r.pids.add(parseInt(row[1]!, 10)); }
      }
      if (res.end === 'closed') { r.errors['connection closed'] = (r.errors['connection closed'] ?? 0) + 1; break; }
      if (!bad) r.ok++;
    }
    return { ok: r.ok, errors: r.errors, pids: [...r.pids].sort((a, b) => a - b), timeouts: r.timeouts };
  }));
  const distinct = [...new Set(perClient.flatMap((p) => p.pids))].sort((a, b) => a - b);
  return { txnsPerClient: txns, clients: live.length, perClient, distinctPids: distinct };
}

async function preparedReadback(clients: (PgConn | null)[]): Promise<RunRecord['preparedReadback']> {
  // pg_prepared_statements is per session, so it is read through the pooler; the rows show the backend the read landed on.
  const seen = new Map<number, { pid: number; count: number; names: string[] }>();
  const q = "SELECT pg_backend_pid() AS pid, (SELECT pg_sleep(0.02))::text AS s, (SELECT count(*) FROM pg_prepared_statements) AS c, (SELECT coalesce(string_agg(name, ',' ORDER BY name), '') FROM pg_prepared_statements) AS names";
  for (let round = 0; round < 3; round++) {
    await Promise.all(clients.map(async (c) => {
      if (!c || c.ended) return;
      c.write(u8(parse('', q), bind('', '', []), describe('P', ''), execute('', 0), sync()));
      const r = await c.collect(1, DEADLINE_MS);
      for (const m of r.msgs) if (m.type === 'D') { const row = decodeDataRow(m.body); const pid = parseInt(row[0]!, 10); seen.set(pid, { pid, count: parseInt(row[2]!, 10), names: row[3]!.split(',').filter(Boolean).slice(0, 12) }); }
    }));
  }
  return [...seen.values()];
}

const one = (tag: string, n: number, sleepSql = false): Uint8Array =>
  u8(parse('', sleepSql ? 'SELECT pg_sleep(0.01), pg_backend_pid()' : sql(tag)), bind('', '', sleepSql ? [] : [String(n)]), describe('P', ''), execute('', 0), sync());

export async function runTarget(t: Target, cproxy: RecordingProxy | null, sproxy: RecordingProxy | null): Promise<{ raw: any; loginInfo: any }> {
  const ctx = { cproxy, sproxy };
  const runs: RunRecord[] = [];
  let loginInfo: any = null;
  for (let run = 1; run <= RUNS; run++) {
    const tag = `${t.id}-r${run}`;
    const { conns, ids, errors } = await connectAll(t, cproxy, tag, t.clients);
    const rec: RunRecord = { run, seqs: [], pin: {} as any, preparedReadback: [], clientConnectErrors: errors };
    runs.push(rec);
    if (!conns[0]) { rec.seqs.push({ seq: 'login', run, outcome: 'error', why: errors.join('; ') } as any); continue; }
    if (run === 1 && conns[0]) {
      const c = conns[0];
      loginInfo = { authMethod: c.authMethod, tls: c.tlsUsed ? c.tlsProtocol : false, parameterStatus: c.parameterStatus, backendPid: c.backendPid, loginMessages: c.loginMessages };
    }
    let cur = conns[0]!; let curId = ids[0]!;
    const reconnect = async (suffix: string) => {
      cur.destroy();
      try { cur = await PgConn.connect({ host: cproxy ? '127.0.0.1' : t.host, port: cproxy ? cproxy.o.port : t.port, user: t.user, password: t.password, database: t.database, appName: `fs06-${tag}-c0${suffix}`, tls: t.tls ?? false }); }
      catch (e: any) { rec.clientConnectErrors.push(`reconnect: ${e.message}`); throw e; }
      await sleep(30);
      curId = cproxy ? [...cproxy.conns.values()].find((c) => c.app === `fs06-${tag}-c0${suffix}`)?.id ?? -1 : 0;
      conns[0] = cur;
    };
    let rc = 0;
    const interleave = async () => {
      const others = conns.slice(1).filter((c): c is PgConn => !!c && !c.ended);
      await Promise.all(others.map(async (c) => { for (let k = 0; k < 6; k++) { c.write(one('x', k, true)); await c.collect(1, DEADLINE_MS); } }));
    };
    const exec = async (def: SeqDef, steps: Step[], conn = cur, connId = curId) => {
      const r = await runSteps(ctx, def, conn, connId, steps, run, def.gap ? interleave : undefined);
      rec.seqs.push(r);
      await sleep(80);
      return r;
    };
    const ensureLive = async () => { if (cur.ended) await reconnect(`x${++rc}`); };
    const byId = (id: string) => SEQUENCES.find((s) => s.id === id)!;
    const build = (def: SeqDef, client = 0) => def.build({ run: tag, client, n: 0 });
    try {
      for (const id of ['S1', 'S2']) { await ensureLive(); await exec(byId(id), build(byId(id))); }
      const s2ok = rec.seqs.at(-1)!.outcome === 'ok';
      // S2b: after the transaction ended, other clients run on the shared server connections, then Bind-only.
      if (s2ok) {
        await interleave();
        await ensureLive();
        await exec(byId('S2b'), build(byId('S2b')));
      } else rec.seqs.push({ seq: 'S2b', run, outcome: 'wrong-result', why: 'not run: S2 did not succeed on this connection', skipped: true } as any);
      for (const id of ['S3', 'S3i', 'S3u', 'S3ui', 'S3f']) { await ensureLive(); await exec(byId(id), build(byId(id))); }
      // S4 name collision: two clients, same statement name, different SQL.
      {
        const nm = `fs06_${tag}_shared`;
        const mk = (tagc: string, n: number, withParse: boolean): SeqDef => ({ id: '', title: '', expect: [withParse ? '1 2 T D C Z' : '2 T D C Z'], rows: [[n, tagc]], build: () => [] });
        const step = (tagc: string, n: number, withParse: boolean): Step[] => [{ bytes: u8(...(withParse ? [parse(nm, sql(tagc))] : []), bind('', nm, [String(n)]), describe('P', ''), execute('', 0), sync()), syncs: 1 }];
        const cB = conns[1];
        if (cB && !cB.ended) {
          await ensureLive();
          const idB = ids[1]!;
          for (const [phase, withParse] of [['a', true], ['b', false]] as const) {
            for (const [who, conn, cid, tg, n] of [['A', cur, curId, 'A', 11], ['B', cB, idB, 'B', 12]] as const) {
              if (conn.ended) { rec.seqs.push({ seq: `S4${phase}-${who}`, run, outcome: 'closed', why: 'connection already closed', skipped: true } as any); continue; }
              const def = { ...mk(tg, n, withParse), id: `S4${phase}-${who}`, title: 'name collision' };
              await exec(def, step(tg, n, withParse), conn, cid);
            }
          }
        } else rec.seqs.push({ seq: 'S4a-A', run, outcome: 'error', why: 'second client missing', skipped: true } as any);
      }
      // S4c: B parses name N while A holds its own server connection inside a transaction; then B reuses N with Bind only, six times.
      {
        const nm = `fs06_${tag}_mix`; const cB = conns[1];
        const defA: SeqDef = { id: 'S4c-setup-A', title: '', expect: ['C Z', '1 2 T D C Z'], rows: [[21, 'A']], build: () => [] };
        const defB: SeqDef = { id: 'S4c-setup-B', title: '', expect: ['1 2 T D C Z'], rows: [[22, 'B']], build: () => [] };
        const defU: SeqDef = { id: 'S4c', title: '', expect: ['2 T D C Z'], rows: [[22, 'B']], build: () => [] };
        if (cB && !cB.ended) {
          await ensureLive();
          const a = await exec(defA, [{ bytes: u8(query('BEGIN'), parse(nm, sql('A')), bind('', nm, ['21']), describe('P', ''), execute('', 0), sync()), syncs: 2 }]);
          void a;
          await exec(defB, [{ bytes: u8(parse(nm, sql('B')), bind('', nm, ['22']), describe('P', ''), execute('', 0), sync()), syncs: 1 }], cB, ids[1]!);
          cur.write(query('COMMIT')); await cur.collect(1, DEADLINE_MS);
          for (let k = 0; k < 6; k++) await exec(defU, [{ bytes: u8(bind('', nm, ['22']), describe('P', ''), execute('', 0), sync()), syncs: 1 }], cB, ids[1]!);
          if (cur.ended) await ensureLive();
        } else rec.seqs.push({ seq: 'S4c', run, outcome: 'error', why: 'second client missing', skipped: true } as any);
      }
      for (const id of ['S5', 'S6-2', 'S6-10', 'S6-100', 'S7', 'S7b']) { await ensureLive(); await exec(byId(id), build(byId(id))); }
    } catch (e: any) { rec.clientConnectErrors.push(`sequence loop: ${e.message}`); }
    // Pinning probes and statistics with all clients connected.
    const liveClients = conns.map((c, i) => (i === 0 ? cur : c));
    const busy = t.stats ? sleep(150).then(() => t.stats!()).catch((e) => ({ error: String(e) })) : Promise.resolve(undefined);
    rec.pin.unnamed = await pinProbe(liveClients, 'unnamed', tag, 20);
    rec.statsBusy = await busy;
    rec.pin.named = await pinProbe(liveClients, 'named', tag, 20);
    await sleep(100);
    rec.statsIdle = t.stats ? await t.stats().catch((e) => ({ error: String(e) })) : undefined;
    rec.preparedReadback = await preparedReadback(liveClients);
    for (const c of liveClients) c?.close();
    await sleep(300);
  }
  // Server-side overview of what the pooler did on its own.
  const server = sproxy ? (() => {
    const qs: Record<string, number> = {}; const parses = new Set<string>(); const closes: Record<string, number> = {};
    for (const m of sproxy.msgs) {
      if (m.dir !== 'c2s') continue;
      if (m.type === 'Q') qs[String((m.d as any).sql)] = (qs[String((m.d as any).sql)] ?? 0) + 1;
      if (m.type === 'P') parses.add(String((m.d as any).name).replace(/fs06_[^_]+-[a-z0-9-]+-r\d_/, 'fs06_<run>_'));
      if (m.type === 'C') { const k = `${(m.d as any).kind}`; closes[k] = (closes[k] ?? 0) + 1; }
    }
    const conns = [...sproxy.conns.values()];
    return { connections: conns.length, pids: [...new Set(conns.map((c) => c.pid).filter(Boolean))], simpleQueries: qs, parseNamesSample: [...parses].slice(0, 15), closeMessages: closes };
  })() : null;
  return { raw: { target: { id: t.id, pooler: t.pooler, config: t.config, mode: t.mode, serverPool: t.serverPool, clients: t.clients, notes: t.notes }, loginInfo, runs, server }, loginInfo };
}

// ---------------------------------------------------------------------------------------------------------------

const median = (a: number[]) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]!; };
const bump = (m: Record<string, number>, k: string) => { m[k] = (m[k] ?? 0) + 1; };

export function summarise(raw: any) {
  const bySeq = new Map<string, SeqRun[]>();
  for (const r of raw.runs as RunRecord[]) for (const s of r.seqs) { if (!bySeq.has(s.seq)) bySeq.set(s.seq, []); bySeq.get(s.seq)!.push(s); }
  const seqs: Record<string, any> = {};
  for (const [id, list] of bySeq) {
    const outcomes: Record<string, number> = {}; const errors: Record<string, number> = {}; const notes: Record<string, number> = {};
    const whys: Record<string, number> = {};
    for (const s of list) {
      bump(outcomes, (s as any).skipped ? 'not-run' : s.outcome);
      for (const e of s.errors ?? []) bump(errors, `${e.code} ${e.message}`);
      if (s.outcome !== 'ok' && s.why) bump(whys, s.why);
      for (const n of s.server?.notes ?? []) bump(notes, n);
    }
    const ran = list.filter((s) => !(s as any).skipped);
    seqs[id] = {
      runs: list.length, ok: outcomes.ok ?? 0, outcomes, errors, ...(Object.keys(whys).length ? { failures: whys } : {}),
      traceRoundTrips: ran.length ? { min: Math.min(...ran.map((s) => s.traceRoundTrips)), median: median(ran.map((s) => s.traceRoundTrips)), max: Math.max(...ran.map((s) => s.traceRoundTrips)) } : null,
      elapsedMs: ran.length ? { median: median(ran.map((s) => s.elapsedMs)), min: Math.min(...ran.map((s) => s.elapsedMs)), max: Math.max(...ran.map((s) => s.elapsedMs)) } : null,
      impliedRoundTrips: ran.length ? median(ran.map((s) => s.impliedRoundTrips)) : null,
      forwardedAsSent: ran.filter((s) => s.server?.forwardedAsSent).length, serverNotes: notes,
      clientTypes: ran[0]?.client?.types, serverTypes: [...new Set(ran.map((s) => s.server?.types))].slice(0, 3).map((x) => (x && x.length > 90 ? `${x.slice(0, 80)} … (${x.split(' ').length} messages)` : x)),
      serverParseExample: ran[0]?.server?.parse?.[0], serverBindExample: ran[0]?.server?.bind?.[0],
      serverTrips: ran.length ? median(ran.map((s) => s.server?.trips ?? 0)) : null,
      poolerQueries: [...new Set(ran.flatMap((s) => s.server?.poolerQueries ?? []))].slice(0, 4),
      wrongRow: ran.some((s) => (s as any).wrongRow),
    };
  }
  const pin: Record<string, any> = {};
  for (const mode of ['unnamed', 'named'] as const) {
    const per: any[] = [];
    const errs: Record<string, number> = {};
    let ok = 0, total = 0, timeouts = 0; const distinct = new Set<number>(); let pinned = 0, clientsSeen = 0, multi = 0;
    for (const r of raw.runs as RunRecord[]) {
      const p = r.pin?.[mode]; if (!p) continue;
      for (const pc of p.perClient) { ok += pc.ok; total += p.txnsPerClient; timeouts += pc.timeouts; for (const [k, v] of Object.entries(pc.errors)) errs[k] = (errs[k] ?? 0) + (v as number); clientsSeen++; if (pc.pids.length === 1 && pc.ok >= p.txnsPerClient - 1) pinned++; if (pc.pids.length > 1) multi++; }
      for (const d of p.distinctPids) distinct.add(d);
      per.push(p.distinctPids.length);
    }
    pin[mode] = { txnsOk: ok, txnsTotal: total, timeouts, errors: errs, clientRunsWithOnePid: pinned, clientRunsWithManyPids: multi, clientRuns: clientsSeen, distinctBackendPidsPerRun: per };
  }
  const prep = (raw.runs as RunRecord[]).at(-1)?.preparedReadback ?? [];
  return { target: raw.target, login: raw.loginInfo ? { authMethod: raw.loginInfo.authMethod, tls: raw.loginInfo.tls, parameterStatus: raw.loginInfo.parameterStatus } : null, seqs, pin, preparedReadbackLastRun: prep, statsIdleLastRun: (raw.runs as RunRecord[]).at(-1)?.statsIdle, statsBusyLastRun: (raw.runs as RunRecord[]).at(-1)?.statsBusy, server: raw.server, connectErrors: (raw.runs as RunRecord[]).flatMap((r) => r.clientConnectErrors) };
}

export async function study(t: Target, sproxy: RecordingProxy | null, opts: { proxyPort?: number; noProxy?: boolean; outDir?: string } = {}): Promise<any> {
  mkdirSync(RAW, { recursive: true }); mkdirSync(opts.outDir ?? RESULTS + 'targets/', { recursive: true });
  const cproxy = opts.noProxy ? null : new RecordingProxy({ name: 'client-side', port: opts.proxyPort ?? CLIENT_PROXY_PORT, targetHost: t.host, targetPort: t.port, delayMs: ONE_WAY_DELAY_MS });
  await cproxy?.start();
  try {
    const { raw } = await runTarget(t, cproxy, sproxy);
    writeFileSync(`${RAW}${t.id}.json`, JSON.stringify(raw));
    if (cproxy) writeFileSync(`${RAW}${t.id}.client-msgs.json`, JSON.stringify(cproxy.msgs.filter((m) => !(m.dir === 's2c' && m.type === 'D'))));
    if (sproxy) writeFileSync(`${RAW}${t.id}.server-msgs.json`, JSON.stringify(sproxy.msgs));
    const sum = summarise(raw);
    writeFileSync(`${opts.outDir ?? RESULTS + 'targets/'}${t.id}.json`, JSON.stringify(sum, null, 1) + '\n');
    return sum;
  } finally { await cproxy?.stop(); }
}
void ROOT; void nowMs;
