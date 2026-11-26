// Runs the production-capable probes against a DEPLOYED probe Worker. Needs, in the environment:
//   FS04_WORKER_URL     https://<worker>.<subdomain>.workers.dev   (no trailing slash)
//   FS04_PROBE_TOKEN    the bearer token the Worker was given as PROBE_TOKEN
// Optional: FS04_DATABASE_URL, the same URL the Worker has as DATABASE_URL, used only to poll pg_stat_activity (concurrency, leave-open).
// An unset FS04_WORKER_URL or FS04_PROBE_TOKEN writes results/production/NOT-VERIFIED.json and exits 0: "Not verified here".
// `--rehearse` runs the same code path against a local workerd whose DATABASE_URL points at the local PostgreSQL 17 (results go to work/rehearsal/, never to results/production/).
// No host, user, password or database name is printed or written: every output is scanned for them before it is saved.
import { mkdirSync, writeFileSync } from 'node:fs';
import { variants, bigVariant, SIZES } from './catalog.ts';
import type { Variant } from './variants.ts';
import { RESULTS, WORK } from './lib/paths.ts';
import { PgConn } from './lib/client.ts';
import { parseUrl } from '../worker/src/pg.ts';
import { query, decodeDataRow } from '../worker/src/wire.ts';

const rehearse = process.argv.includes('--rehearse');
const OUT = rehearse ? WORK + 'rehearsal/' : RESULTS + 'production/';
mkdirSync(OUT, { recursive: true });
let base = process.env.FS04_WORKER_URL, token = process.env.FS04_PROBE_TOKEN, dbUrl = process.env.FS04_DATABASE_URL;

// ---- production variants: the local ones that need nothing but the Worker and the one database ------------------------------
const pick = (id: string, newId: string, patch: Partial<Variant> = {}): Variant => { const v = variants.find((x) => x.id === id)!; return { ...v, ...patch, id: newId, target: 'main', servers: undefined, proxyCfg: undefined }; };
const PROD: Variant[] = [
  pick('p1.starttls.pg17-tls', 'prod.p1.starttls'),
  pick('p1.direct-tls.pg17-tls', 'prod.p1.direct-tls'),
  pick('p1.second-starttls', 'prod.p1.second-starttls'),
  pick('p1.lock.read-pending', 'prod.p1.lock.read-pending'),
  pick('p1.lock.cancel-pending', 'prod.p1.lock.cancel-pending'),
  pick('p2.matrix.trusted-right-name', 'prod.p2.matrix.trusted-right-name'),
  pick('p2.opt.startTls.expectedServerHostname-right', 'prod.p2.opt.expectedServerHostname-right', { params: { startTlsOpts: { expectedServerHostname: '$HOST' } } }),
  pick('p2.opt.startTls.expectedServerHostname-wrong', 'prod.p2.opt.expectedServerHostname-wrong', { params: { startTlsOpts: { expectedServerHostname: 'wrong.invalid' } } }),
  pick('p2.surface', 'prod.p2.surface'),
  ...[1, 2, 6, 7, 8, 24, 50].map((n) => pick(`p4.concurrent.n${n}`, `prod.p4.concurrent.n${n}`)),
  pick('p4.idle-count.n6', 'prod.p4.idle-count.n6'),
  pick('p4.cross-request', 'prod.p4.cross-request'),
  pick('p4.leave-open', 'prod.p4.leave-open'),
  pick('p4.global-scope', 'prod.p4.global-scope'),
  pick('p5.cancel.plain', 'prod.p5.cancel.plain'),
  pick('p5.cancel.busy6', 'prod.p5.cancel.busy6'),
  pick('p5.cancel.tls-main-plain-cancel', 'prod.p5.cancel.tls-main-plain-cancel'),
  pick('p5.cancel.tls-main-tls-cancel', 'prod.p5.cancel.tls-main-tls-cancel'),
];

function notVerified(reason: string): never {
  writeFileSync(OUT + 'NOT-VERIFIED.json', JSON.stringify({ status: 'Not verified here', reason, label: 'not observable' }, null, 1) + '\n');
  console.log('Not verified here: ' + reason); process.exit(0);
}
if (!rehearse && (!base || !token)) notVerified('FS04_WORKER_URL or FS04_PROBE_TOKEN is not set; no Cloudflare account was available to the study.');

const secretsInOutput = (s: string): string | null => {
  if (!dbUrl) return null;
  try { const t = parseUrl(dbUrl); for (const [k, v] of Object.entries({ host: t.host, user: t.user, password: t.password, database: t.database })) if (v && v.length >= 3 && s.includes(v)) return k; } catch { /* ignore */ }
  return s.includes(dbUrl) ? 'url' : null;
};

async function admin(): Promise<PgConn | null> {
  if (!dbUrl) return null;
  try { const t = parseUrl(dbUrl); return await PgConn.connect({ host: t.host, port: t.port, user: t.user, password: t.password, database: t.database, appName: 'fs04-admin', tls: rehearse ? false : { rejectUnauthorized: true } }); } catch { return null; }
}
const count = async (a: PgConn, prefix: string) => { a.write(query(`select count(*) from pg_stat_activity where application_name like '${prefix}%'`)); const r = await a.collect(1, 10000); const d = r.msgs.find((m) => m.type === 'D'); return d ? Number(decodeDataRow(d.body)[0]) : 0; };

