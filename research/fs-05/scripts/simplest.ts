// Decides "simplest" by script, before any measurement (rules.json, simplicity). Order: fewer tunable constants first,
// then fewer policy code lines (blank lines and comments excluded); the order of the brief breaks ties.
// Input: the CONSTANTS export and the source text of each policy file. Output: results/simplest.json.
import { writeFileSync } from 'node:fs';
import { POLICY_FILES } from './policy/index.ts';

const here = new URL('./policy/', import.meta.url).pathname;
export function codeLines(src: string): number {
  const noBlock = src.replace(/\/\*[\s\S]*?\*\//g, '');
  return noBlock.split('\n').map((l) => l.replace(/\/\/.*$/, '').trim()).filter((l) => l.length > 0).length;
}
export async function simplicity() {
  const rows = [];
  for (const [i, id] of POLICY_FILES.entries()) {
    const file = `${here}${id}.ts`;
    const mod = await import(file);
    const src = await Bun.file(file).text();
    rows.push({ policy: id, file: `scripts/policy/${id}.ts`, constants: Object.keys(mod.CONSTANTS), nConstants: Object.keys(mod.CONSTANTS).length, codeLines: codeLines(src), briefOrder: i });
  }
  rows.sort((a, b) => a.nConstants - b.nConstants || a.codeLines - b.codeLines || a.briefOrder - b.briefOrder);
  return rows.map((r, rank) => ({ rank: rank + 1, ...r }));
}
if (import.meta.main) {
  const rows = await simplicity();
  writeFileSync(new URL('../results/simplest.json', import.meta.url).pathname, JSON.stringify({ rule: 'fewer tunable constants, then fewer policy code lines (blank lines and comments excluded), then the order of the brief', order: rows }, null, 2) + '\n');
  for (const r of rows) console.log(r.rank, r.policy.padEnd(14), `constants=${r.nConstants} [${r.constants.join(',')}]`, `lines=${r.codeLines}`);
}
