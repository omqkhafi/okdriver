// Builds results/rule-input.json from the committed result files and applies rule.json (scripts/rule.ts) to it.
// Usage: node scripts/assemble.ts
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { decide, compare, type Rule, type RuleInput, type GateResult, type Cand } from './rule.ts';

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, '..', 'results');
const rj = (n: string): any | null => { const p = join(dir, n); return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null; };
const ruleText = readFileSync(join(here, '..', 'rule.json'));
const rule = JSON.parse(ruleText.toString()) as Rule & { gate: { capabilities_required: string[] } };

const builds = ['release', 'canary'].filter((b) => rj(`fragmentation.${b}.N.json`) && rj(`fragmentation.${b}.B.json`));
const gate: RuleInput['gate'] = {};
const notes: string[] = [];
for (const b of builds) for (const c of ['N', 'B'] as const) {
  const f = rj(`fragmentation.${b}.${c}.json`);
  const cap = rj(`capabilities.${b}.${c}.json`);
  const real = rj(`real-correctness.${b}.json`)?.adapters?.[c];
  let pass = f.results.filter((r: any) => r.status === 'pass').length, total = f.results.length;
  if (real) { total += 1; if (real.pass) pass += 1; } else notes.push(`real PostgreSQL correctness missing for ${b} ${c}`);
  const caps: Record<string, boolean> = {};
  for (const k of rule.gate.capabilities_required) caps[k] = cap?.[k]?.pass === true;
  gate[b] ??= {};
  gate[b]![c] = { fragPassShare: pass / total, capabilities: caps } as GateResult;
}
const tp = rj('throughput.release.json');
const throughput: RuleInput['throughput'] = {};
const nulls: RuleInput['nulls'] = {};
for (const b of builds) {
  const t = b === 'release' ? tp : rj(`throughput.${b}.json`);
  if (!t) continue;
  for (const [cell, v] of Object.entries<any>(t.cells)) for (const c of ['N', 'B'] as const) if (v[c]) ((throughput[b] ??= {})[cell] ??= {})[c] = v[c].map((r: any) => r.value);
}
for (const [cell, v] of Object.entries<any>(tp?.nulls ?? {})) for (const c of ['N', 'B'] as const) if (v[c]) (nulls[cell] ??= {})[c] = [v[c][0].map((r: any) => r.value), v[c][1].map((r: any) => r.value)];
const plantedFailed: Record<string, boolean> = {};
for (const f of rule.suite_sanity.planted_faults) { const p = rj(`planted.release.N+${f}.json`); plantedFailed[f] = !!p && p.results.some((r: any) => r.status !== 'pass'); }
const input: RuleInput = { builds, gate, throughput, nulls, plantedFailed };
writeFileSync(join(dir, 'rule-input.json'), JSON.stringify(input) + '\n');
const verdict = decide(rule, input);
// informational: the same comparison on the canary build, using the release noise floors (no null run was made on canary)
let canaryComparison: unknown = null;
if (builds.includes('canary') && throughput.canary) {
  const c = compare(rule, input, 'canary');
  canaryComparison = { fasterN: c.fasterN, fasterB: c.fasterB, wouldPick: c.fasterB ? 'B' : c.fasterN ? 'N' : rule.pick.tie_order[0], cells: c.cells };
}
const out = { canaryComparison, ruleSha256: createHash('sha256').update(ruleText).digest('hex'), notes, ...verdict };
writeFileSync(join(dir, 'verdict.json'), JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify({ valid: verdict.valid, pick: verdict.pick, basis: verdict.basis, pool: verdict.pool, pickIfOnly: verdict.pickIfOnly, notes }, null, 1));
