// The full simulated matrix. bun run-sim.ts <shard> <shards> [list|cells...]: each shard writes work/sim/shard-<i>.jsonl (one Row per line).
// Per cell: closed loop at 32 and 2048 callers for every config (5 seeds), T* = best median at 2048, then open loop at fractions of T*.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { agg } from '../core/stats.ts';
import { rowOf, type Row } from '../results.ts';
import { MIXES } from '../core/workload.ts';
import { loadParams } from './params.ts';
import { runSim, type SimResult } from './sim.ts';

const ROOT = new URL('../../', import.meta.url).pathname;
export const SIM_RTTS = ['loop', 'ms1', 'd4', 'd20'];
export const SIM_MIXES = MIXES.filter((m) => !['m7-cpu5-10', 'm8-cpu50-10'].includes(m.id)).map((m) => m.id);
export const SIM_CONFIGS = ['control', 'fixed:2', 'fixed:4', 'fixed:8', 'fixed:16', 'fixed:32', 'fixed:64', 'fixed:128', 'rtt-aware', 'latency-aware', 'aimd'];
export const CLOSED = [32, 2048];
export const FRACS = [0.5, 0.8];
export const SEEDS = [1, 2, 3, 4, 5];
export const simCells = (): string[] => SIM_RTTS.flatMap((r) => SIM_MIXES.flatMap((m) => ['standalone', 'pipeline8'].flatMap((s) => ['on', 'off'].map((h) => `${r}|${m}|${s}|${h}`))));

export function runCellSim(cell: string, opts: { configs?: string[]; closed?: number[]; fracs?: number[]; seeds?: number[] } = {}): Row[] {
  const { params, nets } = loadParams();
  const [rtt, mix, shape, sh] = cell.split('|') as [string, string, 'standalone' | 'pipeline8', string];
  const net = nets[rtt]!;
  const configs = opts.configs ?? SIM_CONFIGS, closed = opts.closed ?? CLOSED, fracs = opts.fracs ?? FRACS, seeds = opts.seeds ?? SEEDS;
  const rows: Row[] = [];
  const med = new Map<string, number>();
  for (const n of closed) for (const config of configs) {
    const rs: SimResult[] = seeds.map((seed) => runSim({ net, mix, shape, sharing: sh === 'on', config, seed, load: { kind: 'closed', n } }, params));
    rows.push(rowOf(cell, config, `closed${n}`, rs));
    if (n === Math.max(...closed)) med.set(config, agg(rs.map((r) => r.thr)).med);
  }
  const tstar = Math.max(...med.values());
  for (const frac of fracs) for (const config of configs) {
    const rate = Math.round(frac * tstar);
    const rs = seeds.map((seed) => runSim({ net, mix, shape, sharing: sh === 'on', config, seed, load: { kind: 'open', rate } }, params));
    rows.push(rowOf(cell, config, `open${frac}`, rs, rate));
  }
  return rows;
}
if (import.meta.main) {
  const [shard, shards] = [Number(process.argv[2] ?? 0), Number(process.argv[3] ?? 1)];
  const out = `${ROOT}work/sim/shard-${shard}.jsonl`;
  mkdirSync(`${ROOT}work/sim`, { recursive: true });
  const done = new Set<string>();
  if (existsSync(out)) for (const l of readFileSync(out, 'utf8').split('\n')) if (l) done.add((JSON.parse(l) as Row).c);
  const cells = simCells();
  for (const [i, cell] of cells.entries()) {
    if (i % shards !== shard || done.has(cell)) continue;
    const t = performance.now();
    const rows = runCellSim(cell);
    appendFileSync(out, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
    console.log(`${cell} ${rows.length} rows ${(performance.now() - t) / 1000 | 0}s`);
  }
  void writeFileSync;
}
