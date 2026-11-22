// Readable tables from the result rows: results/real-summary.md (every real cell) and results/sim-summary.md (every simulated cell).
// Cell flags come from the same validity checks as verdict.ts.
import { existsSync, writeFileSync } from 'node:fs';
import { readJson, type A3, type Row } from './results.ts';
import { buildUnits } from './verdict.ts';
const ROOT = new URL('../', import.meta.url).pathname;
const f = (x: number | undefined, d = 1) => (x === undefined || x === null || !Number.isFinite(x) ? 'n/a' : x >= 1000 ? Math.round(x).toString() : x.toFixed(d));
const t3 = (a?: A3, d = 1) => (a ? `${f(a[1], d)} (${f(a[0], d)}-${f(a[2], d)})` : '');

function realTable(rows: Row[]): string {
  const units = buildUnits(rows);
  const cells = [...new Set(rows.map((r) => r.c))].sort();
  const out: string[] = ['# Real runs, every cell', '', 'Throughput in statements per second at the closed-loop caller counts run; p99.9 of fast statements and p99 of slow statements in ms at open-loop fractions of the cell\'s saturation throughput T*; client CPU in microseconds per statement (closed 2048). Cells are median (min-max) of 5 runs. `OV` = runs that could not carry the rate (right-censored tail). Flags: IND = indicative (fewer than 100,000 fast statements), CB = client-bound, PB = proxy-bound, DEF = a delivery defect.', ''];
  for (const c of cells) {
    const rs = rows.filter((r) => r.c === c);
    const flags = new Set<string>();
    for (const u of units) if (u.c === c) for (const w of u.why) flags.add(w.startsWith('indicative') ? 'IND' : w === 'client-bound' ? 'CB' : w === 'proxy-bound' ? 'PB' : '');
    if (rs.some((r) => r.def > 0)) flags.add('DEF');
    flags.delete('');
    const closed = [...new Set(rs.filter((r) => r.l.startsWith('closed')).map((r) => r.l))].sort((a, b) => Number(a.slice(6)) - Number(b.slice(6)));
    const opens = [...new Set(rs.filter((r) => r.l.startsWith('open')).map((r) => r.l))].sort();
    const hasSlow = rs.some((r) => r.sp99);
    const rate = (l: string) => rs.find((r) => r.l === l)?.rate;
    out.push(`## ${c} ${[...flags].length ? '[' + [...flags].join(' ') + ']' : ''}`, '');
    out.push(`| config | ${closed.map((l) => 'thr ' + l.slice(6)).join(' | ')} | ${opens.map((l) => `p99.9 @${l.slice(4)} (${f(rate(l), 0)}/s)`).join(' | ')} | ${hasSlow ? opens.map((l) => `slow p99 @${l.slice(4)}`).join(' | ') + ' | ' : ''}OV | cpu us/stmt |`);
    out.push(`| --- | ${[...closed, ...opens, ...(hasSlow ? opens : [])].map(() => '---').join(' | ')} | --- | --- |`);
    const keys = [...new Set(rs.map((r) => r.k))].sort((a, b) => (a.startsWith('fixed') && b.startsWith('fixed') ? Number(a.slice(6)) - Number(b.slice(6)) : a.localeCompare(b)));
    for (const k of keys) {
      const g = (l: string) => rs.find((r) => r.k === k && r.l === l);
      const ov = opens.map((l) => g(l)?.ov ?? 0).reduce((a, b) => a + b, 0);
      out.push(`| ${k} | ${closed.map((l) => t3(g(l)?.thr, 0)).join(' | ')} | ${opens.map((l) => t3(g(l)?.p999)).join(' | ')} | ${hasSlow ? opens.map((l) => t3(g(l)?.sp99)).join(' | ') + ' | ' : ''}${ov} | ${f(g(closed.at(-1)!)?.cpu[1])} |`);
    }
    out.push('');
  }
  return out.join('\n') + '\n';
}
function simTable(rows: Row[]): string {
  const out = ['# Simulated cells (summary)', '', 'For every cell and load point: the config with the best median, and every config within noise of it (median no worse than the best config\'s worst run). Throughput at 2048 callers; p99.9 of fast statements at 0.5 and 0.8 of T*. `fixed:*` abbreviates the fixed depths within noise. Exploratory unless results/validation.json says passes.', '', '| cell | load | T* or rate | best | within noise |', '| --- | --- | --- | --- | --- |'];
  const g = new Map<string, Row[]>();
  for (const r of rows) (g.get(`${r.c}#${r.l}`) ?? g.set(`${r.c}#${r.l}`, []).get(`${r.c}#${r.l}`)!).push(r);
  for (const [k, rs] of [...g].sort()) {
    const [c, l] = k.split('#') as [string, string];
    const closed = l.startsWith('closed');
    if (closed && l !== 'closed2048') continue;
    const val = (r: Row) => (closed ? r.thr![1] : r.p999![1]);
    const worst = (r: Row) => (closed ? r.thr![0] : r.p999![2]);
    const ok = rs.filter((r) => r.def === 0);
    const best = ok.reduce((a, b) => (closed ? (val(b) > val(a) ? b : a) : val(b) < val(a) ? b : a));
    const near = ok.filter((r) => (closed ? val(r) >= worst(best) : val(r) <= worst(best))).map((r) => r.k);
    const fixed = near.filter((x) => x.startsWith('fixed:')).map((x) => x.slice(6));
    out.push(`| ${c} | ${l} | ${closed ? f(val(best), 0) : f(best.rate, 0)} | ${best.k} | ${[...near.filter((x) => !x.startsWith('fixed:')), ...(fixed.length ? [`fixed:{${fixed.join(',')}}`] : [])].join(', ')} |`);
  }
  return out.join('\n') + '\n';
}
const real: Row[] = (await readJson(ROOT + 'results/real-matrix.json')).rows;
writeFileSync(ROOT + 'results/real-summary.md', realTable(real));
if (existsSync(ROOT + 'results/sim-matrix.json.gz')) writeFileSync(ROOT + 'results/sim-summary.md', simTable((await readJson(ROOT + 'results/sim-matrix.json.gz')).rows));
console.log('ok');
