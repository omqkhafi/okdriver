// Predicts the held-out real cells BEFORE their real data are read: closed-loop throughput at 2048 callers for every config of the
// real plan. Reads only results/calibration.json and the plan (plans.ts), never work/raw. Writes results/sim-predictions.json.
import { writeFileSync } from 'node:fs';
import { PLANS } from '../real/plans.ts';
import { cellId } from '../real/run-real.ts';
import { agg } from '../core/stats.ts';
import { loadParams } from './params.ts';
import { runSim } from './sim.ts';
const ROOT = new URL('../../', import.meta.url).pathname;
const { params, nets } = loadParams();
const out: Record<string, Record<string, [number, number, number]>> = {};
for (const pc of PLANS.p2!) {
  const id = cellId(pc.cell);
  const net = nets[pc.cell.rtt === 'loopT' ? 'loop' : pc.cell.rtt]!;
  out[id] = {};
  for (const config of pc.configs) {
    const t = [1, 2, 3, 4, 5].map((seed) => runSim({ net, mix: pc.cell.mix, shape: pc.cell.shape, sharing: pc.cell.sharing, config, seed, load: { kind: 'closed', n: 2048 } }, params).thr);
    const a = agg(t); out[id]![config] = [a.min, a.med, a.max].map((x) => Math.round(x)) as [number, number, number];
  }
  console.log(id, JSON.stringify(Object.fromEntries(Object.entries(out[id]!).map(([k, v]) => [k, v[1]]))));
}
writeFileSync(ROOT + 'results/sim-predictions.json', JSON.stringify({ note: 'simulated closed-loop throughput [min, median, max] at 2048 callers, written before the held-out real cells were read', params, predictions: out }, null, 1) + '\n');
