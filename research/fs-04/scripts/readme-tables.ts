// Fills the generated blocks of README.md (between <!-- BEGIN name --> and <!-- END name -->) from results/environment.json and
// results/capabilities.json. The prose around the blocks is written by hand; the numbers in the blocks never are.
import { readFileSync, writeFileSync } from 'node:fs';
import { RESULTS, ROOT } from './lib/paths.ts';

const env = JSON.parse(readFileSync(RESULTS + 'environment.json', 'utf8'));
const cap = JSON.parse(readFileSync(RESULTS + 'capabilities.json', 'utf8'));
const val = (s: string) => (s === 'true' ? 'true' : s === 'intermittent' ? 'intermittent (false)' : s === 'too few runs' ? 'too few runs (false)' : s === 'not run' ? 'not run (false)' : 'false');

const blocks: Record<string, string> = {};
blocks.setup = ['| server | image digest | version reported by the server | TLS |', '| --- | --- | --- | --- |',
  ...env.servers.map((s: any) => `| ${s.id} | \`${s.digest.replace(/^.*@/, '')}\` | ${s.version.split(' on ')[0]!.slice(0, 70)} | ${s.tls ? (s.cert === 'selfsigned' ? 'self-signed, untrusted' : s.cert === 'expired' ? 'expired' : s.clientCertRequired ? 'client certificate required' : 'CA-signed') : 'off'} |`)].join('\n');
const rows = cap.capabilities as any[];
const line = (r: any) => `| \`${r.id}\` | ${r.title.replace(/\|/g, '/')} | **${val(r.local.status)}** ${r.local.counts} | ${r.pg19 ? val(r.pg19.status) + ' ' + r.pg19.counts : ''} | ${r.control ? (r.control.ok ? 'ok' : '**SUSPECT**') : ''} | ${r.production.status === 'Not verified here' ? 'Not verified here' : val(r.production.status)} | ${r.claimable} | ${r.transportCaps ?? ''} |`;
const head = ['| capability | what is tested | local-observed | PG 19.0 | control | production | claimable | TransportCaps |', '| --- | --- | --- | --- | --- | --- | --- | --- |'];
blocks.capabilities = [...head, ...rows.filter((r) => r.kind === 'capability').map(line)].join('\n');
blocks.behaviours = [...head, ...rows.filter((r) => r.kind === 'behaviour').map(line)].join('\n');
blocks.limits = ['| write form | largest 5/5 | first failing | peak workerd RSS at largest, MiB (indicative) |', '| --- | --- | --- | --- |',
  ...cap.limits.ladders.map((l: any) => { const top = l.cells.find((c: any) => c.size === l.largestFiveOfFive); return `| ${l.spec} | ${l.largestFiveOfFive ?? 'none'} | ${l.firstFailing ?? 'none up to ' + l.ranTo} | ${top?.rssMiB ?? ''} |`; })].join('\n');
blocks.planted = ['| planted fault | mode | check that must fail | caught 5/5 | checks that failed |', '| --- | --- | --- | --- | --- |', ...cap.plantedFaults.map((p: any) => `| ${p.id} | ${p.mode} | ${p.expectedCheck} | ${p.caught} | ${p.failingChecks.join(', ')} |`)].join('\n');

let md = readFileSync(ROOT + 'README.md', 'utf8');
for (const [name, body] of Object.entries(blocks)) {
  const re = new RegExp(`(<!-- BEGIN ${name} -->)[\\s\\S]*?(<!-- END ${name} -->)`);
  if (!re.test(md)) { console.error('missing block ' + name); process.exit(1); }
  md = md.replace(re, `$1\n${body}\n$2`);
}
writeFileSync(ROOT + 'README.md', md);
console.log('README blocks filled: ' + Object.keys(blocks).join(', '));
