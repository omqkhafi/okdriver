// Applies rules.json to the committed result files and writes results/capabilities.json and results/capabilities.md.
// Nothing is measured here: every number comes from results/probes/*.json and results/production/*.json.
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { RESULTS, ROOT } from './lib/paths.ts';

interface Cell { variant: string; check?: string; negate?: boolean }
interface Cap { id: string; area: string; kind: string; title: string; transportCaps: string | null; requires: Cell[]; requires19?: Cell[]; positiveControls?: string[]; production?: Cell[]; note?: string; forcedFalse?: { reason: string; evidence: Cell[] }; documentedOnly?: string }
const rules = JSON.parse(readFileSync(ROOT + 'rules.json', 'utf8')) as { passRuns: number; capabilities: Cap[] };
const load = (rel: string) => { const p = RESULTS + rel; return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null; };

type Counted = { pass: number; of: number; missing?: boolean };
function count(file: string, c: { check?: string; negate?: boolean }): Counted {
  const r = load(file); if (!r) return { pass: 0, of: 0, missing: true };
  let pass = c.check ? r.checks?.[c.check]?.pass : r.passes; let of = c.check ? r.checks?.[c.check]?.of : r.runs;
  if (pass === undefined || of === undefined) return { pass: 0, of: 0, missing: true };
  if (c.negate) pass = of - pass;
  return { pass, of };
}
type Status = 'true' | 'false' | 'intermittent' | 'not run' | 'too few runs';
function classify(cells: Counted[]): Status {
  if (!cells.length) return 'false';
  if (cells.some((c) => c.missing || c.of === 0)) return 'not run';
  if (cells.every((c) => c.pass === c.of && c.of >= rules.passRuns)) return 'true';
  if (cells.every((c) => c.pass === c.of)) return 'too few runs';
  if (cells.some((c) => c.pass === 0)) return 'false';
  return 'intermittent';
}
const fmt = (cs: Counted[]) => cs.length ? cs.map((c) => (c.missing ? '–' : `${c.pass}/${c.of}`)).join(' ') : '';
const probeFile = (v: string, mode: string) => `probes/${v}.${mode}.json`;

const prodFiles = existsSync(RESULTS + 'production') ? readdirSync(RESULTS + 'production') : [];
const prodVerified = prodFiles.some((f) => f.endsWith('.production.json'));

const rows = rules.capabilities.map((c) => {
  const cells = c.requires.map((r) => count(probeFile(r.variant, 'worker'), r));
  const cells19 = (c.requires19 ?? []).map((r) => count(probeFile(r.variant, 'worker'), r));
  let local: Status = c.forcedFalse && !c.requires.length ? 'false' : classify(cells);
  if (c.forcedFalse && !c.requires.length) local = 'false';
  const controls = (c.positiveControls ?? []).map((id) => { const [v, chk] = id.split(':'); return count(probeFile(v!, 'control'), { check: chk }); });
  const controlOk = controls.every((x) => !x.missing && x.pass === x.of && x.of >= rules.passRuns);
  const prodCells = (c.production ?? []).map((r) => count(`production/${r.variant}.production.json`, r));
  const prodStatus: string = !prodVerified ? 'Not verified here' : prodCells.length ? classify(prodCells) : 'Not verified here';
  const label = c.documentedOnly ? 'documented-only' : c.forcedFalse && !c.requires.length ? 'not observable' : 'local-observed';
  const value = local === 'true' ? true : false;
  const claimable = prodStatus === 'true' ? true : false;
  return { id: c.id, area: c.area, kind: c.kind, title: c.title, transportCaps: c.transportCaps, local: { value, status: local, label, counts: fmt(cells), cells: c.requires.map((r, i) => ({ ...r, ...cells[i] })) },
    pg19: cells19.length ? { status: classify(cells19), counts: fmt(cells19) } : null,
    control: controls.length ? { counts: fmt(controls), ok: controlOk } : null,
    instrumentSuspect: controls.length > 0 && !controlOk,
    production: { value: prodStatus === 'true' ? true : prodStatus === 'Not verified here' ? 'Not verified here' : false, status: prodStatus, label: prodStatus === 'Not verified here' ? 'not observable' : 'production-observed', counts: fmt(prodCells) },
    claimable, note: c.note, reason: c.forcedFalse?.reason };
});

