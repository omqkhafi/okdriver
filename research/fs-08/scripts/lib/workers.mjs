// A tiny cross-runtime worker wrapper: Node worker_threads on Node, the web Worker on Bun.
import { fileURLToPath } from 'node:url';
const BODY = new URL('../worker-thread.mjs', import.meta.url);

export async function spawn(init) {
  let post, terminate, handlers = [];
  if (globalThis.Bun) {
    const w = new Worker(BODY.href);
    w.onmessage = (e) => { for (const h of handlers) h(e.data); };
    w.onerror = (e) => { throw e.error ?? new Error(e.message); };
    post = (m, t) => w.postMessage(m, t || []);
    terminate = () => w.terminate();
  } else {
    const { Worker } = await import('node:worker_threads');
    const w = new Worker(fileURLToPath(BODY));
    w.on('message', (m) => { for (const h of handlers) h(m); });
    w.on('error', (e) => { throw e; });
    post = (m, t) => w.postMessage(m, t || []);
    terminate = () => w.terminate();
  }
  const pending = new Map(); let nextId = 1;
  handlers.push((m) => { const p = pending.get(m.id); if (p) { pending.delete(m.id); m.error ? p.reject(Object.assign(new Error(m.error.message), m.error)) : p.resolve(m); } });
  const call = (msg, transfer) => new Promise((resolve, reject) => { const id = nextId++; pending.set(id, { resolve, reject }); post({ ...msg, id }, transfer); });
  await call({ op: 'init', ...init });
  return { call, terminate };
}
