// MariaDB's ed25519 authentication, written from RFC 8032 arithmetic with BigInt. node:crypto cannot be used:
// the plugin derives the signing scalar directly from SHA-512(password) instead of treating it as a seed.
import { createHash } from 'node:crypto';
import type { AuthPluginFactory } from '../shared/profile.ts';

const P = 2n ** 255n - 19n;
const L = 2n ** 252n + 27742317777372353535851937790883648493n;
const D = ((-121665n * inv(121666n)) % P + P) % P;
function mod(a: bigint, m = P): bigint { const r = a % m; return r >= 0n ? r : r + m; }
function pow(b: bigint, e: bigint, m = P): bigint { let r = 1n; b = mod(b, m); while (e > 0n) { if (e & 1n) r = (r * b) % m; b = (b * b) % m; e >>= 1n; } return r; }
function inv(a: bigint): bigint { return pow(a, P - 2n); }
type Pt = [bigint, bigint, bigint, bigint];
const Bx = 15112221349535400772501151409588531511454012693041857206046113283949847762202n;
const By = 46316835694926478169428394003475163141307993866256225615783033603165251855960n;
const B: Pt = [Bx, By, 1n, mod(Bx * By)];
function add(p: Pt, q: Pt): Pt {
  const A = mod((p[1] - p[0]) * (q[1] - q[0])), Bb = mod((p[1] + p[0]) * (q[1] + q[0]));
  const C = mod(2n * p[3] * q[3] * D), Dd = mod(2n * p[2] * q[2]);
  const E = Bb - A, F = Dd - C, G = Dd + C, H = Bb + A;
  return [mod(E * F), mod(G * H), mod(F * G), mod(E * H)];
}
function mul(s: bigint, p: Pt): Pt {
  let q: Pt = [0n, 1n, 1n, 0n];
  while (s > 0n) { if (s & 1n) q = add(q, p); p = add(p, p); s >>= 1n; }
  return q;
}
function enc(p: Pt): Buffer {
  const zi = inv(p[2]);
  const x = mod(p[0] * zi), y = mod(p[1] * zi);
  const out = Buffer.alloc(32);
  let v = y | ((x & 1n) << 255n);
  for (let i = 0; i < 32; i++) { out[i] = Number(v & 0xffn); v >>= 8n; }
  return out;
}
const le = (b: Buffer): bigint => { let v = 0n; for (let i = b.length - 1; i >= 0; i--) v = (v << 8n) | BigInt(b[i]!); return v; };
const sha512 = (...p: Buffer[]) => { const h = createHash('sha512'); for (const x of p) h.update(x); return h.digest(); };

/** Signature over `msg` with the expanded key derived from SHA-512(password). Returns R || S (64 bytes). */
export function ed25519Sign(password: string, msg: Buffer): Buffer {
  const h = sha512(Buffer.from(password, 'utf8'));
  const a0 = Buffer.from(h.subarray(0, 32));
  a0[0]! &= 248; a0[31]! &= 127; a0[31]! |= 64;
  const a = le(a0);
  const A = enc(mul(a, B));
  const r = mod(le(sha512(h.subarray(32), msg)), L);
  const R = enc(mul(r, B));
  const k = mod(le(sha512(R, A, msg)), L);
  const S = mod(r + k * a, L);
  const sb = Buffer.alloc(32);
  let v = S; for (let i = 0; i < 32; i++) { sb[i] = Number(v & 0xffn); v >>= 8n; }
  return Buffer.concat([R, sb]);
}

export const ed25519Password: AuthPluginFactory = (ctx) => ({
  start: (ch) => ed25519Sign(ctx.password, ch.subarray(0, 32)),
  more: () => null,
});