// ---- limits ------------------------------------------------------------------------------------------------------------
const SIZES = ['64KiB', '1MiB', '4MiB', '16MiB', '64MiB', '128MiB'];
const specs = ['bind-single', 'bind-chunk64k', 'bind-chunk1m', 'bind-chunk64k-nowait', 'copy-chunk64k', 'tls-bind-single', 'tls-bind-chunk64k'];
const ladders = specs.map((s) => {
  const cells = SIZES.map((z) => { const r = load(probeFile(`p3.write.${s}.${z}`, 'worker')); return r ? { size: z, pass: r.passes, of: r.runs, rssMiB: Math.max(0, ...r.runsDetail.map((d: any) => d.extra?.workerd?.peakRssMiB ?? 0)), medianMs: median(r.runsDetail.map((d: any) => d.wallMs)) } : null; }).filter(Boolean) as any[];
  const ok = cells.filter((c) => c.pass === c.of && c.of >= rules.passRuns);
  const firstFail = cells.find((c) => c.pass < c.of);
  return { spec: s, ranTo: cells.at(-1)?.size, largestFiveOfFive: ok.at(-1)?.size ?? null, firstFailing: firstFail ? `${firstFail.size} (${firstFail.pass}/${firstFail.of})` : null, cells };
});
function median(a: number[]) { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)] ?? 0; }
const conc = [1, 2, 6, 7, 8, 24, 50].map((n) => ({ n, ...count(probeFile(`p4.concurrent.n${n}`, 'worker'), {}) }));
const maxConc = Math.max(0, ...conc.filter((c) => c.pass === c.of && c.of >= rules.passRuns).map((c) => c.n));

// ---- planted faults --------------------------------------------------------------------------------------------------------
const planted = existsSync(RESULTS + 'probes') ? readdirSync(RESULTS + 'probes').filter((f) => f.startsWith('planted.')).map((f) => { const r = load('probes/' + f); return { id: r.id, mode: r.mode, expectedCheck: r.expectFail, caught: r.caught, failingChecks: Object.entries(r.checks).filter(([, t]: any) => t.pass < t.of).map(([k, t]: any) => `${k} ${t.pass}/${t.of}`) }; }) : [];

const out = { rule: (rules as any).rule, labels: (rules as any).labels, workerd: '1.20261118.1', productionVerified: prodVerified, capabilities: rows, limits: { ladders, concurrency: conc, maxConcurrentFiveOfFive: maxConc }, plantedFaults: planted };
writeFileSync(RESULTS + 'capabilities.json', JSON.stringify(out, null, 1) + '\n');

// ---- markdown ----------------------------------------------------------------------------------------------------------------
const sym = (s: string) => (s === 'true' ? 'true' : s === 'intermittent' ? 'intermittent (false)' : s === 'not run' ? 'not run (false)' : s === 'too few runs' ? 'too few runs (false)' : 'false');
const md: string[] = ['# Capability table', '', 'Generated by `scripts/capabilities.ts` from `rules.json` and the files in `results/probes/`. Do not edit by hand.', '',
  `**Rule.** ${(rules as any).rule}`, '', '**Labels.** `local-observed`: measured on the pinned workerd with embedder trust settings, not Cloudflare production. `documented-only`: stated by a page, not measured. `not observable`: no API or instrument; false. The claimable value is the production column; ' + (prodVerified ? 'production results exist.' : 'no production run exists, so every claimable value is false.'), ''];
