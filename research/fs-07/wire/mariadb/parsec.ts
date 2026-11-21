// PARSEC (MariaDB 11.8+, auth_parsec): the server sends a 32-byte scramble; the client answers with an empty
// packet to ask for the ext-salt ("P", iteration factor, salt); the signing key is an Ed25519 seed derived with
// PBKDF2-HMAC-SHA512 (1024 << factor rounds, 32 bytes); the reply is client scramble (32) + signature (64) over
// server scramble + client scramble. The iteration factor comes from the server, so it is capped here.
import { createPrivateKey, pbkdf2Sync, randomBytes, sign } from 'node:crypto';
import type { AuthPluginFactory } from '../shared/profile.ts';

const PKCS8_ED25519_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
const MAX_FACTOR = 8;

export const parsecPassword: AuthPluginFactory = (ctx) => {
  let serverScramble = Buffer.alloc(0);
  return {
    start(ch) { serverScramble = Buffer.from(ch.subarray(0, 32)); return Buffer.alloc(0); },
    more(data) {
      if (data[0] !== 0x50) throw new Error('parsec: expected KDF id P');
      const factor = data[1]!;
      if (factor > MAX_FACTOR) throw new Error(`parsec: iteration factor ${factor} above the client cap ${MAX_FACTOR}`);
      const seed = pbkdf2Sync(ctx.password, data.subarray(2), 1024 << factor, 32, 'sha512');
      const key = createPrivateKey({ key: Buffer.concat([PKCS8_ED25519_PREFIX, seed]), format: 'der', type: 'pkcs8' });
      const clientScramble = randomBytes(32);
      return Buffer.concat([clientScramble, sign(null, Buffer.concat([serverScramble, clientScramble]), key)]);
    },
  };
};
