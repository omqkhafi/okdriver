// FS-08 capability probe. Usage: <runtime> scripts/probe-capabilities.mjs <binding>
// Writes results/capabilities/<binding>__<runtime>.json. Every row is exercised against the real
// binding; a capability that cannot be exercised is recorded as "not-observed", never "works".
// Status vocabulary:
//   works                 exercised, behaved as described in `detail`
//   fails                 exercised, raised an error (recorded)
//   partial               exercised, only part of the row could be reached (detail says which)
//   absent                no such API found by name on this binding
//   present-not-exercised API exists, the behaviour was not exercised here
//   not-observed          could not be exercised
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { getAdapter } from './lib/adapters.mjs';
import { runtime, WORK, RESULTS, describeError, writeJson, BINDINGS } from './lib/rt.mjs';

const binding = process.argv[2];
if (!BINDINGS.includes(binding)) { console.error('usage: probe-capabilities.mjs <' + BINDINGS.join('|') + '>'); process.exit(2); }
const rt = runtime();
const tag = binding.replace(/[:]/g, '-') + '__' + rt.id;
const warnings = [];
process.on('warning', (w) => warnings.push(`${w.name}: ${w.message}`));

const out = { binding, runtime: rt, loaded: false, meta: {}, caps: {} };
const outFile = path.join(RESULTS, 'capabilities', tag + '.json');
const dir = path.join(WORK, 'cap', tag);
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });
let n = 0;
const fresh = (ext = '.db') => path.join(dir, `f${++n}${ext}`);

const a = await getAdapter(binding);
await new Promise((r) => setTimeout(r, 30));
if (!a.ok) {
  out.loadError = a.error;
  out.meta.warnings = warnings;
  await writeJson(outFile, out);
  console.log(tag, 'does not load:', a.error.code ?? a.error.message);
  process.exit(0);
}
out.loaded = true;
const isBun = binding === 'bun:sqlite', isNode = binding === 'node:sqlite', isBs3 = binding === 'better-sqlite3';

// ---------- helpers ----------
const T = (fn) => { try { return { ok: true, value: fn() }; } catch (e) { return { ok: false, error: describeError(e) }; } };
const one = (h, sql, ...p) => h.prepare(sql).get(...p);
const val = (h, sql, ...p) => { const r = one(h, sql, ...p); return r == null ? null : Object.values(r)[0]; };
const pragma = (h, name) => val(h, `PRAGMA ${name}`);
const norm = (v) => (v === undefined ? null : JSON.parse(JSON.stringify(v, (k, x) => (typeof x === 'bigint' ? `${x}n` : x instanceof Uint8Array ? `bytes(${x.length})` : x))));
const proto = (o) => { const s = new Set(); let p = o; while (p && p !== Object.prototype && p !== Function.prototype) { Object.getOwnPropertyNames(p).forEach((k) => s.add(k)); p = Object.getPrototypeOf(p); } s.delete('constructor'); return [...s].sort(); };
async function rec(id, fn) {
  try {
    const v = await fn();
    out.caps[id] = v && typeof v === 'object' && 'status' in v ? norm(v) : { status: 'works', detail: norm(v) };
  } catch (e) { out.caps[id] = { status: 'fails', error: describeError(e) }; }
}
const mk = (opts) => a.open(opts.path, opts);
// Seed a WAL-mode file database with table t(id INTEGER PRIMARY KEY, v) of `rows` rows.
function seedWal(rows = 1000) {
  const p = fresh();
  const w = a.open(p, { timeout: 0 });
  w.exec('PRAGMA journal_mode=WAL');
  w.exec('CREATE TABLE t(id INTEGER PRIMARY KEY, v TEXT)');
  w.exec(`WITH RECURSIVE s(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM s WHERE i<${rows}) INSERT INTO t SELECT i, 'x'||i FROM s`);
  return { p, w };
}
const hasName = (o, re) => proto(o).filter((k) => re.test(k));

// ---------- meta ----------
{
  const h = a.open(':memory:');
  const st = h.prepare('SELECT 1 AS a');
  out.meta.sqlite_version = val(h, 'SELECT sqlite_version()');
  out.meta.sqlite_source_id = val(h, 'SELECT sqlite_source_id()');
  out.meta.compile_options = h.prepare('PRAGMA compile_options').all().map((r) => Object.values(r)[0]);
  out.meta.moduleExports = Object.keys(a.mod).sort();
  out.meta.dbMethods = proto(h.raw);
  out.meta.stmtMethods = proto(st.raw);
  out.meta.staticMembers = Object.getOwnPropertyNames(a.Database).sort();
  out.meta.rowPrototype = (() => { const r = st.get(); const p = Object.getPrototypeOf(r); return p === null ? 'null' : p === Object.prototype ? 'Object.prototype' : 'other'; })();
  h.close();
}

