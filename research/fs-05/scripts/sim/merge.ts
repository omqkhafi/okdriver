// work/sim/shard-*.jsonl -> results/sim-matrix.json.gz (rows, compact)
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
const ROOT = new URL('../../', import.meta.url).pathname;
const rows: unknown[] = [];
for (const f of readdirSync(`${ROOT}work/sim`).filter((x) => x.startsWith('shard-'))) for (const l of readFileSync(`${ROOT}work/sim/${f}`, 'utf8').split('\n')) if (l) rows.push(JSON.parse(l));
writeFileSync(`${ROOT}results/sim-matrix.json.gz`, Bun.gzipSync(JSON.stringify({ note: 'simulated rows, same fields as real-matrix.json', rows })));
console.log(rows.length, 'rows');
