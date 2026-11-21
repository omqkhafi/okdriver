// Parse peaks.md and cpu-split.txt (the harness's own tables) into summary.csv, then print/write the median tables
// and the ratios against the published series extracted from orm.drizzle.team/benchmarks.
//   bun scripts/summarize.ts <results-dir> <published-series.json>
import { readFileSync, writeFileSync } from 'node:fs';
const [dir, pubPath] = [process.argv[2], process.argv[3]];

// ---- ours --------------------------------------------------------------------------------------------------
type Run = { config: string; round: number; rps: number; vus: number; p95: number; p99: number; srvUs: number; pgUs: number; restUs: number; totUs: number; failed: number;
  srvPct: number; pgPct: number; irqPct: number; otherPct: number; idlePct: number };
const runs = new Map<string, Run>();
for (const line of readFileSync(`${dir}/peaks.md`, 'utf8').split('\n')) {
  const c = line.split('|').map((x) => x.trim());
  if (c.length < 8 || !/-r\d$/.test(c[1])) continue;
  const m = /^(.*)-r(\d)$/.exec(c[1])!;
  const [p95, p99] = c[4].split('/').map((x) => parseFloat(x));
  const [srv, pg, rest, tot] = c[6].replace(/,/g, '').match(/[\d.]+/g)!.map(Number);
  runs.set(c[1], { config: m[1], round: +m[2], rps: parseFloat(c[2].replace(/[*,]/g, '')), vus: +c[3], p95, p99, srvUs: srv, pgUs: pg, restUs: rest, totUs: tot, failed: +c[7],
    srvPct: NaN, pgPct: NaN, irqPct: NaN, otherPct: NaN, idlePct: NaN });
}
// cpu-split: one block per run, header line "<run>.parquet: CPU in % ...", then table rows; take the row of the peak step's VU count
let cur: Run | undefined;
for (const line of readFileSync(`${dir}/cpu-split.txt`, 'utf8').split('\n')) {
  const h = /^(\S+)\.parquet: CPU in %/.exec(line);
  if (h) { cur = runs.get(h[1]); continue; }
  const c = line.split('│').map((x) => x.trim());
  if (!cur || c.length < 14 || !/^\d+$/.test(c[1]) || +c[2] !== cur.vus) continue;
  [cur.srvPct, cur.pgPct, , cur.irqPct, cur.otherPct, cur.idlePct] = [+c[6], +c[7], +c[8], +c[9], +c[10], +c[11]];
}
const rows = [...runs.values()].sort((a, b) => a.config.localeCompare(b.config) || a.round - b.round);
const num = (x: number) => (Number.isNaN(x) ? '' : String(x));
writeFileSync(`${dir}/summary.csv`, ['config,round,peak_rps,at_vus,p95_ms,p99_ms,server_us_per_req,postgres_us_per_req,rest_us_per_req,total_us_per_req,failed,server_cpu_pct,postgres_cpu_pct,kernel_irq_cpu_pct,other_cpu_pct,idle_cpu_pct',
  ...rows.map((r) => [r.config, r.round, r.rps, r.vus, r.p95, r.p99, r.srvUs, r.pgUs, r.restUs, r.totUs, r.failed, ...[r.srvPct, r.pgPct, r.irqPct, r.otherPct, r.idlePct].map(num)].join(','))].join('\n') + '\n');

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const configs = [...new Set(rows.map((r) => r.config))];
const stat = (c: string, f: (r: Run) => number) => { const v = rows.filter((r) => r.config === c).map(f); return { med: median(v), min: Math.min(...v), max: Math.max(...v) }; };
const fmt = (s: { med: number; min: number; max: number }, d = 0) => `${s.med.toFixed(d)} (${s.min.toFixed(d)}–${s.max.toFixed(d)})`;

let md = '### Reproduced, per config: median (min–max) of 3 runs, at the 600-VU step\n\n';
md += '| config | rps | p95 ms | p99 ms | server µs/req | Postgres µs/req | rest µs/req | total µs/req | server CPU % | Postgres CPU % | other CPU % (load gen) | idle CPU % |\n|---|---|---|---|---|---|---|---|---|---|---|---|\n';
for (const c of configs) {
  md += `| ${c} | ${fmt(stat(c, (r) => r.rps))} | ${fmt(stat(c, (r) => r.p95), 1)} | ${fmt(stat(c, (r) => r.p99), 1)} | ${fmt(stat(c, (r) => r.srvUs))} | ${fmt(stat(c, (r) => r.pgUs))} | ${fmt(stat(c, (r) => r.restUs))} | ${fmt(stat(c, (r) => r.totUs))} | ${fmt(stat(c, (r) => r.srvPct))} | ${fmt(stat(c, (r) => r.pgPct))} | ${fmt(stat(c, (r) => r.otherPct))} | ${fmt(stat(c, (r) => r.idlePct))} |\n`;
}

