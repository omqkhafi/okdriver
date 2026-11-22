// Evidence tables from the scenario runs and the traced runs: depth from the trace against the policy's own counter, correctness gate,
// stuck connection, connection kill. Reads work/raw/scen.jsonl and work/raw/real.jsonl; writes results/evidence.md and results/evidence.json.
import { existsSync, writeFileSync } from 'node:fs';
import { loadRaw } from './real/aggregate.ts';
import { ROOT, type RunResult } from './real/run-real.ts';
import { median } from './core/stats.ts';

const out: string[] = []; const js: any = {};
const real = loadRaw(ROOT + 'work/raw/real.jsonl');
const scen = existsSync(ROOT + 'work/raw/scen.jsonl') ? loadRaw(ROOT + 'work/raw/scen.jsonl') : [];
const f = (x: number, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : 'n/a');

// 1. depth: trace vs policy counter
{
  const rs = real.filter((r) => r.trace);
  const g = new Map<string, { pol: number; tr: number; n: number; syncsEqZs: number }>();
  for (const r of rs) {
    const k = `${r.spec.config}`;
    const e = g.get(k) ?? g.set(k, { pol: 0, tr: 0, n: 0, syncsEqZs: 0 }).get(k)!;
    e.pol = Math.max(e.pol, ...r.maxInFlightPolicy); e.tr = Math.max(e.tr, r.trace.max); e.n++;
  }
  out.push('## In-flight depth: byte trace against the policy\'s own counter', '', 'Largest depth seen over all traced runs (proxy: Syncs forwarded minus ReadyForQuery delivered, per connection; policy: the pool\'s in-flight count at each write).', '', '| config | traced runs | max depth, trace | max depth, policy counter |', '| --- | --- | --- | --- |');
  for (const [k, e] of [...g].sort()) out.push(`| ${k} | ${e.n} | ${e.tr} | ${e.pol} |`);
  js.depth = Object.fromEntries(g);
  // totals: statements the loadgen completed (incl. warm-up and drain) must equal ReadyForQuery the proxy delivered, up to statements lost at the end
  const diffs = rs.filter((r) => !r.overloaded && r.spec.load.kind === 'closed').map((r) => (r.trace.zs - r.trace.syncs));
  out.push('', `Syncs minus ReadyForQuery at the end of closed-loop traced runs (statements still on the wire when the connections were closed): median ${f(median(diffs), 0)}, max ${f(Math.max(...diffs), 0)} over ${diffs.length} runs.`, '');
}
// 2. correctness
{
  const rs = scen.filter((r) => r.spec.label === 'correct');
  const bad = rs.filter((r) => Object.values(r.defects).some((v) => v > 0));
  const errs = rs.reduce((a, r) => a + r.errorsSeen, 0), stm = rs.reduce((a, r) => a + r.completed, 0);
  out.push('## Correctness gate (1% of fast statements divide by zero)', '', `${rs.length} runs (7 configs x sharing on/off x standalone/pipeline8 x loopback/20 ms), ${stm} statements completed in the windows, ${errs} errors received as 22012. Runs with any defect (wrong result, unexpected error, wrong error, mismatch, misorder): **${bad.length}**.`, '');
  if (bad.length) for (const r of bad) out.push(`- ${r.spec.cell.rtt} ${r.spec.cell.shape} sharing ${r.spec.cell.sharing} ${r.spec.config}: ${JSON.stringify(r.defects)}`);
  js.correct = { runs: rs.length, defectRuns: bad.length, errors: errs, statements: stm };
}
// 3. stuck
{
  const rs = scen.filter((r) => r.spec.label === 'stuck');
  out.push('', '## Stuck connection (advisory lock holds one backend for 3 s; arrivals continue)', '', 'Fast statements by scheduled time: before = 1 s to 3 s, during = 3 s to 6 s, after = 6 s to 9 s. Medians over 3 runs. `victims` = fast statements slower than 100 ms. `stuck conn syncs` = statements sent to the blocked connection while it was blocked, against the mean of the other connections. `after share` = the same connection after the release, against the others.', '',
    '| path | sharing | config | p99.9 before | p99.9 during | p99.9 after | victims | stuck conn syncs / others | after share | in flight on stuck conn at release |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  const g = new Map<string, RunResult[]>();
  for (const r of rs) { const k = `${r.spec.cell.rtt}|${r.spec.cell.sharing ? 'on' : 'off'}|${r.spec.config}`; (g.get(k) ?? g.set(k, []).get(k)!).push(r); }
  const tab: any[] = [];
  for (const [k, v] of g) {
    const w = (n: string, key: string) => median(v.map((r) => r.scenario?.windows?.find((x: any) => x.name === n)?.[key] ?? NaN).filter(Number.isFinite));
    const sh = (r: RunResult, from: string, to: string) => { const s = r.scenario?.stuckSnap, b = r.scenario?.blockerConn; if (!s?.[from] || !s?.[to] || b === undefined) return [NaN, NaN]; const d = s[to].map((x: number[], i: number) => x[0]! - s[from][i][0]); const others = d.filter((_: number, i: number) => i !== b); return [d[b], others.reduce((a: number, c: number) => a + c, 0) / others.length]; };
    const during = v.map((r) => sh(r, 'atBlock', 'atRelease')); const after = v.map((r) => { const e = r.trace?.perConn, s = r.scenario?.stuckSnap, b = r.scenario?.blockerConn; if (!e || !s?.atRelease || b === undefined) return [NaN, NaN]; const d = e.map((c: any, i: number) => c.syncs - s.atRelease[i][0]); const o = d.filter((_: number, i: number) => i !== b); return [d[b], o.reduce((a: number, c: number) => a + c, 0) / o.length]; });
    const inflRel = median(v.map((r) => { const s = r.scenario?.stuckSnap?.atRelease, b = r.scenario?.blockerConn; return s && b !== undefined ? s[b][0] - s[b][1] : NaN; }).filter(Number.isFinite));
    const [rtt, sharing, config] = k.split('|') as [string, string, string];
    const row = { rtt, sharing, config, before: w('before', 'p999'), during: w('during', 'p999'), afterP: w('after', 'p999'), victims: w('during', 'over100ms') + w('after', 'over100ms'), dsync: median(during.map((x) => x[0]).filter(Number.isFinite)), dothers: median(during.map((x) => x[1]).filter(Number.isFinite)), async: median(after.map((x) => x[0]).filter(Number.isFinite)), aothers: median(after.map((x) => x[1]).filter(Number.isFinite)), inflRel };
    tab.push(row);
    out.push(`| ${rtt} | ${sharing} | ${config} | ${f(row.before)} | ${f(row.during)} | ${f(row.afterP)} | ${f(row.victims, 0)} | ${f(row.dsync, 0)} / ${f(row.dothers, 0)} | ${f(row.async, 0)} / ${f(row.aothers, 0)} | ${f(row.inflRel, 0)} |`);
  }
  js.stuck = tab;
}
// 4. kill
{
  const rs = scen.filter((r) => r.spec.label === 'kill');
  out.push('', '## Connection killed mid-run (pg_terminate_backend, no automatic retry)', '', '`lost, pool` = statements the pool had written and not completed when it learned the connection was closed. `lost, trace` = Syncs the proxy forwarded for that connection minus ReadyForQuery it delivered, at the end of the run (independent of the pool; a response that was already on its way back when the backend died counts as delivered). `at close, proxy` = the same difference at the moment the server side closed, which also counts responses still in the delay line. `not sent` = statements of a caller\'s pipeline assigned to the connection but not yet written. Statements waiting in the pool queue are unassigned and go to other connections.', '',
    '| path | shape | sharing | config | in flight before kill | lost, pool | lost, trace | at close, proxy | not sent |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  const tab: any[] = [];
  for (const r of rs.sort((a, b) => (a.spec.cell.rtt + a.spec.cell.shape + a.spec.cell.sharing + a.spec.config).localeCompare(b.spec.cell.rtt + b.spec.cell.shape + b.spec.cell.sharing + b.spec.config))) {
    const l = r.scenario?.lost?.[0]; const px = r.scenario?.proxyAtClose?.[r.scenario?.killConn];
    const pc = r.trace?.perConn?.[r.scenario?.killConn]; const tl = pc ? pc.syncs - pc.zs : undefined;
    tab.push({ rtt: r.spec.cell.rtt, shape: r.spec.cell.shape, sharing: r.spec.cell.sharing, config: r.spec.config, before: r.scenario?.inFlightBeforeKill, lostPool: l?.onWire, lostTrace: tl, proxyAtClose: px, notSent: l?.notSent });
    out.push(`| ${r.spec.cell.rtt} | ${r.spec.cell.shape} | ${r.spec.cell.sharing ? 'on' : 'off'} | ${r.spec.config} | ${r.scenario?.inFlightBeforeKill ?? 'n/a'} | ${l?.onWire ?? 'n/a'} | ${tl ?? 'n/a'} | ${px ?? 'n/a'} | ${l?.notSent ?? 'n/a'} |`);
  }
  js.kill = tab;
}
writeFileSync(ROOT + 'results/evidence.md', out.join('\n') + '\n');
writeFileSync(ROOT + 'results/evidence.json', JSON.stringify(js) + '\n');
console.log(out.join('\n'));
