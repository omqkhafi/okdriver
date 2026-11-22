// Measures the real round trip: 300 sequential point lookups on one idle connection (depth 1), per path. Bun's setTimeout
// cannot do sub-millisecond delays, so the proxy's one-way delay is tuned (2 passes) until the measured median round trip is
// near the target, and the measured value is what the study reports. Writes results/rtt.json.
import { writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { K_FAST, type Result, type Stmt } from '../core/pool.ts';
import { agg, percentiles } from '../core/stats.ts';
import { DIRECT, RealConn } from './conn.ts';

const ROOT = new URL('../../', import.meta.url).pathname;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
async function measure(port: number, n = 300): Promise<{ median: number; p10: number; p90: number }> {
  let resolveOne: (() => void) | null = null;
  const c = new RealConn(0, (_i, _r: Result) => resolveOne?.(), () => {});
  await c.open({ ...DIRECT, port });
  const lat = new Float64Array(n);
  for (let i = -20; i < n; i++) {
    const s: Stmt = { uid: i + 100, kind: K_FAST, arg: i + 20, cls: 0, t0: 0, sentAt: 0, sentIdle: false, unit: null as never, idx: 0 };
    const t = performance.now();
    await new Promise<void>((res) => { resolveOne = res; c.write([s]); });
    if (i >= 0) lat[i] = performance.now() - t;
  }
  c.close();
  const p = percentiles(lat, n, [0.1, 0.5, 0.9]);
  return { p10: p[0]!, median: p[1]!, p90: p[2]! };
}
async function viaProxy(oneWay: number, port: number): Promise<{ median: number; p10: number; p90: number }> {
  const ch = spawn('taskset', ['-c', '1', 'bun', new URL('./delayproxy.ts', import.meta.url).pathname, String(port), '55432', String(oneWay), String(port + 100)], { stdio: 'ignore' });
  await sleep(600);
  const m = await measure(port);
  ch.kill(); await sleep(200);
  return m;
}
const out: any = { note: 'median / p10 / p90 of 300 sequential depth-1 point lookups (ms); one-way delay is the proxy setting in each direction', measured: {}, oneWay: {} };
out.measured.loop = await measure(DIRECT.port);
out.measured.loopT = await viaProxy(0, 55501);
for (const [id, target, port, guess] of [['d4', 4, 55502, 1.5], ['d20', 20, 55503, 9]] as const) {
  let ow: number = guess, m = await viaProxy(ow, port);
  for (let pass = 0; pass < 2; pass++) { ow = Math.max(0.5, ow - (m.median - target) / 2); m = await viaProxy(ow, port); }
  out.oneWay[id] = +ow.toFixed(2); out.measured[id] = m;
}
void agg;
writeFileSync(ROOT + 'results/rtt.json', JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify(out, null, 2));
