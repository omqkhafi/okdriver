// Toy test of rule.json / rule.ts on invented numbers. Each clause has a pair of scenarios that differ only in that clause
// and give different outcomes, so no clause is vacuous; the three outcomes N, B and none are all reachable (satisfiable).
// Run: node scripts/rule-toy.ts   (exits 1 on any mismatch). No measurement is involved.
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decide, type Rule, type RuleInput, type Cand, type GateResult } from './rule.ts';

const here = dirname(fileURLToPath(import.meta.url));
const rule = JSON.parse(readFileSync(join(here, '..', 'rule.json'), 'utf8')) as Rule;
const CAPS = rule.gate.capabilities_required;
const CELLS = rule.throughput.cells;

const goodGate = (): GateResult => ({ fragPassShare: 1, capabilities: Object.fromEntries(CAPS.map((c) => [c, true])) });
const series = (m: number, n = 15): number[] => Array.from({ length: n }, (_, i) => m * (1 + ((i % 5) - 2) * 0.004));

interface Opts {
  builds?: string[];
  gate?: (build: string, cand: Cand) => GateResult;
  ratioB?: Record<string, number>; // release B/N ratio per cell, default 1
  canaryRatioB?: number;
  nullGap?: number; // relative gap between the two identical series
  planted?: Record<string, boolean>;
}
const mk = (o: Opts = {}): RuleInput => {
  const builds = o.builds ?? ['release', 'canary'];
  const gate: RuleInput['gate'] = {};
  for (const b of builds) for (const c of ['N', 'B'] as const) (gate[b] ??= {})[c] = (o.gate ?? goodGate)(b, c);
  const throughput: RuleInput['throughput'] = {};
  for (const b of builds) for (const cell of CELLS) {
    const r = b === 'release' ? (o.ratioB?.[cell] ?? 1) : (o.canaryRatioB ?? 1);
    ((throughput[b] ??= {})[cell] ??= {}).N = series(1000);
    throughput[b]![cell]!.B = series(1000 * r);
  }
  const nulls: RuleInput['nulls'] = {};
  for (const cell of CELLS) nulls[cell] = Object.fromEntries((['N', 'B'] as const).map((c) => [c, [series(1000), series(1000 * (1 + (o.nullGap ?? 0)))]]));
  const plantedFailed = Object.fromEntries(rule.suite_sanity.planted_faults.map((f) => [f, o.planted?.[f] ?? true]));
  return { builds, gate, throughput, nulls, plantedFailed };
};
const failing = (cand: Cand, build: string | null, patch: (g: GateResult) => void) => (b: string, c: Cand): GateResult => {
  const g = goodGate();
  if (c === cand && (build === null || build === b)) patch(g);
  return g;
};
const bothFail = (b: string, _c: Cand): GateResult => ({ ...goodGate(), fragPassShare: b === 'release' ? 0.99 : 1 });

interface Case { name: string; clause: string; input: RuleInput; expect: Cand | 'none' | 'invalid' }
const cases: Case[] = [
  { name: 'base: everything passes, all cells within noise', clause: 'tie order', input: mk(), expect: 'N' },
  { name: 'B is 10% ahead in every cell', clause: 'faster (win)', input: mk({ ratioB: Object.fromEntries(CELLS.map((c) => [c, 1.1])) }), expect: 'B' },
  { name: 'B 10% ahead in all cells but N 10% ahead in one (mixed)', clause: 'faster (lose no cell)', input: mk({ ratioB: { ...Object.fromEntries(CELLS.map((c) => [c, 1.1])), W4: 0.9 } }), expect: 'N' },
  { name: 'B 6% ahead in one cell, floor 5%', clause: 'noise floor minimum', input: mk({ ratioB: { W2: 1.06 } }), expect: 'B' },
  { name: 'B 4% ahead in one cell, floor 5%', clause: 'noise floor minimum', input: mk({ ratioB: { W2: 1.04 } }), expect: 'N' },
  { name: 'B 8% ahead, null gap 6% so floor 12%', clause: 'noise floor from null', input: mk({ ratioB: { W2: 1.08 }, nullGap: 0.06 }), expect: 'N' },
  { name: 'B 8% ahead, null gap 0', clause: 'noise floor from null', input: mk({ ratioB: { W2: 1.08 }, nullGap: 0 }), expect: 'B' },
  { name: 'N fails fragmentation (99%) on release', clause: 'gate: fragmentation', input: mk({ gate: failing('N', 'release', (g) => { g.fragPassShare = 0.99; }) }), expect: 'B' },
  ...CAPS.map((c): Case => ({ name: `N lacks ${c} on release`, clause: `gate: ${c}`, input: mk({ gate: failing('N', 'release', (g) => { g.capabilities[c] = false; }) }), expect: 'B' })),
  { name: 'N fails fragmentation on canary only', clause: 'gate on canary', input: mk({ gate: failing('N', 'canary', (g) => { g.fragPassShare = 0.5; }) }), expect: 'B' },
  { name: 'N fails fragmentation on canary only, canary not obtainable', clause: 'canary optional', input: mk({ builds: ['release'], gate: failing('N', 'canary', (g) => { g.fragPassShare = 0.5; }) }), expect: 'N' },
  { name: 'B faster on canary, tie on release', clause: 'throughput of release only', input: mk({ canaryRatioB: 1.3 }), expect: 'N' },
  { name: 'both fail on release', clause: 'empty pool', input: mk({ gate: bothFail }), expect: 'none' },
  { name: 'a planted fault passed the suite', clause: 'suite sanity', input: mk({ planted: { duplicate_chunk: false } }), expect: 'invalid' },
];

let bad = 0;
const rows: string[] = [];
for (const c of cases) {
  const v = decide(rule, c.input);
  const got = v.valid ? v.pick : 'invalid';
  const ok = got === c.expect;
  if (!ok) bad++;
  rows.push(`${ok ? 'ok  ' : 'FAIL'} [${c.clause}] ${c.name}: expected ${c.expect}, got ${got}`);
}
// every clause shown with two different outcomes
const byClause = new Map<string, Set<string>>();
for (const c of cases) { const v = decide(rule, c.input); (byClause.get(c.clause) ?? byClause.set(c.clause, new Set()).get(c.clause)!).add(v.valid ? v.pick : 'invalid'); }
const outcomes = new Set(cases.map((c) => c.expect));
for (const o of ['N', 'B', 'none', 'invalid']) if (!outcomes.has(o as Cand)) { bad++; rows.push(`FAIL outcome ${o} is not reachable`); }
const single = [...byClause].filter(([, s]) => s.size < 2).map(([k]) => k);
// clauses with a single scenario (tie order, empty pool, canary clauses etc.) are paired with the base case by construction; list them
rows.push(`clauses with one outcome among their own scenarios (paired with the base case): ${single.join('; ') || 'none'}`);
console.log(rows.join('\n'));
writeFileSync(join(here, '..', 'results', 'rule-toy.txt'), rows.join('\n') + `\n${bad === 0 ? 'all toy cases behave as written' : `${bad} mismatches`}\n`);
process.exit(bad ? 1 : 0);
