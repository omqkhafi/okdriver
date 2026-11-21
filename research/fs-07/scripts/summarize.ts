// Groups the nine servers by identical result for every item in facts/ and behaviour/, and writes the items on which they differ.
// Volatile values (connection ids, statement ids in tracker data, ports, timestamps) are normalised before comparing.
import { readFileSync, readdirSync } from 'node:fs';
import { save, RESULTS, SERVERS } from './lib.ts';

const ids = SERVERS.map((s) => s.id);
const load = (dir: string) => Object.fromEntries(ids.map((i) => [i, JSON.parse(readFileSync(`${RESULTS}${dir}/${i}.json`, 'utf8'))]));
const flat = (o: any, p = ''): Record<string, string> => {
  if (o === null || typeof o !== 'object') return { [p]: String(o) };
  return Object.entries(o).reduce((a, [k, v]) => ({ ...a, ...flat(v, p ? `${p}.${k}` : k) }), {});
};
const vol = (s: string) => s.replace(/statement_id[^"']*\d+/g, 'statement_id N').replace(/\b\d{2}:\d{2}:\d{2}(\.\d+)?\b/g, 'TIME').replace(/'[^']*'@'[^']*'/g, "'U'@'H'").replace(/\(conn:\d+\)/g, '(conn:N)').replace(/\b(thread|connection) id \d+/gi, '$1 id N');
function diffs(dir: string, skip: RegExp) {
  const data = load(dir);
  const flats = Object.fromEntries(ids.map((i) => [i, flat(data[i])]));
  const keys = [...new Set(ids.flatMap((i) => Object.keys(flats[i]!)))].filter((k) => !skip.test(k));
  const out: { key: string; groups: { servers: string[]; value: string }[] }[] = [];
  for (const k of keys.sort()) {
    const g = new Map<string, string[]>();
    for (const i of ids) { const v = vol(flats[i]![k] ?? '(absent)'); (g.get(v) ?? g.set(v, []).get(v)!).push(i); }
    if (g.size > 1) out.push({ key: k, groups: [...g].map(([value, servers]) => ({ servers, value: value.length > 160 ? value.slice(0, 160) + '…' : value })) });
  }
  return { total: keys.length, differing: out };
}
const facts = diffs('facts', /authPluginsAvailable|greeting\.(reserved|saltLength|capabilityNames|serverVersion)|connectAttrs|negotiated|rootUsers|^id$|^image$|collationIds/);
const beh = diffs('behaviour', /^(server|version)$|literalValues|B3_sessionTracking|B4_transaction|B10_countAfter|storedBack|E24|E25|E23/);
save('summary/facts-diff.json', facts); save('summary/behaviour-diff.json', beh);
const md = (t: ReturnType<typeof diffs>, title: string) => [`## ${title}`, '', `${t.total} items compared; ${t.differing.length} differ between at least two servers.`, '', '| item | grouping (servers with the same value) |', '| --- | --- |',
  ...t.differing.map((d) => `| \`${d.key}\` | ${d.groups.map((g) => `${g.servers.join(', ')}: ${g.value.replace(/\|/g, '/').replace(/\n/g, ' ')}`).join('<br>')} |`)].join('\n');
save('summary/differences.md', md(facts, 'Server facts and defaults') + '\n\n' + md(beh, 'Behaviour') + '\n');
console.log(`facts: ${facts.differing.length}/${facts.total} differ; behaviour: ${beh.differing.length}/${beh.total} differ`);