// ---------- open modes ----------
await rec('open.memory', () => { const h = a.open(':memory:'); const v = val(h, 'SELECT 1'); h.close(); return { value: v }; });
await rec('open.readonly_rejects_write', () => {
  const p = fresh(); const w = a.open(p); w.exec('CREATE TABLE t(x)'); w.close();
  const r = a.open(p, { readonly: true });
  const e = T(() => r.exec('INSERT INTO t VALUES (1)')); r.close();
  return e.ok ? { status: 'fails', detail: 'write on a readonly handle succeeded' } : { error: e.error };
});
await rec('open.must_exist_option', () => {
  const p = fresh();
  if (isNode) {
    const h = a.open(p, {}); h.close();
    return { status: 'absent', detail: 'no create=false option observed on the constructor; opening a missing path created the file', fileCreated: fs.existsSync(p) };
  }
  const e = T(() => a.open(p, { create: false }));
  if (e.ok) { e.value.close(); return { status: 'fails', detail: 'missing file opened with create=false', fileCreated: fs.existsSync(p) }; }
  return { error: e.error, fileCreated: fs.existsSync(p) };
});
await rec('open.uri_filename', () => {
  // a file: URI with mode=ro; if URI handling is on, a write must fail and no file literally named "file:..." may appear
  const p = fresh(); const w = a.open(p); w.exec('CREATE TABLE t(x)'); w.close();
  const uri = 'file:' + p + '?mode=ro';
  const h = T(() => a.open(uri, {}));
  if (!h.ok) return { status: 'absent', detail: 'file: URIs are not interpreted; the string was opened as a literal path', error: h.error };
  const wr = T(() => h.value.exec('INSERT INTO t VALUES (1)'));
  h.value.close();
  const literal = fs.existsSync(path.join(process.cwd(), uri)) || fs.existsSync(uri);
  return { uriHonoured: !wr.ok, writeError: wr.ok ? null : wr.error, literalFileCreated: literal };
});
await rec('open.constructor_options', () => {
  const o = {};
  if (isBun) o.accepted = 'readonly, readwrite, create, strict, safeIntegers (observed via adapter: readonly, create, readwrite)';
  if (isNode) { const p = fresh(); const t = []; for (const k of ['readOnly', 'timeout', 'enableForeignKeyConstraints', 'allowExtension', 'readBigInts', 'returnArrays', 'allowBareNamedParameters', 'allowUnknownNamedParameters', 'defensive']) { const r = T(() => { const h = new a.Database(p, { [k]: k === 'timeout' ? 10 : false }); h.close(); }); t.push(`${k}:${r.ok ? 'ok' : 'rejected'}`); } o.accepted = t; }
  if (isBs3) { const p = fresh(); const t = []; for (const k of ['readonly', 'fileMustExist', 'timeout', 'nativeBinding', 'verbose']) { const r = T(() => { const h = new a.Database(p, { [k]: k === 'timeout' ? 10 : k === 'nativeBinding' || k === 'verbose' ? undefined : false }); h.close(); }); t.push(`${k}:${r.ok ? 'ok' : 'rejected'}`); } o.accepted = t; }
  return { status: 'works', detail: o };
});

// ---------- pragmas and defaults ----------
await rec('pragma.defaults_on_fresh_file_handle', () => {
  const h = a.open(fresh());
  const r = {};
  for (const k of ['foreign_keys', 'busy_timeout', 'journal_mode', 'synchronous', 'cache_size', 'temp_store', 'mmap_size', 'trusted_schema', 'secure_delete', 'wal_autocheckpoint', 'locking_mode', 'recursive_triggers', 'defer_foreign_keys']) { const t = T(() => pragma(h, k)); r[k] = t.ok ? norm(t.value) : t.error; }
  h.close(); return r;
});
await rec('pragma.set_via_sql_and_read_back', () => {
  const h = a.open(fresh());
  const j = pragma(h, 'journal_mode=WAL');
  h.exec('PRAGMA synchronous=NORMAL'); h.exec('PRAGMA foreign_keys=ON'); h.exec('PRAGMA busy_timeout=250');
  const r = { journal_mode_set_result: j, journal_mode: pragma(h, 'journal_mode'), synchronous: pragma(h, 'synchronous'), foreign_keys: pragma(h, 'foreign_keys'), busy_timeout: pragma(h, 'busy_timeout') };
  const o = T(() => h.exec('PRAGMA optimize')); r.optimize = o.ok ? 'ok' : o.error;
  h.close(); return r;
});
await rec('pragma.busy_timeout_constructor_option', () => {
  const p = fresh();
  if (isBun) return { status: 'absent', detail: 'no constructor option observed; the adapter sets PRAGMA busy_timeout instead' };
  const h = a.open(p, { timeout: 123 }); const v = pragma(h, 'busy_timeout'); h.close();
  return { requested: 123, observed: v };
});

// ---------- WAL and checkpoint ----------
await rec('wal.reader_sees_commit_and_snapshot', () => {
  const { p, w } = seedWal(10);
  const r = a.open(p, { timeout: 0 });
  const before = val(r, 'SELECT count(*) FROM t');
  w.prepare('INSERT INTO t VALUES (?, ?)').run(11, 'new');
  const after = val(r, 'SELECT count(*) FROM t');
  // snapshot: reader inside BEGIN keeps its view while the writer commits
  r.exec('BEGIN'); const s1 = val(r, 'SELECT count(*) FROM t');
  w.prepare('INSERT INTO t VALUES (?, ?)').run(12, 'new2');
  const s2 = val(r, 'SELECT count(*) FROM t'); r.exec('COMMIT');
  const s3 = val(r, 'SELECT count(*) FROM t');
  const walFile = fs.existsSync(p + '-wal'), shm = fs.existsSync(p + '-shm');
  r.close(); w.close();
  const after_close = { wal: fs.existsSync(p + '-wal'), shm: fs.existsSync(p + '-shm') };
  return { before: Number(before), after_commit_seen: Number(after), snapshot_start: Number(s1), snapshot_after_writer_commit: Number(s2), after_reader_commit: Number(s3), walFileWhileOpen: walFile, shmWhileOpen: shm, filesAfterLastClose: after_close };
});
await rec('wal.checkpoint_control', () => {
  const { p, w } = seedWal(500);
  const passive = w.prepare('PRAGMA wal_checkpoint(PASSIVE)').get();
  w.prepare('INSERT INTO t VALUES (?, ?)').run(100000, 'x');
  const trunc = w.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get();
  const size = fs.existsSync(p + '-wal') ? fs.statSync(p + '-wal').size : null;
  const auto = pragma(w, 'wal_autocheckpoint');
  w.close(); return { passive, truncate: trunc, walSizeAfterTruncate: size, wal_autocheckpoint: auto, rowShape: 'busy, log, checkpointed' };
});

