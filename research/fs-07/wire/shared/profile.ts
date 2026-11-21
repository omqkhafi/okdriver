// The seam between shared code and a server family. shared/ never names a family: everything that
// depends on one arrives through this interface, implemented in mysql/ and mariadb/.
import type { Reader } from './bytes.ts';
import type { Greeting } from './greeting.ts';

export interface Negotiated { caps: number; ext: number }

export interface AuthContext {
  user: string;
  password: string;
  /** True when the transport is TLS (or otherwise protects a cleartext password). */
  secureTransport: boolean;
}
export interface AuthExchange {
  /** First response, given the salt/challenge the server sent (greeting or auth-switch). */
  start(challenge: Buffer): Buffer;
  /** Response to an "auth more data" packet (header 0x01); null = send nothing. */
  more(data: Buffer): Buffer | null;
}
export type AuthPluginFactory = (ctx: AuthContext) => AuthExchange;

export interface FamilyProfile {
  readonly family: string;
  /** Standard capability bits to ask for on top of the shared base set. */
  extraCapabilities(g: Greeting): number;
  /** Standard capability bits to clear from the shared base set (e.g. bit 0 for MariaDB). */
  clearCapabilities(g: Greeting): number;
  /** Extended capability word carried in the response filler (0 when the family has none). */
  extendedCapabilities(g: Greeting): number;
  readonly authPlugins: ReadonlyMap<string, AuthPluginFactory>;
  /** Hook: extra fields in a column definition, between org_name and the fixed block. */
  columnExtra(r: Reader, n: Negotiated): Record<string, string> | undefined;
  /** Hook: bytes between the column count and the column definitions. Returns true when the server will
   *  not send column definitions for this result (metadata skipped). */
  resultsetHeaderTail(r: Reader, n: Negotiated): boolean;
  /** Hook: bytes after the fixed 12-byte COM_STMT_PREPARE_OK header (the "reserved" byte and anything past it). */
  prepareOkTail(r: Reader, n: Negotiated): Buffer;
  /** Hook: true when the tail says the PREPARE response carries no parameter/column definitions. */
  prepareMetadataSkipped(tail: Buffer, n: Negotiated): boolean;
}
