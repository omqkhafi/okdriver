// TLS control: SSLRequest, TLS with SNI/servername, SCRAM over TLS, then every sequence, against a local Postgres with a self-signed
// certificate whose only name is pg.fs06.test. Shows the client's TLS path works before a hosted URL is tried.
import { readFileSync, writeFileSync } from 'node:fs';
import { PgConn } from './lib/client.ts';
import { study } from './study.ts';
import { WORK, RESULTS } from './lib/paths.ts';
import type { Target } from './lib/target.ts';

const ca = readFileSync(WORK + 'tls/cert.pem', 'utf8');
const base = { host: '127.0.0.1', port: 55440, user: 'fs06', password: 'fs06pw', database: 'fs06' };
const checks: Record<string, string> = {};
try { const c = await PgConn.connect({ ...base, tls: { servername: 'pg.fs06.test', ca } }); checks['right servername, CA pinned'] = `ok (${c.tlsProtocol}, ${c.authMethod})`; c.close(); } catch (e: any) { checks['right servername, CA pinned'] = 'FAILED ' + e.message; }
try { const c = await PgConn.connect({ ...base, tls: { servername: 'wrong.example', ca } }); checks['wrong servername'] = 'UNEXPECTED success'; c.close(); } catch (e: any) { checks['wrong servername'] = 'rejected: ' + e.message; }
try { const c = await PgConn.connect({ ...base, tls: { servername: 'pg.fs06.test' } }); checks['no CA (system trust)'] = 'UNEXPECTED success'; c.close(); } catch (e: any) { checks['no CA (system trust)'] = 'rejected: ' + e.message; }
try { const c = await PgConn.connect({ ...base, port: 55400, tls: { servername: 'x', ca } }); checks['TLS asked of a server without TLS'] = 'UNEXPECTED success'; c.close(); } catch (e: any) { checks['TLS asked of a server without TLS'] = 'rejected: ' + e.message; }
console.log(JSON.stringify(checks, null, 1));

const t: Target = { id: 'direct-tls', pooler: 'none', config: 'direct over TLS', mode: 'direct', ...base, tls: { servername: 'pg.fs06.test', ca }, serverPool: 0, clients: 8, serverSide: false, notes: ['TLS: the proxies see opaque bytes after the SSLRequest answer, so only chunk timing is recorded'] };
const s = await study(t, null, { proxyPort: 55421 });
const bad = Object.entries(s.seqs).filter(([, v]: any) => v.ok !== v.runs);
writeFileSync(RESULTS + 'tls-control.json', JSON.stringify({ checks, login: s.login, sequences: Object.fromEntries(Object.entries(s.seqs).map(([k, v]: any) => [k, `${v.ok}/${v.runs} trips ${v.traceRoundTrips?.median} implied ${v.impliedRoundTrips}`])) }, null, 1) + '\n');
console.log(bad.length ? `TLS CONTROL FAILED: ${bad.map(([k]) => k).join(',')}` : 'TLS CONTROL OK', 'tls', s.login?.tls);
process.exit(bad.length ? 1 : 0);
