// FS-08 overhead benchmark. Usage: <runtime> scripts/bench-overhead.mjs <binding>
// Same process, same database. Variants:
//   raw      the binding's own API called directly, number mode
//   adapter  the private probe adapter (scripts/lib/adapters.mjs): argument spreading and one extra call frame
//   rule     adapter + the integer-width rule: lossless (bigint) read, then per-column narrowing with a safe-range check
// Warm-up runs are discarded; the measured runs of the three variants are interleaved to cancel drift.
// Verdict: a difference between medians that is inside the larger run-to-run spread (max - min) is "no measurable overhead".
import fs from 'node:fs';
import path from 'node:path';
import { getAdapter } from './lib/adapters.mjs';
import { runtime, WORK, RESULTS, writeJson, BINDINGS } from './lib/rt.mjs';
import { now, summarize } from './lib/stats.mjs';
const round = (o) => (typeof o === 'number' ? Math.round(o * 1e6) / 1e6 : Array.isArray(o) ? o.map(round) : o && typeof o === 'object' ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, round(v)])) : o);

const binding = process.argv[2];
if (!BINDINGS.includes(binding)) { console.error('usage: bench-overhead.mjs <binding>'); process.exit(2); }
const rt = runtime();
const tag = binding.replace(/[:]/g, '-') + '__' + rt.id;
const a = await getAdapter(binding);
if (!a.ok) { console.log(tag, 'does not load'); process.exit(0); }
const RUNS = 21, WARM = 4;

const dir = path.join(WORK, 'bench'); fs.mkdirSync(dir, { recursive: true });
const dbPath = path.join(dir, `overhead-${tag}.db`);
for (const s of ['', '-wal', '-shm']) fs.rmSync(dbPath + s, { force: true });
const adH = a.open(dbPath, { timeout: 0 });
adH.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL');
adH.exec('CREATE TABLE items(id INTEGER PRIMARY KEY, a INTEGER NOT NULL, b BIGINT NOT NULL, c REAL NOT NULL, d TEXT NOT NULL, e INTEGER NOT NULL)');
adH.exec('BEGIN');
const ins = adH.prepare('INSERT INTO items VALUES (?,?,?,?,?,?)');
for (let i = 1; i <= 20000; i++) ins.run(i, i * 31 % 100003, 1000000007 * i, i / 7, 'item-' + String(i).padStart(10, '0'), i % 5);
adH.exec('COMMIT');
adH.exec('CREATE TABLE ins_target(id INTEGER PRIMARY KEY, a INTEGER NOT NULL, b BIGINT NOT NULL, c REAL NOT NULL, d TEXT NOT NULL)');

// raw handles use the binding's own API
const mk = (intMode) => {
  const Db = a.Database; let db;
  if (binding === 'bun:sqlite') db = new Db(dbPath, { readwrite: true });
  else if (binding === 'node:sqlite') db = new Db(dbPath);
  else db = new Db(dbPath);
  if (binding === 'bun:sqlite' || binding === 'better-sqlite3' || binding === 'node:sqlite') db.exec('PRAGMA busy_timeout=0');
  const prep = (sql) => { const s = db.prepare(sql); if (intMode === 'bigint') { if (binding === 'node:sqlite') s.setReadBigInts(true); else s.safeIntegers(true); } return s; };
  return { db, prep };
};
const rawNum = mk('number'), rawBig = mk('bigint');
const declsOf = (raw) => (binding === 'bun:sqlite' ? Array.from(raw.declaredTypes) : raw.columns().map((c) => c.type));
const is64 = (d) => { if (d == null) return false; const u = String(d).toUpperCase().replace(/\(.*\)/, '').replace(/\s+/g, ' ').trim(); return u === 'BIGINT' || u === 'INT8' || u === 'UNSIGNED BIG INT'; };
const MAX = 9007199254740991n, MIN = -9007199254740991n;

/** The rule, compiled once per statement: names of columns to narrow to number (non-64-bit declared). */
function ruleFor(st) {
  const decls = declsOf(st), names = binding === 'bun:sqlite' ? Array.from(st.columnNames) : st.columns().map((c) => c.name);
  const narrow = []; names.forEach((n, i) => { if (!is64(decls[i])) narrow.push(n); });
  return (rows) => {
    for (let r = 0; r < rows.length; r++) { const row = rows[r]; for (let k = 0; k < narrow.length; k++) { const n = narrow[k]; const v = row[n]; if (typeof v === 'bigint') { if (v > MAX || v < MIN) throw new RangeError('DataError: ' + n + ' = ' + v); row[n] = Number(v); } } }
    return rows;
  };
}

