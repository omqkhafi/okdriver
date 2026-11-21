// sha256_password (MySQL only, deprecated): cleartext over TLS, otherwise RSA-OAEP with the server's public key.
import { nulPassword, rsaEncryptPassword } from '../shared/sha2.ts';
import type { AuthPluginFactory } from '../shared/profile.ts';

export const sha256Password: AuthPluginFactory = (ctx) => {
  let salt: Buffer = Buffer.alloc(0);
  return {
    start(ch: Buffer): Buffer {
      salt = ch.subarray(0, 20);
      if (ctx.password === '') return Buffer.from([0]);
      return ctx.secureTransport ? nulPassword(ctx.password) : Buffer.from([1]);
    },
    more: (data: Buffer): Buffer | null => rsaEncryptPassword(data, ctx.password, salt),
  };
};