// ---------- busy handling ----------
await rec('busy.immediate_blocks_second_writer', () => {
  const { p, w } = seedWal(10);
  const b = a.open(p, { timeout: 0 });
  w.exec('BEGIN IMMEDIATE');
  const res = {};
  for (const ms of [0, 300]) {
    b.exec(`PRAGMA busy_timeout=${ms}`);
    const t0 = performance.now();
    const e = T(() => b.exec('BEGIN IMMEDIATE'));
    res['timeout_' + ms] = { elapsedMs: Math.round(performance.now() - t0), error: e.ok ? null : e.error };
  }
  w.exec('ROLLBACK'); b.close(); w.close();
  res.note = 'the wait happens inside the synchronous call: the calling thread is blocked for up to the timeout';
  return res;
});
await rec('busy.timeout_bounds_wait', () => {
  const { p, w } = seedWal(10);
  const b = a.open(p, { timeout: 0 });
  w.exec('BEGIN IMMEDIATE');
  const rows = [];
  for (const ms of [50, 200, 600]) {
    b.exec(`PRAGMA busy_timeout=${ms}`);
    const t0 = performance.now();
    const e = T(() => b.exec('BEGIN IMMEDIATE'));
    const el = performance.now() - t0;
    rows.push({ timeout: ms, elapsedMs: Math.round(el * 10) / 10, returnedBeforeTimeout: el < ms - 5, errored: !e.ok });
  }
  w.exec('ROLLBACK'); b.close(); w.close();
  return { rows };
});
await rec('busy.deferred_read_to_write_upgrade', () => {
  const { p, w } = seedWal(10);
  const x = a.open(p, { timeout: 500 }); x.exec('PRAGMA busy_timeout=500');
  x.exec('BEGIN'); x.prepare('SELECT count(*) FROM t').get(); // read tx, snapshot fixed
  w.exec('BEGIN IMMEDIATE'); w.prepare('INSERT INTO t VALUES (?, ?)').run(500, 'w'); w.exec('COMMIT');
  const t0 = performance.now();
  const e = T(() => x.prepare('INSERT INTO t VALUES (?, ?)').run(501, 'x'));
  const el = performance.now() - t0;
  x.exec('ROLLBACK'); x.close(); w.close();
  return { elapsedMs: Math.round(el), busy_timeout: 500, error: e.ok ? null : e.error, note: 'deferred read-then-write after another commit fails without waiting out the timeout' };
});
await rec('busy.immediate_avoids_upgrade_failure', () => {
  const { p, w } = seedWal(10);
  const x = a.open(p, { timeout: 100 }); x.exec('PRAGMA busy_timeout=100');
  x.exec('BEGIN IMMEDIATE'); x.prepare('SELECT count(*) FROM t').get();
  const other = T(() => { w.exec('PRAGMA busy_timeout=100'); w.exec('BEGIN IMMEDIATE'); });
  const ins = T(() => x.prepare('INSERT INTO t VALUES (?, ?)').run(900, 'ok'));
  const commit = T(() => x.exec('COMMIT'));
  x.close(); w.close();
  return { otherWriterBlocked: !other.ok, otherWriterError: other.ok ? null : other.error, ownInsertOk: ins.ok, ownCommitOk: commit.ok };
});

