// One compact row per (instrument, cell, config, load point), made from the 5 runs. Arrays are [min, median, max].
import { agg } from './core/stats.ts';
export type A3 = [number, number, number];
export interface Row {
  c: string;          // cell id: rtt|mix|shape|sharing
  k: string;          // config
  l: string;          // load point: closed<N> | open<fraction>
  n: number;          // runs
  thr?: A3; p999?: A3; sp99?: A3; cpu: A3;
  util: number;       // median client CPU utilisation (load generator process, or modelled client thread)
  pu?: number;        // largest proxy CPU utilisation seen (real, delayed paths)
  ov: number;         // runs that were overloaded (open loop)
  def: number;        // defects summed over the runs (wrong result, unexpected error, mismatch, misorder, wrong error)
  fd: number;         // fewest completed fast statements in a run
  fo: number;         // fewest fast statements observed (completed plus right-censored)
  rate?: number;      // open loop: arrival rate in statements per second
  alias?: boolean;    // not run: equal to `control` by construction (sharing off, standalone statements)
}
const r4 = (x: number) => (Number.isFinite(x) ? Number(x.toPrecision(4)) : (null as unknown as number));
export const a3 = (x: number[]): A3 => { const a = agg(x); return [r4(a.min), r4(a.med), r4(a.max)]; };
export interface RunLike { thr: number; fastP999: number; slowP99: number; cpuUsPerStmt: number; util: number; overloaded: boolean; nFast: number; nFastDone: number; nSlow: number; proxyCpuUtil?: number; defects?: Record<string, number>; mismatches?: number; misorders?: number }
export function rowOf(c: string, k: string, l: string, runs: RunLike[], rate?: number): Row {
  const closed = l.startsWith('closed');
  const def = runs.reduce((a, r) => a + (r.defects ? Object.values(r.defects).reduce((x, y) => x + y, 0) : (r.mismatches ?? 0) + (r.misorders ?? 0)), 0);
  const pu = runs.map((r) => r.proxyCpuUtil ?? 0).reduce((a, b) => Math.max(a, b), 0);
  return {
    c, k, l, n: runs.length,
    ...(closed ? { thr: a3(runs.map((r) => r.thr)) } : { p999: a3(runs.map((r) => r.fastP999)), ...(runs.some((r) => r.nSlow > 0) ? { sp99: a3(runs.map((r) => r.slowP99)) } : {}) }),
    cpu: a3(runs.map((r) => r.cpuUsPerStmt)),
    util: r4(agg(runs.map((r) => r.util)).med), ...(pu > 0 ? { pu: r4(pu) } : {}),
    ov: runs.filter((r) => r.overloaded).length, def,
    fd: Math.min(...runs.map((r) => r.nFastDone)), fo: Math.min(...runs.map((r) => r.nFast)), ...(rate ? { rate } : {}),
  };
}
export const readJson = async (f: string) => JSON.parse(f.endsWith('.gz') ? new TextDecoder().decode(Bun.gunzipSync(new Uint8Array(await Bun.file(f).arrayBuffer()))) : await Bun.file(f).text());
