// What sharing off costs against sharing on for standalone statements, at one absolute arrival rate per round trip: the rates are the
// two open-loop rates measured for the sharing-OFF cell (0.5 and 0.8 of its saturation), so the sharing-off rows already exist and
// this script runs the same rates with sharing ON. Delayed paths run short (indicative: fewer than 100,000 fast statements).
// Raw lines: work/raw/sharing.jsonl. bun scripts/real/sharing.ts (under taskset -c 0)
import { appendFileSync } from 'node:fs';
import { loadProxyConfig, RAW, ROOT, runOnce, startProxies, stopProxies, loadDone, runKey, type RunSpec, type RunResult } from './run-real.ts';
import { readJson, type Row } from '../results.ts';
loadProxyConfig(); startProxies(['d4', 'd20']);
await new Promise((r) => setTimeout(r, 1000));
const file = RAW + 'sharing.jsonl'; const done = loadDone(file);
const rows: Row[] = (await readJson(ROOT + 'results/real-matrix.json')).rows;
for (const rtt of ['loop', 'd4', 'd20'] as const) for (const frac of [0.5, 0.8]) {
  const off = rows.find((r) => r.c === `${rtt}|m0-fast|standalone|off` && r.l === `open${frac}`);
  if (!off?.rate) continue;
  for (const config of ['control', 'fixed:16', 'rtt-aware']) for (let run = 0; run < 5; run++) {
    const spec: RunSpec = { cell: { rtt, mix: 'm0-fast', shape: 'standalone', sharing: true }, config, run, label: 'sharing', load: { kind: 'open', rate: off.rate, frac, ...(rtt === 'loop' ? {} : { fastTarget: rtt === 'd4' ? 8000 : 3000 }) } };
    if (done.has(runKey(spec))) continue;
    let r: RunResult; try { r = await runOnce(spec); } catch (e: any) { r = { spec, ok: false, error: String(e?.message ?? e) } as RunResult; }
    appendFileSync(file, JSON.stringify(r) + '\n'); done.set(runKey(spec), r);
    console.log(rtt, frac, config, run, r.ok ? `p999=${r.fastP999.toFixed(1)} ov=${r.overloaded}` : r.error);
  }
}
stopProxies(); process.exit(0);
