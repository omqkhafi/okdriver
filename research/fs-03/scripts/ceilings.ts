// Each server's own ceiling, measured with a bare Node raw-socket client (not a candidate) pinned to core 0.
// Usage: taskset -c 1,2 node scripts/ceilings.ts [loadsfile]
import { execFile } from 'node:child_process';
import { writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FakePg } from './servers/fakepg.ts';
import { resultsDir } from './lib/builds.ts';
import type { Loads } from './perf.ts';

// asynchronous on purpose: the servers live in this process and must keep running while the raw client works
const raw = (args: Record<string, unknown>): Promise<Record<string, number>> => new Promise((res, rej) => execFile('taskset', ['-c', '0', process.execPath, new URL('./rawclient.ts', import.meta.url).pathname, JSON.stringify(args)], { encoding: 'utf8', timeout: 120000 }, (e, out) => (e ? rej(e) : res(JSON.parse(out.trim().split('\n').pop()!)))));

const loads = JSON.parse(readFileSync(process.argv[2] ?? join(resultsDir, 'loads.json'), 'utf8')) as Loads;
const pg = await new FakePg().listen();
const out: Record<string, any> = { loads, note: 'raw Node client on core 0, server on cores 1-2; median of 3', rates: {} };
const med = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
const rep = async (f: () => Promise<number>): Promise<number[]> => [await f(), await f(), await f()];
out.rates['pipeline statements/s (depth 200)'] = med(await rep(async () => { const r = await raw({ mode: 'pipeline', port: pg.port, seconds: 2, depth: 200 }); return r.statements! / r.seconds!; }));
for (const [name, burst] of [['8K', 8192], ['64K', 65536], ['1M', 1 << 20]] as const) {
  const rows = Math.floor(loads.w3Bytes / (loads.w3Row + 11));
  const bytes = rows * (loads.w3Row + 11);
  out.rates[`stream MB/s (burst ${name})`] = med(await rep(async () => { const r = await raw({ mode: 'drain', port: pg.port, sql: `SELECT 1 -- fs03 stream rows=${rows} row=${loads.w3Row} burst=${burst}`, bytes }); return r.bytes! / 1e6 / r.seconds!; }));
}
out.rates['copy sink MB/s (unthrottled)'] = med(await rep(async () => { const r = await raw({ mode: 'push', port: pg.port, bytes: loads.w4Bytes }); return r.bytes! / 1e6 / r.seconds!; }));
writeFileSync(join(resultsDir, 'ceilings.json'), JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify(out.rates, null, 1));
process.exit(0);
