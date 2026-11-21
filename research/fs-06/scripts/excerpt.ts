// Prints (and optionally saves) the two proxies' view of one sequence run: client-side frames, pooler-to-server frames, with times
// relative to the first client write. Usage: bun scripts/excerpt.ts <target-id> <seq> <run> [--save]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { RAW, RESULTS } from './lib/paths.ts';
const [id, seq, runS, save] = process.argv.slice(2);
const raw = JSON.parse(readFileSync(`${RAW}${id}.json`, 'utf8'));
const cm = JSON.parse(readFileSync(`${RAW}${id}.client-msgs.json`, 'utf8'));
let sm: any[] = [];
try { sm = JSON.parse(readFileSync(`${RAW}${id}.server-msgs.json`, 'utf8')); } catch { /* direct target */ }
const run = raw.runs.find((r: any) => r.run === Number(runS));
const s = run?.seqs.find((x: any) => x.seq === seq);
if (!s) { console.error('no such run/sequence'); process.exit(1); }
const out: string[] = [`# ${id} ${seq} run ${runS}: ${s.outcome}${s.why ? ' (' + s.why + ')' : ''}; ${s.elapsedMs} ms; client-side round trips ${s.traceRoundTrips}`];
const fmt = (m: any, side: string) => {
  const d = m.d ? ' ' + JSON.stringify(m.d).replace(/"/g, '').slice(0, 150) : '';
  return { t: m.t, line: `${(m.t - s.t0).toFixed(1).padStart(7)} ms  ${side} ${m.dir === 'c2s' ? '>' : '<'} ${m.type}${d}` };
};
const rows = [
  ...cm.filter((m: any) => m.conn === s.connId && m.t >= s.t0 - 2 && m.t <= s.t1 + 2).map((m: any) => fmt(m, 'client-side ')),
  ...sm.filter((m: any) => m.t >= s.t0 && m.t <= s.t1 + 60 && !['p'].includes(m.type)).map((m: any) => fmt(m, `server-side#${m.conn}`)),
].sort((a, b) => a.t - b.t);
out.push(...rows.map((r) => r.line));
console.log(out.join('\n'));
if (save === '--save') { mkdirSync(RESULTS + 'trace-excerpts/', { recursive: true }); writeFileSync(`${RESULTS}trace-excerpts/${id}.${seq}.run${runS}.txt`, out.join('\n') + '\n'); }
