// Round trip under load: 8 connections at depth 1 (control, 64 callers), RTT = 8 / throughput. The proxy's timer rounding differs between an idle
// path (results/rtt.json "measured") and a busy one; the simulator's network parameter for the delayed paths starts from this loaded value.
import { readFileSync, writeFileSync } from 'node:fs';
import { loadProxyConfig, ROOT, runOnce, startProxies, stopProxies } from './run-real.ts';
loadProxyConfig(); startProxies(['d4', 'd20']);
await new Promise((r) => setTimeout(r, 800));
const f = ROOT + 'results/rtt.json'; const j = JSON.parse(readFileSync(f, 'utf8')); j.loaded = {};
for (const rtt of ['d4', 'd20'] as const) {
  const t: number[] = [];
  for (let i = 0; i < 3; i++) t.push((await runOnce({ cell: { rtt, mix: 'm0-fast', shape: 'standalone', sharing: true }, config: 'control', load: { kind: 'closed', n: 64 }, run: 90 + i })).thr);
  t.sort((a, b) => a - b); j.loaded[rtt] = +(8000 / t[1]!).toFixed(2);
}
j.loadedNote = 'ms, 8 connections at depth 1 under load: 8000 / median throughput of 3 runs';
writeFileSync(f, JSON.stringify(j, null, 2) + '\n'); console.log(j.loaded);
stopProxies(); process.exit(0);
