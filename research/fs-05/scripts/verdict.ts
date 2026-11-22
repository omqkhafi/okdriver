// Applies rules.json to the result rows. No threshold lives here: every number comes from rules.json.
// bun scripts/verdict.ts  ->  results/verdict.json and results/verdict.md
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { readJson, type A3, type Row } from './results.ts';

const ROOT = new URL('../', import.meta.url).pathname;
const rules = JSON.parse(readFileSync(ROOT + 'rules.json', 'utf8'));
const order: string[] = JSON.parse(readFileSync(ROOT + 'results/simplest.json', 'utf8')).order.map((r: { policy: string }) => r.policy); // control, fixed, latency-aware, rtt-aware, aimd
const MARGIN: number = rules.wins.margin;
type Metric = 'thr' | 'p999' | 'sp99' | 'cpu';
const BETTER: Record<Metric, 'higher' | 'lower'> = { thr: 'higher', p999: 'lower', sp99: 'lower', cpu: 'lower' };
const policyOf = (k: string) => (k.startsWith('fixed:') ? 'fixed' : k);
const rank = (k: string) => order.indexOf(policyOf(k));
const val = (a: A3 | undefined, i: 0 | 1 | 2): number => { const v = a?.[i]; return v === null || v === undefined || Number.isNaN(v) ? NaN : v; };
// worst/best run of a metric, by direction
const worst = (m: Metric, a: A3) => (BETTER[m] === 'higher' ? val(a, 0) : val(a, 2));
const best = (m: Metric, a: A3) => (BETTER[m] === 'higher' ? val(a, 2) : val(a, 0));
const worseThan = (m: Metric, x: number, y: number) => (Number.isNaN(x) ? true : Number.isNaN(y) ? false : BETTER[m] === 'higher' ? x < y : x > y);

export interface Unit { c: string; l: string; rows: Map<string, Row>; metrics: Metric[]; valid: boolean; why: string[] }
export function buildUnits(rows: Row[]): Unit[] {
  const g = new Map<string, Row[]>();
  for (const r of rows) (g.get(`${r.c}#${r.l}`) ?? g.set(`${r.c}#${r.l}`, []).get(`${r.c}#${r.l}`)!).push(r);
  const cellInd = new Map<string, boolean>();
  for (const r of rows) if (r.l.startsWith('open')) {
    const short = r.fo < rules.validity.minFastCompleted || (r.ov === 0 && r.fd < rules.validity.minFastCompleted);
    if (short) cellInd.set(r.c, true);
  }
  const units: Unit[] = [];
  for (const [k, rs] of g) {
    const [c, l] = k.split('#') as [string, string];
    const closed = l.startsWith('closed');
    const metrics: Metric[] = closed ? ['thr', 'cpu'] : ['p999', ...(rs.some((r) => r.sp99) ? ['sp99' as Metric] : []), 'cpu'];
    const why: string[] = [];
    if (cellInd.get(c)) why.push('indicative: fewer than minFastCompleted fast statements in a run of this cell');
    if (closed && l !== `closed${rules.loadPoints.closedForRule}`) why.push('not the rule load point');
    if (rs.some((r) => r.util >= rules.validity.clientBoundUtilisation)) why.push('client-bound');
    if (rs.some((r) => (r.pu ?? 0) >= rules.validity.proxyBoundUtilisation)) why.push('proxy-bound');
    units.push({ c, l, rows: new Map(rs.map((r) => [r.k, r])), metrics, valid: why.length === 0, why });
  }
  return units;
}
const med = (r: Row, m: Metric) => val(r[m], 1);
const okRow = (r: Row | undefined) => !!r && r.def === 0;

/** Within noise of the best row of `pool` (best median per metric) on every metric of the unit. */
function withinNoise(u: Unit, key: string, pool: string[]): { ok: boolean; margins: Record<string, number>; bad: string[] } {
  const r = u.rows.get(key)!; const margins: Record<string, number> = {}; const badM: string[] = [];
  let ok = true;
  for (const m of u.metrics) {
    let bestRow: Row | null = null;
    for (const k of pool) { const x = u.rows.get(k); if (!okRow(x)) continue; if (!bestRow || worseThan(m, med(bestRow, m), med(x!, m)) ) bestRow = x!; }
    if (!bestRow) continue;
    const bw = worst(m, bestRow[m]!), mine = med(r, m);
    const bad = worseThan(m, mine, bw);
    margins[m] = BETTER[m] === 'higher' ? mine / bw : mine / bw; // ratio of this median to the best's worst run
    if (bad) { ok = false; badM.push(m); }
  }
  return { ok, margins, bad: badM };
}

