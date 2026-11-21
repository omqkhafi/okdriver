// Prints a compact view of one target's summary JSON. Usage: bun scripts/peek.ts <target-id> [--full]
import { readFileSync } from 'node:fs';
import { RESULTS } from './lib/paths.ts';
const d = JSON.parse(readFileSync(`${RESULTS}targets/${process.argv[2]}.json`, 'utf8'));
if (d.notVerified) { console.log('NOT VERIFIED', d.blocker); process.exit(0); }
for (const [k, v] of Object.entries(d.seqs) as any) {
  const f = v.failures ? ' FAIL ' + JSON.stringify(v.failures) : '';
  console.log(k.padEnd(7), `${v.ok}/${v.runs}`, `trips ${v.traceRoundTrips?.min}-${v.traceRoundTrips?.max}`, `implied ${v.impliedRoundTrips}`, `${v.elapsedMs?.median}ms`, `asSent ${v.forwardedAsSent}`, `wrongRow ${v.wrongRow}`, f.slice(0, 300), Object.keys(v.errors).length ? 'ERR ' + JSON.stringify(v.errors).slice(0, 200) : '');
  if (process.argv[3] === '--full') console.log('        notes', JSON.stringify(v.serverNotes), 'srv', (v.serverTypes?.[0] ?? '').slice(0, 90));
}
console.log('pin unnamed', JSON.stringify(d.pin.unnamed).slice(0, 400));
console.log('pin named  ', JSON.stringify(d.pin.named).slice(0, 500));
console.log('prepared', JSON.stringify(d.preparedReadbackLastRun).slice(0, 300));
console.log('statsBusy', JSON.stringify(d.statsBusyLastRun).slice(0, 500));
console.log('server', JSON.stringify({ c: d.server?.connections, pids: d.server?.pids, names: d.server?.parseNamesSample?.slice(0, 5), q: Object.keys(d.server?.simpleQueries ?? {}).slice(0, 4) }));
console.log('connectErrors', JSON.stringify(d.connectErrors?.slice(0, 3)));
