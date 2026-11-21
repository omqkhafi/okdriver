// FS-08 Durable Objects SQLite probe. Runs inside the repo's pinned workerd (local only).
// GET /probe runs every check inside one Durable Object with SQLite storage and returns JSON.
// Every value in the output was observed on LOCAL workerd; nothing here is a statement about production Cloudflare.
import { DurableObject } from 'cloudflare:workers';

const desc = (e) => ({ name: e?.name, ctor: e?.constructor?.name, message: String(e?.message).slice(0, 400), code: e?.code, isError: e instanceof Error, stackFirstFrame: undefined });
const T = (fn) => { try { return { ok: true, value: fn() }; } catch (e) { return { ok: false, error: desc(e) }; } };
const norm = (v) => JSON.parse(JSON.stringify(v, (k, x) => (typeof x === 'bigint' ? `${x}n` : x instanceof ArrayBuffer ? `ArrayBuffer(${x.byteLength})` : ArrayBuffer.isView(x) ? `${x.constructor.name}(${x.length})` : x === undefined ? null : x)) ?? null);
const typeOf = (v) => (v === null ? 'null' : v instanceof ArrayBuffer ? 'ArrayBuffer' : ArrayBuffer.isView(v) ? v.constructor.name : typeof v);
const proto = (o) => { const s = new Set(); let p = o; while (p && p !== Object.prototype) { Object.getOwnPropertyNames(p).forEach((k) => s.add(k)); p = Object.getPrototypeOf(p); } s.delete('constructor'); return [...s].sort(); };

