// Runs the study against a hosted pooler whose URL is in the environment. Nothing about the URL is printed, logged or written:
// host, user, password and database name are replaced by <redacted> in everything that is saved.
//   FS06_RDSPROXY_URL  postgres://user:password@endpoint:5432/dbname?sslmode=require      -> results/hosted/rdsproxy.json
//   FS06_NEON_URL      postgres://user:password@ep-...-pooler.region.aws.neon.tech/dbname -> results/hosted/neon.json
// An unset variable writes a "Not verified here" file. Hyperdrive needs a Worker and an account and is not attempted.
// Usage: bun scripts/hosted.ts rdsproxy|neon
import { writeFileSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { PgConn, nowMs } from './lib/client.ts';
import { setBaselineRtt, DEADLINE_MS } from './lib/seq.ts';
import { study } from './study.ts';
import { query, parse, bind, describe, execute, sync, u8, decodeDataRow } from './lib/wire.ts';
import type { Target } from './lib/target.ts';
import { RESULTS, RAW, WORK } from './lib/paths.ts';

const VARS: Record<string, string> = { rdsproxy: 'FS06_RDSPROXY_URL', neon: 'FS06_NEON_URL' };
const name = process.argv[2] ?? '';
const varName = VARS[name];
if (!varName) { console.error(`usage: bun scripts/hosted.ts ${Object.keys(VARS).join('|')}`); process.exit(2); }
const outDir = RESULTS + 'hosted/';
mkdirSync(outDir, { recursive: true });
const url = process.env[varName];
if (!url) {
  writeFileSync(`${outDir}${name}.json`, JSON.stringify({ target: { id: name }, notVerified: true, blocker: `${varName} is not set` }, null, 1) + '\n');
  console.log(`Not verified here: ${varName} is not set`);
  process.exit(0);
}

let u: URL;
try { u = new URL(url); } catch { console.error(`${varName} is not a valid URL (not printed)`); process.exit(2); }
const host = u.hostname, port = Number(u.port || 5432), user = decodeURIComponent(u.username), password = decodeURIComponent(u.password);
const database = decodeURIComponent(u.pathname.replace(/^\//, '')) || user;
const sslmode = u.searchParams.get('sslmode') ?? 'require';
const secrets = [host, user, password, database, url].filter((x) => x && x.length >= 3);
const redact = (v: unknown): unknown => JSON.parse(secrets.reduce((acc, s) => acc.split(s).join('<redacted>'), JSON.stringify(v)));
const tls = sslmode === 'disable' ? false : { servername: host, rejectUnauthorized: process.env.FS06_TLS_INSECURE !== '1' };

const t: Target = { id: name, pooler: name, config: 'hosted', mode: 'hosted', host, port, user, password, database, tls, serverPool: 0, clients: 8, serverSide: false,
  notes: ['hosted: no server-side proxy, no injected delay; round trips come from the client\'s own read/write trace and elapsed time is divided by the measured round trip of `select 1`', 'server pool size is not controlled by the harness'] };

// Baseline round trip of a trivial simple query on an open connection.
const probe = await PgConn.connect({ host, port, user, password, database, tls });
const samples: number[] = [];
for (let i = 0; i < 9; i++) { const a = nowMs(); probe.write(query('select 1')); await probe.collect(1, 10000); samples.push(nowMs() - a); }
probe.close();
samples.sort((a, b) => a - b);
const baseline = samples[Math.floor(samples.length / 2)]!;
setBaselineRtt(baseline);

// The unredacted summary goes to the ignored work/ folder; only the redacted file is written under results/.
const sum: any = await study(t, null, { noProxy: true, outDir: WORK + 'hosted-tmp/' });

// P-04 probes: does SET, or a statement text above 16 KB, make one client sticky to one backend while others share?
const pinCheck = async (label: string, prelude: string | null, bigText: boolean) => {
  const clients = await Promise.all(Array.from({ length: 4 }, () => PgConn.connect({ host, port, user, password, database, tls })));
  const subject = clients[0]!;
  const txn = async (c: PgConn, sqlText: string) => {
    c.write(u8(parse('', sqlText), bind('', '', []), describe('P', ''), execute('', 0), sync()));
    const r = await c.collect(1, DEADLINE_MS);
    const row = r.msgs.find((m) => m.type === 'D'); return row ? parseInt(decodeDataRow(row.body)[0]!, 10) : -1;
  };
  if (prelude) { subject.write(query(prelude)); await subject.collect(1, DEADLINE_MS); }
  const big = bigText ? `/* ${'x'.repeat(20 * 1024)} */ ` : '';
  const pids = new Set<number>(); const others = new Set<number>();
  await Promise.all(clients.map(async (c, i) => { for (let k = 0; k < 20; k++) { const pid = await txn(c, `${i === 0 ? big : ''}SELECT pg_backend_pid() FROM (SELECT pg_sleep(0.01)) s`); (i === 0 ? pids : others).add(pid); } }));
  clients.forEach((c) => c.close());
  return { label, subjectDistinctPids: pids.size, othersDistinctPids: others.size };
};
const p04 = [await pinCheck('control', null, false), await pinCheck('after SET', "SET application_name = 'fs06-pin-check'", false), await pinCheck('statement text above 16 KB', null, true)];
const refs: any[] = [];
for (const kind of ['pg', 'pg-unnamed', 'postgres', 'postgres-unnamed']) {
  const child = spawn('bun', [new URL('./ref/refclient.ts', import.meta.url).pathname, kind, 'env', '0', '-', '-', '-', '8', '20'], { env: { ...process.env, FS06_REF_HOST: host, FS06_REF_PORT: String(port), FS06_REF_USER: user, FS06_REF_PASSWORD: password, FS06_REF_DB: database, FS06_REF_TLS: tls ? '1' : '0' } });
  let out = ''; let err = '';
  child.stdout.on('data', (d) => (out += d)); child.stderr.on('data', (d) => (err += d));
  const code: number = await new Promise((res) => { child.on('close', res); setTimeout(() => child.kill('SIGKILL'), 75000); });
  const line = out.trim().split('\n').filter((l) => l.startsWith('{')).at(-1);
  refs.push(line ? JSON.parse(line) : { kind, failed: `exit ${code}: ${err.slice(0, 200)}` });
}
sum.refs = refs;
sum.p04 = p04; sum.baselineRttMs = Math.round(baseline * 10) / 10; sum.tlsUsed = sum.login?.tls;
const clean = redact(sum);
writeFileSync(`${outDir}${name}.json`, JSON.stringify(clean, null, 1) + '\n');
console.log(`${name}: written to results/hosted/${name}.json (baseline round trip ${sum.baselineRttMs} ms). Check the file for anything identifying before sending it.`);
void RAW;
process.exit(0);