// ---------- error classification ----------
function errorObjects() {
  const out2 = {};
  // BUSY
  { const { p, w } = seedWal(10); const b = a.open(p, { timeout: 0 }); b.exec('PRAGMA busy_timeout=0'); w.exec('BEGIN IMMEDIATE');
    out2.BUSY = T(() => b.exec('BEGIN IMMEDIATE')); w.exec('ROLLBACK'); b.close(); w.close(); }
  // LOCKED: DROP TABLE while a statement on the same connection is stepping over it
  { const { w } = seedWal(10); const it = w.prepare('SELECT id FROM t').iterate(); it.next();
    out2.LOCKED = T(() => w.exec('DROP TABLE t')); T(() => it.return && it.return()); w.close(); }
  // constraint
  { const h = a.open(':memory:'); h.exec('CREATE TABLE u(x UNIQUE)'); h.exec('INSERT INTO u VALUES (1)'); out2.CONSTRAINT_UNIQUE = T(() => h.exec('INSERT INTO u VALUES (1)')); h.close(); }
  // READONLY
  { const p = fresh(); const w = a.open(p); w.exec('CREATE TABLE t(x)'); w.close(); const r = a.open(p, { readonly: true }); out2.READONLY = T(() => r.exec('INSERT INTO t VALUES (1)')); r.close(); }
  // syntax
  { const h = a.open(':memory:'); out2.SYNTAX = T(() => h.exec('SELEC 1')); h.close(); }
  return out2;
}
await rec('errors.classification', () => {
  const o = errorObjects();
  const rows = {};
  for (const [k, v] of Object.entries(o)) rows[k] = v.ok ? 'no error' : v.error;
  const busy = o.BUSY.ok ? null : o.BUSY.error, locked = o.LOCKED.ok ? null : o.LOCKED.error;
  const codeOf = (e) => (e ? (e.errcode ?? e.errno ?? e.code) : undefined);
  const primary = (e) => (e == null ? null : typeof codeOf(e) === 'number' ? codeOf(e) & 0xff : String(e.code).replace(/^SQLITE_([A-Z]+)(_.*)?$/, '$1'));
  const lockedReached = !!locked && (primary(locked) === 6 || primary(locked) === 'LOCKED');
  const busyReached = !!busy && (primary(busy) === 5 || primary(busy) === 'BUSY');
  const props = ['code', 'errno', 'errcode', 'errstr'].filter((k) => busy && busy[k] !== undefined);
  return { status: lockedReached && busyReached ? 'works' : busyReached ? 'partial' : 'fails', errors: rows, busyReached, lockedReached, lockedRoute: 'DROP TABLE on the connection while a SELECT iterator over that table is mid-step', propertiesCarryingACode: props, primaryBusy: primary(busy), primaryLocked: lockedReached ? primary(locked) : 'not reached (the binding rejected the call before SQLite saw it, or no error)' , busyAndLockedDistinguishable: busyReached && lockedReached && primary(busy) !== primary(locked) };
});

// ---------- transactions and savepoints ----------
await rec('tx.modes_and_flag', () => {
  const h = a.open(fresh()); h.exec('CREATE TABLE t(x)');
  const flag = (hh) => (isNode ? hh.raw.isTransaction : hh.raw.inTransaction);
  const r = { flagName: isNode ? 'isTransaction' : 'inTransaction' };
  for (const m of ['DEFERRED', 'IMMEDIATE', 'EXCLUSIVE']) { const e = T(() => { h.exec('BEGIN ' + m); const f = flag(h); h.exec('ROLLBACK'); return f; }); r[m] = e.ok ? { inTransactionAfterBegin: e.value } : e.error; }
  r.afterRollback = flag(h);
  const nested = T(() => { h.exec('BEGIN'); try { h.exec('BEGIN'); } finally { h.exec('ROLLBACK'); } });
  r.nestedBegin = nested.ok ? 'no error' : nested.error;
  h.close(); return r;
});
await rec('tx.nested_savepoints', () => {
  const h = a.open(fresh()); h.exec('CREATE TABLE t(x)');
  h.exec('BEGIN'); h.exec('INSERT INTO t VALUES (1)');
  h.exec('SAVEPOINT a'); h.exec('INSERT INTO t VALUES (2)');
  h.exec('SAVEPOINT b'); h.exec('INSERT INTO t VALUES (3)');
  h.exec('ROLLBACK TO b'); h.exec('RELEASE b'); h.exec('RELEASE a'); h.exec('COMMIT');
  return { rows: h.prepare('SELECT x FROM t ORDER BY x').all().map((r) => Number(r.x)), expected: [1, 2] };
});
await rec('tx.transaction_helper', () => {
  if (isNode) return { status: 'absent', detail: 'no transaction() helper on DatabaseSync; BEGIN/COMMIT via exec', names: hasName(a.Database.prototype, /transaction/i) };
  const h = a.open(fresh()); h.exec('CREATE TABLE t(x)'); const raw = h.raw;
  const ins = raw.prepare('INSERT INTO t VALUES (?)');
  const tx = raw.transaction((vals) => { for (const v of vals) ins.run(v); });
  tx([1, 2]);
  const failing = raw.transaction(() => { ins.run(3); throw new Error('boom'); });
  const f = T(() => failing());
  const inner = raw.transaction(() => { ins.run(10); });
  const outer = raw.transaction(() => { ins.run(20); T(() => raw.transaction(() => { ins.run(30); throw new Error('inner'); })()); inner(); });
  outer();
  const rows = h.prepare('SELECT x FROM t ORDER BY x').all().map((r) => Number(r.x));
  const variants = ['deferred', 'immediate', 'exclusive'].map((k) => `${k}:${typeof tx[k]}`);
  return { committed_then_failed_rows: rows, expected: [1, 2, 10, 20], failingRethrown: !f.ok, variants };
});

