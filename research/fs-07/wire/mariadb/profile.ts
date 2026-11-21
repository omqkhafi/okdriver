import type { Reader } from '../shared/bytes.ts';
import { CAP } from '../shared/constants.ts';
import { nativePasswordResponse } from '../shared/auth.ts';
import type { AuthPluginFactory, FamilyProfile, Negotiated } from '../shared/profile.ts';
import { cachingSha2Password } from '../shared/sha2.ts';
import { ed25519Password } from './ed25519.ts';
import { parsecPassword } from './parsec.ts';

/** MariaDB extended capabilities: a 32-bit word in the last four of the ten reserved greeting bytes, and in
 *  the last four of the 23 filler bytes of the client response. (Bit n here is bit 32+n of the 64-bit mask.) */
export const MARIADB_EXT = { PROGRESS: 1, COM_MULTI: 2, STMT_BULK_OPERATIONS: 4, EXTENDED_METADATA: 8, CACHE_METADATA: 16, BULK_UNIT_RESULTS: 32 } as const;

const native: AuthPluginFactory = (ctx) => ({
  start: (ch) => nativePasswordResponse(ctx.password, ch),
  more: () => null,
});

/** Extended capability word the server offered, read from the greeting's reserved bytes. */
export function serverExtendedCapabilities(reserved: Buffer): number { return reserved.readUInt32LE(6); }

export const mariadbProfile: FamilyProfile = {
  family: 'mariadb',
  extraCapabilities: () => 0,
  // Bit 0 is CLIENT_MYSQL on MariaDB: when it is clear the server reads extended capabilities from the filler.
  clearCapabilities: () => CAP.LONG_PASSWORD,
  extendedCapabilities: (g) =>
    serverExtendedCapabilities(g.reserved) & (MARIADB_EXT.STMT_BULK_OPERATIONS | MARIADB_EXT.EXTENDED_METADATA),
  authPlugins: new Map<string, AuthPluginFactory>([
    ['mysql_native_password', native],
    ['client_ed25519', ed25519Password],
    ['parsec', parsecPassword],
    ['caching_sha2_password', cachingSha2Password],
  ]),
  columnExtra(r: Reader, n: Negotiated) {
    if (!(n.ext & MARIADB_EXT.EXTENDED_METADATA)) return undefined;
    const raw = r.lenencBytes();
    if (!raw || raw.length === 0) return undefined;
    const out: Record<string, string> = {};
    for (let i = 0; i + 2 <= raw.length; ) {
      const type = raw[i]!, len = raw[i + 1]!;
      out[type === 0 ? 'typeName' : type === 1 ? 'format' : `t${type}`] = raw.toString('utf8', i + 2, i + 2 + len);
      i += 2 + len;
    }
    return out;
  },
  resultsetHeaderTail(r: Reader, n: Negotiated) {
    if (!(n.ext & MARIADB_EXT.CACHE_METADATA)) return false;
    return r.u8() === 0; // placeholder: the real meaning is established against the live servers
  },
  prepareOkTail: (r: Reader) => Buffer.from(r.rest()),
  prepareMetadataSkipped: () => false,
};
