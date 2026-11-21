import { Reader } from '../shared/bytes.ts';
import { nativePasswordResponse } from '../shared/auth.ts';
import type { AuthPluginFactory, FamilyProfile } from '../shared/profile.ts';
import { cachingSha2Password } from '../shared/sha2.ts';
import { sha256Password } from './sha256.ts';

/** MySQL only: CLIENT_OPTIONAL_RESULTSET_METADATA. With it negotiated, every result header carries a metadata_follows byte
 *  (0 = RESULTSET_METADATA_NONE: column definitions are not sent). Requested through ConnectOptions.addCaps. */
export const OPTIONAL_RESULTSET_METADATA = 1 << 25;

const native: AuthPluginFactory = (ctx) => ({
  start: (ch) => nativePasswordResponse(ctx.password, ch),
  more: () => null,
});

export const mysqlProfile: FamilyProfile = {
  family: 'mysql',
  extraCapabilities: () => 0,
  clearCapabilities: () => 0,
  extendedCapabilities: () => 0,
  // First entry is the plugin used when the greeting names one this client does not know.
  authPlugins: new Map<string, AuthPluginFactory>([
    ['caching_sha2_password', cachingSha2Password],
    ['sha256_password', sha256Password],
    ['mysql_native_password', native],
  ]),
  columnExtra: () => undefined,
  resultsetHeaderTail: (r: Reader, n) => ((n.caps & OPTIONAL_RESULTSET_METADATA) !== 0 ? r.u8() === 0 : false),
  prepareOkTail: (r: Reader) => Buffer.from(r.rest()),
  prepareMetadataSkipped: (tail, n) => (n.caps & OPTIONAL_RESULTSET_METADATA) !== 0 && tail[0] === 0,
};