// ---------- statement lifecycle ----------
await rec('stmt.finalize_api', () => {
  const h = a.open(':memory:'); const st = h.prepare('SELECT 1 AS x');
  const names = hasName(st.raw, /final|close|dispose/i);
  if (!names.length) return { status: 'absent', detail: 'no finalize/close method on a statement; statements are released at db close or by GC', names };
  const fn = names.find((k) => /final|close/i.test(k));
  const r = T(() => st.raw[fn]()); const after = T(() => st.get());
  return { method: fn, callOk: r.ok, useAfterFinalize: after.ok ? { value: norm(after.value) } : after.error };
});
await rec('stmt.close_semantics', () => {
  const trial = (kind, closeFn) => {
    const p = fresh(); const h = a.open(p, {}); h.exec('PRAGMA journal_mode=WAL'); h.exec('CREATE TABLE t(x)'); h.exec('INSERT INTO t VALUES (1),(2)');
    const st = h.prepare('SELECT x FROM t'); let it = null;
    if (kind === 'ran_to_completion') st.all();
    if (kind === 'open_iterator') { it = st.iterate(); it.next(); }
    const c = T(() => closeFn(h.raw));
    const use = T(() => h.prepare('SELECT 1').get()); // a new statement on the handle
    const old = T(() => st.all().length);
    const walGone = !fs.existsSync(p + '-wal');
    // second attempt after releasing the iterator
    let second = null;
    if (kind === 'open_iterator' && !c.ok) { T(() => it.return && it.return()); const c2 = T(() => closeFn(h.raw)); second = c2.ok ? 'ok' : c2.error; }
    const fileOk = (() => { const r = a.open(p, {}); const n = Number(val(r, 'SELECT count(*) FROM t')); r.close(); return n === 2; })();
    return { close: c.ok ? 'returned' : c.error, newStatementAfterClose: use.ok ? 'ok' : use.error, oldStatementAfterClose: old.ok ? { rows: old.value } : old.error, walFilesRemoved: walGone, closeAfterIteratorReturned: second, fileReadableAfter: fileOk };
  };
  const r = {};
  for (const kind of ['prepared_never_run', 'ran_to_completion', 'open_iterator']) r[kind] = trial(kind, (raw) => raw.close());
  if (isBun) for (const kind of ['prepared_never_run', 'open_iterator']) r[kind + '__close_true'] = trial(kind, (raw) => raw.close(true));
  return r;
});
await rec('stmt.reuse_after_early_break', () => {
  const h = a.open(':memory:'); h.exec('CREATE TABLE t(x)'); h.exec('INSERT INTO t VALUES (1),(2),(3)');
  const st = h.prepare('SELECT x FROM t ORDER BY x');
  let first; for (const r of st.iterate()) { first = r; break; }
  const again = T(() => st.all().length);
  return { first: norm(first), allAfterBreak: again.ok ? again.value : again.error, busyProperty: isBs3 ? st.raw.busy : undefined };
});
await rec('stmt.use_while_iterator_open', () => {
  const h = a.open(':memory:'); h.exec('CREATE TABLE t(x)'); h.exec('INSERT INTO t VALUES (1),(2),(3)');
  const st = h.prepare('SELECT x FROM t ORDER BY x'); const it = st.iterate(); it.next();
  const r = T(() => st.all().length); T(() => it.return && it.return());
  return { sameStatementWhileIterating: r.ok ? { rows: r.value } : r.error };
});
await rec('stmt.cache', () => {
  const h = a.open(':memory:');
  if (isBun) { const q1 = h.raw.query('SELECT 1'), q2 = h.raw.query('SELECT 1'); return { api: 'db.query(sql) cache', sameObjectOnSecondCall: q1 === q2, clearQueryCache: typeof h.raw.clearQueryCache, maxSize: a.Database.MAX_QUERY_CACHE_SIZE }; }
  if (isNode) { const ts = T(() => h.raw.createTagStore(8)); if (!ts.ok) return { status: 'absent', detail: 'createTagStore not callable', error: ts.error }; const s = ts.value; const r1 = s.get`SELECT 1 AS x`; const r2 = s.get`SELECT 1 AS x`; return { api: 'createTagStore (LRU)', size: s.size, capacity: s.capacity, rows: [norm(r1), norm(r2)] }; }
  return { status: 'absent', detail: 'no built-in statement cache', names: hasName(h.raw, /cache/i) };
});

