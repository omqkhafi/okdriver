// Real PostgreSQL 19.0 in Docker on a pinned core: correctness against psql, then W5 (S1, depth 100, 100 MB result), optionally over TLS.
// Usage: taskset -c 1,2 node scripts/real.ts <build> correctness [--adapters B,N,N-data]
//        taskset -c 1,2 node scripts/real.ts <build> w5 [--adapters B,N] [--runs 15] [--tls]
//        node scripts/real.ts up | down
import { execFileSync, spawnSync } from 'node:child_process';
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { startClient } from './lib/proc.ts';
import { runtimeFor, describeBuild, resultsDir, certDir, workDir } from './lib/builds.ts';
import { interleave, type CellDef, type Loads } from './perf.ts';

const NAME = 'fs03pg';
const PORT = 55439;
const credFile = join(workDir, 'pg.password');
const password = (): string => readFileSync(credFile, 'utf8').trim();

export function up(): void {
  spawnSync('docker', ['rm', '-f', NAME], { stdio: 'ignore' });
  mkdirSync(workDir, { recursive: true });
  writeFileSync(credFile, randomBytes(12).toString('hex'), { mode: 0o600 });
  execFileSync('docker', ['run', '-d', '--name', NAME, '--network', 'host', '--cpuset-cpus', '3', '-e', `POSTGRES_PASSWORD=${password()}`, '-e', 'POSTGRES_USER=fs03', '-e', 'POSTGRES_DB=fs03',
    '-v', `${certDir}:/certs:ro`, '--entrypoint', 'bash', 'postgres:19.0', '-c',
    `cp /certs/server.key /tmp/server.key && chown postgres:postgres /tmp/server.key && chmod 600 /tmp/server.key && exec docker-entrypoint.sh postgres -p ${PORT} -c listen_addresses=127.0.0.1 -c ssl=on -c ssl_cert_file=/certs/server.crt -c ssl_key_file=/tmp/server.key -c shared_buffers=256MB -c max_connections=50`]);
  for (let i = 0; i < 60; i++) {
    const r = spawnSync('pg_isready', ['-h', '127.0.0.1', '-p', String(PORT), '-U', 'fs03'], { encoding: 'utf8' });
    if (r.status === 0) { await_(2000); return; }
    await_(1000);
  }
  throw new Error('postgres did not come up');
}
function await_(ms: number): void { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }
export const down = (): void => { spawnSync('docker', ['rm', '-f', NAME], { stdio: 'ignore' }); };
const psql = (sql: string): string => execFileSync('psql', ['-X', '-A', '-t', '-F', '|', '-P', 'null=∅', '-h', '127.0.0.1', '-p', String(PORT), '-U', 'fs03', '-d', 'fs03', '-v', 'ON_ERROR_STOP=0', '-c', sql], { env: { ...process.env, PGPASSWORD: password(), PGSSLMODE: 'disable' }, encoding: 'utf8', maxBuffer: 1 << 28 });
const psqlErr = (sql: string): string => { const r = spawnSync('psql', ['-X', '-A', '-t', '-h', '127.0.0.1', '-p', String(PORT), '-U', 'fs03', '-d', 'fs03', '-c', sql], { env: { ...process.env, PGPASSWORD: password(), PGSSLMODE: 'disable' }, encoding: 'utf8' }); return r.stderr.trim(); };

export const QUERIES = [
  `select 1, null::text, ''::text, 'héllo wörld 日本語 😀'`,
  `select i, i*i, i::text, (i%3=0), (i%7=0)::text from generate_series(1,50) i`,
  `select repeat('x', 100000) as big, length(repeat('y', 3000000))`,
  `select '2026-11-25 12:34:56.789+00'::timestamptz, '1999-12-31'::date, 1.5::numeric, -0.0001::numeric, 'NaN'::float8, 'Infinity'::float8`,
  `select array[1,2,3], array['a',null,'c'], '{"a":1,"b":[1,2,{"c":null}]}'::jsonb`,
  `select '\\xdeadbeef'::bytea, '00000000-0000-0000-0000-000000000001'::uuid, true, false`,
  `select * from (values (1,'a'),(2,null),(3,'')) t(a,b)`,
  `select 1 where false`,
  `select md5(i::text), i from generate_series(1, 20000) i`,
  `select current_setting('server_version_num')::int >= 190000, current_setting('server_version')`,
];
const errorQuery = 'select 1/0';