/** Sharing off, standalone statements: one statement per exclusive checkout, so the depth cap never binds and every policy that places by
 *  least-in-flight behaves as `control`. Only `control` and `latency-aware` (different placement) were run there; the others are given control's row, marked alias. */
function withAliases(rows: Row[], grid: number[]): Row[] {
  const out = [...rows];
  const have = new Set(rows.map((r) => `${r.c}#${r.l}#${r.k}`));
  for (const r of rows) if (r.k === 'control' && r.c.endsWith('|standalone|off')) for (const k of [...grid.map((d) => `fixed:${d}`), 'rtt-aware', 'aimd']) if (!have.has(`${r.c}#${r.l}#${k}`)) out.push({ ...r, k, alias: true });
  return out;
}
export function evaluate(rowsIn: Row[], grid: number[], title: string) {
  const rows = withAliases(rowsIn, grid);
  const units = buildUnits(rows);
  const required = units.filter((u) => u.valid);
  const out: any = { title, units: units.length, validUnits: required.length, excluded: {} as Record<string, number> };
  for (const u of units) for (const w of u.why) out.excluded[w] = (out.excluded[w] ?? 0) + 1;
  const fixedKeys = grid.map((d) => `fixed:${d}`);
  // 1. D*: most required units within noise of the reference over every config; ties: regret, then smaller D
  const score = fixedKeys.map((k) => {
    let cnt = 0, lr = 0, n = 0;
    for (const u of required) {
      const r = u.rows.get(k); if (!okRow(r)) continue;
      const all = [...u.rows.keys()];
      if (withinNoise(u, k, all).ok) cnt++;
      for (const m of u.metrics) { let b = NaN; for (const kk of all) { const x = u.rows.get(kk); if (okRow(x)) { const v = med(x!, m); if (Number.isNaN(b) || worseThan(m, b, v)) b = v; } } const v = med(r!, m); if (b > 0 && v > 0) { lr += Math.abs(Math.log(v / b)); n++; } }
    }
    return { k, d: Number(k.slice(6)), within: cnt, regret: n ? Math.exp(lr / n) : Infinity };
  }).sort((a, b) => b.within - a.within || a.regret - b.regret || a.d - b.d);
  const dstar = score[0]?.k;
  out.fixedD = { grid, score, dstar };
  if (!dstar) return out;
  const cands = ['control', dstar, 'rtt-aware', 'latency-aware', 'aimd'].sort((a, b) => rank(a) - rank(b));
  // 2. within noise per unit among the candidates
  const W = new Map<Unit, Set<string>>();
  const fails: Record<string, { unit: string; margins: Record<string, number>; bad: string[] }[]> = Object.fromEntries(cands.map((c) => [c, []]));
  for (const u of required) {
    const pool = cands.filter((k) => okRow(u.rows.get(k)));
    const s = new Set<string>();
    for (const k of pool) { const r = withinNoise(u, k, pool); if (r.ok) s.add(k); else fails[k]!.push({ unit: `${u.c}#${u.l}`, margins: r.margins, bad: r.bad }); }
    for (const k of cands) if (!okRow(u.rows.get(k)) && u.rows.has(k)) fails[k]!.push({ unit: `${u.c}#${u.l}`, margins: { correctness: 0 }, bad: ['correctness'] });
    W.set(u, s);
  }
  // 3. default
  const passAll = cands.filter((k) => required.every((u) => W.get(u)!.has(k)));
  out.candidates = cands;
  out.failsPerCandidate = Object.fromEntries(cands.map((k) => [k, fails[k]!.length]));
  out.failsByMetric = Object.fromEntries(cands.map((k) => [k, fails[k]!.reduce<Record<string, number>>((a, f) => { for (const m of f.bad) a[m] = (a[m] ?? 0) + 1; return a; }, {})]));
  out.failingUnitsList = Object.fromEntries(cands.map((k) => [k, fails[k]!.map((f) => `${f.unit} ${f.bad.join('+')}`)]));
  out.aliasedUnits = required.filter((u) => [...u.rows.values()].some((r) => r.alias)).length;
  out.default = passAll[0] ?? null;
  if (!out.default) {
    // which cell and by how much: for the simplest candidate, its worst failing units
    out.noDefault = cands.map((k) => ({ candidate: k, failingUnits: fails[k]!.length, worst: fails[k]!.map((f) => ({ unit: f.unit, margins: f.margins })).sort((a, b) => Math.max(...Object.values(b.margins)) - Math.max(...Object.values(a.margins))).slice(0, 5) }));
  }
  // 4. wins somewhere: worst run of X beats the best run of the simplest within-noise policy by MARGIN
  const wins: Record<string, { unit: string; metric: string; x: number; s: string; sBest: number; ratio: number }[]> = Object.fromEntries(cands.map((c) => [c, []]));
  for (const u of required) {
    const s = cands.find((k) => W.get(u)!.has(k)); if (!s) continue;
    const sr = u.rows.get(s)!;
    for (const x of cands) {
      if (x === s || !okRow(u.rows.get(x))) continue;
      for (const m of u.metrics) {
        const xw = worst(m, u.rows.get(x)![m]!), sb = best(m, sr[m]!);
        if (Number.isNaN(xw) || Number.isNaN(sb)) continue;
        const beats = BETTER[m] === 'higher' ? xw >= sb * (1 + MARGIN) : xw <= sb * (1 - MARGIN);
        if (beats) wins[x]!.push({ unit: `${u.c}#${u.l}`, metric: m, x: xw, s, sBest: sb, ratio: BETTER[m] === 'higher' ? xw / sb : sb / xw });
      }
    }
  }
  out.winsSomewhere = Object.fromEntries(Object.entries(wins).map(([k, v]) => [k, { count: v.length, examples: v.sort((a, b) => b.ratio - a.ratio).slice(0, 6) }]));
  // 4b. SECONDARY reading (not the frozen rule): wins against one baseline for the whole evaluation: the default, or, when none exists, the candidate that is
  // outside noise in the fewest units (ties: simpler). The frozen reading above compares with the simplest within-noise policy of each unit, which cannot be beaten by construction.
  const baseline = out.default ?? [...cands].sort((a, b) => fails[a]!.length - fails[b]!.length || rank(a) - rank(b))[0]!;
  const wins2: Record<string, { unit: string; metric: string; ratio: number }[]> = Object.fromEntries(cands.map((c) => [c, []]));
  for (const u of required) {
    const sr = u.rows.get(baseline); if (!okRow(sr)) continue;
    for (const x of cands) {
      if (x === baseline || !okRow(u.rows.get(x))) continue;
      for (const m of u.metrics) {
        const xw = worst(m, u.rows.get(x)![m]!), sb = best(m, sr![m]!);
        if (Number.isNaN(xw) || Number.isNaN(sb) || sb === 0) continue;
        const beats = BETTER[m] === 'higher' ? xw >= sb * (1 + MARGIN) : xw <= sb * (1 - MARGIN);
        if (beats) wins2[x]!.push({ unit: `${u.c}#${u.l}`, metric: m, ratio: BETTER[m] === 'higher' ? xw / sb : sb / xw });
      }
    }
  }
  out.secondaryBaseline = baseline;
  out.secondaryWins = Object.fromEntries(Object.entries(wins2).map(([k, v]) => [k, { count: v.length, units: [...new Set(v.map((e) => e.unit))].length, examples: v.sort((a, b) => b.ratio - a.ratio).slice(0, 6) }]));
  // 5. oracle bound: best fixed D median per unit against fixed(D*) (reported, never a candidate)
  const gaps: number[] = [];
  for (const u of required) if (u.l.startsWith('closed')) {
    let b = 0; for (const k of fixedKeys) { const r = u.rows.get(k); if (okRow(r)) b = Math.max(b, med(r!, 'thr')); }
    const r = u.rows.get(dstar); if (okRow(r) && b > 0) gaps.push(med(r!, 'thr') / b);
  }
  out.oracleBound = { unitsCompared: gaps.length, medianRatioOfDstarToBestFixedThroughput: gaps.length ? gaps.sort((a, b) => a - b)[gaps.length >> 1] : null, worstRatio: gaps.length ? Math.min(...gaps) : null };
  return out;
}

