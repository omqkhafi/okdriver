// Worker body for the FS-08 worker benchmark: one read-only connection per worker.
import { getAdapter } from './lib/adapters.mjs';
import { pack } from './lib/pack.mjs';

const isBun = !!globalThis.Bun;
let post, listen;
if (isBun) { post = (m, t) => postMessage(m, t || []); listen = (cb) => { self.onmessage = (e) => cb(e.data); }; }
else { const wt = await import('node:worker_threads'); post = (m, t) => wt.parentPort.postMessage(m, t || []); listen = (cb) => wt.parentPort.on('message', cb); }

let h = null; const stmts = new Map();
const stmt = (sql) => { let s = stmts.get(sql); if (!s) { s = h.prepare(sql); stmts.set(sql, s); } return s; };
listen((m) => {
  try {
    switch (m.op) {
      case 'init': { getAdapter(m.binding).then((a) => { h = a.open(m.dbPath, { readonly: true, timeout: 0 }); post({ id: m.id, ok: true }); }); return; }
      case 'noop': post({ id: m.id, ok: true }); return;
      case 'all': { const rows = stmt(m.sql).all(...m.params); post({ id: m.id, rows }); return; }               // structured clone of row objects
      case 'pack': { const rows = stmt(m.sql).all(...m.params); const buf = pack(rows); post({ id: m.id, buf }, [buf]); return; } // one transferred ArrayBuffer
      case 'get': { const row = stmt(m.sql).get(...m.params); post({ id: m.id, row }); return; }
      case 'close': { h && h.close(); post({ id: m.id, ok: true }); return; }
      default: throw new Error('unknown op ' + m.op);
    }
  } catch (e) { post({ id: m.id, error: { message: String(e.message), code: e.code } }); }
});