const areas = [...new Set(rows.map((r) => r.area))];
for (const a of areas) {
  md.push(`## ${a}`, '', '| capability | what is tested | local (workerd) | PG 19.0 | control | production | claimable | TransportCaps |', '| --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const r of rows.filter((x) => x.area === a)) {
    md.push(`| \`${r.id}\`${r.kind === 'behaviour' ? ' (behaviour)' : ''} | ${r.title}${r.reason ? ` *(${r.reason})*` : ''} | **${sym(r.local.status)}** ${r.local.counts} \`${r.local.label}\` | ${r.pg19 ? sym(r.pg19.status) + ' ' + r.pg19.counts : ''} | ${r.control ? (r.control.ok ? 'ok ' : '**SUSPECT** ') + r.control.counts : ''} | ${r.production.status === 'Not verified here' ? 'Not verified here' : sym(r.production.status) + ' ' + r.production.counts} | ${r.claimable} | ${r.transportCaps ?? ''} |`);
  }
  md.push('');
}
md.push('## Limits found locally (largest write, 5 of 5, intact in PostgreSQL and at the proxy)', '', '| write form | largest 5/5 | first failing | ran up to | peak workerd RSS at largest (MiB, indicative) | median wall ms at largest |', '| --- | --- | --- | --- | --- | --- |');
for (const l of ladders) { const top = l.cells.find((c: any) => c.size === l.largestFiveOfFive); md.push(`| ${l.spec} | ${l.largestFiveOfFive ?? 'none'} | ${l.firstFailing ?? 'none up to the ladder end'} | ${l.ranTo} | ${top?.rssMiB ?? ''} | ${top?.medianMs ?? ''} |`); }
md.push('', `Concurrent sockets from one invocation, local: ${conc.map((c) => `N=${c.n} ${c.pass}/${c.of}`).join(', ')}. Largest N at 5/5: ${maxConc}.`, '');
md.push('## TransportCaps mapping (FS-01 provisional, not edited)', '', '| TransportCaps field | value FS-04 supports for a Cloudflare transport (claimable) | local observation | rows |', '| --- | --- | --- | --- |');
const m = (id: string) => rows.find((r) => r.id === id)!;
const tc = (field: string, ids: string[], local: string) => md.push(`| \`${field}\` | **false** (production not verified) | ${local} | ${ids.map((i) => '`' + i + '`').join(', ')} |`);
tc('startTls', ['pg.startTls', 'my84.startTls', 'ma118.startTls'], `PostgreSQL ${m('pg.startTls').local.status} ${m('pg.startTls').local.counts}; MySQL ${m('my84.startTls').local.status}; MariaDB ${m('ma118.startTls').local.status}. A driver must read nothing but the server's answer before the switch and settle any pending read with reader.cancel() first.`);
tc('channelBinding', ['cert.peerCertificate.api', 'cert.channelBinding.tlsServerEndPoint'], `'none': peer certificate API ${m('cert.peerCertificate.api').local.status}; tls-server-end-point is not observable`);
tc('secondConnectionForCancel', ['cancel.secondSocket', 'cancel.whileSixBusy', 'cancel.mainOnTls.plainCancel', 'cancel.mainOnTls.tlsCancel', 'my84.killQuery', 'ma118.killQuery'], `PostgreSQL ${m('cancel.secondSocket').local.status} ${m('cancel.secondSocket').local.counts}; MySQL ${m('my84.killQuery').local.status}; MariaDB ${m('ma118.killQuery').local.status}. Whether the production limit of 6 delays the second socket was not tested.`);
tc('streaming', ['transport.streaming'], `sockets are byte streams: ${m('transport.streaming').local.status} ${m('transport.streaming').local.counts}`);
tc('keepalive', ['transport.keepalive'], 'not observable');
tc('halfOpenDetection', ['transport.halfOpenDetection'], 'not observable');
md.push('', '## Planted faults (each must fail exactly the named check)', '', '| planted fault | mode | expected failing check | caught in 5/5 runs | checks that failed |', '| --- | --- | --- | --- | --- |');
for (const p of planted) md.push(`| ${p.id} | ${p.mode} | ${p.expectedCheck} | ${p.caught} | ${p.failingChecks.join(', ')} |`);
writeFileSync(RESULTS + 'capabilities.md', md.join('\n') + '\n');
console.log(`${rows.length} rows; true: ${rows.filter((r) => r.local.value).length}; instrument-suspect: ${rows.filter((r) => r.instrumentSuspect).map((r) => r.id).join(', ') || 'none'}; production verified: ${prodVerified}`);
