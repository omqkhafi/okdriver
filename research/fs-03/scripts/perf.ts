// Throughput cells. Usage: taskset -c 1,2 node scripts/perf.ts <build> <cell,cell,...|all> [--adapters B,N] [--null] [--runs 15] [--tls] [--out name]
// The client under test is pinned to core 0, the Node server (this process) to cores 1 and 2. A run is READY (login done) / GO / RESULT / DONE,
// and CPU time comes from /proc/<pid>/stat read at READY and at DONE, so process start-up and login are not in it.
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { FakePg } from './servers/fakepg.ts';
import { startClient, cpuTicks, ticksToSeconds, hwmKB, exited } from './lib/proc.ts';
import { runtimeFor, describeBuild, resultsDir, readCert, certDir } from './lib/builds.ts';

const MiB = 1 << 20;
export interface Loads { w1: number; w2: number; w3Bytes: number; w3Row: number; w4Bytes: number; w4RateMBps: number; depth: number }
export const loadsPath = join(resultsDir, 'loads.json');

export interface CellDef { id: string; unit: string; build(loads: Loads): { workload: string; args: Record<string, unknown>; ops: (r: any) => number } }
const streamSql = (loads: Loads, burst: number): string => `SELECT 1 -- fs03 stream rows=${Math.floor(loads.w3Bytes / (loads.w3Row + 11))} row=${loads.w3Row} burst=${burst}`;
export const CELLS: CellDef[] = [
  { id: 'W1', unit: 'statements/s', build: (l) => ({ workload: 'w1', args: { sql: 'SELECT 1', n: l.w1 }, ops: (r) => r.ops / r.seconds }) },
  { id: 'W2', unit: 'statements/s', build: (l) => ({ workload: 'w2', args: { sql: 'SELECT 1', n: l.w2, depth: l.depth }, ops: (r) => r.ops / r.seconds }) },
  ...([['8K', 8192], ['64K', 65536], ['1M', MiB]] as const).map(([n, b]): CellDef => ({ id: `W3-${n}`, unit: 'MB/s', build: (l) => ({ workload: 'w3', args: { sql: streamSql(l, b) }, ops: (r) => r.wireBytes / 1e6 / r.seconds }) })),
  { id: 'W4', unit: 'MB/s', build: (l) => ({ workload: 'w4', args: { sql: `COPY fs03 FROM STDIN -- fs03 rate=${l.w4RateMBps}`, bytes: l.w4Bytes }, ops: (r) => r.bytes / 1e6 / r.seconds }) },
  { id: 'W4-unthrottled', unit: 'MB/s', build: (l) => ({ workload: 'w4', args: { sql: 'COPY fs03 FROM STDIN -- fs03 rate=0', bytes: l.w4Bytes }, ops: (r) => r.bytes / 1e6 / r.seconds }) },
];

export interface Target { host: string; port: number; tls?: Record<string, unknown>; login?: Record<string, unknown>; label: string }

export async function measureOne(runtime: string, adapter: string, cell: CellDef, loads: Loads, target: Target): Promise<Record<string, number>> {
  const def = cell.build(loads);
  const c = startClient({ runtime, cpu: '0', args: { task: 'perf', adapter, host: target.host, port: target.port, workload: def.workload, tls: target.tls, ...(target.login ?? {}), ...def.args }, timeoutMs: 180000 });
  await c.waitFor('READY');
  const t0 = cpuTicks(c.pid);
  c.send('GO');
  const r = await c.result;
  await c.waitFor('DONE');
  const t1 = cpuTicks(c.pid);
  const hwm = hwmKB(c.pid);
  c.send('BYE');
  await exited(c);
  const value = def.ops(r);
  const units = def.workload === 'w1' || def.workload === 'w2' ? r.ops : (r.wireBytes ?? r.bytes) / 1e6;
  return { value, seconds: r.seconds, cpuSeconds: ticksToSeconds(t1 - t0), cpuPerUnit: ticksToSeconds(t1 - t0) / units, rssPeakKB: hwm, p50us: r.p50us ?? NaN, p99us: r.p99us ?? NaN };
}

export const median = (xs: number[]): number => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2; };

export interface Series { runs: Record<string, number>[] }
/** A B A B interleaving: warm-up rounds first (dropped), then `runs` measured rounds. Candidates may repeat (null comparison). */
export async function interleave(runtime: string, cell: CellDef, loads: Loads, target: Target, cands: string[], runs: number, warmup: number, log: (s: string) => void): Promise<Series[]> {
  const out: Series[] = cands.map(() => ({ runs: [] }));
  for (let round = 0; round < warmup + runs; round++) {
    for (let i = 0; i < cands.length; i++) {
      const m = await measureOne(runtime, cands[i]!.split('#')[0]!, cell, loads, target);
      if (round >= warmup) out[i]!.runs.push(m);
      log(`${cell.id} ${cands[i]} round ${round}${round < warmup ? ' (warm-up)' : ''}: ${m.value!.toFixed(1)} ${cell.unit}, cpu ${m.cpuSeconds!.toFixed(2)} s`);
    }
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const [build, cellArg] = argv;
  const flag = (n: string, d?: string): string | undefined => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
  const adapters = (flag('--adapters', 'B,N'))!.split(',');
  const runs = Number(flag('--runs', '15'));
  const doNull = argv.includes('--null');
  const useTls = argv.includes('--tls');
  const loads = JSON.parse(readFileSync(flag('--loads', loadsPath)!, 'utf8')) as Loads;
  const cells = cellArg === 'all' ? CELLS.filter((c) => !c.id.includes('unthrottled')) : cellArg!.split(',').map((id) => CELLS.find((c) => c.id === id)!);
  const runtime = runtimeFor(build!);
  const key = readCert('server.key'), cert = readCert('server.crt');
  const pg = await new FakePg(useTls ? { tls: { key, cert } } : {}).listen();
  const target: Target = { host: '127.0.0.1', port: pg.port, label: useTls ? 'fakepg-tls' : 'fakepg', tls: useTls ? { mode: 'upgrade', ca: join(certDir, 'ca.crt'), servername: 'localhost' } : undefined };
  const result: Record<string, any> = { build: describeBuild(build!), target: target.label, loads, runsPerCell: runs, warmupDropped: 2, cells: {}, nulls: {} };
  const log = (s: string): void => { pg.conns.length = 0; console.error(s); };
  for (const cell of cells) {
    const series = await interleave(runtime, cell, loads, target, adapters, runs, 2, log);
    result.cells[cell.id] = { unit: cell.unit, ...Object.fromEntries(adapters.map((a, i) => [a, series[i]!.runs])) };
    if (doNull) {
      result.nulls[cell.id] = {};
      for (const a of adapters) {
        const s = await interleave(runtime, cell, loads, target, [`${a}#1`, `${a}#2`], runs, 2, log);
        result.nulls[cell.id][a] = [s[0]!.runs, s[1]!.runs];
      }
    }
    mkdirSync(resultsDir, { recursive: true });
    writeFileSync(join(resultsDir, `${flag('--out', `throughput.${build}${useTls ? '.tls' : ''}`)}.json`), JSON.stringify(result, null, 1) + '\n');
  }
  process.exit(0);
}
