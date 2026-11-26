// Diffs the claim ledger (scripts/ledger.json plus the documentation statements in scripts/ledger.docs.json) against claims.json:
// every claim exactly once, no extra IDs, allowed verdict and scope, filled fields, evidence files that exist, a corrected sentence on every
// Corrected row, and every documentation quote at most 15 words and marked as read from raw page text. When the raw pages are on disk
// (work/docs, git-ignored) each quote is also checked to occur verbatim in the page whose sha256 is recorded. Renders results/ledger.md.
// Exit code 1 on any problem. Usage: bun scripts/check-ledger.ts
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { RESULTS, ROOT, WORK } from './lib/paths.ts';

const claims: { id: string; area: string; kind: string; text: string }[] = JSON.parse(readFileSync(ROOT + 'claims.json', 'utf8'));
const rows: any[] = JSON.parse(readFileSync(new URL('./ledger.json', import.meta.url), 'utf8'));
const docs: Record<string, any[]> = JSON.parse(readFileSync(new URL('./ledger.docs.json', import.meta.url), 'utf8'));
const VERDICTS = ['Confirmed', 'Corrected', 'Not verifiable here'];
const SCOPES = ['local-observed', 'production-observed', 'documented-only', 'not observable'];
const problems: string[] = [];

const raw = new Map<string, string>();
if (existsSync(WORK + 'docs')) for (const f of readdirSync(WORK + 'docs')) { const b = readFileSync(WORK + 'docs/' + f); raw.set(createHash('sha256').update(b).digest('hex'), b.toString('utf8')); }

const seen = new Map<string, number>();
for (const r of rows) seen.set(r.id, (seen.get(r.id) ?? 0) + 1);
for (const c of claims) if (seen.get(c.id) !== 1) problems.push(`${c.id}: appears ${seen.get(c.id) ?? 0} times in the ledger (want exactly 1)`);
for (const id of seen.keys()) if (!claims.some((c) => c.id === id)) problems.push(`${id}: in the ledger but not in claims.json`);
for (const id of Object.keys(docs)) if (!claims.some((c) => c.id === id)) problems.push(`${id}: documentation statements for an unknown claim`);
let quotes = 0, verified = 0;
for (const c of claims) {
  const d = docs[c.id]; if (!d) { problems.push(`${c.id}: no entry in ledger.docs.json`); continue; }
  for (const q of d) {
    if (q.note && !q.quote) continue; // explicit "none cited"
    quotes++;
    if (q.read !== 'raw page text') problems.push(`${c.id}: quote not marked "raw page text"`);
    if (!q.quote || q.quote.trim().split(/\s+/).length > 15) problems.push(`${c.id}: quote over 15 words or empty: ${q.quote}`);
    if (!q.url || !q.sha256 || !q.fetched || !q.source) problems.push(`${c.id}: quote without url, sha256, fetched or source`);
    const page = raw.get(q.sha256);
    if (raw.size) { if (page === undefined) problems.push(`${c.id}: no saved page has sha256 ${String(q.sha256).slice(0, 12)}`); else if (!page.includes(q.quote)) problems.push(`${c.id}: quote not verbatim in its page: ${q.quote}`); else verified++; }
  }
}
for (const r of rows) {
  if (!VERDICTS.includes(r.verdict)) problems.push(`${r.id}: bad verdict ${r.verdict}`);
  if (!SCOPES.includes(r.scope)) problems.push(`${r.id}: bad scope ${r.scope}`);
  for (const k of ['summary', 'live']) if (!r[k] || !String(r[k]).trim()) problems.push(`${r.id}: empty ${k}`);
  if (!Array.isArray(r.evidence) || !r.evidence.length) problems.push(`${r.id}: no evidence file`);
  for (const e of r.evidence ?? []) if (!existsSync(ROOT + e)) problems.push(`${r.id}: evidence file missing: ${e}`);
  if (r.verdict === 'Corrected' && !r.corrected) problems.push(`${r.id}: Corrected without a corrected sentence`);
  if (r.verdict === 'Confirmed' && r.scope === 'documented-only') problems.push(`${r.id}: Confirmed with scope documented-only`);
}
const count = (v: string) => rows.filter((r) => r.verdict === v).length;
console.log(`claims: ${claims.length}; ledger rows: ${rows.length}; Confirmed ${count('Confirmed')}, Corrected ${count('Corrected')}, Not verifiable here ${count('Not verifiable here')}; quotes ${quotes}${raw.size ? `, verified verbatim against saved pages ${verified}` : ' (saved pages not on disk: verbatim check skipped)'}`);
if (problems.length) { console.error(problems.join('\n')); process.exit(1); }

const md: string[] = ['# Claim ledger', '',
  `${claims.length} claims: the 2 roadmap lines FS-04 closes and ${claims.length - 2} statements taken from Cloudflare's pages and from the competing driver's documentation. Verdicts: Confirmed ${count('Confirmed')}, Corrected ${count('Corrected')}, Not verifiable here ${count('Not verifiable here')}. Rendered by \`scripts/check-ledger.ts\` from \`scripts/ledger.json\` and \`scripts/ledger.docs.json\`; the script fails when a claim is missing, duplicated or extra, when a quote is over 15 words, and (with the saved pages on disk) when a quote is not verbatim in the page whose sha256 is recorded.`, '',
  'How to read a row. **Scope** says what the verdict rests on: `local-observed` is the pinned workerd 1.20261118.1 with embedder trust settings (not Cloudflare production), `documented-only` is a page nobody tested, `not observable` has no instrument. A `Confirmed` with scope `local-observed` does not confirm production; the capability table keeps the production column at "Not verified here". Every documentation statement was read as **raw page text**: the page saved by `curl` (Cloudflare pages through their `index.md` variant, GitHub files from `raw.githubusercontent.com`), and read as text; no summarising tool was used for any quote. Quotes are at most 15 words.', '',
  '| ID | area | verdict | scope | in one line |', '| --- | --- | --- | --- | --- |'];
for (const c of claims) { const r = rows.find((x) => x.id === c.id); md.push(`| ${c.id} | ${c.area} | ${r.verdict} | ${r.scope} | ${r.summary} |`); }
for (const c of claims) {
  const r = rows.find((x) => x.id === c.id);
  md.push('', `## ${c.id} ${c.area}: ${r.verdict} (${r.scope})`, '', `**Claim** (${c.kind}). ${c.text}`, '', '**Documentation.**');
  const d = docs[c.id]!.filter((q) => q.quote);
  if (!d.length) md.push(`- none cited${docs[c.id]![0]?.note ? ': ' + docs[c.id]![0].note : ''}`);
  for (const q of d) md.push(`- ${q.source}, fetched ${q.fetched}, sha256 \`${String(q.sha256).slice(0, 12)}\` (read as **raw page text**): "${q.quote}"`);
  md.push('', `**Measured here.** ${r.live}`, '', `**Evidence files.** ${r.evidence.map((e: string) => '`' + e + '`').join(', ')}`);
  if (r.corrected) md.push('', `**Corrected sentence.** ${r.corrected}`);
}
writeFileSync(RESULTS + 'ledger.md', md.join('\n') + '\n');
