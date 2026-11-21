// Private probe interface for FS-08. One thin adapter per binding.
// It is NOT a proposal for the Driver Contract and does not depend on research/fs-01.
//   open(path, opts) -> Handle { prepare(sql), exec(sql), close(), raw, binding }
//   Stmt { get(...p), all(...p), iterate(...p), run(...p), raw }
//   opts: { readonly, create, intMode: 'number' | 'bigint', timeout }
// Positional parameters only. intMode 'bigint' switches the binding's lossless-integer mode on
// every statement it prepares (safeIntegers / setReadBigInts).
import { loadBinding, runtime } from './rt.mjs';

export async function getAdapter(binding) {
  const b = await loadBinding(binding);
  if (!b.ok) return { ok: false, binding, error: b.error };
  const { Database } = b;
  const rt = runtime();

  function wrapStmt(st, binding, intMode) {
    if (intMode === 'bigint') {
      if (binding === 'node:sqlite') st.setReadBigInts(true);
      else st.safeIntegers(true); // bun:sqlite and better-sqlite3 both name it safeIntegers
    }
    return {
      raw: st,
      get: (...p) => st.get(...p),
      all: (...p) => st.all(...p),
      iterate: (...p) => st.iterate(...p),
      run: (...p) => st.run(...p),
    };
  }

  function open(path, opts = {}) {
    const intMode = opts.intMode ?? 'number';
    let db;
    if (binding === 'bun:sqlite') {
      const o = {};
      if (opts.readonly) o.readonly = true;
      else o.create = opts.create !== false, o.readwrite = true;
      db = new Database(path, o);
      if (opts.timeout != null) db.exec('PRAGMA busy_timeout=' + (opts.timeout | 0));
    } else if (binding === 'node:sqlite') {
      const o = {};
      if (opts.readonly) o.readOnly = true;
      if (opts.timeout != null) o.timeout = opts.timeout;
      db = new Database(path, o);
    } else {
      const o = {};
      if (opts.readonly) o.readonly = true;
      if (opts.create === false) o.fileMustExist = true;
      if (opts.timeout != null) o.timeout = opts.timeout;
      db = new Database(path, o);
    }
    return {
      binding, raw: db, intMode,
      prepare: (sql) => wrapStmt(db.prepare(sql), binding, intMode),
      exec: (sql) => { db.exec(sql); },
      // bun:sqlite close() with live statements leaves the connection open (see stmt.close_semantics); close(true) is the real close
      close: () => (binding === 'bun:sqlite' ? db.close(true) : db.close()),
    };
  }
  return { ok: true, binding, runtime: rt, Database, mod: b.mod, open };
}
