// TLS upgrade inside the handshake (SSLRequest) on every server: offered or not, protocol and cipher, and what a
// verifying client (rejectUnauthorized true, the verify-full style default) gets from the stock certificates.
import { save, pick, tryErr, PW, root } from './lib.ts';
import { connect } from '../wire/connect.ts';
import { CAP } from '../wire/shared/constants.ts';
import type { TLSSocket } from 'node:tls';

for (const s of pick()) {
  const out: any = { server: s.id };
  const plain = await root(s);
  out.serverOffersSslCapability = !!(plain.greeting.capabilities & CAP.SSL);
  out.have_ssl = String((await plain.rows("show variables like 'have_ssl'"))[0]?.[1] ?? 'n/a');
  out.require_secure_transport = String((await plain.rows("show variables like 'require_secure_transport'"))[0]?.[1] ?? 'n/a');
  out.sslVersionsOffered = String((await plain.rows("show variables like 'tls_version'"))[0]?.[1] ?? 'n/a');
  await plain.close();
  const t = await tryErr(async () => {
    const c = await connect({ host: '127.0.0.1', port: s.port, user: 'root', password: PW, tls: { rejectUnauthorized: false } });
    const sock = c.socket as TLSSocket; const cert = sock.getPeerCertificate();
    const r = { protocol: c.tlsInfo?.protocol, cipher: c.tlsInfo?.cipher, certSubject: cert.subject?.CN, certIssuer: cert.issuer?.CN, selfSigned: cert.issuer?.CN === cert.subject?.CN, sanPresent: !!cert.subjectaltname, validTo: cert.valid_to, queryOverTls: String((await c.rows('select 1'))[0]![0]) };
    await c.close(); return r;
  });
  out.upgradeWithoutVerification = t.ok ? t.v : t.error.slice(0, 120);
  const v = await tryErr(async () => { const c = await connect({ host: '127.0.0.1', port: s.port, user: 'root', password: PW, tls: { rejectUnauthorized: true, servername: 'localhost' } }); await c.close(); });
  out.upgradeWithVerification = v.ok ? 'accepted' : v.error.slice(0, 120);
  save(`tls/${s.id}.json`, out);
  console.log(s.id, out.serverOffersSslCapability, out.have_ssl, JSON.stringify(out.upgradeWithoutVerification).slice(0, 110), '|', String(out.upgradeWithVerification).slice(0, 60));
}
