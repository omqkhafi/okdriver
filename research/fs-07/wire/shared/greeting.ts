import { Reader } from './bytes.ts';
import { CAP } from './constants.ts';
import { ProtocolError } from './errors.ts';

/** Initial handshake packet, protocol version 10. The 10 reserved bytes are returned raw: how they are
 *  read is the family's business (see mariadb/). */
export interface Greeting {
  protocolVersion: number;
  serverVersion: string;
  connectionId: number;
  /** 20 scramble bytes (8 + 12), without the trailing NUL of part 2. */
  salt: Buffer;
  /** Capability bits offered, lower and upper halves combined (32 bit). */
  capabilities: number;
  charset: number;
  status: number;
  reserved: Buffer;
  authPluginName: string;
}

export function parseGreeting(payload: Buffer): Greeting {
  const r = new Reader(payload);
  const protocolVersion = r.u8();
  if (protocolVersion !== 10) throw new ProtocolError(`unsupported protocol version ${protocolVersion}`);
  const serverVersion = r.nulString();
  const connectionId = r.u32();
  const part1 = r.bytes(8);
  r.skip(1);
  let caps = r.u16();
  let charset = 0, status = 0, authLen = 0;
  let reserved: Buffer = Buffer.alloc(10);
  let part2: Buffer = Buffer.alloc(0);
  let authPluginName = '';
  if (!r.eof()) {
    charset = r.u8();
    status = r.u16();
    caps = (caps | (r.u16() << 16)) >>> 0;
    authLen = r.u8();
    reserved = Buffer.from(r.bytes(10));
    if (caps & CAP.SECURE_CONNECTION) {
      const n = Math.max(13, authLen - 8);
      part2 = r.bytes(Math.min(n, r.left));
      if (part2.length && part2[part2.length - 1] === 0) part2 = part2.subarray(0, part2.length - 1);
    }
    if (caps & CAP.PLUGIN_AUTH) authPluginName = r.nulString();
  }
  return { protocolVersion, serverVersion, connectionId, salt: Buffer.concat([part1, part2]), capabilities: caps >>> 0, charset, status, reserved, authPluginName };
}
