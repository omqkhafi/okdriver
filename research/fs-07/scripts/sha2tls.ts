// caching_sha2_password full authentication over TLS (cleartext inside the tunnel) with a cold server cache, and the
// fast path afterwards; the first login of a fresh account must take the full path.
import { save, pick, root, PW } from './lib.ts';
import { startProxy } from './mytrace.ts';
import { connect } from '../wire/connect.ts';

for (const s of pick().filter((x) => x.family === 'mysql')) {
  const a = await root(s);
  await a.queryAll("drop user if exists 'fs07_tls'@'%'");
  await a.query("create user 'fs07_tls'@'%' identified with caching_sha2_password by 'pw-tls'");
  const out: any = { server: s.id };
  const px = await startProxy({ host: '127.0.0.1', port: s.port });
  for (const label of ['first login over TLS (cold cache: full authentication)', 'second login over TLS (fast path)']) {
    const c = await connect({ host: '127.0.0.1', port: s.port, user: 'fs07_tls', password: 'pw-tls', tls: { rejectUnauthorized: false } });
    out[label] = `ok ${JSON.stringify(c.tlsInfo)}`;
    await c.close();
  }
  await a.queryAll('flush privileges');
  const plain = await connect({ host: '127.0.0.1', port: px.port, user: 'fs07_tls', password: 'pw-tls' });
  await plain.close(); await new Promise((r) => setTimeout(r, 150));
  out['after FLUSH PRIVILEGES, plain TCP: packets from server'] = px.traces()[0]!.steps[0]!.s2c.map((p) => p.kind).join(',');
  await px.close();
  await a.query("drop user 'fs07_tls'@'%'"); await a.close();
  save(`sha2tls/${s.id}.json`, out);
  console.log(s.id, JSON.stringify(out));
}
