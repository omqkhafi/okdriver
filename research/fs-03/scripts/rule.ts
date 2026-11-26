// Applies rule.json to the committed results. Pure functions plus a CLI: `node scripts/rule.ts [resultsDir]` writes results/verdict.json.
// The same functions are driven by scripts/rule-toy.ts on invented numbers.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export type Cand = 'N' | 'B';
export interface GateResult { fragPassShare: number; capabilities: Record<string, boolean> }
export interface RuleInput {
  /** builds that were run; canary absent means not obtainable */
  builds: string[];
  gate: Record<string, Partial<Record<Cand, GateResult>>>;
  /** throughput runs after warm-up: cell -> candidate -> numbers */
  throughput: Record<string, Record<string, Partial<Record<Cand, number[]>>>>;
  /** null comparison on release: cell -> candidate -> [seriesA, seriesB] */
  nulls: Record<string, Partial<Record<Cand, [number[], number[]]>>>;
  plantedFailed: Record<string, boolean>;
}
export interface Rule {
  gate: { fragmentation: { required_pass_share: number }; capabilities_required: string[] };
  suite_sanity: { planted_faults: string[] };
  throughput: { cells: string[]; min_runs_per_cell: number };
  noise: { floor_min: number; null_multiplier: number };
  pick: { tie_order: Cand[] };
}

export const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

export const gatePasses = (rule: Rule, g: GateResult | undefined): { pass: boolean; why: string[] } => {
  if (!g) return { pass: false, why: ['not run'] };
  const why: string[] = [];
  if (g.fragPassShare < rule.gate.fragmentation.required_pass_share) why.push(`fragmentation ${(g.fragPassShare * 100).toFixed(1)}%`);
  for (const c of rule.gate.capabilities_required) if (g.capabilities[c] !== true) why.push(`capability ${c}`);
  return { pass: why.length === 0, why };
};

export const floorFor = (rule: Rule, input: RuleInput, cell: string): number => {
  let spread = 0;
  const n = input.nulls[cell];
  for (const c of ['N', 'B'] as const) {
    const pair = n?.[c];
    if (!pair) continue;
    const a = median(pair[0]), b = median(pair[1]);
    spread = Math.max(spread, Math.abs(a - b) / ((a + b) / 2));
  }
  return Math.max(rule.noise.floor_min, rule.noise.null_multiplier * spread);
};

export interface CellOutcome { cell: string; mN: number; mB: number; floor: number; winner: 'N' | 'B' | 'tie' }
export const compare = (rule: Rule, input: RuleInput, build: string): { cells: CellOutcome[]; fasterN: boolean; fasterB: boolean } => {
  const cells: CellOutcome[] = [];
  for (const cell of rule.throughput.cells) {
    const runs = input.throughput[build]?.[cell];
    const nRuns = runs?.N, bRuns = runs?.B;
    if (!nRuns || !bRuns || nRuns.length < rule.throughput.min_runs_per_cell || bRuns.length < rule.throughput.min_runs_per_cell) {
      throw new Error(`cell ${cell} on ${build} has fewer than ${rule.throughput.min_runs_per_cell} runs`);
    }
    const mN = median(nRuns), mB = median(bRuns), floor = floorFor(rule, input, cell);
    const winner = mN > mB * (1 + floor) ? 'N' : mB > mN * (1 + floor) ? 'B' : 'tie';
    cells.push({ cell, mN, mB, floor, winner });
  }
  const nWins = cells.filter((c) => c.winner === 'N').length, bWins = cells.filter((c) => c.winner === 'B').length;
  return { cells, fasterN: nWins >= 1 && bWins === 0, fasterB: bWins >= 1 && nWins === 0 };
};

export interface Verdict {
  valid: boolean;
  invalidReason?: string;
  pool: Cand[];
  gate: Record<string, Record<string, { pass: boolean; why: string[] }>>;
  pick: Cand | 'none';
  basis: string;
  releaseCells?: CellOutcome[];
  pickIfOnly: Record<string, Cand | 'none'>;
}

const pickFor = (rule: Rule, input: RuleInput, buildsInPool: string[], releaseCompareBuild: string): { pick: Cand | 'none'; basis: string; pool: Cand[]; cells?: CellOutcome[] } => {
  const pool = (['N', 'B'] as const).filter((c) => buildsInPool.every((b) => gatePasses(rule, input.gate[b]?.[c]).pass));
  if (pool.length === 0) return { pick: 'none', basis: 'no candidate passes the gate on every build run', pool };
  if (pool.length === 1) return { pick: pool[0]!, basis: `only ${pool[0]} passes the gate on every build run`, pool };
  const cmp = compare(rule, input, releaseCompareBuild);
  if (cmp.fasterN) return { pick: 'N', basis: 'N faster on the release build', pool, cells: cmp.cells };
  if (cmp.fasterB) return { pick: 'B', basis: 'B faster on the release build', pool, cells: cmp.cells };
  return { pick: rule.pick.tie_order[0]!, basis: `neither faster (mixed or within noise): tie order ${rule.pick.tie_order.join(' before ')}`, pool, cells: cmp.cells };
};

export const decide = (rule: Rule, input: RuleInput): Verdict => {
  const gate: Verdict['gate'] = {};
  for (const b of input.builds) for (const c of ['N', 'B'] as const) (gate[b] ??= {})[c] = gatePasses(rule, input.gate[b]?.[c]);
  const sane = rule.suite_sanity.planted_faults.every((f) => input.plantedFailed[f] === true);
  const pickIfOnly: Verdict['pickIfOnly'] = {};
  for (const b of input.builds) pickIfOnly[b] = pickFor(rule, input, [b], 'release').pick;
  if (!sane) return { valid: false, invalidReason: 'a planted fault passed: the suite is defective', pool: [], gate, pick: 'none', basis: 'invalid', pickIfOnly };
  const r = pickFor(rule, input, input.builds, 'release');
  return { valid: true, pool: r.pool, gate, pick: r.pick, basis: r.basis, releaseCells: r.cells, pickIfOnly };
};

if (import.meta.url === `file://${process.argv[1]}`) {
  const here = dirname(fileURLToPath(import.meta.url));
  const dir = process.argv[2] ?? join(here, '..', 'results');
  const rule = JSON.parse(readFileSync(join(here, '..', 'rule.json'), 'utf8')) as Rule;
  const ruleSha = createHash('sha256').update(readFileSync(join(here, '..', 'rule.json'))).digest('hex');
  const input = JSON.parse(readFileSync(join(dir, 'rule-input.json'), 'utf8')) as RuleInput;
  const v = decide(rule, input);
  const out = { ruleSha256: ruleSha, ...v };
  writeFileSync(join(dir, 'verdict.json'), JSON.stringify(out, null, 2) + '\n');
  console.log(JSON.stringify({ ruleSha256: ruleSha, valid: v.valid, pick: v.pick, basis: v.basis, pool: v.pool, pickIfOnly: v.pickIfOnly }, null, 2));
  if (!existsSync(join(dir, 'verdict.json'))) process.exit(1);
}
