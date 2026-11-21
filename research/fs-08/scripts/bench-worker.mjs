// FS-08 worker benchmark. Usage: <runtime> scripts/bench-worker.mjs <binding> [--quick]
// In-thread vs worker execution on a WAL file database: one connection per worker (read-only), the main thread
// keeps its own connection (the writer). Transfer variants: structured clone of row objects ("clone") and one
// packed ArrayBuffer that is transferred ("packed-lazy": views only, "packed-decode": plain row objects rebuilt).
// Writes results/worker/<binding>__<runtime>.json.
//
// PRE-REGISTERED DECISION CRITERIA (fixed here, before any run; they are not tuned afterwards):
//   spread(path)     = max - min of the per-run values of that path in that cell
//   latency win      worker median latency < in-thread median latency - max(spread(worker), spread(inthread))
//   blocking win     worker median of per-run longest main-thread gap < in-thread's - max(spreads)   (longest gap = timer lag
//                    sampler re-arming setTimeout(1); a synchronous block of B ms is one gap of about B ms)
//   worker adopted   at the smallest cell (by result rows, or by query time) from which BOTH wins hold in that cell and in
//                    every larger cell of the same sweep; "no threshold found" when that cell does not exist.
//   Blocking-only wins (blocking win, no latency win) are reported separately as "blocking-only".
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getAdapter } from './lib/adapters.mjs';
import { runtime, WORK, RESULTS, writeJson, BINDINGS } from './lib/rt.mjs';
import { now, summarize, round, startSampler, sleep } from './lib/stats.mjs';
import { spawn } from './lib/workers.mjs';
import { view, materialize } from './lib/pack.mjs';

const binding = process.argv[2];
const quick = process.argv.includes('--quick');
if (!BINDINGS.includes(binding)) { console.error('usage: bench-worker.mjs <binding> [--quick]'); process.exit(2); }
const rt = runtime();
const tag = binding.replace(/[:]/g, '-') + '__' + rt.id;
const a = await getAdapter(binding);
if (!a.ok) { console.log(tag, 'does not load'); process.exit(0); }

// ---------- database ----------
const dbDir = path.join(WORK, 'bench'); fs.mkdirSync(dbDir, { recursive: true });
const dbPath = path.join(dbDir, `worker-${tag}.db`);
for (const s of ['', '-wal', '-shm']) fs.rmSync(dbPath + s, { force: true });
const main = a.open(dbPath, { timeout: 0 });
main.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL');
main.exec('CREATE TABLE narrow(id INTEGER PRIMARY KEY, v INTEGER NOT NULL)');
main.exec(`CREATE TABLE wide(id INTEGER PRIMARY KEY, i1 INTEGER NOT NULL, i2 INTEGER NOT NULL, i3 INTEGER NOT NULL, i4 INTEGER NOT NULL, i5 INTEGER NOT NULL, i6 INTEGER NOT NULL,
  r1 REAL NOT NULL, r2 REAL NOT NULL, r3 REAL NOT NULL, r4 REAL NOT NULL, t1 TEXT NOT NULL, t2 TEXT NOT NULL, t3 TEXT NOT NULL, t4 TEXT NOT NULL, t5 TEXT NOT NULL, t6 TEXT NOT NULL, b BLOB NOT NULL)`);
