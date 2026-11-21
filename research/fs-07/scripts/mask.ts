// Masks applied before judging two traces identical. Documented in the README ("Masks").
//  greeting      : server version string, connection id, both salt parts (the extended-capability bytes are NOT masked)
//  auth replies  : bytes of every client auth response and every server challenge / public key (functions of the salt or key)
//  login OK info : MariaDB 11.4+ puts a random 65-byte token (0x01 plus 64 hex digits) in the info field of the OK that ends authentication
//  ERR text      : the client address and thread id embedded in access-denied style messages
// Everything else (capabilities, status flags, charset ids, column definitions, rows, OK counters) is compared raw.
import type { Step } from './mytrace.ts';

const zeros = (n: number) => '0'.repeat(n * 2);

function maskGreeting(h: string): string {
  const b = Buffer.from(h, 'hex');
  const e = b.indexOf(0, 1), o = e + 1;
  const authLen = b[o + 20]!;
  const out = Buffer.from(b);
  out.fill(0, o, o + 4);                       // connection id
  out.fill(0, o + 4, o + 12);                  // salt part 1
  out.fill(0, o + 31, o + 31 + Math.max(13, authLen - 8) - 1); // salt part 2 without its trailing NUL
  return Buffer.concat([Buffer.from([10]), Buffer.from('<VERSION>\0'), out.subarray(o)]).toString('hex');
}
function maskResponse(h: string): string {
  // HandshakeResponse41: caps 4, max packet 4, charset 1, filler 23, user NUL, auth response (lenenc), ...
  const b = Buffer.from(h, 'hex');
  if (b.length < 33) return h;
  const o = b.indexOf(0, 32) + 1;
  const len = b[o]!;
  if (len < 0xfb) b.fill(0, o + 1, o + 1 + len);
  return b.toString('hex');
}
function maskErr(h: string): string {
  const b = Buffer.from(h, 'hex');
  const msg = b.toString('utf8', 9).replace(/@'[^']*'/g, "@'<ADDR>'").replace(/\(conn:\d+\)/g, '(conn:N)');
  return b.subarray(0, 9).toString('hex') + Buffer.from(msg).toString('hex');
}
function maskLoginOk(h: string): string {
  const b = Buffer.from(h, 'hex');
  if (b[0] !== 0x00 || b.length < 8) return h;
  const o = 1 + 1 + 1 + 2 + 2; // header, affected rows, last insert id (one byte each here), status, warnings
  const len = b[o]!;
  if (len > 0 && len < 0xfb) b.fill(0, o + 1, o + 1 + len);
  return b.toString('hex');
}
function maskSwitch(h: string): string {
  const b = Buffer.from(h, 'hex');
  if (b[0] === 0xfe) { const e = b.indexOf(0, 1); b.fill(0, e + 1); }
  else if (b[0] === 0x01 && b.length > 4) b.fill(0, 1);
  return b.toString('hex');
}
export function maskStep(s: Step): { c2s: string[]; s2c: { kind: string; hex: string }[] } {
  const auth = s.label === 'greeting+auth';
  const c2s = s.c2s.map((p, i) => (auth ? (i === 0 ? maskResponse(p.hex) : zeros(p.hex.length / 2)) : p.hex));
  const s2c = s.s2c.map((p) => ({
    kind: p.kind,
    hex: p.kind === 'GREETING' ? maskGreeting(p.hex) : p.kind === 'OK' && auth ? maskLoginOk(p.hex) : p.kind === 'ERR' ? maskErr(p.hex) : p.kind === 'AUTH_SWITCH' || p.kind === 'AUTH_MORE' ? maskSwitch(p.hex) : p.hex,
  }));
  return { c2s, s2c };
}