export async function correctness(build: string, adapters: string[]): Promise<Record<string, unknown>> {
  const runtime = runtimeFor(build);
  const expected = QUERIES.map((q) => psql(q).replace(/\n$/, ''));
  const expectedErr = psqlErr(errorQuery);
  const res: Record<string, unknown> = { build: describeBuild(build), pg: execFileSync('psql', ['-X', '-A', '-t', '-h', '127.0.0.1', '-p', String(PORT), '-U', 'fs03', '-d', 'fs03', '-c', 'select version()'], { env: { ...process.env, PGPASSWORD: password(), PGSSLMODE: 'disable' }, encoding: 'utf8' }).trim(), psqlClient: execFileSync('psql', ['--version'], { encoding: 'utf8' }).trim(), expectedPsqlOutput: expected.map((e) => ({ lines: e.split('\n').length, bytes: Buffer.byteLength(e), sha256: createHash('sha256').update(e).digest('hex') })), adapters: {} };
  for (const adapter of adapters) for (const tls of [false, true]) {
    const c = startClient({ runtime, cpu: '0', args: { task: 'real', adapter, port: PORT, user: 'fs03', database: 'fs03', password: password(), queries: [...QUERIES, errorQuery], tls: tls ? { mode: 'upgrade', ca: join(certDir, 'ca.crt'), servername: 'localhost' } : undefined }, timeoutMs: 120000 });
    let r: any;
    try { r = await c.result; } catch (e) { (res.adapters as any)[`${adapter}${tls ? '+tls' : ''}`] = { pass: false, error: String(e).slice(0, 300) }; continue; }
    const rows = (r.results as any[]).slice(0, QUERIES.length).map((x) => (x.rows as (string | null)[][] | null ?? []).map((row) => row.map((v) => (v === null ? '∅' : v)).join('|')).join('\n'));
    const mismatches = rows.map((got, i) => (got === expected[i] ? null : i)).filter((x) => x !== null);
    const errR = r.results[QUERIES.length] as { error: { code: string; message: string } | null };
    const errOk = !!errR.error && errR.error.code === '22012' && expectedErr.includes(errR.error.message);
    (res.adapters as any)[`${adapter}${tls ? '+tls' : ''}`] = { pass: mismatches.length === 0 && errOk, queries: QUERIES.length, mismatches, errorMatches: errOk, runtime: r.runtime };
  }
  // the same upgrade against real PostgreSQL with a wrong server name must fail, with the right one it must work
  for (const adapter of adapters) {
    const c = startClient({ runtime, cpu: '0', args: { task: 'tls_upgrade', adapter, port: PORT, ca: join(certDir, 'ca.crt'), user: 'fs03', database: 'fs03', password: password() }, timeoutMs: 60000 });
    const r = await c.result;
    (res.adapters as any)[adapter].tlsAgainstPostgres = { good: r.good?.ok === true, mismatchRefused: r.mismatch?.ok === false, mismatchError: r.mismatch?.error };
  }
  return res;
}

