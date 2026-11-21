// caching_sha2_password: MySQL 8.0+ and MariaDB 11.4+ (server plugin auth_mysql_sha2, not loaded by default).
// Full authentication sends the password in cleartext over TLS, or RSA-OAEP encrypted with the server's public key.
import { publicEncrypt, constants } from 'node:crypto';
import { sha256, xor } from './auth.ts';
import type { AuthPluginFactory } from './profile.ts';

export const nulPassword = (pw: string): Buffer => Buffer.concat([Buffer.from(pw, 'utf8'), Buffer.from([0])]);
export const rsaEncryptPassword = (pem: Buffer, pw: string, salt: Buffer): Buffer =>
  publicEncrypt({ key: pem.toString('utf8'), padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha1' }, xor(nulPassword(pw), salt));

export const cachingSha2Password: AuthPluginFactory = (ctx) => {
  let salt: Buffer = Buffer.alloc(0);
  let awaitingKey = false;
  return {
    start(ch: Buffer): Buffer {
      salt = ch.subarray(0, 20);
      if (ctx.password === '') return Buffer.alloc(0);
      const pw = Buffer.from(ctx.password, 'utf8');
      const h1 = sha256(pw);
      return xor(h1, sha256(sha256(h1), salt));
    },
    more(data: Buffer): Buffer | null {
      if (awaitingKey) return rsaEncryptPassword(data, ctx.password, salt);
      if (data[0] === 3) return null; // fast path accepted; an OK packet follows
      if (data[0] === 4) {
        if (ctx.secureTransport) return nulPassword(ctx.password);
        awaitingKey = true;
        return Buffer.from([2]); // ask for the server's RSA public key
      }
      throw new Error(`unexpected caching_sha2_password status ${data[0]}`);
    },
  };
};

