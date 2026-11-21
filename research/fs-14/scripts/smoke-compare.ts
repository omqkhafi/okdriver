// Compare smoke bodies: Drizzle servers against drizzle-node24-pg, Kysely servers against kysely-node24-pg.
// A difference counts as "float32 digits" when every differing leaf is a `totalPrice` number that matches
// after rounding to float32 (the known Bun.SQL difference). Anything else is reported as a real difference.
import { readdirSync, readFileSync } from 'node:fs';
const dir = process.argv[2];
const configs = readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
const base = (c: string) => (c.startsWith('kysely') ? 'kysely-node24-pg' : 'drizzle-node24-pg');
type J = unknown;
function diffs(a: J, b: J, path: string, out: { path: string; a: J; b: J }[]) {
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const keys = new Set([...Object.keys(a as object), ...Object.keys(b as object)]);
    for (const k of keys) diffs((a as any)[k], (b as any)[k], `${path}.${k}`, out);
  } else if (a !== b) out.push({ path, a, b });
}
let bad = 0;
for (const c of configs) {
  const ref = base(c);
  if (c === ref) continue;
  for (const f of readdirSync(`${dir}/${c}`).sort()) {
    const A = JSON.parse(readFileSync(`${dir}/${ref}/${f}`, 'utf8'));
    const B = JSON.parse(readFileSync(`${dir}/${c}/${f}`, 'utf8'));
    const d: { path: string; a: J; b: J }[] = [];
    diffs(A, B, '', d);
    if (!d.length) { console.log(`same      ${c} ${f}`); continue; }
    const f32 = d.every((x) => x.path.endsWith('.totalPrice') && typeof x.a === 'number' && typeof x.b === 'number' && Math.fround(x.a) === Math.fround(x.b));
    if (f32) console.log(`float32   ${c} ${f} (${d.length} totalPrice values differ in digits only, e.g. ${d[0].a} vs ${d[0].b})`);
    else { bad++; console.log(`DIFFERENT ${c} ${f} (${d.length} leaves, first ${d[0].path}: ${JSON.stringify(d[0].a)} vs ${JSON.stringify(d[0].b)})`); }
  }
}
console.log(bad ? `${bad} real differences` : 'no real differences');
