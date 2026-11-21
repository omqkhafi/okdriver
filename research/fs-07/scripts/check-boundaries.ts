// Mirrors ADR 004: shared/ imports neither family; mysql/ and mariadb/ may import shared/ and never each other.
// connect.ts (outside the three folders) is the only file allowed to import all of them.
// Also lists every mention of a family name in shared/ code (comments removed) so each can be justified.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { save, stripComments } from './lib.ts';

const WIRE = new URL('../wire/', import.meta.url).pathname;
const walk = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : f.endsWith('.ts') ? [join(d, f)] : []));
const area = (p: string) => relative(WIRE, p).split('/')[0]!.replace(/\.ts$/, '');

const violations: string[] = [];
const edges: Record<string, Set<string>> = {};
for (const f of walk(WIRE)) {
  const a = area(f);
  const src = readFileSync(f, 'utf8');
  for (const m of src.matchAll(/(?:import|export)[^'"]*from\s+['"]([^'"]+)['"]/g)) {
    const spec = m[1]!;
    if (!spec.startsWith('.')) continue; // node: built-ins only
    const target = area(resolve(join(f, '..'), spec));
    (edges[a] ??= new Set()).add(target);
    const ok = a === 'connect' ? true : a === 'shared' ? target === 'shared' : target === 'shared' || target === a;
    if (!ok) violations.push(`${relative(WIRE, f)} imports ${spec} (${a} -> ${target})`);
  }
  if (/from\s+['"](?!node:|\.)/.test(src)) violations.push(`${relative(WIRE, f)} imports a non-node: package`);
}
const mentions: string[] = [];
for (const f of walk(WIRE).filter((x) => area(x) === 'shared')) {
  stripComments(readFileSync(f, 'utf8')).forEach((l, i) => { if (/mariadb|mysql|\bfamily\b/i.test(l)) mentions.push(`${relative(WIRE, f)}:${i + 1}: ${l.trim()}`); });
}
const result = { allowed: 'shared -> shared; mysql -> shared|mysql; mariadb -> shared|mariadb; connect.ts -> any', edges: Object.fromEntries(Object.entries(edges).map(([k, v]) => [k, [...v].sort()])), violations, familyNameMentionsInSharedCode: mentions };
save('boundaries.json', result);
console.log(JSON.stringify(result, null, 2));
process.exit(violations.length ? 1 : 0);