main.exec('BEGIN');
const insN = main.prepare('INSERT INTO narrow VALUES (?, ?)');
const insW = main.prepare('INSERT INTO wide VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
for (let i = 1; i <= 100000; i++) {
  insN.run(i, (i * 2654435761) % 1000003);
  insW.run(i, i, i * 3, i % 977, i * 7919 % 100003, 1000000 - i, i % 2, i / 7, i * 1.5, Math.sqrt(i), i / 3, 'alpha-' + String(i).padStart(18, '0'), 'beta-' + String(i * 3).padStart(19, '0'), 'gamma-' + (i % 977), 'delta-' + (i * 7).toString(36).padStart(12, 'x'), 'eps' + String(i % 100).padStart(21, 'e'), 'zeta-' + String(i).padStart(10, 'z'), new Uint8Array(32).fill(i % 256));
}
main.exec('COMMIT');
main.exec('PRAGMA wal_checkpoint(TRUNCATE)');

// ---------- paths ----------
const NW = 4;
const workers = [];
for (let i = 0; i < NW; i++) workers.push(await spawn({ binding, dbPath }));
let sink = 0;
const cache = new Map();
const mainStmt = (sql) => { let s = cache.get(sql); if (!s) { s = main.prepare(sql); cache.set(sql, s); } return s; };
let rr = 0;
const pick = (R) => workers[(rr++) % R];
const PATHS = {
  inthread: async (sql, params) => { const rows = mainStmt(sql).all(...params); sink += rows.length; return rows; },
  clone: async (sql, params, R = 1) => { const m = await pick(R).call({ op: 'all', sql, params }); sink += m.rows.length; return m.rows; },
  'packed-lazy': async (sql, params, R = 1) => { const m = await pick(R).call({ op: 'pack', sql, params }, []); const v = view(m.buf); sink += v.n; return v; },
  'packed-decode': async (sql, params, R = 1) => { const m = await pick(R).call({ op: 'pack', sql, params }, []); const rows = materialize(view(m.buf)); sink += rows.length; return rows; },
};

// ---------- verification: every path returns the same rows ----------
// Buffer (better-sqlite3 BLOBs) has a toJSON that runs before the replacer sees the value, so read the raw value from `this`
const norm = (rows) => JSON.stringify(rows, function (k, v) { const raw = this[k]; return raw instanceof Uint8Array ? 'b:' + Array.from(raw).join(',') : typeof raw === 'bigint' ? 'n:' + raw : v; });
const verify = {};
for (const shape of ['narrow', 'wide']) {
  const sql = `SELECT * FROM ${shape} WHERE id <= ?`;
  const base = norm(await PATHS.inthread(sql, [1000]));
  verify[shape] = { clone: norm(await PATHS.clone(sql, [1000])) === base, 'packed-decode': norm(await PATHS['packed-decode'](sql, [1000])) === base, rows: 1000 };
}

// ---------- measurement ----------
async function measure(fn, runs, warm = 3) {
  for (let i = 0; i < warm; i++) await fn();
  const lat = [], maxGap = [], blocked = [], allGaps = [];
  for (let i = 0; i < runs; i++) {
    const s = startSampler(); await sleep(4);
    const t0 = now(); await fn(); const t1 = now();
    await sleep(4);
    const gaps = s.stop();
    lat.push(t1 - t0);
    maxGap.push(Math.max(...gaps) - 1);
    blocked.push(gaps.reduce((acc, g) => acc + (g > 3 ? g - 1 : 0), 0));
    for (const g of gaps) allGaps.push(g - 1);
  }
  return { latencyMs: summarize(lat), longestBlockMs: summarize(maxGap), blockedMsPerRequest: summarize(blocked), timerLagMs: { p99: summarize(allGaps).p99, max: summarize(allGaps).max, samples: allGaps.length } };
}
const spread = (s) => s.max - s.min;
function judge(inth, wk) {
  const L = wk.latencyMs.median < inth.latencyMs.median - Math.max(spread(wk.latencyMs), spread(inth.latencyMs));
  const B = wk.longestBlockMs.median < inth.longestBlockMs.median - Math.max(spread(wk.longestBlockMs), spread(inth.longestBlockMs));
  return { latencyWin: L, blockingWin: B, verdict: L && B ? 'both' : B ? 'blocking-only' : L ? 'latency-only' : 'none' };
}
const out = { binding, runtime: rt, quick, cpus: os.cpus().length, cpuModel: os.cpus()[0].model, workers: NW, verify, idleTimerLag: null, size: [], time: [], throughput: [], criteria: 'see header of scripts/bench-worker.mjs' };

// idle floor of the sampler itself
{ const s = startSampler(); await sleep(400); const g = s.stop().map((x) => x - 1); out.idleTimerLag = round({ p99: summarize(g).p99, max: summarize(g).max, samples: g.length }); }

// ---------- A. result-size sweep ----------
const SIZES = quick ? [1, 100, 10000, 100000] : [1, 10, 100, 1000, 10000, 100000];
const runsFor = (n) => (n >= 100000 ? 10 : 15);
for (const shape of ['narrow', 'wide']) {
  for (const n of SIZES) {
    const sql = `SELECT * FROM ${shape} WHERE id <= ?`;
    const cell = { shape, rows: n, paths: {}, judge: {} };
    for (const p of Object.keys(PATHS)) cell.paths[p] = round(await measure(() => PATHS[p](sql, [n]), runsFor(n)));
    for (const p of ['clone', 'packed-lazy', 'packed-decode']) cell.judge[p] = judge(cell.paths.inthread, cell.paths[p]);
    out.size.push(cell);
    console.log(tag, 'size', shape, n, 'inthread', cell.paths.inthread.latencyMs.median, 'clone', cell.paths.clone.latencyMs.median, 'decode', cell.paths['packed-decode'].latencyMs.median);
  }
}

// ---------- B. query-time sweep (tiny result) ----------
const CTE = 'WITH RECURSIVE c(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM c WHERE i < ?) SELECT count(*) AS n FROM c';
function timeIn(n, reps = 5) { const st = mainStmt(CTE); const ts = []; for (let i = 0; i < reps; i++) { const t0 = now(); st.get(n); ts.push(now() - t0); } return summarize(ts).median; }
function calibrate(target) { let n = Math.max(100, Math.round(target * 20000)); for (let i = 0; i < 12; i++) { const t = timeIn(n, 5); const r = target / t; if (Math.abs(r - 1) < 0.08) break; n = Math.max(10, Math.round(n * r)); } return n; }
const TARGETS = quick ? [1, 10, 100] : [0.1, 1, 10, 100, 1000];
const calib = {};
for (const t of TARGETS) { const n = calibrate(t); calib[t] = { iterations: n, actualInThreadMedianMs: Math.round(timeIn(n, 5) * 1000) / 1000 }; }
out.calibration = calib;
for (const t of TARGETS) {
  const n = calib[t].iterations; const runs = t >= 1000 ? 8 : t >= 100 ? 10 : 20;
  const cell = { targetMs: t, iterations: n, paths: {}, judge: {} };
  cell.paths.inthread = round(await measure(() => PATHS.inthread(CTE, [n]), runs));
  cell.paths.worker = round(await measure(() => PATHS.clone(CTE, [n]), runs));
  cell.judge.worker = judge(cell.paths.inthread, cell.paths.worker);
  out.time.push(cell);
  console.log(tag, 'time', t, 'inthread', cell.paths.inthread.latencyMs.median, 'worker', cell.paths.worker.latencyMs.median, cell.judge.worker.verdict);
}

// ---------- C. throughput with 1, 2 and 4 readers ----------
async function closedLoop(req, total, inflight) {
  const t0 = now(); let issued = 0, done = 0;
  await new Promise((resolve) => { const next = () => { if (issued >= total) return; issued++; req().then(() => { done++; if (done >= total) resolve(); else next(); }); }; for (let i = 0; i < inflight; i++) next(); });
  return total / ((now() - t0) / 1000);
}
async function sequentialInThread(req, total) { // one request per event-loop turn, as a server would
  const t0 = now(); for (let i = 0; i < total; i++) { await req(); await new Promise((r) => setImmediate(r)); } return total / ((now() - t0) / 1000);
}
const WL = quick
  ? [{ name: 'cpu-1ms-tiny', sql: CTE, params: [calib[1].iterations], total: 300, modes: ['clone'] }, { name: 'narrow-1000-rows', sql: 'SELECT * FROM narrow WHERE id <= ?', params: [1000], total: 300, modes: ['clone', 'packed-decode'] }]
  : [{ name: 'cpu-1ms-tiny', sql: CTE, params: [calib[1].iterations], total: 600, modes: ['clone'] }, { name: 'cpu-10ms-tiny', sql: CTE, params: [calib[10].iterations], total: 150, modes: ['clone'] },
     { name: 'narrow-1000-rows', sql: 'SELECT * FROM narrow WHERE id <= ?', params: [1000], total: 400, modes: ['clone', 'packed-decode'] }, { name: 'wide-1000-rows', sql: 'SELECT * FROM wide WHERE id <= ?', params: [1000], total: 300, modes: ['clone', 'packed-decode'] }];
const REPS = 5; const READERS = quick ? [1, 4] : [1, 2, 4];
for (const w of WL) {
  const cell = { workload: w.name, totalRequests: w.total, inthread: null, worker: {} };
  { const rates = [], gapsAll = []; for (let rep = 0; rep < REPS; rep++) { const s = startSampler(); rates.push(await sequentialInThread(() => PATHS.inthread(w.sql, w.params), w.total)); gapsAll.push(...s.stop().map((g) => g - 1)); }
    cell.inthread = round({ reqPerSec: summarize(rates), timerLagMs: { p99: summarize(gapsAll).p99, max: summarize(gapsAll).max } }); }
  for (const mode of w.modes) {
    cell.worker[mode] = {};
    for (const R of READERS) {
      const rates = [], gapsAll = [];
      for (let rep = 0; rep < REPS + 1; rep++) { const s = startSampler(); const rate = await closedLoop(() => PATHS[mode](w.sql, w.params, R), w.total, R * 2); const g = s.stop(); if (rep > 0) { rates.push(rate); gapsAll.push(...g.map((x) => x - 1)); } }
      cell.worker[mode][R] = round({ reqPerSec: summarize(rates), timerLagMs: { p99: summarize(gapsAll).p99, max: summarize(gapsAll).max } });
    }
  }
  out.throughput.push(cell);
  console.log(tag, 'throughput', w.name, 'inthread', cell.inthread.reqPerSec.median, Object.fromEntries(Object.entries(cell.worker).map(([m, v]) => [m, Object.fromEntries(Object.entries(v).map(([R, x]) => [R, x.reqPerSec.median]))])));
}

out.sink = sink;
for (const w of workers) await w.call({ op: 'close' }).catch(() => {});
workers.forEach((w) => w.terminate());
main.close();
for (const s of ['', '-wal', '-shm']) fs.rmSync(dbPath + s, { force: true });
await writeJson(path.join(RESULTS, 'worker', tag + '.json'), out);
console.log(tag, 'done');
process.exit(0);
