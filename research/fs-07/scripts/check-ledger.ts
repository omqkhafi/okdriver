// Diffs the claim ledger against the appendix claim list: every ID exactly once, a verdict from the allowed set,
// documentation and live-server columns filled, a corrected sentence on every Corrected row. Also renders ledger.md.
import { readFileSync } from 'node:fs';
import { save, RESULTS } from './lib.ts';

const claims: { id: string; area: string; text: string }[] = JSON.parse(readFileSync(new URL('./claims.json', import.meta.url), 'utf8'));
const rows: any[] = JSON.parse(readFileSync(RESULTS + 'ledger.json', 'utf8'));
const VERDICTS = ['Confirmed', 'Corrected', 'Not verifiable here'];
const problems: string[] = [];
const seen = new Map<string, number>();
for (const r of rows) seen.set(r.id, (seen.get(r.id) ?? 0) + 1);
for (const c of claims) if (seen.get(c.id) !== 1) problems.push(`${c.id}: appears ${seen.get(c.id) ?? 0} times in the ledger`);
for (const id of seen.keys()) if (!claims.some((c) => c.id === id)) problems.push(`${id}: not in the appendix`);
for (const r of rows) {
  if (!VERDICTS.includes(r.verdict)) problems.push(`${r.id}: bad verdict ${r.verdict}`);
  for (const k of ['summary', 'docs', 'live']) if (!r[k] || !String(r[k]).trim()) problems.push(`${r.id}: empty ${k}`);
  if (r.verdict === 'Corrected' && !r.corrected) problems.push(`${r.id}: Corrected without a corrected sentence`);
}
const count = (v: string) => rows.filter((r) => r.verdict === v).length;
console.log(`claims in appendix: ${claims.length}; ledger rows: ${rows.length}; Confirmed ${count('Confirmed')}, Corrected ${count('Corrected')}, Not verifiable here ${count('Not verifiable here')}`);
if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
const md: string[] = ['# Claim ledger', '', `${claims.length} claims from the roadmap appendix, one row each. Verdicts: Confirmed ${count('Confirmed')}, Corrected ${count('Corrected')}, Not verifiable here ${count('Not verifiable here')}.`, '',
  'Rule used throughout: when the documentation and a live server disagree, the server wins and the disagreement is recorded in the row.', '', '| ID | area | verdict | in one line |', '| --- | --- | --- | --- |'];
for (const c of claims) { const r = rows.find((x) => x.id === c.id); md.push(`| ${c.id} | ${c.area} | ${r.verdict} | ${r.summary} |`); }
for (const c of claims) {
  const r = rows.find((x) => x.id === c.id);
  md.push('', `## ${c.id} ${c.area}: ${r.verdict}`, '', `**Claim.** ${c.text}`, '', `**Documentation.** ${r.docs}`, '', `**Live servers.** ${r.live}`);
  if (r.evidence?.length) md.push('', `**Evidence files.** ${r.evidence.map((e: string) => '`' + e + '`').join(', ')}`);
  if (r.corrected) md.push('', `**Corrected sentence.** ${r.corrected}`);
}
save('ledger.md', md.join('\n') + '\n');