export class Probe extends DurableObject {
  async fetch() {
    const out = {};
    const rec = async (id, fn) => { try { const v = await fn(); out[id] = { status: 'local-observed', detail: norm(v) }; } catch (e) { out[id] = { status: 'local-observed', threw: desc(e) }; } };
    const storage = this.ctx.storage, sql = storage.sql;

    await rec('api.shape', () => ({
      storageMembers: proto(storage), sqlMembers: proto(sql), sqlType: sql?.constructor?.name, hasKv: typeof storage.kv,
      execIsSync: !(sql.exec('SELECT 1') instanceof Promise), transactionSyncIsSync: !(storage.transactionSync(() => 1) instanceof Promise),
      transactionIsAsync: storage.transaction(async () => 1) instanceof Promise,
    }));
    await rec('api.versions_and_options', () => {
      const one = (q) => { const x = T(() => Object.values(sql.exec(q).one())[0]); return x.ok ? x.value : x.error.message; };
      return { sqlite_version: one('SELECT sqlite_version()'), sqlite_source_id: one('SELECT sqlite_source_id()'), compileoption_used: one("SELECT sqlite_compileoption_used('ENABLE_FTS5')"),
        compile_options_pragma: (() => { const x = T(() => sql.exec('PRAGMA compile_options').toArray().map((r) => Object.values(r)[0])); return x.ok ? x.value : x.error.message; })(),
        pragma_function_list: (() => { const x = T(() => sql.exec('PRAGMA function_list').toArray().length); return x.ok ? x.value : x.error.message; })(), databaseSize: sql.databaseSize };
    });
    await rec('cursor.shape', () => {
      sql.exec('CREATE TABLE IF NOT EXISTS c(a INTEGER, b TEXT)'); sql.exec('DELETE FROM c'); sql.exec("INSERT INTO c VALUES (1,'x'),(2,'y'),(3,'z')");
      const cur = sql.exec('SELECT a, b FROM c ORDER BY a');
      const r = { cursorCtor: cur.constructor.name, members: proto(cur), columnNames: cur.columnNames, isIterable: typeof cur[Symbol.iterator] === 'function', isAsyncIterable: typeof cur[Symbol.asyncIterator] === 'function' };
      const first = cur.next(); r.nextResult = { done: first.done, valueType: typeOf(first.value), valuePrototype: first.value && Object.getPrototypeOf(first.value) === Object.prototype ? 'Object.prototype' : String(Object.getPrototypeOf(first.value)) };
      r.rest = cur.toArray().length; r.rowsRead = cur.rowsRead; r.rowsWritten = cur.rowsWritten;
      const raw = [...sql.exec('SELECT a, b FROM c ORDER BY a').raw()]; r.rawShape = raw[0];
      r.oneOnMany = T(() => sql.exec('SELECT a FROM c').one()); r.oneOnEmpty = T(() => sql.exec('SELECT a FROM c WHERE a = 99').one());
      return r;
    });
    await rec('cursor.laziness_and_invalidation', () => {
      sql.exec('CREATE TABLE IF NOT EXISTS lz(a INTEGER)'); sql.exec('DELETE FROM lz');
      for (let i = 1; i <= 5; i++) sql.exec('INSERT INTO lz VALUES (?)', i);
      const cur = sql.exec('SELECT a FROM lz ORDER BY a'); const first = cur.next().value.a;
      const w = T(() => sql.exec('INSERT INTO lz VALUES (100)')); // write while a cursor is mid-iteration
      const rest = T(() => cur.toArray().map((x) => x.a));
      const wBad = T(() => sql.exec('INSERT INTO nope VALUES (1)')); // error raised at exec time or at first next()?
      return { first, writeDuringOpenCursor: w.ok ? 'ok' : w.error, restAfterWrite: rest.ok ? rest.value : rest.error, errorAtExecTime: !wBad.ok };
    });

    // integers and blobs
    await rec('integers.read_and_bind', () => {
      sql.exec('CREATE TABLE IF NOT EXISTS i(k INTEGER PRIMARY KEY, n INTEGER, big BIGINT, r REAL)'); sql.exec('DELETE FROM i');
      const vals = ['0', '9007199254740991', '9007199254740992', '9007199254740993', '9223372036854775807', '-9223372036854775808'];
      const rows = [];
      vals.forEach((v, k) => sql.exec(`INSERT INTO i VALUES (${k + 1}, ${v}, ${v}, ${v})`));
      for (const [k, v] of vals.entries()) {
        const r = T(() => sql.exec('SELECT n, big, n + 0 AS expr, r, CAST(n AS TEXT) AS txt, typeof(n) AS t FROM i WHERE k = ?', k + 1).one());
        rows.push({ value: v, result: r.ok ? Object.fromEntries(Object.entries(r.value).map(([c, x]) => [c, `${typeof x}:${String(x)}`])) : r.error });
      }
      const bind = [];
      for (const v of [3, 2 ** 53, 1.5, 9007199254740993n, 9223372036854775807n, 9223372036854775808n]) {
        const r = T(() => sql.exec('SELECT typeof(?) AS t, CAST(? AS TEXT) AS s', v, v).one());
        bind.push({ kind: typeof v, value: String(v), result: r.ok ? r.value : r.error });
      }
      return { rows, bind };
    });
    await rec('blobs.read_and_bind', () => {
      sql.exec('CREATE TABLE IF NOT EXISTS bl(k INTEGER PRIMARY KEY, b BLOB)'); sql.exec('DELETE FROM bl');
      sql.exec('INSERT INTO bl VALUES (1, ?)', new Uint8Array([1, 2, 3]).buffer);
      sql.exec('INSERT INTO bl VALUES (2, ?)', new Uint8Array([4, 5, 6]));
      sql.exec("INSERT INTO bl VALUES (3, X'0A0B')");
      const rows = sql.exec('SELECT k, b, typeof(b) AS t FROM bl ORDER BY k').toArray().map((r) => ({ k: r.k, jsType: typeOf(r.b), len: r.b.byteLength, sqlType: r.t }));
      return { rows };
    });

    // transactions
    await rec('tx.sql_statements_refused', () => {
      const r = {};
      for (const s of ['BEGIN', 'BEGIN IMMEDIATE', 'BEGIN TRANSACTION', 'COMMIT', 'ROLLBACK', 'SAVEPOINT a', 'RELEASE a']) { const x = T(() => sql.exec(s)); r[s] = x.ok ? 'accepted' : x.error; }
      return r;
    });
    await rec('tx.transactionSync', () => {
      sql.exec('CREATE TABLE IF NOT EXISTS tx(a INTEGER)'); sql.exec('DELETE FROM tx');
      const r = {};
      r.commit = storage.transactionSync(() => { sql.exec('INSERT INTO tx VALUES (1)'); return 'returned-value'; });
      const rb = T(() => storage.transactionSync(() => { sql.exec('INSERT INTO tx VALUES (2)'); throw new Error('boom'); }));
      r.throwRolledBack = { rethrown: !rb.ok, errorMessage: rb.ok ? null : rb.error.message, rowsAfter: sql.exec('SELECT a FROM tx ORDER BY a').toArray().map((x) => x.a) };
      const nested = T(() => storage.transactionSync(() => { sql.exec('INSERT INTO tx VALUES (10)'); const inner = T(() => storage.transactionSync(() => { sql.exec('INSERT INTO tx VALUES (11)'); throw new Error('inner'); })); return { innerRethrown: !inner.ok }; }));
      r.nested = nested.ok ? { value: nested.value, rows: sql.exec('SELECT a FROM tx ORDER BY a').toArray().map((x) => x.a) } : nested.error;
      const asyncInSync = T(() => storage.transactionSync(async () => { sql.exec('INSERT INTO tx VALUES (20)'); }));
      r.asyncCallback = asyncInSync.ok ? { returnedPromise: asyncInSync.value instanceof Promise } : asyncInSync.error;
      return r;
    });
    await rec('tx.async_transaction', async () => {
      sql.exec('DELETE FROM tx');
      const r = {};
      r.commit = await storage.transaction(async (txn) => { sql.exec('INSERT INTO tx VALUES (1)'); return 'ok'; });
      const rb = await storage.transaction(async (txn) => { sql.exec('INSERT INTO tx VALUES (2)'); txn.rollback(); }).then(() => 'resolved', (e) => desc(e));
      r.rollbackCall = rb; r.rows = sql.exec('SELECT a FROM tx ORDER BY a').toArray().map((x) => x.a);
      return r;
    });

    // pragmas, extensions, backup-like statements
    await rec('limits.pragmas', () => {
      const r = {};
      for (const p of ['journal_mode', 'foreign_keys', 'synchronous', 'busy_timeout', 'locking_mode', 'user_version', 'page_size', 'page_count', 'cache_size', 'data_version', 'table_list', 'recursive_triggers', 'defer_foreign_keys', 'wal_checkpoint(TRUNCATE)', 'optimize', 'integrity_check', 'foreign_key_check', 'temp_store', 'trusted_schema']) { const x = T(() => sql.exec('PRAGMA ' + p).toArray()); r['read ' + p] = x.ok ? norm(x.value).slice(0, 6) : x.error; }
      for (const p of ['journal_mode=DELETE', 'journal_mode=WAL', 'foreign_keys=OFF', 'foreign_keys=ON', 'synchronous=OFF', 'busy_timeout=1000', 'user_version=7', 'defer_foreign_keys=ON', 'recursive_triggers=ON', 'writable_schema=ON', 'case_sensitive_like=ON']) { const x = T(() => sql.exec('PRAGMA ' + p).toArray()); r['set ' + p] = x.ok ? { accepted: true, result: norm(x.value) } : x.error; }
      return r;
    });
    await rec('limits.statements_and_extensions', () => {
      const r = {};
      const st = { load_extension: "SELECT load_extension('x')", attach: "ATTACH DATABASE ':memory:' AS other", vacuum: 'VACUUM', vacuum_into: "VACUUM INTO '/tmp/x.db'", fts5: 'CREATE VIRTUAL TABLE IF NOT EXISTS f USING fts5(a)', rtree: 'CREATE VIRTUAL TABLE IF NOT EXISTS rt USING rtree(id, a, b)', json: "SELECT json_extract('{\"a\":1}', '$.a') AS v", math: 'SELECT sqrt(4) AS v', strict: 'CREATE TABLE IF NOT EXISTS st(a INTEGER) STRICT', create_temp: 'CREATE TEMP TABLE tt(a)', create_trigger: 'CREATE TABLE IF NOT EXISTS trg(a); CREATE TRIGGER IF NOT EXISTS trg1 AFTER INSERT ON trg BEGIN SELECT 1; END', window: 'SELECT row_number() OVER () AS n FROM (SELECT 1)' };
      for (const [k, s] of Object.entries(st)) { const x = T(() => sql.exec(s).toArray()); r[k] = x.ok ? 'accepted' : x.error; }
      r.fts5_function_check = T(() => sql.exec("SELECT sqlite_compileoption_used('ENABLE_FTS5') AS v").one().v);
      return r;
    });
    await rec('limits.size', () => {
      sql.exec('CREATE TABLE IF NOT EXISTS big(k INTEGER PRIMARY KEY, b BLOB, s TEXT)'); sql.exec('DELETE FROM big');
      const r = {};
      for (const n of [1024 * 1024, 2 * 1024 * 1024 - 1024, 2 * 1024 * 1024 + 1, 4 * 1024 * 1024]) { const x = T(() => sql.exec('INSERT INTO big(b) VALUES (?)', new Uint8Array(n))); r['blob ' + n] = x.ok ? 'accepted' : x.error; }
      for (const n of [50, 100, 101, 200]) { const ph = Array(n).fill('?').join(','); const x = T(() => sql.exec('SELECT ' + ph, ...Array(n).fill(1)).toArray()); r['bound params ' + n] = x.ok ? 'accepted' : x.error; }
      const longSql = 'SELECT 1' + ' + 1'.repeat(40000); r['statement length ' + longSql.length] = (() => { const x = T(() => sql.exec(longSql).toArray()); return x.ok ? 'accepted' : x.error; })();
      let cols = 'a0'; for (let i = 1; i < 120; i++) cols += `, a${i}`; r['create table with 120 columns'] = (() => { const x = T(() => sql.exec('CREATE TABLE IF NOT EXISTS wide(' + cols + ')')); return x.ok ? 'accepted' : x.error; })();
      return r;
    });
    await rec('backup.apis', async () => {
      const r = { storageMembersMatchingBackup: proto(storage).filter((k) => /bookmark|backup|restore|snapshot|export|dump|serialize|sync/i.test(k)) };
      for (const k of ['getCurrentBookmark', 'getBookmarkForTime', 'onNextSessionRestoreBookmark', 'sync', 'deleteAll', 'getAlarm', 'setAlarm']) {
        if (typeof storage[k] !== 'function') { r[k] = 'absent'; continue; }
        if (k === 'getCurrentBookmark') { try { r[k] = { returned: typeof (await storage[k]()) }; } catch (e) { r[k] = { threw: desc(e) }; } }
        else if (k === 'sync') { try { await storage.sync(); r[k] = 'resolved'; } catch (e) { r[k] = { threw: desc(e) }; } }
        else r[k] = 'present-not-exercised';
      }
      return r;
    });
    await rec('errors.classes', () => {
      sql.exec('CREATE TABLE IF NOT EXISTS u(x UNIQUE)'); sql.exec('DELETE FROM u'); sql.exec('INSERT INTO u VALUES (1)');
      const r = {};
      r.unique = T(() => sql.exec('INSERT INTO u VALUES (1)')); r.syntax = T(() => sql.exec('SELEC 1')); r.noTable = T(() => sql.exec('SELECT * FROM missing')); r.badBind = T(() => sql.exec('SELECT ?', {}));
      r.strict = (() => { sql.exec('CREATE TABLE IF NOT EXISTS stt(a INTEGER) STRICT'); return T(() => sql.exec("INSERT INTO stt VALUES ('abc')")); })();
      r.tooFewBindings = T(() => sql.exec('SELECT ?, ?', 1));
      return Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v.ok ? 'no error' : v.error]));
    });
    await rec('model.no_connections_no_busy', () => ({
      openSecondHandle: typeof storage.sql?.open, sqlMembers: proto(sql),
      busyReachable: 'no API opens a second connection to the object database; SQLITE_BUSY has no way to arise in this model (inferred from the API surface, not a documented guarantee)',
      databaseSizeAfter: sql.databaseSize,
    }));
    return Response.json(out);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/ping') return new Response('pong');
    if (url.pathname === '/probe') {
      const stub = env.PROBE.get(env.PROBE.idFromName('fs08'));
      return stub.fetch(request);
    }
    return new Response('not found', { status: 404 });
  },
};
