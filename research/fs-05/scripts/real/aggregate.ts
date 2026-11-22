// Raw per-run lines (work/raw/real.jsonl, ignored) -> results/real-matrix.json (one compact row per cell, config, load point).
import { readFileSync, writeFileSync } from 'node:fs';
import { cellId, loadId, ROOT, type RunResult } from './run-real.ts';
import { rowOf, type Row } from '../results.ts';

export function loadRaw(file: string): RunResult[] {
  const out: RunResult[] = [];
  for (const l of readFileSync(file, 'utf8').split('\n')) if (l) { try { const r = JSON.parse(l) as RunResult; if (r.ok) out.push(r); } catch { /* partial line at an interrupted write */ } }
  return out;
}
export function aggregate(runs: RunResult[], filter: (r: RunResult) => boolean = () => true): Row[] {
  const g = new Map<string, RunResult[]>();
  for (const r of runs) { if (!filter(r)) continue; const k = `${cellId(r.spec.cell)}#${r.spec.config}#${loadId(r.spec.load)}`; (g.get(k) ?? g.set(k, []).get(k)!).push(r); }
  const rows: Row[] = [];
  for (const [k, rs] of g) { if (rs.length < 5) continue; const [c, cfg, l] = k.split('#') as [string, string, string]; const rate = rs[0]!.spec.load.kind === 'open' ? (rs[0]!.spec.load as { rate: number }).rate : undefined; rows.push(rowOf(c, cfg, l, rs, rate)); }
  return rows.sort((a, b) => (a.c + a.l + a.k).localeCompare(b.c + b.l + b.k));
}
if (import.meta.main) {
  const runs = loadRaw(ROOT + 'work/raw/real.jsonl');
  const rows = aggregate(runs, (r) => !r.spec.label);
  writeFileSync(ROOT + 'results/real-matrix.json', JSON.stringify({ note: 'one row per (cell, config, load point); [min, median, max] of 5 runs; see scripts/results.ts for the fields', rows }) + '\n');
  console.log(`${runs.length} runs, ${rows.length} rows`);
}
