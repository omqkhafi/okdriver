// Renders the committed Markdown tables from the result JSON files.
import { readFileSync, existsSync } from 'node:fs';
import { save, RESULTS, SERVERS } from './lib.ts';

const ids = SERVERS.map((s) => s.id);
const rd = (p: string) => JSON.parse(readFileSync(RESULTS + p, 'utf8'));

// ---- pipelining
{
  const data = Object.fromEntries(ids.map((i) => [i, rd(`pipeline/${i}.json`)]));
  const names = Object.keys(data[ids[0]!].probes);
  const md = ['# Pipelining probes', '', `Each probe ran ${data[ids[0]!].runsPerProbe} times per server. Cells: runs meeting the definition of "safe" out of ${data[ids[0]!].runsPerProbe}, then the observation (identical in every run unless noted).`, '',
    'Safe means: responses in command order; every error belongs to exactly one statement; nothing stalls; nothing is skipped silently (server-side log and table effects match what was sent). Probes marked observation-only (P5b, P8b, P9b, P9c) are never "safe" by construction.', ''];
  for (const n of names) {
    md.push(`## ${n}`, '', '| server | safe runs | observation |', '| --- | --- | --- |');
    for (const i of ids) {
      const p = data[i].probes[n]; const ds: string[] = p.distinctSummaries;
      md.push(`| ${i} | ${p.safeRuns}/${data[i].runsPerProbe} | ${ds[0]!.replace(/\|/g, '/')}${ds.length > 1 ? ` (+${ds.length - 1} run-to-run variants, e.g. timings or statement ids)` : ''} |`);
    }
    md.push('');
  }
  save('pipeline/summary.md', md.join('\n'));
}
// ---- kill
{
  const md = ['# Killing the connection in the middle of a pipelined batch', '', '300 autocommit inserts were written in one write; `KILL CONNECTION` followed a few milliseconds later. Per run: responses the client received before the loss / rows the server had committed.', '', '| server | run 1 | run 2 | run 3 | run 4 | run 5 | committed set always a prefix of the sent order |', '| --- | --- | --- | --- | --- | --- | --- |'];
  for (const i of ids) { const d = rd(`kill/${i}.json`); md.push(`| ${i} | ${d.runs.map((r: any) => `${r.responsesOkBeforeLoss}/${r.rowsCommittedOnServer}`).join(' | ')} | ${d.runs.every((r: any) => r.committedIsPrefixOfSentOrder) ? 'yes' : 'NO'} |`); }
  save('kill/summary.md', md.join('\n') + '\n');
}
// ---- auth
{
  const md = ['# Authentication matrix', '', 'Plain-password logins. "plain" is a TCP connection without TLS, "TLS" upgrades inside the handshake without certificate verification. P = this prototype, M2 = mysql2, MC = MariaDB Connector/Node.js. ok / refused (with the reason in the JSON).', ''];
  for (const i of [...ids.slice(0, 1), 'my84-native-on', ...ids.slice(1)]) {
    const d = rd(`auth/${i}.json`);
    md.push(`## ${i}`, '', `Plugins loaded in the fresh server before anything was installed: ${d.defaultLoadedBeforeAnyInstall.map((x: any) => x[0] + (x[1] === 'ACTIVE' ? '' : ` (${x[1]})`)).join(', ')}`, '', '| plugin | create user | plain P / M2 / MC | TLS P / M2 / MC | note |', '| --- | --- | --- | --- | --- |');
    const s = (x: string) => (x.startsWith('ok') ? 'ok' : 'refused');
    for (const p of d.plugins) {
      if (!p.prototype) { md.push(`| ${p.plugin} | ${p.create.slice(0, 70).replace(/\|/g, '/')} | | | ${p.note ?? ''} |`); continue; }
      md.push(`| ${p.plugin} | ok | ${s(p.prototype.first)} / ${s(p.mysql2)} / ${s(p.mariadbConnector)} | ${s(p.overTls.prototype)} / ${s(p.overTls.mysql2)} / ${s(p.overTls.mariadbConnector)} | ${p.authPacketKinds.map((k: any) => k.kinds).slice(0, 2).join(' ; ')} |`);
    }
    md.push('');
  }
  save('auth/summary.md', md.join('\n'));
}
// ---- binlog
{
  const md = ['# Binlog table-map metadata', '', 'Size of the Table_map event for one 7-column table (int unsigned, varchar utf8mb4, enum, bit, decimal, tinyint, blob), from SHOW BINLOG EVENTS, with the default binlog_row_metadata and with FULL.', '', '| server | default setting | Table_map bytes (default) | Table_map bytes (FULL) | image tool | row image shows column names (FULL) |', '| --- | --- | --- | --- | --- | --- |'];
  for (const i of ids) {
    const d = rd(`binlog/${i}.json`); const a = d.variants.default, b = d.variants.FULL;
    md.push(`| ${i} | ${a.binlog_row_metadata} | ${a.tableMapEvent?.[0]?.eventBytes} | ${b.tableMapEvent?.[0]?.eventBytes} | ${b.imageTool} | ${b.rowImageLines?.length ? (b.rowImageLines.some((l: string) => /`a`|@1=/.test(l)) ? b.rowImageLines[2]?.slice(0, 60) : 'see json') : 'n/a'} |`);
  }
  save('binlog/summary.md', md.join('\n') + '\n');
}
console.log('tables written');
