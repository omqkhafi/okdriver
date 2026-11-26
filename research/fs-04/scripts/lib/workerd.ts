// Starts the repo's pinned workerd (node_modules/.bin/workerd serve) with a generated capnp config.
// Embedder-side settings used here (production has no such file):
//   - globalOutbound is a `network` service that allows `local` (connect() to 127.0.0.1 is refused otherwise);
//   - that service carries tlsOptions.trustedCertificates, without which startTls() refuses ("not supported on this connection").
import { mkdirSync, writeFileSync } from 'node:fs';
import { WORK, ROOT } from './paths.ts';
import { pem } from './certs.ts';

export const WORKERD = ROOT + '../../node_modules/.bin/workerd';
export const COMPAT_DATE = '2026-11-01';

const q = (s: string) => JSON.stringify(s);
export interface WorkerdOpts { port: number; bindings: Record<string, string>; trusted?: string[]; allow?: string[]; keypair?: { cert: string; key: string }; tag?: string }

export function buildBundle(): void {
  const r = Bun.spawnSync(['bun', 'build', ROOT + 'worker/src/index.ts', '--target=browser', '--format=esm', '--external', 'cloudflare:sockets', '--outfile', WORK + 'worker.js'], { stdout: 'pipe', stderr: 'pipe' });
  if (r.exitCode !== 0) throw new Error('bundle failed: ' + r.stderr.toString());
}

export function config(o: WorkerdOpts): string {
  const trusted = (o.trusted ?? [pem('ca.pem')]).map(q).join(', ');
  const kp = o.keypair ? `, keypair = (certificateChain = ${q(o.keypair.cert)}, privateKey = ${q(o.keypair.key)})` : '';
  return `using Workerd = import "/workerd/workerd.capnp";
const config :Workerd.Config = (
  services = [
    (name = "main", worker = .w),
    (name = "internet", network = (allow = [${(o.allow ?? ['public', 'local']).map(q).join(', ')}], tlsOptions = (trustedCertificates = [${trusted}]${kp}))),
  ],
  sockets = [ (name = "http", address = "127.0.0.1:${o.port}", http = (), service = "main") ],
);
const w :Workerd.Worker = (
  modules = [ (name = "worker", esModule = embed "worker.js") ],
  compatibilityDate = ${q(COMPAT_DATE)},
  bindings = [ ${Object.entries(o.bindings).map(([k, v]) => `(name = ${q(k)}, text = ${q(v)})`).join(', ')} ],
  globalOutbound = "internet",
);
`;
}

export interface Running { port: number; stop(): Promise<void>; log(): string; proc: Bun.Subprocess }
export async function startWorkerd(o: WorkerdOpts): Promise<Running> {
  mkdirSync(WORK, { recursive: true });
  const file = WORK + `workerd-${o.tag ?? o.port}.capnp`;
  writeFileSync(file, config(o));
  const proc = Bun.spawn([WORKERD, 'serve', '--verbose', file], { cwd: WORK, stdout: 'pipe', stderr: 'pipe' });
  let out = '';
  const pump = async (s: ReadableStream<Uint8Array>) => { const d = new TextDecoder(); for await (const c of s) out += d.decode(c); };
  void pump(proc.stdout as ReadableStream<Uint8Array>); void pump(proc.stderr as ReadableStream<Uint8Array>);
  const deadline = Date.now() + 15000;
  for (;;) {
    try { const r = await fetch(`http://127.0.0.1:${o.port}/health`); if (r.ok) break; } catch { /* not up yet */ }
    if (Date.now() > deadline || proc.exitCode !== null) throw new Error('workerd did not start:\n' + out);
    await Bun.sleep(40);
  }
  return { port: o.port, log: () => out, proc, async stop() { proc.kill(); await proc.exited; } };
}
