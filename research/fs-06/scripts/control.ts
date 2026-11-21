// Controls: every sequence against Postgres directly (through the client-side proxy only). Must all pass before any pooler result counts.
import { study } from './study.ts';
import type { Target } from './lib/target.ts';

const t: Target = { id: 'direct', pooler: 'none', config: 'direct', mode: 'direct', host: '127.0.0.1', port: 55400, user: 'fs06', password: 'fs06pw', database: 'fs06', serverPool: 0, clients: 8, serverSide: false };
const s = await study(t, null);
const bad = Object.entries(s.seqs).filter(([, v]: any) => v.ok !== v.runs);
for (const [k, v] of Object.entries(s.seqs) as any) console.log(k.padEnd(8), `ok ${v.ok}/${v.runs}`, 'trips', JSON.stringify(v.traceRoundTrips), 'implied', v.impliedRoundTrips, 'ms', v.elapsedMs?.median, v.failures ? JSON.stringify(v.failures) : '');
console.log('pin', JSON.stringify(s.pin));
console.log('prepared', JSON.stringify(s.preparedReadbackLastRun));
console.log(bad.length ? `CONTROL FAILED: ${bad.map(([k]) => k).join(',')}` : 'CONTROL OK');
process.exit(bad.length ? 1 : 0);
