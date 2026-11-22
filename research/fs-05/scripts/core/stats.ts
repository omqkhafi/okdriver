export function percentile(sorted: Float64Array, n: number, p: number): number {
  if (n === 0) return NaN;
  const rank = Math.min(n - 1, Math.max(0, Math.ceil(p * n) - 1));
  return sorted[rank]!;
}
/** Sorts a copy of the first n samples and returns the requested percentiles (p in 0..1). */
export function percentiles(a: Float64Array, n: number, ps: number[]): number[] {
  const s = a.slice(0, n).sort();
  return ps.map((p) => percentile(s, n, p));
}
export const median = (x: number[]): number => { const s = [...x].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2; };
export interface Agg { min: number; med: number; max: number; n: number }
export const agg = (x: number[]): Agg => { const v = x.filter((y) => Number.isFinite(y)); return v.length ? { min: Math.min(...v), med: median(v), max: Math.max(...v), n: v.length } : { min: NaN, med: NaN, max: NaN, n: 0 }; };