// ---- published (website series of 2026-11-20) ----------------------------------------------------------------
type Sec = { time: string; core1: number | null; core2: number | null; core3: number | null; core4: number | null; reqs_per_sec: number; fail_reqs_per_sec: number; latency_95: number; latency_99: number; vus?: number };
const pub = JSON.parse(readFileSync(pubPath, 'utf8')) as Record<string, Sec[]>;
// The same step logic as peaks.ts: a step is the seconds at one steady VU count, the first second skipped; a peak is the
// first step whose rps is within 1% of the best step.
function pubSteps(s: Sec[]) {
  const by = new Map<number, Sec[]>();
  for (let i = 1; i < s.length; i++) {
    const v = s[i].vus ?? 0;
    if (!v || s[i - 1].vus !== v) continue; // steady seconds only: same VU count as the previous second
    (by.get(v) ?? by.set(v, []).get(v)!).push(s[i]);
  }
  return [...by.entries()].filter(([, x]) => x.length >= 2).map(([vus, x]) => {
    const avg = (f: (z: Sec) => number | null) => { const v = x.map(f).filter((n): n is number => n != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN; };
    const rps = avg((z) => z.reqs_per_sec);
    const cpu = avg((z) => (z.core1 == null ? null : z.core1 + z.core2! + z.core3! + z.core4!)); // % of one core, all four
    return { vus, rps, p95: avg((z) => z.latency_95), p99: avg((z) => z.latency_99), cpuUs: cpu / 100 / rps * 1e6 };
  }).sort((a, b) => a.vus - b.vus);
}
const P = (name: string) => { const st = pubSteps(pub[`20112026:${name}`] ?? []); const best = Math.max(...st.map((x) => x.rps)); return { at600: st.find((x) => x.vus === 600), peak: st.find((x) => x.rps >= 0.99 * best) }; };
const pubNames = ['drizzle-node24-pg', 'drizzle-node24-drizzle', 'drizzle-bun14-bunsql', 'drizzle-bun14-drizzle'];
md += '\n### Published (orm.drizzle.team/benchmarks data, 2026-11-20), same step logic\n\n| config | peak rps (at VUs) | at 600 VUs: rps | p95 ms | p99 ms | machine CPU µs/req (all 4 cores) |\n|---|---|---|---|---|---|\n';
for (const n of pubNames) { const p = P(n); md += `| ${n} | ${p.peak?.rps.toFixed(0)} (${p.peak?.vus}) | ${p.at600?.rps.toFixed(0)} | ${p.at600?.p95.toFixed(1)} | ${p.at600?.p99.toFixed(1)} | ${p.at600?.cpuUs.toFixed(0)} |\n`; }

// ---- ratios ---------------------------------------------------------------------------------------------------
const pair = (a: string, b: string) => ({ a, b });
const pairs = [pair('drizzle-node24-drizzle', 'drizzle-node24-pg'), pair('drizzle-bun14-drizzle', 'drizzle-bun14-bunsql'), pair('drizzle-node24-drizzle-nopipe', 'drizzle-node24-pg'), pair('drizzle-node24-drizzle', 'drizzle-node24-drizzle-nopipe'),
  pair('kysely-node24-drizzle', 'kysely-node24-pg'), pair('kysely-node24-postgresjs', 'kysely-node24-pg'), pair('kysely-node24-drizzle', 'kysely-node24-postgresjs')];
const r2 = (x: number) => x.toFixed(2);
md += '\n### Ratios A / B at 600 VUs (reproduced = ratio of medians; published where a series exists; flag = more than 25% apart)\n\n| A / B | rps | p95 | p99 | server µs/req | total µs/req (ours) vs machine µs/req (published) | flag |\n|---|---|---|---|---|---|---|\n';
for (const { a, b } of pairs) {
  const rs = (f: (r: Run) => number) => stat(a, f).med / stat(b, f).med;
  const ours = { rps: rs((r) => r.rps), p95: rs((r) => r.p95), p99: rs((r) => r.p99), srv: rs((r) => r.srvUs), tot: rs((r) => r.totUs) };
  const pa = pubNames.includes(a) ? P(a).at600 : undefined, pb = pubNames.includes(b) ? P(b).at600 : undefined;
  let flag = 'no published series';
  let pubCells = '';
  if (pa && pb) {
    const pr = { rps: pa.rps / pb.rps, p95: pa.p95 / pb.p95, p99: pa.p99 / pb.p99, tot: pa.cpuUs / pb.cpuUs };
    const far = (['p95', 'p99', 'tot'] as const).filter((k) => Math.abs(ours[k] / pr[k] - 1) > 0.25);
    flag = far.length ? `>25% apart: ${far.join(', ')}` : 'within 25%';
    pubCells = ` (published: rps ${r2(pr.rps)}, p95 ${r2(pr.p95)}, p99 ${r2(pr.p99)}, CPU ${r2(pr.tot)})`;
  }
  md += `| ${a} / ${b} | ${r2(ours.rps)} | ${r2(ours.p95)} | ${r2(ours.p99)} | ${r2(ours.srv)} | ${r2(ours.tot)}${pubCells} | ${flag} |\n`;
}
const pk = (a: string, b: string) => { const x = P(a).peak!, y = P(b).peak!; return x.rps / y.rps; };
md += `\nPublished peak-rps ratios (not reproducible with the 100,000-request profile, which ends before saturation): node24 drizzle/pg ${r2(pk('drizzle-node24-drizzle', 'drizzle-node24-pg'))}, bun14 drizzle/bunsql ${r2(pk('drizzle-bun14-drizzle', 'drizzle-bun14-bunsql'))}.\n`;
writeFileSync(`${dir}/tables.md`, md);
console.log(md);
