// Throwaway certificates for the local servers, made with the system `openssl` (no dependency).
//   ca            : trusted root (this is what workerd's `trustedCertificates` gets)
//   pg            : leaf signed by ca, SAN pg.fs04.test + wrong-name target uses the same leaf under another host name
//   selfsigned    : self-signed leaf, SAN selfsigned.fs04.test, NOT in the trusted list
//   expired       : leaf signed by ca, SAN expired.fs04.test, notAfter in the past
//   client        : client certificate signed by ca (for the client-certificate probe)
import { existsSync, mkdirSync, writeFileSync, chmodSync, readFileSync } from 'node:fs';
import { CERTS } from './paths.ts';

const sh = (cmd: string, cwd = CERTS) => {
  const r = Bun.spawnSync(['bash', '-c', cmd], { cwd, stderr: 'pipe', stdout: 'pipe' });
  if (r.exitCode !== 0) throw new Error(`${cmd}\n${r.stderr.toString()}`);
  return r.stdout.toString();
};

export function ensureCerts(): void {
  if (existsSync(CERTS + 'ca.crt') && existsSync(CERTS + 'client.crt')) return;
  mkdirSync(CERTS, { recursive: true });
  const ext = (san: string) => `subjectAltName=DNS:${san}\nbasicConstraints=CA:FALSE\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth,clientAuth\n`;
  writeFileSync(CERTS + 'ca.ext', 'basicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,cRLSign\nsubjectKeyIdentifier=hash\n');
  sh('openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -keyout ca.key -out ca.crt -subj "/CN=fs04 test root" -days 30 -addext "basicConstraints=critical,CA:TRUE" -addext "keyUsage=critical,keyCertSign,cRLSign"');
  const leaf = (name: string, san: string, args = '') => {
    writeFileSync(CERTS + `${name}.ext`, ext(san));
    sh(`openssl req -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -keyout ${name}.key -out ${name}.csr -subj "/CN=${san}"`);
    sh(`openssl x509 -req -in ${name}.csr -CA ca.crt -CAkey ca.key -CAcreateserial -out ${name}.crt -days 29 -extfile ${name}.ext ${args}`);
  };
  leaf('pg', 'pg.fs04.test');
  leaf('client', 'client.fs04.test');
  // self-signed, untrusted
  writeFileSync(CERTS + 'selfsigned.ext', ext('selfsigned.fs04.test'));
  sh('openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -keyout selfsigned.key -out selfsigned.crt -subj "/CN=selfsigned.fs04.test" -days 29 -addext "subjectAltName=DNS:selfsigned.fs04.test"');
  // expired leaf: `openssl ca` accepts explicit validity dates in the past
  writeFileSync(CERTS + 'expired.ext', ext('expired.fs04.test'));
  sh('openssl req -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -keyout expired.key -out expired.csr -subj "/CN=expired.fs04.test"');
  writeFileSync(CERTS + 'ca.cnf', `[ca]\ndefault_ca=c\n[c]\ndatabase=index.txt\nnew_certs_dir=.\nserial=serial.txt\ndefault_md=sha256\npolicy=p\ncopy_extensions=none\nunique_subject=no\n[p]\ncommonName=supplied\n`);
  writeFileSync(CERTS + 'index.txt', ''); writeFileSync(CERTS + 'serial.txt', '01\n');
  sh('openssl ca -batch -config ca.cnf -cert ca.crt -keyfile ca.key -in expired.csr -out expired.crt -startdate 20240101000000Z -enddate 20240102000000Z -extfile expired.ext');
  for (const f of ['pg', 'selfsigned', 'expired', 'client', 'ca']) {
    sh(`openssl x509 -in ${f}.crt -out ${f}.pem -outform PEM`);
  }
  for (const f of ['pg', 'selfsigned', 'expired', 'ca']) { sh(`chown 999:999 ${f}.key ${f}.crt; chmod 600 ${f}.key; chmod 644 ${f}.crt`); }
  sh('chmod 644 ca.crt client.crt; chmod 644 client.key');
}
export const pem = (f: string): string => readFileSync(CERTS + f, 'utf8');
if (import.meta.main) { ensureCerts(); console.log(sh('for f in ca pg selfsigned expired client; do echo $f; openssl x509 -in $f.crt -noout -subject -dates -ext subjectAltName 2>&1 | head -5; done')); }
