// Scenario plans on the real server: correctness (1% of fast statements divide by zero), stuck connection (an advisory lock holds one
// backend for 3 s while statements keep arriving), connection kill (pg_terminate_backend mid-run). Raw lines go to work/raw/scen.jsonl.
// bun scripts/real/scenarios.ts <correct|stuck|kill> (run under taskset -c 0)
import { appendFileSync } from 'node:fs';
import { CONF_ON } from './plans.ts';
import { loadProxyConfig, RAW, runOnce, startProxies, stopProxies, loadDone, runKey, type Cell, type RunResult, type RunSpec } from './run-real.ts';

loadProxyConfig();
const which = process.argv[2] ?? 'correct';
const file = RAW + 'scen.jsonl';
const done = loadDone(file);
startProxies(['loopT', 'd20']);
await new Promise((r) => setTimeout(r, 1000));
// Rates (statements per second): about 0.5 of what the cell carries; with sharing off at 20 ms the connections carry 8/RTT, so a low rate.
const rateOf = (rtt: string, sharing: boolean): number => (rtt === 'd20' ? (sharing ? 3000 : 150) : rtt === 'loopT' ? 8000 : 8000);
const run = async (spec: RunSpec) => {
  const k = runKey(spec); if (done.has(k)) return;
  let r: RunResult;
  try { r = await runOnce(spec); } catch (e: any) { r = { spec, ok: false, error: String(e?.message ?? e) } as RunResult; }
  appendFileSync(file, JSON.stringify(r) + '\n'); done.set(k, r);
  console.log(spec.label, spec.cell.rtt, spec.cell.shape, spec.cell.sharing ? 'on' : 'off', spec.config, spec.run, r.ok ? `defects=${JSON.stringify(r.defects)} errs=${r.errorsSeen} p999=${r.fastP999.toFixed(1)} ${JSON.stringify(r.scenario?.windows ?? r.scenario?.lost ?? '')}` : r.error);
};
// loopback runs go through the zero-delay proxy (loopT) so the depth is read from a trace
for (const rtt of ['loopT', 'd20'] as const) for (const sharing of [true, false]) for (const shape of ['standalone', 'pipeline8'] as const) for (const config of CONF_ON) for (let rep = 0; rep < (which === 'stuck' ? 3 : 1); rep++) {
  const cell: Cell = { rtt, mix: 'm0-fast', shape, sharing };
  if (which === 'stuck' && shape === 'pipeline8') continue;
  if (which === 'kill' && !sharing && shape === 'standalone') continue;
  const rate = rateOf(rtt, sharing) * (shape === 'pipeline8' ? 1 : 1);
  if (which === 'correct') await run({ cell, config, run: rep, label: 'correct', errRate: 0.01, load: { kind: 'open', rate, frac: 0.5, seconds: 6 } });
  if (which === 'stuck') await run({ cell, config, run: rep, label: 'stuck', scenario: 'stuck', load: { kind: 'open', rate, frac: 0.5, seconds: 10 } });
  if (which === 'kill') await run({ cell, config, run: rep, label: 'kill', scenario: 'kill', load: { kind: 'open', rate, frac: 0.5, seconds: 6 } });
}
stopProxies(); process.exit(0);
