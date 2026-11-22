// "Where does each shape end": the binding resource per cell, worked out from measured constants, next to the measured plateau.
// Ceilings (statements per second): depth x connections / round trip; client CPU (1e6 / client CPU per statement of the best config);
// connection time for sleeping statements (connections / (slow share x sleep time)); server CPU (pgbench, results/pgbench.txt).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { mixById } from './core/workload.ts';
import { readJson, type Row } from './results.ts';
const ROOT = new URL('../', import.meta.url).pathname;
const rtt = JSON.parse(readFileSync(ROOT + 'results/rtt.json', 'utf8'));
const cal = existsSync(ROOT + 'results/calibration.json') ? JSON.parse(readFileSync(ROOT + 'results/calibration.json', 'utf8')) : null;
const rows: Row[] = (await readJson(ROOT + 'results/real-matrix.json')).rows.filter((r: Row) => r.l === 'closed2048');
const pg = existsSync(ROOT + 'results/pgbench.txt') ? readFileSync(ROOT + 'results/pgbench.txt', 'utf8') : '';
const loadedRtt: Record<string, number> = { loop: rtt.measured.loop.median, loopT: rtt.measured.loopT.median, d4: rtt.loaded?.d4 ?? rtt.measured.d4.median, d20: rtt.loaded?.d20 ?? (cal ? 2 * (cal.oneWay.d20 + 0.5) : rtt.measured.d20.median) };
const P = 8;
const out = ['| cell | best measured plateau | best config | connections x depth 128 / RTT | client ceiling | connection-time ceiling | binding |', '| --- | --- | --- | --- | --- | --- | --- |'];
const cells = [...new Set(rows.map((r) => r.c))];
for (const c of cells) {
  const [r, mixId, shape, sh] = c.split('|') as [string, string, string, string];
  const mix = mixById(mixId);
  const rs = rows.filter((x) => x.c === c);
  const best = rs.reduce((a, b) => ((b.thr?.[1] ?? 0) > (a.thr?.[1] ?? 0) ? b : a));
  const plateau = best.thr![1];
  const rt = loadedRtt[r] ?? 0.1;
  const depth = sh === 'on' ? (P * 128 * 1000) / (rt + 0.05) : (P * 1000) / (rt + 0.05) * (shape === 'pipeline8' ? 8 : 1);
  const client = 1e6 / Math.min(...rs.map((x) => x.cpu[1]));
  const conn = mix.slowShare > 0 && mix.slowKind === 'sleep' ? (P * 1000) / (mix.slowShare * (mix.slowMs + 0.4)) : Infinity;
  const ceil = { depth, client, conn };
  const low = Object.entries(ceil).sort((a, b) => a[1] - b[1])[0]!;
  const bind = low[1] <= plateau * 1.25 ? (low[0] === 'depth' ? 'connections x depth / RTT' : low[0] === 'conn' ? 'connection time (sleepers)' : 'client CPU') : 'none of the three: server CPU or the CPU cost of the round trip itself (pgbench on the same two cores: 34k to 54k)';
  out.push(`| ${c} | ${Math.round(plateau)} | ${best.k} | ${Math.round(depth)} | ${Math.round(client)} | ${Number.isFinite(conn) ? Math.round(conn) : 'n/a'} | ${bind} |`);
}
writeFileSync(ROOT + 'results/limits.md', `Loaded round trip used (ms): ${JSON.stringify(loadedRtt)}\n\npgbench ceiling (tps, same two cores): ${pg.replace(/\n/g, '; ')}\n\n` + out.join('\n') + '\n');
console.log(out.join('\n'));
