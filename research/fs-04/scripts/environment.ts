// Records what the results were measured on: image digests, server versions, runtime versions, base commit. Needs the servers up.
import { SERVERS, digest } from './lib/servers.ts';
import { Lab, mysqlCli, save } from './lib/harness.ts';
import { WORKERD } from './lib/workerd.ts';

const sh = (a: string[]) => Bun.spawnSync(a, { stdout: 'pipe', stderr: 'pipe' }).stdout.toString().trim();
const lab = new Lab(); await lab.start([]);
const servers: any[] = [];
for (const s of SERVERS) {
  let version = '';
  try { if (s.engine === 'postgres') { if (s.clientCert) version = '(client certificate required: version taken from the same image)'; else { const a = await lab.admin(s.id); version = (await a.q('select version()'))[0]![0]!; } } else version = mysqlCli(s.id, 'select version()'); } catch (e: any) { version = 'unavailable: ' + String(e?.message ?? e).slice(0, 80); }
  const created = sh(['docker', 'inspect', '--format', '{{.Created}}', s.image]);
  servers.push({ id: s.id, engine: s.engine, image: s.image, digest: digest(s.image), version, tls: s.tls, cert: s.cert, clientCertRequired: s.clientCert ?? false, imageCreated: created });
}
await lab.stop();
save('environment.json', {
  baseCommit: sh(['git', 'merge-base', 'HEAD', 'origin/main']),
  workerd: sh([WORKERD, '--version']), workerdCompatibilityDate: '2026-11-01', bun: sh(['bun', '--version']), kernel: sh(['uname', '-sr']), openssl: sh(['openssl', 'version']), docker: sh(['docker', '--version']),
  registryNote: 'Docker Hub answered 429 to unauthenticated pulls; the same official images were pulled from mirror.gcr.io/library (digests recorded here).',
  hostsFileNote: 'pg.fs04.test, wrong.fs04.test, selfsigned.fs04.test and expired.fs04.test were added to /etc/hosts as 127.0.0.1 so that connect-by-name works.',
  embedder: { outboundService: 'network, allow ["public","local"], tlsOptions.trustedCertificates = [test root CA]', note: 'a workerd embedder setting; Cloudflare production has no such file' },
  servers,
});
console.log(servers.map((s) => `${s.id} ${s.version.slice(0, 60)} ${s.digest.slice(-20)}`).join('\n'));