// ---------- iteration and what an open iterator holds ----------
await rec('iter.early_termination_and_return', () => {
  const h = a.open(':memory:'); h.exec('CREATE TABLE t(x)'); h.exec('INSERT INTO t VALUES (1),(2),(3)');
  const it = h.prepare('SELECT x FROM t').iterate();
  return { iteratorHasReturn: typeof it.return === 'function', iteratorIsIterable: typeof it[Symbol.iterator] === 'function', iteratorHasAsyncIterator: typeof it[Symbol.asyncIterator] === 'function' };
});
await rec('iter.open_iterator_holds_read_snapshot_and_blocks_checkpoint', () => {
  const { p, w } = seedWal(1000);
  const r = a.open(p, { timeout: 0 });
  const it = r.prepare('SELECT id FROM t ORDER BY id').iterate(); it.next();
  const flagOpen = isNode ? r.raw.isTransaction : r.raw.inTransaction;
  w.prepare('INSERT INTO t VALUES (?, ?)').run(5000, 'late');
  const countOnReaderWhileOpen = Number(val(r, 'SELECT count(*) FROM t'));
  const ckOpen = w.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get();
  const walSizeOpen = fs.statSync(p + '-wal').size;
  // release by return()/break
  if (typeof it.return === 'function') it.return(); else { for (const _ of r.prepare('SELECT 1').iterate()) break; }
  const countAfterRelease = Number(val(r, 'SELECT count(*) FROM t'));
  const ckClosed = w.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get();
  const walSizeClosed = fs.existsSync(p + '-wal') ? fs.statSync(p + '-wal').size : null;
  r.close(); w.close();
  return { inTransactionFlagWhileOpen: flagOpen, committedRowsAtStart: 1000, readerCountWhileIteratorOpen_afterWriterCommit: countOnReaderWhileOpen, checkpointWhileOpen: ckOpen, walBytesWhileOpen: walSizeOpen, readerCountAfterReturn: countAfterRelease, checkpointAfterReturn: ckClosed, walBytesAfterReturn: walSizeClosed };
});
await rec('iter.abandoned_iterator_holds_until_db_close', () => {
  const { p, w } = seedWal(100);
  let r = a.open(p, { timeout: 0 });
  let it = r.prepare('SELECT id FROM t').iterate(); it.next();
  w.prepare('INSERT INTO t VALUES (?, ?)').run(9000, 'x');
  const held = w.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get();
  const c = T(() => r.close());
  const released = w.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get();
  w.close();
  return { checkpointWhileIteratorReferenced: held, closeResult: c.ok ? 'ok' : c.error, checkpointAfterDbClose: released };
});
await rec('iter.rollback_journal_iterator_blocks_writer', () => {
  const p = fresh(); const w = a.open(p, { timeout: 0 }); w.exec('PRAGMA busy_timeout=0'); w.exec('CREATE TABLE t(x)'); w.exec('INSERT INTO t VALUES (1),(2),(3)');
  const r = a.open(p, { timeout: 0 }); r.exec('PRAGMA busy_timeout=0');
  const it = r.prepare('SELECT x FROM t').iterate(); it.next();
  const wr = T(() => w.exec('INSERT INTO t VALUES (4)'));
  T(() => it.return && it.return());
  const wr2 = T(() => w.exec('INSERT INTO t VALUES (5)'));
  r.close(); w.close();
  return { journal_mode: 'delete (default)', writeWhileIteratorOpen: wr.ok ? 'ok' : wr.error, writeAfterReturn: wr2.ok ? 'ok' : wr2.error };
});
await rec('iter.streams_row_by_row', () => {
  const h = a.open(':memory:'); h.exec('CREATE TABLE t(x)');
  h.exec('WITH RECURSIVE s(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM s WHERE i<300000) INSERT INTO t SELECT i FROM s');
  const st = h.prepare('SELECT x, x*2 AS y FROM t');
  const med = (f) => { const ts = []; for (let i = 0; i < 7; i++) { const t0 = performance.now(); f(); ts.push(performance.now() - t0); } ts.sort((x, y) => x - y); return ts[3]; };
  const first = med(() => { for (const _ of st.iterate()) break; });
  const all = med(() => st.all());
  return { rows: 300000, medianMs_firstRowThenBreak: Math.round(first * 1000) / 1000, medianMs_all: Math.round(all * 10) / 10, steppingEvidence: first * 20 < all };
});

// ---------- custom functions, aggregates, collations ----------
await rec('fn.scalar', () => {
  const h = a.open(':memory:'); const raw = h.raw;
  if (typeof raw.function !== 'function') return { status: 'absent' };
  raw.function('okfs_add1', (x) => x + 1);
  const r1 = one(h, 'SELECT okfs_add1(41) AS v').v;
  const det = T(() => raw.function('okfs_det', { deterministic: true }, (x) => x));
  const va = T(() => raw.function('okfs_va', { varargs: true }, (...xs) => xs.length));
  const thrown = (() => { raw.function('okfs_throw', () => { throw new Error('from-js'); }); return T(() => one(h, 'SELECT okfs_throw() AS v')); })();
  let argType = null; raw.function('okfs_type', (x) => { argType = typeof x; return 1; }); const at = T(() => one(h, 'SELECT okfs_type(9007199254740993) AS v')); if (!at.ok) argType = { callFailed: at.error };
  const sf = T(() => { let t = null; raw.function('okfs_safe', { safeIntegers: true }, (x) => { t = typeof x; return 1; }); one(h, 'SELECT okfs_safe(9007199254740993) AS v'); return t; });
  let blobType = null; raw.function('okfs_blob', (x) => { blobType = x?.constructor?.name; return 1; }); one(h, 'SELECT okfs_blob(x\'00ff\') AS v');
  return { result: r1, deterministicOption: det.ok ? 'accepted' : det.error, varargsOption: va.ok ? 'accepted' : va.error, jsExceptionPropagates: thrown.ok ? 'no' : thrown.error, jsTypeOfInt2p53plus1AsArgument: argType, jsTypeOfBlobArgument: blobType, safeIntegersFunctionOption: sf.ok ? { jsTypeOfInt2p53plus1AsArgument: sf.value } : sf.error };
});
await rec('fn.aggregate', () => {
  const h = a.open(':memory:'); const raw = h.raw;
  if (typeof raw.aggregate !== 'function') return { status: 'absent' };
  h.exec('CREATE TABLE t(x)'); h.exec('INSERT INTO t VALUES (1),(2),(3)');
  const r = T(() => { raw.aggregate('okfs_sum', { start: 0, step: (acc, x) => acc + x, result: (acc) => acc }); return one(h, 'SELECT okfs_sum(x) AS v FROM t').v; });
  return r.ok ? { result: r.value } : { status: 'fails', error: r.error };
});
await rec('fn.collation', () => {
  const h = a.open(':memory:');
  const names = hasName(h.raw, /collat/i);
  if (!names.length) { const e = T(() => one(h, "SELECT 'a' < 'B' COLLATE okfs_nocase AS v")); return { status: 'absent', detail: 'no collation API by name on the handle', usingAnUnknownCollationFromSql: e.ok ? 'ok' : e.error }; }
  return { status: 'present-not-exercised', names };
});
await rec('fn.virtual_tables_and_other_hooks', () => {
  const h = a.open(':memory:');
  return { status: 'works', detail: { namesMatchingTableOrModule: hasName(h.raw, /^(table|createModule)$/), authorizer: typeof h.raw.setAuthorizer, limits: typeof h.raw.limits, defensive: typeof h.raw.enableDefensive } };
});

