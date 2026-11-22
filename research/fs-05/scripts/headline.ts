// The two headline tables of the README, from results/real-matrix.json: closed-loop throughput at 2048 callers, and p99.9 of fast statements at 0.5 and 0.8 of T*.
import { writeFileSync } from 'node:fs';
import { readJson, type Row } from './results.ts';
const ROOT = new URL('../', import.meta.url).pathname;
const rows: Row[] = (await readJson(ROOT + 'results/real-matrix.json')).rows;
const cfgs = ['control', 'fixed:4', 'fixed:16', 'fixed:64', 'rtt-aware', 'latency-aware', 'aimd'];
const cells = [...new Set(rows.map((r) => r.c))].sort((a, b) => a.split('|').slice(1).join().localeCompare(b.split('|').slice(1).join()) || a.localeCompare(b));
const num = (x: number) => (x >= 1000 ? (x / 1000).toFixed(1) + 'k' : x >= 100 ? x.toFixed(0) : x.toFixed(1));
const out = ['Throughput, statements per second, 2048 callers (median of 5 runs). `-` = not run (sharing off, standalone: the other policies are `control` by construction).', '', `| cell (rtt, mix, shape, sharing) | ${cfgs.join(' | ')} |`, `| --- | ${cfgs.map(() => '---').join(' | ')} |`];
for (const c of cells) out.push(`| ${c.replace(/\|/g, ', ')} | ${cfgs.map((k) => { const r = rows.find((x) => x.c === c && x.k === k && x.l === 'closed2048'); return r?.thr ? num(r.thr[1]) : '-'; }).join(' | ')} |`);
out.push('', 'p99.9 of fast statements in ms (median of 5 runs) at 0.5 / 0.8 of the cell\'s T*. `*` = every run overloaded (right-censored tail); `i` = indicative (fewer than 100,000 fast statements).', '', `| cell | rate at 0.5 / 0.8 | ${cfgs.join(' | ')} |`, `| --- | --- | ${cfgs.map(() => '---').join(' | ')} |`);
for (const c of cells) {
  const g = (k: string, l: string) => rows.find((x) => x.c === c && x.k === k && x.l === l);
  const any = rows.find((x) => x.c === c && x.l === 'open0.5');
  const ind = (any?.fo ?? 1e9) < 100000 ? 'i' : '';
  out.push(`| ${c.replace(/\|/g, ', ')}${ind ? ' (i)' : ''} | ${any?.rate} / ${rows.find((x) => x.c === c && x.l === 'open0.8')?.rate} | ${cfgs.map((k) => { const a = g(k, 'open0.5'), b = g(k, 'open0.8'); return a?.p999 ? `${num(a.p999[1])}${a.ov ? '*' : ''} / ${num(b!.p999![1])}${b!.ov ? '*' : ''}` : '-'; }).join(' | ')} |`);
}
writeFileSync(ROOT + 'results/headline.md', out.join('\n') + '\n');
console.log(out.join('\n'));
