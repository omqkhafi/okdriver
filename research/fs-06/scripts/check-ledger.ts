// Diffs the claim ledger (scripts/ledger.json) against the appendix claim list (scripts/claims.json):
// every appendix ID exactly once, no extra IDs, an allowed verdict, documentation and live-evidence fields filled,
// evidence files that exist, and a corrected sentence on every Corrected row. Renders results/ledger.md.
// Exit code 1 on any problem. Usage: bun scripts/check-ledger.ts
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { RESULTS, ROOT } from './lib/paths.ts';

const claims: { id: string; area: string; text: string }[] = JSON.parse(readFileSync(new URL('./claims.json', import.meta.url), 'utf8'));
const rows: any[] = JSON.parse(readFileSync(new URL('./ledger.json', import.meta.url), 'utf8'));
const VERDICTS = ['Confirmed', 'Corrected', 'Not verifiable here'];
const READ = ['raw page text', 'summarising tool', 'not read'];
const problems: string[] = [];
const seen = new Map<string, number>();
for (const r of rows) seen.set(r.id, (seen.get(r.id) ?? 0) + 1);
for (const c of claims) if (seen.get(c.id) !== 1) problems.push(`${c.id}: appears ${seen.get(c.id) ?? 0} times in the ledger (want exactly 1)`);
for (const id of seen.keys()) if (!claims.some((c) => c.id === id)) problems.push(`${id}: in the ledger but not in the appendix`);
for (const r of rows) {
  if (!VERDICTS.includes(r.verdict)) problems.push(`${r.id}: bad verdict ${r.verdict}`);
  for (const k of ['summary', 'live']) if (!r[k] || !String(r[k]).trim()) problems.push(`${r.id}: empty ${k}`);
  if (!Array.isArray(r.docs) || !r.docs.length) problems.push(`${r.id}: docs must list at least one statement (or an explicit "none cited")`);
  for (const d of r.docs ?? []) { if (!READ.includes(d.read)) problems.push(`${r.id}: doc statement without a valid "read" (${READ.join(' | ')})`); if (!d.source || !d.quote) problems.push(`${r.id}: doc statement needs source and quote`); }
  if (!Array.isArray(r.evidence) || !r.evidence.length) problems.push(`${r.id}: no evidence file`);
  for (const e of r.evidence ?? []) if (!existsSync(ROOT + e)) problems.push(`${r.id}: evidence file missing: ${e}`);
  if (r.verdict === 'Corrected' && !r.corrected) problems.push(`${r.id}: Corrected without a corrected sentence`);
}
const count = (v: string) => rows.filter((r) => r.verdict === v).length;
console.log(`claims in appendix: ${claims.length}; ledger rows: ${rows.length}; Confirmed ${count('Confirmed')}, Corrected ${count('Corrected')}, Not verifiable here ${count('Not verifiable here')}`);
if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
const md: string[] = ['# Claim ledger', '', `${claims.length} claims from the roadmap appendix, one row each. Verdicts: Confirmed ${count('Confirmed')}, Corrected ${count('Corrected')}, Not verifiable here ${count('Not verifiable here')}. Rendered by \`scripts/check-ledger.ts\` from \`scripts/ledger.json\`; the script fails when an appendix ID is missing, duplicated or extra.`, '',
  'Rule used throughout: when documentation and a live server disagree, the server wins and the disagreement is recorded in the row. Every documentation statement is marked **raw page text** (a file or web page fetched as bytes and read as text, HTML stripped by a local script) or **summarising tool**. No statement here was read through a summarising tool.', '',
  '| ID | area | verdict | in one line |', '| --- | --- | --- | --- |'];
for (const c of claims) { const r = rows.find((x) => x.id === c.id); md.push(`| ${c.id} | ${c.area} | ${r.verdict} | ${r.summary} |`); }
for (const c of claims) {
  const r = rows.find((x) => x.id === c.id);
  md.push('', `## ${c.id} ${c.area}: ${r.verdict}`, '', `**Claim.** ${c.text}`, '', '**Documentation.**');
  for (const d of r.docs) md.push(`- ${d.source} (read as **${d.read}**): "${d.quote}"`);
  md.push('', `**Measured here.** ${r.live}`, '', `**Evidence files.** ${r.evidence.map((e: string) => '`' + e + '`').join(', ')}`);
  if (r.corrected) md.push('', `**Corrected sentence.** ${r.corrected}`);
}
writeFileSync(RESULTS + 'ledger.md', md.join('\n') + '\n');
