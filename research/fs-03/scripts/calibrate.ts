// Works out where each load ends and fixes its size. Usage: taskset -c 1,2 node scripts/calibrate.ts <build>
// W1 and W2 are sized so that the faster candidate runs about 2.5 s; W3 and W4 move 256 MiB. The W4 throttle is fixed at 500 MB/s. Writes results/loads.json and results/calibration.json.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FakePg } from './servers/fakepg.ts';
import { CELLS, measureOne, type Loads } from './perf.ts';
import { runtimeFor, resultsDir, describeBuild } from './lib/builds.ts';

const build = process.argv[2] ?? 'release';
const runtime = runtimeFor(build);
const pg = await new FakePg().listen();
const target = { host: '127.0.0.1', port: pg.port, label: 'fakepg' };
// w3Row 100: with 1000-byte DataRows the fastest client came within 1.6x of the server's ceiling, and the rule asks for at least 2x
const probe: Loads = { w1: 15000, w2: 200000, w3Bytes: 256 * (1 << 20), w3Row: 100, w4Bytes: 256 * (1 << 20), w4RateMBps: 0, depth: 100 };
const cal: Record<string, Record<string, any>> = {};
const best: Record<string, number> = {};
for (const cell of CELLS) {
  cal[cell.id] = {};
  for (const a of ['B', 'N']) {
    const runs: Record<string, number>[] = [];
    for (let i = 0; i < 3; i++) runs.push(await measureOne(runtime, a, cell, probe, target));
    runs.sort((x, y) => x.value! - y.value!);
    cal[cell.id]![a] = { median: runs[1], all: runs.map((r) => r.value) };
    best[cell.id] = Math.max(best[cell.id] ?? 0, runs[1]!.value!);
    pg.conns.length = 0;
  }
  console.error(cell.id, JSON.stringify(Object.fromEntries(Object.entries(cal[cell.id]!).map(([a, v]) => [a, Math.round(v.median.value)]))));
}
const round = (x: number, q: number): number => Math.max(q, Math.round(x / q) * q);
const loads: Loads = {
  ...probe,
  w1: round(best.W1! * 2.5, 1000),
  w2: round(best.W2! * 2.5, 10000),
  // a reader slower than every client: 500 MB/s is about a seventh of the fastest unthrottled client rate, so 256 MiB takes about 0.55 s
  w4RateMBps: 500,
};
writeFileSync(join(resultsDir, 'loads.json'), JSON.stringify(loads, null, 2) + '\n');
writeFileSync(join(resultsDir, 'calibration.json'), JSON.stringify({ build: describeBuild(build), probe, medianOf: 3, cells: cal, chosen: loads }, null, 1) + '\n');
console.log(JSON.stringify(loads));
process.exit(0);