/** PostgreSQL's own ceiling with pgbench (a C client) on core 0: S1, a pipeline of 100, and the 100 MB result through psql. */
export function ceiling(): Record<string, unknown> {
  const env = { ...process.env, PGPASSWORD: password(), PGSSLMODE: 'disable' };
  mkdirSync(join(workDir, 'tmp'), { recursive: true });
  const f1 = join(workDir, 'tmp', 's1.sql'), f100 = join(workDir, 'tmp', 'p100.sql');
  writeFileSync(f1, 'SELECT 1;\n');
  writeFileSync(f100, '\\startpipeline\n' + 'SELECT 1;\n'.repeat(100) + '\\endpipeline\n');
  const tps = (f: string): number => {
    const o = execFileSync('taskset', ['-c', '0', 'pgbench', '-n', '-M', 'extended', '-c', '1', '-j', '1', '-T', '6', '-f', f, '-h', '127.0.0.1', '-p', String(PORT), '-U', 'fs03', 'fs03'], { env, encoding: 'utf8' });
    return Number(/tps = ([\d.]+)/.exec(o)![1]);
  };
  const out: Record<string, unknown> = { tool: execFileSync('pgbench', ['--version'], { encoding: 'utf8' }).trim() };
  out['S1 statements/s (pgbench -M extended, one connection)'] = tps(f1);
  out['depth 100 statements/s (pgbench pipeline of 100)'] = tps(f100) * 100;
  const mbs: number[] = [];
  for (let i = 0; i < 3; i++) {
    const t0 = performance.now();
    const bytes = execFileSync('taskset', ['-c', '0', 'psql', '-X', '-A', '-t', '-h', '127.0.0.1', '-p', String(PORT), '-U', 'fs03', '-d', 'fs03', '-c', `select repeat('x', 1000) from generate_series(1, 100000)`], { env, maxBuffer: 1 << 29 }).length;
    mbs.push(bytes / 1e6 / ((performance.now() - t0) / 1000));
  }
  out['100 MB result MB/s (psql to a pipe, text, median of 3)'] = mbs.sort((a, b) => a - b)[1];
  return out;
}

export const W5: CellDef[] = [
  { id: 'W5-S1', unit: 'statements/s', build: (l) => ({ workload: 'w1', args: { sql: 'SELECT 1', n: l.w1 }, ops: (r) => r.ops / r.seconds }) },
  { id: 'W5-D100', unit: 'statements/s', build: (l) => ({ workload: 'w2', args: { sql: 'SELECT 1', n: l.w2, depth: l.depth }, ops: (r) => r.ops / r.seconds }) },
  { id: 'W5-100MB', unit: 'MB/s', build: () => ({ workload: 'w3', args: { sql: `select repeat('x', 1000) from generate_series(1, 100000)` }, ops: (r) => r.wireBytes / 1e6 / r.seconds }) },
];

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const flag = (n: string, d?: string): string | undefined => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
  if (argv[0] === 'up') { up(); console.log('up'); process.exit(0); }
  if (argv[0] === 'down') { down(); process.exit(0); }
  if (argv[0] === 'ceiling') { const c = ceiling(); mkdirSync(resultsDir, { recursive: true }); writeFileSync(join(resultsDir, 'w5-ceiling.json'), JSON.stringify(c, null, 2) + '\n'); console.log(c); process.exit(0); }
  const [build, what] = argv;
  const adapters = flag('--adapters', 'B,N')!.split(',');
  mkdirSync(resultsDir, { recursive: true });
  if (what === 'correctness') {
    const r = await correctness(build!, adapters);
    writeFileSync(join(resultsDir, `real-correctness.${build}.json`), JSON.stringify(r, null, 2) + '\n');
    console.log(JSON.stringify(r, null, 1));
  } else if (what === 'w5') {
    const runs = Number(flag('--runs', '15'));
    const tls = argv.includes('--tls');
    const loads = JSON.parse(readFileSync(flag('--loads', join(resultsDir, 'loads.json'))!, 'utf8')) as Loads;
    const runtime = runtimeFor(build!);
    const target = { host: '127.0.0.1', port: PORT, label: 'postgres-19.0-docker', login: { user: 'fs03', database: 'fs03', password: password() }, tls: tls ? { mode: 'upgrade', ca: join(certDir, 'ca.crt'), servername: 'localhost' } : undefined };
    const out: Record<string, any> = { build: describeBuild(build!), target: target.label, tls, loads, runsPerCell: runs, warmupDropped: 2, cells: {} };
    const only = flag('--cells')?.split(',');
    for (const cell of W5.filter((c) => !only || only.includes(c.id))) {
      const s = await interleave(runtime, cell, loads, target as any, adapters, runs, 2, (m) => console.error(m));
      out.cells[cell.id] = { unit: cell.unit, ...Object.fromEntries(adapters.map((a, i) => [a, s[i]!.runs])) };
      writeFileSync(join(resultsDir, `w5.${build}${tls ? '.tls' : ''}.json`), JSON.stringify(out, null, 1) + '\n');
    }
  }
  process.exit(0);
}
void existsSync;
