// bun scripts/real/main.ts <plan> [cellFilter]   (run under taskset -c 0)
import { PLANS } from './plans.ts';
import { cellId, loadProxyConfig, runCell, startProxies, stopProxies } from './run-real.ts';
loadProxyConfig();
const plan = PLANS[process.argv[2] ?? ''];
if (!plan) throw new Error(`plans: ${Object.keys(PLANS).join(', ')}`);
const filter = process.argv[3];
const need = new Set(plan.filter((p) => p.cell.rtt !== 'loop').map((p) => p.cell.rtt as string));
startProxies([...need]);
await new Promise((r) => setTimeout(r, 1000));
for (const p of plan) {
  if (filter && !cellId(p.cell).includes(filter)) continue;
  await runCell(p.cell, p.configs, { closed: p.closed, fracs: p.fracs, runs: 5, fastTarget: p.fastTarget });
}
stopProxies(); process.exit(0);
