// Local database servers in Docker, bound to 127.0.0.1 only, throwaway password in work/secrets.json (never committed).
// Images come from mirror.gcr.io/library (a mirror of the Docker Hub official images; Docker Hub itself answered 429).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { CERTS, WORK } from './paths.ts';
import { ensureCerts } from './certs.ts';

export interface ServerSpec {
  id: string; engine: 'postgres' | 'mysql' | 'mariadb'; image: string; port: number;
  tls: boolean; cert?: 'pg' | 'selfsigned' | 'expired'; clientCert?: boolean;
}
const IMG = 'mirror.gcr.io/library/';
export const SERVERS: ServerSpec[] = [
  { id: 'pg17-tls', engine: 'postgres', image: IMG + 'postgres:17', port: 55417, tls: true, cert: 'pg' },
  { id: 'pg17-plain', engine: 'postgres', image: IMG + 'postgres:17', port: 55418, tls: false },
  { id: 'pg17-selfsigned', engine: 'postgres', image: IMG + 'postgres:17', port: 55419, tls: true, cert: 'selfsigned' },
  { id: 'pg17-expired', engine: 'postgres', image: IMG + 'postgres:17', port: 55420, tls: true, cert: 'expired' },
  { id: 'pg17-clientcert', engine: 'postgres', image: IMG + 'postgres:17', port: 55421, tls: true, cert: 'pg', clientCert: true },
  { id: 'pg19-tls', engine: 'postgres', image: IMG + 'postgres:19.0', port: 55437, tls: true, cert: 'pg' },
  { id: 'pg19-plain', engine: 'postgres', image: IMG + 'postgres:19.0', port: 55438, tls: false },
  { id: 'my84', engine: 'mysql', image: IMG + 'mysql:8.4', port: 55601, tls: true, cert: 'pg' },
  { id: 'ma118', engine: 'mariadb', image: IMG + 'mariadb:11.8', port: 55602, tls: true, cert: 'pg' },
];
export const DB = 'fs04db';
export const USER = 'fs04user';

export function secrets(): { password: string } {
  const p = WORK + 'secrets.json';
  if (!existsSync(p)) { mkdirSync(WORK, { recursive: true }); writeFileSync(p, JSON.stringify({ password: 'fs04-' + randomBytes(12).toString('hex') })); }
  return JSON.parse(readFileSync(p, 'utf8'));
}
const sh = (args: string[]) => { const r = Bun.spawnSync(args, { stdout: 'pipe', stderr: 'pipe' }); return { code: r.exitCode, out: r.stdout.toString().trim(), err: r.stderr.toString().trim() }; };
const name = (id: string) => 'fs04-' + id;

export function hbaClientCert(): string {
  return `local all all trust\nhostssl all all 0.0.0.0/0 scram-sha-256 clientcert=verify-ca\nhost all all 0.0.0.0/0 reject\n`;
}

export async function up(ids: string[]): Promise<void> {
  ensureCerts();
  writeFileSync(CERTS + 'hba-clientcert.conf', hbaClientCert());
  const pw = secrets().password;
  for (const id of ids) {
    const s = SERVERS.find((x) => x.id === id)!;
    sh(['docker', 'rm', '-f', name(id)]);
    let args: string[];
    if (s.engine === 'postgres') {
      args = ['docker', 'run', '-d', '--name', name(id), '-p', `127.0.0.1:${s.port}:5432`, '-v', `${CERTS}:/certs:ro`,
        '-e', `POSTGRES_PASSWORD=${pw}`, '-e', `POSTGRES_USER=${USER}`, '-e', `POSTGRES_DB=${DB}`, s.image,
        '-c', 'max_connections=300', '-c', 'log_connections=on', '-c', 'log_disconnections=on', '-c', 'log_error_verbosity=default',
        '-c', 'password_encryption=scram-sha-256', '-c', 'log_min_messages=info',
        ...(s.tls ? ['-c', 'ssl=on', '-c', `ssl_cert_file=/certs/${s.cert}.crt`, '-c', `ssl_key_file=/certs/${s.cert}.key`] : ['-c', 'ssl=off']),
        ...(s.clientCert ? ['-c', 'ssl_ca_file=/certs/ca.crt', '-c', 'hba_file=/certs/hba-clientcert.conf'] : [])];
    } else {
      const root = s.engine === 'mysql' ? 'MYSQL' : 'MARIADB';
      args = ['docker', 'run', '-d', '--name', name(id), '-p', `127.0.0.1:${s.port}:3306`, '-v', `${CERTS}:/certs:ro`,
        '-e', `${root}_ROOT_PASSWORD=${pw}`, '-e', `${root}_ROOT_HOST=%`, '-e', `${root}_USER=${USER}`, '-e', `${root}_PASSWORD=${pw}`, '-e', `${root}_DATABASE=${DB}`, s.image,
        '--max-connections=300', '--ssl-ca=/certs/ca.crt', '--ssl-cert=/certs/pg.crt', '--ssl-key=/certs/pg.key'];
    }
    const r = sh(args);
    if (r.code !== 0) throw new Error(`docker run ${id}: ${r.err}`);
  }
}
export function down(): void {
  const r = sh(['docker', 'ps', '-aq', '--filter', 'name=fs04-']);
  if (r.out) sh(['docker', 'rm', '-f', ...r.out.split('\n')]);
}
export const logs = (id: string, since?: string): string => { const r = sh(['docker', 'logs', ...(since ? ['--since', since] : []), name(id)]); return r.out + '\n' + r.err; };
export const digest = (image: string): string => sh(['docker', 'image', 'inspect', '--format', '{{index .RepoDigests 0}}', image]).out;
if (import.meta.main) { const [cmd, ...rest] = process.argv.slice(2); if (cmd === 'up') await up(rest.length ? rest : SERVERS.filter((s) => s.engine === 'postgres').map((s) => s.id)); else if (cmd === 'down') down(); else if (cmd === 'logs') console.log(logs(rest[0]!)); }
