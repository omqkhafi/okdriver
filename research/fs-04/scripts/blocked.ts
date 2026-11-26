// Destination blocking, observed locally: the same probe Worker on a workerd whose outbound service allows ["public","local"] and one that allows
// only ["public"]. This is workerd's embedder rule, not Cloudflare's production rule; production blocking is documented-only here.
import { Lab, TOKEN, WORKER_PORT, bindings, save } from './lib/harness.ts';
import { startWorkerd } from './lib/workerd.ts';

const lab = new Lab(); await lab.start(['pg17-plain']);
const addrs = [
  { label: 'string form connect("host:port") with no options', str: '127.0.0.1:15418', hostname: '', port: 0 },
  { label: 'loopback proxy port of a listening PostgreSQL', hostname: '127.0.0.1', port: 15418 },
  { label: 'localhost name, same port', hostname: 'localhost', port: 15418 },
  { label: 'loopback port 25 (nothing listens)', hostname: '127.0.0.1', port: 25 },
  { label: 'private address 10.255.255.1 (unrouted)', hostname: '10.255.255.1', port: 5432 },
  { label: 'Cloudflare resolver 1.1.1.1 port 53 over TCP', hostname: '1.1.1.1', port: 53 },
];
const out: any = { note: 'workerd 1.20261118.1 network service, embedder-side rule; not Cloudflare production', configs: {} };
for (const allow of [['public', 'local'], ['public']]) {
  const w = await startWorkerd({ port: WORKER_PORT, bindings: bindings(['pg17-plain']), allow, tag: 'blocked' });
  const r = await (await fetch(`http://127.0.0.1:${WORKER_PORT}/run`, { method: 'POST', headers: { authorization: `Bearer ${TOKEN}` }, body: JSON.stringify({ probe: 'p7.blocked', params: { addrs, timeoutMs: 3000 }, runId: 'blocked' }) })).json() as any;
  out.configs[allow.join('+')] = r.observations;
  await w.stop();
}
lab.proxy.reset();
const w = await startWorkerd({ port: WORKER_PORT, bindings: bindings(['pg17-plain']), tag: 'wt' });
out.writableTypes = ((await (await fetch(`http://127.0.0.1:${WORKER_PORT}/run`, { method: 'POST', headers: { authorization: `Bearer ${TOKEN}` }, body: JSON.stringify({ probe: 'p2.writable-types', params: { target: 'pg17-plain' }, runId: 'wt' }) })).json()) as any).observations;
out.writableTypesBytesAtProxy = Object.fromEntries(Object.keys(out.writableTypes).map((k, i) => [k, lab.proxy.conns[i]?.c2sBytes ?? null]));
await w.stop(); await lab.stop();
save('blocked.json', out);
console.log(JSON.stringify({ types: out.writableTypes, bytesAtProxy: out.writableTypesBytesAtProxy }, null, 1));