async function runOne(v: Variant, runs: number): Promise<any> {
  const { judge } = v; const out: any[] = []; const tally: Record<string, { pass: number; of: number }> = {};
  const a = (v.poll || v.after) ? await admin() : null;
  for (let i = 1; i <= runs; i++) {
    const runId = `${v.id.replace(/[^a-z0-9]/gi, '').slice(-14)}p${i}x${Math.random().toString(36).slice(2, 6)}`;
    const t0 = Date.now(); const activity: { t: number; count: number }[] = []; const extra: Record<string, unknown> = {};
    let timer: ReturnType<typeof setInterval> | null = null;
    if (a && v.poll) timer = setInterval(async () => { try { activity.push({ t: Date.now() - t0, count: await count(a, `fs04-${runId}`) }); } catch { /* ignore */ } }, 100);
    const call = async (probe: string, params: any) => { try { const r = await fetch(`${base}/run`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ probe, params, runId }), signal: AbortSignal.timeout(240000) }); return await r.json(); } catch (e: any) { return { ok: false, error: { message: String(e?.message ?? e) } }; } };
    let response: any;
    if (v.kind === 'state') { const r = await fetch(`${base}/state`, { headers: { authorization: `Bearer ${token}` } }); extra.state = await r.json(); }
    else if (v.kind === 'xreq') { const c = await call(v.probe, { ...v.params, target: 'main', phase: 'create' }); extra.createOk = c?.observations?.created === true; extra.use = await call(v.probe, { ...v.params, target: 'main', phase: 'use' }); response = c; }
    else response = await call(v.probe, { ...v.params, target: 'main' });
    extra.responseAt = Date.now();
    if (a && v.after) { const sampled: any[] = []; for (const ms of v.after) { await Bun.sleep(ms - (sampled.length ? v.after[sampled.length - 1]! : 0)); try { sampled.push({ at: ms, count: await count(a, `fs04-${runId}`) }); } catch { /* ignore */ } } extra.sampled = sampled; }
    if (timer) clearInterval(timer);
    const rec: any = { run: i, runId, mode: 'production', wallMs: Date.now() - t0, response, proxy: [], log: [], activity, extra };
    const checks = judge(rec, v); const pass = v.required.every((k) => checks[k] === null || checks[k] === true);
    for (const [k, val] of Object.entries(checks)) if (val !== null) { tally[k] ??= { pass: 0, of: 0 }; tally[k]!.of++; if (val) tally[k]!.pass++; }
    out.push({ run: i, runId, wallMs: rec.wallMs, pass, checks, response, extra });
  }
  a?.close();
  const passes = out.filter((r) => r.pass).length;
  const res = { id: v.id, title: v.title, mode: 'production', runs, passes, required: v.required, checks: tally, label: rehearse ? 'local-rehearsal' : 'production-observed', runsDetail: out };
  const text = JSON.stringify(res);
  const leak = secretsInOutput(text);
  if (leak) { console.error(`REFUSING to write ${v.id}: output contains the database ${leak}`); process.exit(2); }
  writeFileSync(OUT + `${v.id}.production.json`, JSON.stringify({ ...res, runsDetail: undefined }, null, 1).replace(/\n}$/, ',\n "runsDetail": [\n' + out.map((r) => '  ' + JSON.stringify(r)).join(',\n') + '\n ]\n}') + '\n');
  console.log(`${(rehearse ? 'rehearsal' : 'production').padEnd(10)} ${v.id.padEnd(46)} ${passes}/${runs}  ${Object.entries(tally).filter(([, t]) => t.pass < t.of).map(([k, t]) => `${k}:${t.pass}/${t.of}`).join(' ')}`);
  return res;
}

async function main() {
  let lab: any = null;
  if (rehearse) {
    const { Lab, urlFor, TOKEN, WORKER_PORT, bindings } = await import('./lib/harness.ts'); const { SERVERS } = await import('./lib/servers.ts'); const { startWorkerd } = await import('./lib/workerd.ts');
    lab = new Lab(); await lab.start(['pg17-tls']);
    const s = SERVERS.find((x) => x.id === 'pg17-tls')!;
    lab.worker = await startWorkerd({ port: WORKER_PORT, bindings: { ...bindings(['pg17-tls']), DATABASE_URL: urlFor(s) }, tag: 'rehearse' });
    base = `http://127.0.0.1:${WORKER_PORT}`; token = TOKEN; dbUrl = urlFor(s, false);
  }
  const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  for (const v of PROD) if (!only.length || only.some((p) => v.id.startsWith(p))) await runOne(v, 5);
  // large writes: the same ladder and stop line as locally, single write and 64 KiB chunks
  if (!only.length || only.includes('prod.p3')) for (const spec of ['bind-single', 'bind-chunk64k']) {
    for (let k = 0; k < SIZES.length; k++) {
      const v = bigVariant(spec, SIZES[k]!); v.id = 'prod.' + v.id; v.target = 'main';
      const res = await runOne(v, 5);
      if (res.passes < 5) { if (k + 1 < SIZES.length) { const w = bigVariant(spec, SIZES[k + 1]!); w.id = 'prod.' + w.id; await runOne(w, 1); } break; }
    }
  }
  if (lab) await lab.stop();
}
await main();
