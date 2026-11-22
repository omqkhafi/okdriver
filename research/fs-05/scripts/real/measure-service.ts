// Service times of each statement kind on the real server: depth 1, one idle connection, loopback, 500 samples (fast) or 40.
// Also sets cpuPerMs: the generate_series upper bound that costs about one millisecond, so the CPU-bound slow statements
// (5 ms and 50 ms) match the timed ones. Writes results/service.json; the simulator's fit starts from these.
import { writeFileSync } from 'node:fs';
import { K_CPU, K_FAST, K_SLEEP, type Result, type Stmt } from '../core/pool.ts';
import { percentiles } from '../core/stats.ts';
import { DIRECT, RealConn } from './conn.ts';

const ROOT = new URL('../../', import.meta.url).pathname;
let res: (() => void) | null = null;
const c = new RealConn(0, (_i, _r: Result) => res?.(), () => {});
await c.open(DIRECT);
async function time(kind: number, arg: () => number, n: number): Promise<{ n: number; p50: number; p90: number; p99: number; max: number }> {
  const lat = new Float64Array(n);
  for (let i = -10; i < n; i++) {
    const s: Stmt = { uid: i + 100, kind, arg: arg(), cls: 0, t0: 0, sentAt: 0, sentIdle: false, unit: null as never, idx: 0 };
    const t = performance.now();
    await new Promise<void>((r) => { res = r; c.write([s]); });
    if (i >= 0) lat[i] = performance.now() - t;
  }
  const p = percentiles(lat, n, [0.5, 0.9, 0.99, 1]);
  return { n, p50: p[0]!, p90: p[1]!, p99: p[2]!, max: p[3]! };
}
const out: any = { note: 'ms, depth 1, one idle connection, direct loopback; round trip included' };
out.fast = await time(K_FAST, () => Math.floor(Math.random() * 100000), 2000);
out.sleep5 = await time(K_SLEEP, () => 5, 40);
out.sleep50 = await time(K_SLEEP, () => 50, 20);
// CPU-bound slow statements: find, by bisection on measured latency, the generate_series bound that takes the target time.
async function findN(targetMs: number): Promise<{ n: number; p50: number }> {
  let lo = 1000, hi = 4_000_000, best = { n: lo, p50: 0 };
  for (let i = 0; i < 14; i++) {
    const mid = Math.round((lo + hi) / 2);
    const t = await time(K_CPU, () => mid, 7);
    best = { n: mid, p50: t.p50 };
    if (t.p50 < targetMs) lo = mid; else hi = mid;
  }
  return best;
}
out.cpu5 = await findN(5.5);   // the timed 5 ms statement measures 5.5 ms end to end at depth 1
out.cpu50 = await findN(50.9); // the timed 50 ms statement measures 50.9 ms
out.cpuN5 = out.cpu5.n; out.cpuN50 = out.cpu50.n;
out.cpu5check = await time(K_CPU, () => out.cpuN5, 30);
out.cpu50check = await time(K_CPU, () => out.cpuN50, 15);
c.close();
writeFileSync(ROOT + 'results/service.json', JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify(out));