let sink = 0;
function bench(name, unit, perRun, variants) {
  const times = Object.fromEntries(Object.keys(variants).map((k) => [k, []]));
  for (let i = 0; i < WARM + RUNS; i++) for (const [k, fn] of Object.entries(variants)) { const t0 = now(); fn(); const t = now() - t0; if (i >= WARM) times[k].push(t / perRun); }
  const res = Object.fromEntries(Object.entries(times).map(([k, v]) => [k, summarize(v)]));
  const base = res.raw; const cmp = {};
  for (const k of Object.keys(res)) if (k !== 'raw') { const diff = res[k].median - base.median; const spread = Math.max(res[k].max - res[k].min, base.max - base.min); cmp[k] = { diff, ratio: res[k].median / base.median, spread, verdict: Math.abs(diff) <= spread ? 'no measurable overhead' : diff > 0 ? 'overhead' : 'faster' }; }
  console.log(tag, name, unit, JSON.stringify(Object.fromEntries(Object.entries(res).map(([k, v]) => [k, Math.round(v.median * 1000) / 1000]))), JSON.stringify(Object.fromEntries(Object.entries(cmp).map(([k, v]) => [k, v.verdict]))));
  return { name, unit: unit + ' per operation (query, or row for the insert bench)', runs: RUNS, results: res, comparison: cmp };
}
const out = { binding, runtime: rt, runs: RUNS, warmup: WARM, allocations: 'not measured: no cheap, reliable allocation counter on all three runtimes', benches: [] };

// ---- point select by primary key ----
{
  const ids = Array.from({ length: 4000 }, (_, i) => 1 + ((i * 7919) % 20000));
  const SQL = 'SELECT id, a, b, c, d, e FROM items WHERE id = ?';
  const rawS = rawNum.prep(SQL); const adS = a.open(dbPath, { timeout: 0 }); const adStmt = adS.prepare(SQL);
  const ruleDb = a.open(dbPath, { timeout: 0, intMode: 'bigint' }); const ruleStmt = ruleDb.prepare(SQL); const fix = ruleFor(ruleStmt.raw);
  out.benches.push(bench('point select by primary key', 'ms', 4000, {
    raw: () => { for (let i = 0; i < ids.length; i++) { sink += rawS.get(ids[i]).a; } },
    adapter: () => { for (let i = 0; i < ids.length; i++) { sink += adStmt.get(ids[i]).a; } },
    rule: () => { for (let i = 0; i < ids.length; i++) { const r = ruleStmt.get(ids[i]); fix([r]); sink += r.a; } },
  }));
}
// ---- 100 rows, 10,000 rows ----
for (const [label, n, reps] of [['100 rows', 100, 200], ['10,000 rows', 10000, 4]]) {
  const SQL = 'SELECT id, a, b, c, d, e FROM items WHERE id <= ?';
  const rawS = rawNum.prep(SQL); const adS = a.open(dbPath, { timeout: 0 }); const adStmt = adS.prepare(SQL);
  const ruleDb = a.open(dbPath, { timeout: 0, intMode: 'bigint' }); const ruleStmt = ruleDb.prepare(SQL); const fix = ruleFor(ruleStmt.raw);
  out.benches.push(bench('select ' + label, 'ms', reps, {
    raw: () => { for (let i = 0; i < reps; i++) sink += rawS.all(n).length; },
    adapter: () => { for (let i = 0; i < reps; i++) sink += adStmt.all(n).length; },
    rule: () => { for (let i = 0; i < reps; i++) sink += fix(ruleStmt.all(n)).length; },
  }));
}
// ---- insert in a transaction (5,000 rows) ----
{
  const rawI = rawNum.prep('INSERT INTO ins_target VALUES (?,?,?,?,?)'); const adI = adH.prepare('INSERT INTO ins_target VALUES (?,?,?,?,?)');
  const N = 5000;
  const reset = () => adH.exec('DELETE FROM ins_target');
  out.benches.push(bench('insert 5,000 rows in one transaction', 'ms', N, {
    raw: () => { reset(); rawNum.db.exec('BEGIN'); for (let i = 1; i <= N; i++) rawI.run(i, i, 1000000007 * i, i / 7, 'item-' + i); rawNum.db.exec('COMMIT'); },
    adapter: () => { reset(); adH.exec('BEGIN'); for (let i = 1; i <= N; i++) adI.run(i, i, 1000000007 * i, i / 7, 'item-' + i); adH.exec('COMMIT'); },
  }));
}
out.sink = sink;
await writeJson(path.join(RESULTS, 'overhead', tag + '.json'), round(out));
for (const s of ['', '-wal', '-shm']) fs.rmSync(dbPath + s, { force: true });
process.exit(0);
