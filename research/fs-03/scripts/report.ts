// Renders results/tables.md from the committed result files. Usage: node scripts/report.ts
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { median, floorFor, type RuleInput, type Rule } from './rule.ts';

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, '..', 'results');
const rj = (n: string): any | null => { const p = join(dir, n); return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null; };
const rule = JSON.parse(readFileSync(join(here, '..', 'rule.json'), 'utf8')) as Rule;
const md: string[] = [];
const table = (head: string[], rows: (string | number)[][]): void => { md.push(`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...rows.map((r) => `| ${r.join(' | ')} |`), ''); };
const f = (x: number, d = 1): string => (Number.isFinite(x) ? x.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d }) : 'n/a');
const med = (runs: any[], k: string): number => median(runs.map((r) => r[k]));
const rng = (runs: any[], k: string): string => { const v = runs.map((r) => r[k]).sort((a, b) => a - b); return `${f(v[0]!)}–${f(v[v.length - 1]!)}`; };
const files = readdirSync(dir);

// builds
md.push('## Builds', '');
const builds = rj('builds.json');
if (builds) table(['id', 'runtime', '`--version`', '`--revision`'], builds.builds.map((b: any) => [b.id, b.runtime ?? '', `\`${b.version}\``, b.revision ? `\`${b.revision}\`` : '']));

// throughput tables
const input = rj('rule-input.json') as RuleInput | null;
for (const fl of files.filter((x) => /^throughput\..*\.json$/.test(x)).sort()) {
  const b = fl.replace(/^throughput\./, '').replace(/\.json$/, '');
  const t = rj(fl);
  if (!t) continue;
  md.push(`## Throughput ${b}${t.target ? ` (${t.target})` : ''}`, '');
  const cands = Object.keys(t.cells[Object.keys(t.cells)[0]!]).filter((k) => k !== 'unit');
  const rows: (string | number)[][] = [];
  for (const [cell, v] of Object.entries<any>(t.cells)) {
    const base = input && b === 'release' && rule.throughput.cells.includes(cell) ? floorFor(rule, input, cell) : null;
    const row: (string | number)[] = [cell, v.unit];
    for (const c of cands) row.push(`${f(med(v[c], 'value'))} (${rng(v[c], 'value')})`);
    if (cands.includes('N') && cands.includes('B')) {
      const ratio = med(v.N, 'value') / med(v.B, 'value');
      row.push(f(ratio, 3), base === null ? '' : `${(base * 100).toFixed(1)}%`);
    }
    rows.push(row);
  }
  table(['cell', 'unit', ...cands.map((c) => `${c} median (min–max)`), ...(cands.includes('N') && cands.includes('B') ? ['N / B', 'noise floor'] : [])], rows);
  md.push(`CPU seconds per unit (statement, or MB) and peak RSS, medians over runs; not gating.`, '');
  const cpuRows: (string | number)[][] = [];
  for (const [cell, v] of Object.entries<any>(t.cells)) {
    const row: (string | number)[] = [cell];
    for (const c of cands) row.push(`${(med(v[c], 'cpuPerUnit') * (cell.startsWith('W1') || cell.startsWith('W2') || cell.startsWith('W5-S') || cell.startsWith('W5-D') ? 1e6 : 1e3)).toFixed(1)} ${cell.startsWith('W1') || cell.startsWith('W2') || cell.startsWith('W5-S') || cell.startsWith('W5-D') ? 'µs/stmt' : 'ms/MB'} · ${f(med(v[c], 'rssPeakKB') / 1024, 0)} MiB`);
    if (cell === 'W1' || cell === 'W5-S1') row.push(...cands.map((c) => `p50 ${f(med(v[c], 'p50us'), 0)} µs, p99 ${f(med(v[c], 'p99us'), 0)} µs`));
    cpuRows.push(row);
  }
  table(['cell', ...cands.map((c) => `${c} CPU · peak RSS`), ...(cpuRows.some((r) => r.length > 1 + cands.length) ? cands.map((c) => `${c} latency (W1)`) : [])], cpuRows.map((r) => (r.length < 1 + cands.length * 2 && cpuRows.some((x) => x.length > 1 + cands.length) ? [...r, ...cands.map(() => '')] : r)));
  if (t.nulls && Object.keys(t.nulls).length) {
    md.push('Null comparison (candidate against itself, interleaved): relative gap between the two series\' medians.', '');
    table(['cell', ...Object.keys(Object.values<any>(t.nulls)[0]!).map((c) => `${c} gap`)], Object.entries<any>(t.nulls).map(([cell, v]) => [cell, ...Object.keys(v).map((c) => { const a = med(v[c][0], 'value'), bb = med(v[c][1], 'value'); return `${(Math.abs(a - bb) / ((a + bb) / 2) * 100).toFixed(2)}%`; })]));
  }
}
for (const n of files.filter((x) => /^w5\..*\.json$/.test(x)).sort()) {
  const t = rj(n);
  if (!t) continue;
  md.push(`## ${n.replace('.json', '')}`, '');
  const cands = Object.keys(Object.values<any>(t.cells)[0]!).filter((k) => k !== 'unit');
  table(['cell', 'unit', ...cands.map((c) => `${c} median (min–max)`), 'N / B'], Object.entries<any>(t.cells).map(([cell, v]) => [cell, v.unit, ...cands.map((c) => `${f(med(v[c], 'value'))} (${rng(v[c], 'value')})`), v.N && v.B ? f(med(v.N, 'value') / med(v.B, 'value'), 3) : '']));
}

