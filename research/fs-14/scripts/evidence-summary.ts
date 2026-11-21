// Turn results/evidence/*.trace.json, *.pglog.json and depth-*.json into results/evidence.md.
//   node scripts/evidence-summary.ts <results-dir>
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
const dir = `${process.argv[2]}/evidence`;
const J = (f: string) => JSON.parse(readFileSync(`${dir}/${f}`, 'utf8'));
const configs = ['drizzle-node24-pg', 'drizzle-node24-drizzle', 'drizzle-node24-drizzle-nopipe', 'drizzle-bun14-bunsql', 'drizzle-bun14-drizzle', 'kysely-node24-pg', 'kysely-node24-postgresjs', 'kysely-node24-drizzle'];
const cls = (o: Record<string, number>) => Object.entries(o).filter(([k]) => k !== 'none').map(([k, v]) => `${k} ${v}`).join(', ');
const deep = (t: any) => { const tot = Object.values<number>(t.inflightAtSync).reduce((a, b) => a + b, 0); const d = Object.entries<number>(t.inflightAtSync).filter(([k]) => +k > 1).reduce((a, [, v]) => a + v, 0); return `${(100 * d / tot).toFixed(2)}%`; };
let md = '#### Benchmark-profile trace (20,000 requests per config, 16 backends = 2 processes x 8 connections)\n\n| config | Parse (named / unnamed) | distinct named statements | most Parses of one name on one backend | Bind | Describe | result formats (per Bind) | param formats (per Bind) | max statements in flight on a connection | share of statements sent behind another |\n|---|---|---|---|---|---|---|---|---|---|\n';
for (const c of configs) {
  const t = J(`${c}.trace.json`), l = J(`${c}.pglog.json`);
  md += `| ${c} | ${l.parse.named} / ${l.parse.unnamed} | ${l.distinctNamedStatements} | ${l.maxParsesOfOneNamedStatementOnOneBackend} | ${t.bindTotal} | ${cls(t.describes) || 'none'} | ${cls(t.resultFormats)} | ${cls(t.paramFormats)} | ${Math.max(...t.maxInflightPerConnection)} | ${deep(t)} |\n`;
}
md += '\n(The Postgres log and the protocol trace give the same Parse and Bind counts for every config; the table shows the log's Parse counts and the trace for everything else.)\n';
md += '\n#### Heavier profile through the trace proxy (`--quick`, 500 to 3000 VUs; not a benchmark)\n\n| config | max statements in flight on a connection (per connection) | share of statements sent behind another | largest Syncs in one TCP write |\n|---|---|---|---|\n';
for (const c of ['drizzle-node24-pg', 'drizzle-node24-drizzle', 'drizzle-node24-drizzle-nopipe']) {
  const t = J(`quick-${c}.trace.json`);
  md += `| ${c} | ${t.maxInflightPerConnection.join(' ')} | ${deep(t)} | ${Math.max(...Object.keys(t.syncsPerClientWrite).map(Number))} |\n`;
}
md += '\n#### Depth probe: 400 concurrent single-row lookups over a pool of 2 connections\n\n| variant | connections used | max statements in flight per connection | largest Syncs in one TCP write | Parse | Bind |\n|---|---|---|---|---|---|\n';
for (const v of ['drizzle', 'drizzle-depth4', 'drizzle-off', 'pg', 'bunsql']) {
  if (!existsSync(`${dir}/depth-${v}.json`)) continue;
  const t = J(`depth-${v}.json`);
  md += `| ${v} | ${t.connections} | ${t.maxInflightPerConnection.join(', ')} | ${Math.max(...Object.keys(t.syncsPerClientWrite).map(Number))} | ${t.parseTotal} | ${t.bindTotal} |\n`;
}
writeFileSync(`${process.argv[2]}/evidence.md`, md);
console.log(md);