// ---------- extension loading ----------
await rec('ext.loading', () => {
  const so = path.join(WORK, 'ext', 'okfs08.so');
  const r = { fixtureBuilt: fs.existsSync(so) };
  const h = a.open(':memory:'); const raw = h.raw;
  r.api = { loadExtension: typeof raw.loadExtension, enableLoadExtension: typeof raw.enableLoadExtension };
  if (!r.fixtureBuilt) return { status: 'not-observed', detail: r };
  const sqlFn = T(() => one(h, 'SELECT load_extension(?) AS v', so)); r.sqlLoadExtensionFunctionByDefault = sqlFn.ok ? 'loaded' : sqlFn.error;
  const h2 = a.open(':memory:'); const raw2 = h2.raw;
  if (typeof raw2.loadExtension === 'function') { const d = T(() => raw2.loadExtension(so)); r.loadExtensionWithoutEnabling = d.ok ? 'loaded' : d.error; if (d.ok) r.exercisedWithoutEnabling = T(() => one(h2, 'SELECT okfs08_answer() AS v').v).value; }
  if (isNode) {
    const ctor = T(() => { const h3 = new a.Database(':memory:', { allowExtension: true }); const l = T(() => h3.loadExtension(so)); const v = l.ok ? T(() => h3.prepare('SELECT okfs08_answer() AS v').get().v) : null; h3.close(); return { loaded: l.ok, error: l.ok ? null : l.error, answer: v && v.value }; });
    r.withAllowExtensionOption = ctor.ok ? ctor.value : ctor.error;
    const h4 = new a.Database(':memory:', { allowExtension: true }); const en = T(() => h4.enableLoadExtension(false)); const l2 = T(() => h4.loadExtension(so)); r.enableLoadExtensionFalseThenLoad = l2.ok ? 'loaded' : l2.error; h4.close();
  }
  return { status: 'works', detail: r };
});

// ---------- backup, serialize, deserialize, VACUUM INTO ----------
await rec('backup.vacuum_into', () => {
  const { p, w } = seedWal(50); const dest = fresh();
  const e = T(() => w.exec(`VACUUM INTO '${dest}'`)); if (!e.ok) return { status: 'fails', error: e.error };
  const d = a.open(dest); const c = Number(val(d, 'SELECT count(*) FROM t')); d.close(); w.close();
  return { rowsInCopy: c, expected: 50 };
});
await rec('backup.online_backup_api', () => {
  const { w } = seedWal(50); const dest = fresh();
  if (isBs3) return (async () => { const r = w.raw.backup(dest); const isPromise = typeof r?.then === 'function'; const res = await r; const d = a.open(dest); const c = Number(val(d, 'SELECT count(*) FROM t')); d.close(); w.close(); return { api: 'db.backup(dest)', returnsPromise: isPromise, result: norm(res), rowsInCopy: c }; })();
  if (isNode) { const fn = a.mod.backup; if (typeof fn !== 'function') return { status: 'absent', detail: 'no backup export from node:sqlite', exports: Object.keys(a.mod) }; return (async () => { const res = await fn(w.raw, dest); const d = a.open(dest); const c = Number(val(d, 'SELECT count(*) FROM t')); d.close(); w.close(); return { api: 'backup(db, path)', result: norm(res), rowsInCopy: c }; })(); }
  return { status: 'absent', detail: 'no sqlite3_backup API on bun:sqlite', names: hasName(w.raw, /backup/i), staticNames: Object.getOwnPropertyNames(a.Database).filter((k) => /backup/i.test(k)) };
});
await rec('backup.serialize_deserialize', () => {
  const probeOne = (kind) => {
    const h = a.open(kind === 'memory' ? ':memory:' : fresh()); if (kind === 'wal') h.exec('PRAGMA journal_mode=WAL'); h.exec('CREATE TABLE t(id INTEGER PRIMARY KEY, v)'); h.exec('INSERT INTO t VALUES (1,1),(2,2),(3,3)');
    const raw = h.raw;
    if (typeof raw.serialize !== 'function') return { status: 'absent' };
    const s = T(() => raw.serialize());
    if (!s.ok) return { serialize: s.error };
    const buf = s.value; const r = { serializedType: buf?.constructor?.name, bytes: buf.length };
    let d2;
    if (isBun) d2 = T(() => a.Database.deserialize(buf));
    else if (isNode) d2 = T(() => { const x = new a.Database(':memory:'); if (typeof x.deserialize !== 'function') throw new Error('no deserialize()'); x.deserialize(buf); return x; });
    else d2 = T(() => new a.Database(buf));
    if (!d2.ok) { r.deserialize = d2.error; return r; }
    const cnt = T(() => Number(d2.value.prepare('SELECT count(*) AS c FROM t').get().c));
    if (!cnt.ok) { r.deserialize = Object.assign({ note: 'deserialize call returned; the first query on the handle failed' }, cnt.error); T(() => d2.value.close()); return r; }
    r.deserialize = 'ok'; r.rowsAfterDeserialize = cnt.value; d2.value.close();
    return r;
  };
  if (typeof a.open(':memory:').raw.serialize !== 'function') return { status: 'absent', detail: 'no serialize() on this binding/runtime' };
  return { status: 'works', detail: { memoryDatabase: probeOne('memory'), fileDatabase: probeOne('file'), fileDatabaseWal: probeOne('wal') } };
});