if (import.meta.main) {
  const results: any[] = [];
  const real: Row[] = (await readJson(ROOT + 'results/real-matrix.json')).rows;
  const simFile = ROOT + 'results/sim-matrix.json.gz';
  const sim: Row[] = existsSync(simFile) ? (await readJson(simFile)).rows : [];
  const valFile = ROOT + 'results/validation.json';
  const validated: boolean | null = existsSync(valFile) ? JSON.parse(readFileSync(valFile, 'utf8')).passes : null;
  for (const sharing of ['on', 'off']) {
    results.push({ set: 'real', sharing, ...evaluate(real.filter((r) => r.c.endsWith(`|${sharing}`)), rules.fixedGrid.real, `real, sharing ${sharing}`) });
    if (sim.length) {
      results.push({ set: 'simulator', sharing, simulatorValidated: validated === true, ...evaluate(sim.filter((r) => r.c.endsWith(`|${sharing}`)), rules.fixedGrid.simulator, `simulator, sharing ${sharing}${validated === true ? '' : ' (EXPLORATORY: not validated)'}`) });
    }
  }
  writeFileSync(ROOT + 'results/verdict.json', JSON.stringify({ simulatorValidated: validated, results }, null, 1) + '\n');
  const md: string[] = ['# Verdict (generated by scripts/verdict.ts from rules.json)', ''];
  for (const r of results) {
    md.push(`## ${r.title}`, '', `units ${r.units}, valid ${r.validUnits}; excluded: ${JSON.stringify(r.excluded)}`, '');
    if (!r.fixedD?.dstar) { md.push('no valid unit with a fixed-D row', ''); continue; }
    md.push(`fixed D*: **${r.fixedD.dstar}** (within noise in ${r.fixedD.score[0].within} of ${r.validUnits} units); candidates ${r.candidates.join(', ')}`, '');
    md.push(`default: **${r.default ?? 'none'}**; units each candidate is outside noise: ${JSON.stringify(r.failsPerCandidate)}`, '');
    if (!r.default) for (const n of r.noDefault.slice(0, 2)) md.push(`- ${n.candidate}: ${n.failingUnits} failing units, worst: ${n.worst.map((w: any) => `${w.unit} ${JSON.stringify(Object.fromEntries(Object.entries(w.margins).map(([k, v]) => [k, +(v as number).toFixed(2)])))}`).join('; ')}`);
    md.push('', 'wins somewhere, frozen rule (worst run beats the best run of the simplest within-noise policy of the unit by the margin; cannot be satisfied by a policy that is itself within noise, see README):', '');
    for (const [k, v] of Object.entries(r.winsSomewhere) as [string, any][]) md.push(`- ${k}: ${v.count} unit-metrics${v.count ? '; e.g. ' + v.examples.slice(0, 3).map((e: any) => `${e.unit} ${e.metric} x${e.ratio.toFixed(2)} over ${e.s}`).join('; ') : ''}`);
    md.push('', `secondary reading, baseline **${r.secondaryBaseline}** (the default, or the candidate outside noise in the fewest units): wins somewhere:`, '');
    for (const [k, v] of Object.entries(r.secondaryWins) as [string, any][]) md.push(`- ${k}: ${v.count} unit-metrics in ${v.units} units${v.count ? '; e.g. ' + v.examples.slice(0, 3).map((e: any) => `${e.unit} ${e.metric} x${e.ratio.toFixed(2)}`).join('; ') : ''}`);
    md.push('', `units each candidate is outside noise, by metric: ${JSON.stringify(r.failsByMetric)}; units with aliased rows: ${r.aliasedUnits}`);
    md.push('', `oracle bound (best fixed D per unit, throughput): D* reaches median ${r.oracleBound.medianRatioOfDstarToBestFixedThroughput?.toFixed(3)} of it, worst ${r.oracleBound.worstRatio?.toFixed(3)} over ${r.oracleBound.unitsCompared} units`, '');
  }
  writeFileSync(ROOT + 'results/verdict.md', md.join('\n') + '\n');
  console.log(md.join('\n'));
}
