// Compares the simulator with the real held-out cells under the criterion in rules.json (simulatorValidation):
//   (1) simulated median throughput within 15% of the real median, (2) no inversion of a policy pair that is separated beyond noise in the real runs
// (worst run of one better than the best run of the other). Throughput is checked on the predictions; p99.9 is checked with the simulator re-run at
// the real arrival rate. Writes results/validation.json.
import { writeFileSync } from 'node:fs';
import { loadRaw } from '../real/aggregate.ts';
import { cellId, ROOT } from '../real/run-real.ts';
import { PLANS } from '../real/plans.ts';
import { agg } from '../core/stats.ts';
import { loadParams } from './params.ts';
import { runSim } from './sim.ts';

const rules = JSON.parse(await Bun.file(ROOT + 'rules.json').text()).simulatorValidation;
const pred = JSON.parse(await Bun.file(ROOT + 'results/sim-predictions.json').text()).predictions as Record<string, Record<string, number[]>>;
const { params, nets } = loadParams();
const runs = loadRaw(ROOT + 'work/raw/real.jsonl').filter((r) => !r.spec.label);
const held = new Set(PLANS.p2!.map((p) => cellId(p.cell)));
interface Pair { a: string; b: string }
const cells: any[] = [];
let allWithin = true, inversions = 0, p999Inversions = 0, compared = 0;
const by = (cell: string, load: string) => { const g = new Map<string, number[]>(); const o = new Map<string, any[]>(); for (const r of runs) if (cellId(r.spec.cell) === cell && (r.spec.load.kind === 'closed' ? `closed${(r.spec.load as any).n}` : `open${(r.spec.load as any).frac}`) === load) { (g.get(r.spec.config) ?? g.set(r.spec.config, []).get(r.spec.config)!).push(r.spec.load.kind === 'closed' ? r.thr : r.fastP999); (o.get(r.spec.config) ?? o.set(r.spec.config, []).get(r.spec.config)!).push(r); } return { g, o }; };
for (const cell of held) {
  const { g } = by(cell, 'closed2048');
  if (![...g.values()].some((v) => v.length >= 5)) continue;
  const rowsOut: any[] = [];
  const realAgg = new Map<string, ReturnType<typeof agg>>();
  for (const [cfg, v] of g) if (v.length >= 5) realAgg.set(cfg, agg(v));
  for (const [cfg, a] of realAgg) { const p = pred[cell]?.[cfg]; if (!p) continue; const ratio = p[1]! / a.med; const within = Math.abs(ratio - 1) <= rules.throughputTolerance; if (!within) allWithin = false; rowsOut.push({ cfg, real: Math.round(a.med), sim: p[1], ratio: +ratio.toFixed(3), within }); compared++; }
  const inv: Pair[] = [];
  for (const [x, ax] of realAgg) for (const [y, ay] of realAgg) if (x !== y && ax.min > ay.max) { const sx = pred[cell]?.[x]?.[1], sy = pred[cell]?.[y]?.[1]; if (sx !== undefined && sy !== undefined && sx <= sy) inv.push({ a: x, b: y }); }
  inversions += inv.length;
  // open-loop p99.9 ranking at the real arrival rate
  const p999inv: Pair[] = [];
  for (const frac of [0.5, 0.8]) {
    const { o } = by(cell, `open${frac}`);
    const ra = new Map<string, ReturnType<typeof agg>>(); let rate = 0;
    for (const [cfg, rs] of o) if (rs.length >= 5) { ra.set(cfg, agg(rs.map((r) => r.fastP999))); rate = (rs[0].spec.load as any).rate; }
    if (ra.size < 2) continue;
    const net = nets[cell.split('|')[0] === 'loopT' ? 'loop' : cell.split('|')[0]!]!; const [, mix, shape, sh] = cell.split('|') as [string, string, any, string];
    const sim = new Map<string, number>();
    for (const cfg of ra.keys()) sim.set(cfg, agg([1, 2, 3, 4, 5].map((seed) => runSim({ net, mix, shape, sharing: sh === 'on', config: cfg, seed, load: { kind: "open", rate } }, params).fastP999)).med);
    for (const [x, ax] of ra) for (const [y, ay] of ra) if (x !== y && ax.max < ay.min && !(sim.get(x)! < sim.get(y)!)) p999inv.push({ a: x, b: y });
  }
  p999Inversions += p999inv.length;
  cells.push({ cell, rows: rowsOut, throughputInversions: inv, p999Inversions: p999inv });
}
const passes = cells.length > 0 && allWithin && inversions === 0 && p999Inversions === 0;
writeFileSync(ROOT + 'results/validation.json', JSON.stringify({ criterion: rules, heldOutCellsCompared: cells.length, configsCompared: compared, allWithin15pct: allWithin, throughputInversions: inversions, p999Inversions, passes, cells }, null, 1) + '\n');
console.log({ cells: cells.length, compared, allWithin, inversions, p999Inversions, passes });
