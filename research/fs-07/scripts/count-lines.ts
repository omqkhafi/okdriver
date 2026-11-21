// Counts non-blank, non-comment lines per file in wire/shared, wire/mysql, wire/mariadb and the dispatcher.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { save, stripComments } from './lib.ts';

const WIRE = new URL('../wire/', import.meta.url).pathname;
const walk = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : f.endsWith('.ts') ? [join(d, f)] : []));
const files: Record<string, Record<string, number>> = { shared: {}, mysql: {}, mariadb: {}, dispatch: {} };
for (const f of walk(WIRE)) {
  const rel = relative(WIRE, f);
  const group = rel.includes('/') ? rel.split('/')[0]! : 'dispatch';
  files[group]![rel] = stripComments(readFileSync(f, 'utf8')).filter((l) => l.trim() !== '').length;
}
const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);
const t = { shared: sum(files.shared!), mysql: sum(files.mysql!), mariadb: sum(files.mariadb!), dispatch: sum(files.dispatch!) };
const family = t.mysql + t.mariadb;
const pct = (n: number, d: number) => Math.round((1000 * n) / d) / 10;
// one MySQL driver and one MariaDB driver built from this code would each carry shared + their own folder
const mysqlDriver = t.shared + t.mysql, mariadbDriver = t.shared + t.mariadb;
const out = { perFile: files, totals: t, sharedPercentOfSharedPlusFamily: pct(t.shared, t.shared + family), forkedLines: family,
  eachDriverAlone: { mysql: { lines: mysqlDriver, sharedPercent: pct(t.shared, mysqlDriver) }, mariadb: { lines: mariadbDriver, sharedPercent: pct(t.shared, mariadbDriver) } },
  note: 'non-blank, non-comment lines; dispatch (connect.ts) is the family switch and counts as neither shared nor forked' };
save('lines.json', out);
const md = ['| folder | file | lines |', '| --- | --- | --- |'];
for (const g of ['shared', 'mysql', 'mariadb', 'dispatch']) for (const [f, n] of Object.entries(files[g]!)) md.push(`| ${g} | ${f} | ${n} |`);
md.push(`| | **shared total** | **${t.shared}** |`, `| | **mysql total** | **${t.mysql}** |`, `| | **mariadb total** | **${t.mariadb}** |`, `| | **dispatch** | **${t.dispatch}** |`);
save('lines.md', md.join('\n') + '\n');
console.log(JSON.stringify({ totals: t, sharedPercentOfSharedPlusFamily: out.sharedPercentOfSharedPlusFamily, eachDriverAlone: out.eachDriverAlone }, null, 2));
