// What sharing off costs against sharing on, standalone fast statements, per round trip. Saturation: closed loop, 2048 callers (real-matrix.json).
// Tail at the same absolute arrival rate: the sharing-off rows are the 0.5 and 0.8 open-loop points of the sharing-off cell; the sharing-on rows are
// work/raw/sharing.jsonl (same rate, same policies' code). Delayed paths ran short (indicative).
import { writeFileSync } from 'node:fs';
import { loadRaw, aggregate } from './real/aggregate.ts';
import { ROOT } from './real/run-real.ts';
import { readJson, type Row } from './results.ts';
const rows: Row[] = (await readJson(ROOT + 'results/real-matrix.json')).rows;
const sh = aggregate(loadRaw(ROOT + 'work/raw/sharing.jsonl'));
const f = (a?: [number, number, number], d = 1) => (a ? `${a[1].toFixed(d)} (${a[0].toFixed(d)}-${a[2].toFixed(d)})` : 'n/a');
const out = ['| path | statements/s at saturation, off (control) | on (best config) | on / off | rate | p99.9 ms, sharing off (control) | p99.9 ms, sharing on: control | fixed:16 | rtt-aware | note |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |'];
for (const rtt of ['loop', 'd4', 'd20']) {
  const off = rows.find((r) => r.c === `${rtt}|m0-fast|standalone|off` && r.k === 'control' && r.l === 'closed2048');
  const onRows = rows.filter((r) => r.c === `${rtt}|m0-fast|standalone|on` && r.l === 'closed2048');
  const on = onRows.reduce((a, b) => ((b.thr?.[1] ?? 0) > (a.thr?.[1] ?? 0) ? b : a));
  for (const frac of [0.5, 0.8]) {
    const o = rows.find((r) => r.c === `${rtt}|m0-fast|standalone|off` && r.k === 'control' && r.l === `open${frac}`);
    const g = (k: string) => sh.find((r) => r.c === `${rtt}|m0-fast|standalone|on` && r.k === k && r.l === `open${frac}`);
    const ind = (o?.fo ?? 0) < 100000 ? 'indicative (fewer than 100,000 fast statements)' : '';
    out.push(`| ${rtt} | ${off?.thr?.[1].toFixed(0)} | ${on.thr?.[1].toFixed(0)} (${on.k}) | ${(on.thr![1] / off!.thr![1]).toFixed(2)} | ${o?.rate} | ${f(o?.p999)}${o?.ov ? ' OV' : ''} | ${f(g('control')?.p999)}${g('control')?.ov ? ' OV' : ''} | ${f(g('fixed:16')?.p999)}${g('fixed:16')?.ov ? ' OV' : ''} | ${f(g('rtt-aware')?.p999)}${g('rtt-aware')?.ov ? ' OV' : ''} | ${ind} |`);
  }
}
writeFileSync(ROOT + 'results/sharing-cost.md', out.join('\n') + '\n');
console.log(out.join('\n'));
