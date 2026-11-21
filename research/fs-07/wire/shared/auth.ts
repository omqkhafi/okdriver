import { createHash } from 'node:crypto';

export function sha1(...parts: Buffer[]): Buffer { const h = createHash('sha1'); for (const p of parts) h.update(p); return h.digest(); }
export function sha256(...parts: Buffer[]): Buffer { const h = createHash('sha256'); for (const p of parts) h.update(p); return h.digest(); }

export function xor(a: Buffer, b: Buffer): Buffer {
  const out = Buffer.allocUnsafe(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i]! ^ b[i % b.length]!;
  return out;
}

/** mysql_native_password response: SHA1(pw) XOR SHA1(salt + SHA1(SHA1(pw))). Same bytes wherever a server
 *  still offers the plugin. Empty password sends an empty response. */
export function nativePasswordResponse(password: string, salt: Buffer): Buffer {
  if (password === '') return Buffer.alloc(0);
  const pw = Buffer.from(password, 'utf8');
  const stage1 = sha1(pw);
  return xor(stage1, sha1(salt.subarray(0, 20), sha1(stage1)));
}
