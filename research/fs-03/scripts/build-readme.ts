// README.md = scripts/readme.template.md with every {{section:Title}} replaced by the section of results/tables.md of that title.
// Usage: node scripts/build-readme.ts
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const tables = readFileSync(join(root, 'results', 'tables.md'), 'utf8');
const sections = new Map<string, string>();
for (const part of tables.split(/^## /m).slice(1)) { const nl = part.indexOf('\n'); sections.set(part.slice(0, nl).trim(), part.slice(nl + 1).replace(/^### /gm, '#### ').trim()); }
const out = readFileSync(join(here, 'readme.template.md'), 'utf8').replace(/\{\{section:([^}]+)\}\}/g, (_m, t: string) => {
  const s = sections.get(t.trim());
  if (!s) throw new Error(`no section "${t}" in results/tables.md`);
  return s;
});
writeFileSync(join(root, 'README.md'), out);
console.log(`README.md: ${out.split('\n').length} lines`);
