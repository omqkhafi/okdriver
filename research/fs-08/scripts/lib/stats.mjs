import { performance } from 'node:perf_hooks';
export const now = () => performance.now();
export function summarize(xs) {
  const a = [...xs].sort((x, y) => x - y);
  const q = (p) => a[Math.min(a.length - 1, Math.max(0, Math.ceil(p * a.length) - 1))];
  return { n: a.length, median: q(0.5), min: a[0], max: a[a.length - 1], p99: q(0.99) };
}
export const r3 = (x) => Math.round(x * 1000) / 1000;
export const round = (o) => (typeof o === 'number' ? r3(o) : Array.isArray(o) ? o.map(round) : o && typeof o === 'object' ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, round(v)])) : o);

/** Timer-lag sampler: re-arms setTimeout(1) and records every gap between firings. A synchronous block of B ms
 *  shows up as one gap of about B ms. Works on Node and Bun. */
export function startSampler() {
  const gaps = []; let last = performance.now(); let alive = true;
  const tick = () => { if (!alive) return; const t = performance.now(); gaps.push(t - last); last = t; setTimeout(tick, 1); };
  setTimeout(tick, 1);
  return { stop() { alive = false; return gaps; } };
}
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