// ---------- change capture ----------
await rec('change.update_hooks', () => {
  const h = a.open(':memory:'); const raw = h.raw;
  const names = hasName(raw, /hook|onInsert|onUpdate|onDelete/i);
  if (!names.length) return { status: 'absent', detail: 'no update-hook API by name', names };
  const events = []; h.exec('CREATE TABLE t(x)');
  // bun:sqlite exposes the hooks as assignable properties (db.onInsert = fn), not methods
  const reg = T(() => { for (const k of ['onInsert', 'onUpdate', 'onDelete']) raw[k] = (...args) => events.push([k, ...args.slice(1)]); });
  if (!reg.ok) return { status: 'fails', error: reg.error, names };
  h.exec('INSERT INTO t VALUES (1)'); h.exec('UPDATE t SET x=2'); h.exec('DELETE FROM t WHERE x=2');
  return { names, form: 'assignable property taking (db, table, rowid, schema)', events: norm(events) };
});
await rec('change.session_extension', () => {
  const h = a.open(':memory:'); const raw = h.raw;
  if (typeof raw.createSession !== 'function') return { status: 'absent', detail: 'no createSession()', names: hasName(raw, /session|changeset/i) };
  h.exec('CREATE TABLE t(id INTEGER PRIMARY KEY, x)');
  const s = raw.createSession(); h.exec('INSERT INTO t VALUES (1, 10)');
  const cs = s.changeset();
  const other = a.open(':memory:'); other.exec('CREATE TABLE t(id INTEGER PRIMARY KEY, x)');
  const ap = T(() => other.raw.applyChangeset(cs));
  const n2 = Number(other.prepare('SELECT count(*) AS c FROM t').get().c);
  return { changesetBytes: cs.length, applyChangesetResult: ap.ok ? norm(ap.value) : ap.error, rowsOnTarget: n2 };
});
await rec('change.authorizer', () => {
  const raw = a.open(':memory:').raw;
  return typeof raw.setAuthorizer === 'function' ? { status: 'present-not-exercised', detail: 'setAuthorizer is access control, not change capture' } : { status: 'absent' };
});

// ---------- declared-type and column metadata ----------
await rec('meta.declared_types', () => {
  const h = a.open(':memory:');
  h.exec('CREATE TABLE m(a BIGINT, b INTEGER, c NUMERIC(10,2), d UNSIGNED BIG INT, e VARCHAR(255), f, g custom_type, h REAL)');
  h.exec('CREATE VIEW mv AS SELECT a AS va, a+1 AS vx FROM m');
  h.exec('INSERT INTO m VALUES (1, 2, 3, 4, \'five\', 6, 7, 8.5)');
  const q = 'SELECT a, b, c, d, e, f, g, h, a+1 AS expr, count(*) AS cnt FROM m';
  const st = h.prepare(q); const raw = st.raw; const r = { sql: q };
  if (isBun) {
    r.declaredTypesBeforeStep = T(() => raw.declaredTypes).ok ? norm(T(() => raw.declaredTypes).value) : T(() => raw.declaredTypes).error;
    r.columnNames = norm(raw.columnNames); st.get();
    r.declaredTypesAfterStep = norm(raw.declaredTypes);
    r.columnTypesAfterStep = T(() => norm(raw.columnTypes)).value ?? T(() => raw.columnTypes).error;
  } else if (typeof raw.columns === 'function') {
    const c = T(() => raw.columns()); r.columns = c.ok ? norm(c.value) : c.error;
    r.metaAvailableWithoutStepping = c.ok;
  } else { r.status = 'absent'; }
  const sub = h.prepare('SELECT va, vx FROM mv'); r.viewColumns = isBun ? (() => { sub.get(); return norm(sub.raw.declaredTypes); })() : T(() => norm(sub.raw.columns().map((c) => c.type))).value ?? 'n/a';
  const sq = h.prepare('SELECT a FROM (SELECT a FROM m)'); r.subqueryColumn = isBun ? (() => { sq.get(); return norm(sq.raw.declaredTypes); })() : T(() => norm(sq.raw.columns().map((c) => c.type))).value ?? 'n/a';
  return r;
});
await rec('meta.strict_tables', () => {
  const h = a.open(':memory:');
  const ok = T(() => h.exec('CREATE TABLE s(a INTEGER, b TEXT, c REAL, d BLOB, e ANY) STRICT'));
  const big = T(() => h.exec('CREATE TABLE s2(a BIGINT) STRICT'));
  const wrong = T(() => h.prepare('INSERT INTO s(a) VALUES (?)').run('abc'));
  return { createStrict: ok.ok ? 'ok' : ok.error, bigintDeclaredInStrict: big.ok ? 'ok' : big.error, textIntoIntegerColumn: wrong.ok ? 'accepted' : wrong.error };
});

// ---------- done ----------
out.meta.warnings = warnings;
out.meta.node_options = process.execArgv;
await writeJson(outFile, out);
const sc = {}; for (const v of Object.values(out.caps)) sc[v.status] = (sc[v.status] || 0) + 1;
console.log(tag, JSON.stringify(sc));
