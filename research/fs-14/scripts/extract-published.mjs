// usage: node extract-published.mjs <MdxBenchmark-*.js saved from orm.drizzle.team/_astro/> <out.json>
// Extract the published benchmark series embedded in the website's JS bundle WITHOUT executing it:
// each series is `"<date>:<config>":[{time:"...",core1:..,reqs_per_sec:..,...},...]` with bare keys, so locate
// the array by bracket matching, quote the keys, and JSON.parse (throws on anything that is not plain data).
import { readFileSync, writeFileSync } from 'node:fs';
const s = readFileSync(process.argv[2], 'utf8');
const out = {};
const re = /"(\d{8}:[A-Za-z0-9_.-]+)":\[/g;
let m;
while ((m = re.exec(s))) {
  let depth = 0, j = m.index + m[0].length - 1, inStr = false;
  const start = j;
  for (; j < s.length; j++) {
    const c = s[j];
    if (c === '"') inStr = !inStr;
    if (inStr) continue;
    if (c === '[') depth++; else if (c === ']') { depth--; if (depth === 0) break; }
  }
  const src = s.slice(start, j + 1).replace(/([{,])([A-Za-z_][A-Za-z0-9_]*):/g, '$1"$2":').replace(/([:,\[])(-?)\.(\d)/g, '$1$20.$3'); // bare keys; minified `.5` -> `0.5`
  try { out[m[1]] = JSON.parse(src); } catch (e) { console.log("skip", m[1], String(e.message).slice(0, 80)); }
  re.lastIndex = j;
}
writeFileSync(process.argv[3], JSON.stringify(out));
console.log(Object.keys(out).length, 'series');
for (const [k, v] of Object.entries(out)) console.log(k, v.length, v[0]?.time, v.at(-1)?.vus);
