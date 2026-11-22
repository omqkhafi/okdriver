// Fits the simulator's free parameters to the real calibration cells (fast-only, standalone, loopback and 20 ms): closed-loop
// median throughput per (config, caller count). Nelder-Mead in log space. Writes results/calibration.json with every attempt.
// Nothing from a held-out cell is read here (the cells listed in HELD_OUT are skipped by construction).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { loadRaw } from '../real/aggregate.ts';
import { cellId, ROOT } from '../real/run-real.ts';
import { agg } from '../core/stats.ts';
import { runSim, type SimParams } from './sim.ts';
import { DEFAULT, loadParams } from './params.ts';

const CAL_CELLS = ['loop|m0-fast|standalone|on', 'd20|m0-fast|standalone|on', 'loop|m0-fast|standalone|off', 'd20|m0-fast|standalone|off'];
const names = ['sFast', 'wake', 'cIssue', 'cDec', 'cWrite', 'cRead', 'oneWay0', 'oneWay20', 'sigma'] as const;
type Th = Record<(typeof names)[number], number>;
const toParams = (t: Th, base: SimParams): SimParams => ({ ...base, sFast: t.sFast, wake: t.wake, cUnit: t.cIssue / 3, cStmt: (2 * t.cIssue) / 3, cDec: t.cDec, cWrite: t.cWrite, cRead: t.cRead, oneWay0: t.oneWay0, sigma: t.sigma });

interface Target { cell: string; config: string; n: number; real: number }
function targets(): Target[] {
  const runs = loadRaw(ROOT + 'work/raw/real.jsonl').filter((r) => !r.spec.label && r.spec.load.kind === 'closed' && CAL_CELLS.includes(cellId(r.spec.cell)));
  const g = new Map<string, number[]>();
  for (const r of runs) { const k = `${cellId(r.spec.cell)}#${r.spec.config}#${(r.spec.load as { n: number }).n}`; (g.get(k) ?? g.set(k, []).get(k)!).push(r.thr); }
  return [...g].filter(([k, v]) => v.length >= 5 && [4, 2048].includes(Number(k.split('#')[2]))).map(([k, v]) => { const [cell, config, n] = k.split('#') as [string, string, string]; return { cell, config, n: Number(n), real: agg(v).med }; });
}
// the real runs warm up for 1 s and measure for 3 s; AIMD and the 20 ms path need that long to settle, the rest is steady much sooner
const slowConverge = (x: Target) => x.cell.startsWith('d20') || x.config === 'aimd';
const net = (cell: string, t: Th) => (cell.startsWith('loop') ? { oneWay: t.oneWay0, quantum: 0 } : { oneWay: t.oneWay20, quantum: 1 });
export function errorOf(t: Th, tg: Target[], base: SimParams): { err: number; detail: { t: Target; sim: number }[] } {
  const p = toParams(t, base);
  let err = 0; const detail: { t: Target; sim: number }[] = [];
  for (const x of tg) {
    const r = runSim({ net: net(x.cell, t), mix: 'm0-fast', shape: 'standalone', sharing: x.cell.endsWith('|on'), config: x.config, seed: 1, load: { kind: 'closed', n: x.n }, warmMs: slowConverge(x) ? 1000 : 300, closedMs: slowConverge(x) ? 3000 : 600 }, p);
    detail.push({ t: x, sim: r.thr });
    err += Math.log(r.thr / x.real) ** 2;
  }
  return { err: err / tg.length, detail };
}
function nelderMead(f: (x: number[]) => number, x0: number[], iters: number, step = 0.25): { x: number[]; fx: number } {
  const n = x0.length;
  let simplex = [x0, ...x0.map((_, i) => x0.map((v, j) => (i === j ? v + step : v)))].map((x) => ({ x, fx: f(x) }));
  for (let it = 0; it < iters; it++) {
    simplex.sort((a, b) => a.fx - b.fx);
    const best = simplex[0]!, worst = simplex[n]!, second = simplex[n - 1]!;
    const cen = x0.map((_, j) => simplex.slice(0, n).reduce((a, s) => a + s.x[j]!, 0) / n);
    const at = (c: number) => cen.map((v, j) => v + c * (worst.x[j]! - v));
    const xr = at(-1), fr = f(xr);
    if (fr < best.fx) { const xe = at(-2), fe = f(xe); simplex[n] = fe < fr ? { x: xe, fx: fe } : { x: xr, fx: fr }; }
    else if (fr < second.fx) simplex[n] = { x: xr, fx: fr };
    else { const xc = at(fr < worst.fx ? -0.5 : 0.5), fc = f(xc); if (fc < Math.min(fr, worst.fx)) simplex[n] = { x: xc, fx: fc }; else simplex = simplex.map((s, i) => (i === 0 ? s : { x: s.x.map((v, j) => best.x[j]! + 0.5 * (v - best.x[j]!)), fx: f(s.x.map((v, j) => best.x[j]! + 0.5 * (v - best.x[j]!))) })); }
  }
  simplex.sort((a, b) => a.fx - b.fx);
  return simplex[0]!;
}
if (import.meta.main) {
  const rttj = JSON.parse(readFileSync(ROOT + 'results/rtt.json', 'utf8'));
  const attempt = Number(process.argv[2] ?? 1);
  const iters = Number(process.argv[3] ?? 120);
  const tg = targets();
  console.log(`${tg.length} calibration targets`);
  const { params: base } = loadParams();
  const prev = existsSync(ROOT + 'results/calibration.json') ? JSON.parse(readFileSync(ROOT + 'results/calibration.json', 'utf8')) : { attempts: [] };
  const init: Th = prev.attempts.length ? prev.attempts.at(-1).theta : { sFast: 0.02, wake: 0.01, cIssue: 0.006, cDec: 0.004, cWrite: 0.004, cRead: 0.003, oneWay0: 0.03, oneWay20: 9.5, sigma: 0.3 };
  const x0 = names.map((k) => Math.log(init[k]));
  const fn = (x: number[]) => { const t = Object.fromEntries(names.map((k, i) => [k, Math.exp(x[i]!)])) as Th; return errorOf(t, tg, base).err; };
  const r = nelderMead(fn, x0, iters);
  const theta = Object.fromEntries(names.map((k, i) => [k, Math.exp(r.x[i]!)])) as Th;
  const fin = errorOf(theta, tg, base);
  const rel = fin.detail.map((d) => ({ cell: d.t.cell, config: d.t.config, n: d.t.n, real: Math.round(d.t.real), sim: Math.round(d.sim), ratio: +(d.sim / d.t.real).toFixed(3) }));
  console.log(`rms log error ${Math.sqrt(fin.err).toFixed(3)}; worst ratios`, rel.map((x) => x.ratio).sort((a, b) => Math.abs(Math.log(b)) - Math.abs(Math.log(a))).slice(0, 5));
  prev.attempts.push({ attempt, calibrationCells: CAL_CELLS, nTargets: tg.length, theta, rmsLogError: +Math.sqrt(fin.err).toFixed(4), targets: rel });
  const params = toParams(theta, { ...DEFAULT, ...base });
  writeFileSync(ROOT + 'results/calibration.json', JSON.stringify({ ...prev, attempt, params, oneWay: { d20: theta.oneWay20, d4: theta.oneWay20 - (rttj.loaded.d20 - rttj.loaded.d4) / 2 }, quantum: { d20: 1, d4: 1 } }, null, 2) + '\n');
}