// gate
md.push('## Gate', '');
const gateRows: (string | number)[][] = [];
for (const b of ['release', 'canary']) for (const c of ['N', 'B', 'N-data']) {
  const fr = rj(`fragmentation.${b}.${c}.json`), cap = rj(`capabilities.${b}.${c}.json`), real = rj(`real-correctness.${b}.json`)?.adapters?.[c];
  if (!fr) continue;
  gateRows.push([b, c, `${fr.results.filter((r: any) => r.status === 'pass').length}/${fr.results.length}`, real ? (real.pass ? 'pass' : 'FAIL') : 'not run',
    ...['tls_upgrade', 'pause_resume_bounded', 'write_backpressure', 'terminal_once'].map((k) => (cap ? (cap[k].pass ? 'pass' : 'FAIL') : 'not run'))]);
}
table(['build', 'candidate', 'fragmentation scenarios', 'real PostgreSQL vs psql', 'tls_upgrade', 'pause_resume_bounded', 'write_backpressure', 'terminal_once'], gateRows);
const scen: Record<string, Record<string, string>> = {};
for (const fl of files.filter((x) => x.startsWith('fragmentation.') || x.startsWith('planted'))) {
  const r = rj(fl);
  const key = fl.replace(/\.json$/, '').replace('fragmentation.', '').replace('planted-extra.', 'planted-extra ').replace('planted.', 'planted ');
  for (const s of r.results) (scen[s.name] ??= {})[key] = s.status;
}
const keys = [...new Set(Object.values(scen).flatMap((o) => Object.keys(o)))].sort();
md.push('### Scenarios', '');
table(['scenario', ...keys], Object.entries(scen).map(([n, o]) => [n, ...keys.map((k) => o[k] ?? '')]));

// capabilities reported
md.push('## Capabilities reported only', '');
const capRows: (string | number)[][] = [];
for (const b of ['release', 'canary', 'node22', 'node24']) for (const c of ['N', 'B', 'N-data']) {
  const cap = rj(`capabilities.${b}.${c}.json`);
  if (!cap) continue;
  capRows.push([b, c, cap.direct_tls_alpn?.alpnNegotiated ? 'yes' : 'no', cap.peer_certificate_bytes?.matches ? 'yes' : 'no', cap.nodelay?.raw?.threw ? `threw` : 'call accepted', cap.keepalive?.keepaliveTimer ? 'keepalive timer seen in /proc/net/tcp' : 'no timer seen', cap.half_close?.pass ? 'yes' : 'no', `${cap.connect_timeout?.raw?.stateAtTimeout}; destroy: ${cap.connect_timeout?.raw?.destroyResult}`]);
}
table(['build', 'candidate', 'direct TLS + ALPN', 'peer certificate bytes = server DER', 'nodelay', 'keepalive', 'half-close', 'connect timeout probe (state after 1.5 s; destroy)'], capRows);
md.push('## Lifetime of delivered bytes', '');
const lt: (string | number)[][] = [];
for (const b of ['release', 'canary', 'node22', 'node24']) for (const c of ['N', 'B', 'N-data']) {
  const cap = rj(`capabilities.${b}.${c}.json`)?.lifetime;
  if (!cap) continue;
  lt.push([b, c, cap.deliveries, cap.consecutiveDeliveriesSharingArrayBuffer, cap.viewsChangedAfterMicrotask, cap.viewsChangedBeforeNextDelivery, cap.viewsChangedAtEnd]);
}
table(['build', 'candidate', 'deliveries', 'consecutive deliveries on the same ArrayBuffer', 'views changed after a microtask', 'views changed before the next delivery', 'views changed at the end'], lt);
const w5c = rj('w5-ceiling.json');
if (w5c) { md.push('## PostgreSQL 19.0 own ceiling (pgbench and psql, core 0)', ''); table(['rate', 'value'], Object.entries<any>(w5c).map(([k, v]) => [k, typeof v === 'number' ? f(v, 0) : v])); }
const ce = rj('ceilings.json');
if (ce) { md.push('## Server ceilings (raw Node client)', ''); table(['rate', 'value'], Object.entries<number>(ce.rates).map(([k, v]) => [k, f(v, 0)])); }
const v = rj('verdict.json');
if (v) { md.push('## Verdict (scripts/assemble.ts applying rule.json)', '', '```json', JSON.stringify({ valid: v.valid, pick: v.pick, basis: v.basis, pool: v.pool, pickIfOnly: v.pickIfOnly, ruleSha256: v.ruleSha256 }, null, 1), '```', ''); }
writeFileSync(join(dir, 'tables.md'), md.join('\n'));
console.log(`results/tables.md: ${md.length} lines`);
