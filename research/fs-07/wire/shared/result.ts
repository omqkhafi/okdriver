import { Reader } from './bytes.ts';
import { BINARY_COLLATION, FIELD, STATUS, TYPE } from './constants.ts';
import { ProtocolError } from './errors.ts';

export interface Column {
  catalog: string; schema: string; table: string; orgTable: string; name: string; orgName: string;
  charset: number; length: number; type: number; flags: number; decimals: number;
  /** Whatever the family's column-extra hook found (e.g. MariaDB extended type name). */
  extra?: Record<string, string>;
}
export type Value = null | number | bigint | string | Buffer;
export interface SessionStateEntry { type: number; data: Buffer }
export interface OkPacket {
  kind: 'ok'; affectedRows: number; lastInsertId: bigint; status: number; warnings: number; info: string; sessionState: SessionStateEntry[];
}
export interface ErrPacket { kind: 'err'; errno: number; sqlState: string; message: string }
export interface Rows { kind: 'rows'; columns: Column[]; rows: Value[][]; status: number; warnings: number; metadataSkipped: boolean }
export interface PrepareOk { kind: 'prepare'; id: number; params: Column[]; columns: Column[]; warnings: number; tail: Buffer }
export type Response = OkPacket | ErrPacket | Rows | PrepareOk;

export function parseOk(payload: Buffer, sessionTrack: boolean): OkPacket {
  const r = new Reader(payload, 1);
  const affectedRows = r.lenenc() ?? 0;
  const lastInsertId = BigInt(r.lenenc() ?? 0);
  const status = r.u16();
  const warnings = r.u16();
  let info = '';
  const sessionState: SessionStateEntry[] = [];
  if (!r.eof()) {
    if (sessionTrack) {
      info = r.lenencString() ?? '';
      if (status & STATUS.SESSION_STATE_CHANGED && !r.eof()) {
        const blob = r.lenencBytes();
        if (blob) {
          const b = new Reader(blob);
          while (!b.eof()) { const type = b.u8(); sessionState.push({ type, data: b.lenencBytes() ?? Buffer.alloc(0) }); }
        }
      }
    } else info = r.rest().toString('utf8');
  }
  return { kind: 'ok', affectedRows, lastInsertId, status, warnings, info, sessionState };
}

export function parseErr(payload: Buffer): ErrPacket {
  const r = new Reader(payload, 1);
  const errno = r.u16();
  let sqlState = '';
  if (payload[3] === 0x23) { r.skip(1); sqlState = r.bytes(5).toString('latin1'); }
  return { kind: 'err', errno, sqlState, message: r.rest().toString('utf8') };
}

/** Terminator of a result set (EOF or, with DEPRECATE_EOF, an OK packet with header 0xfe). */
export function parseTerminator(payload: Buffer, deprecateEof: boolean, sessionTrack: boolean): { status: number; warnings: number } {
  if (deprecateEof) { const ok = parseOk(payload, sessionTrack); return { status: ok.status, warnings: ok.warnings }; }
  const r = new Reader(payload, 1);
  return { warnings: r.u16(), status: r.u16() };
}

export function isTerminator(p: Buffer): boolean { return p[0] === 0xfe && p.length < 0xffffff; }

/** Column definition 41. `extra` is called after org_name and before the fixed-length block: the one place
 *  a family can append fields without changing the shared layout. */
export function parseColumn(payload: Buffer, extra?: (r: Reader) => Record<string, string> | undefined): Column {
  const r = new Reader(payload);
  const catalog = r.lenencString() ?? '', schema = r.lenencString() ?? '', table = r.lenencString() ?? '';
  const orgTable = r.lenencString() ?? '', name = r.lenencString() ?? '', orgName = r.lenencString() ?? '';
  const ex = extra ? extra(r) : undefined;
  const fixed = r.lenenc() ?? 0;
  if (fixed < 12) throw new ProtocolError(`column fixed block ${fixed}`);
  const charset = r.u16(), length = r.u32(), type = r.u8(), flags = r.u16(), decimals = r.u8();
  const col: Column = { catalog, schema, table, orgTable, name, orgName, charset, length, type, flags, decimals };
  if (ex) col.extra = ex;
  return col;
}

const isBinaryCharset = (c: Column) => c.charset === BINARY_COLLATION;

export function decodeText(col: Column, b: Buffer): Value {
  switch (col.type) {
    case TYPE.TINY: case TYPE.SHORT: case TYPE.LONG: case TYPE.INT24: case TYPE.YEAR: case TYPE.FLOAT: case TYPE.DOUBLE:
      return Number(b.toString('latin1'));
    case TYPE.LONGLONG: return BigInt(b.toString('latin1'));
    case TYPE.BIT: case TYPE.GEOMETRY: case TYPE.VECTOR: return Buffer.from(b);
    case TYPE.TINY_BLOB: case TYPE.MEDIUM_BLOB: case TYPE.LONG_BLOB: case TYPE.BLOB: case TYPE.VARCHAR: case TYPE.VAR_STRING: case TYPE.STRING:
      return isBinaryCharset(col) ? Buffer.from(b) : b.toString('utf8');
    default: return b.toString('utf8'); // DECIMAL, NEWDECIMAL, dates, times, JSON, ENUM, SET: text as sent
  }
}

const p2 = (n: number) => String(n).padStart(2, '0');
function frac(micro: number, digits: number): string { return digits > 0 ? '.' + String(micro).padStart(6, '0').slice(0, digits) : ''; }

export function decodeBinary(col: Column, r: Reader): Value {
  const unsigned = (col.flags & FIELD.UNSIGNED) !== 0;
  switch (col.type) {
    case TYPE.TINY: { const v = unsigned ? r.buf.readUInt8(r.pos) : r.buf.readInt8(r.pos); r.pos += 1; return v; }
    case TYPE.SHORT: case TYPE.YEAR: { const v = unsigned || col.type === TYPE.YEAR ? r.buf.readUInt16LE(r.pos) : r.buf.readInt16LE(r.pos); r.pos += 2; return v; }
    case TYPE.LONG: case TYPE.INT24: { const v = unsigned ? r.buf.readUInt32LE(r.pos) : r.buf.readInt32LE(r.pos); r.pos += 4; return v; }
    case TYPE.LONGLONG: { const v = unsigned ? r.buf.readBigUInt64LE(r.pos) : r.buf.readBigInt64LE(r.pos); r.pos += 8; return v; }
    case TYPE.FLOAT: { const v = r.buf.readFloatLE(r.pos); r.pos += 4; return v; }
    case TYPE.DOUBLE: { const v = r.buf.readDoubleLE(r.pos); r.pos += 8; return v; }
    case TYPE.DATE: case TYPE.DATETIME: case TYPE.TIMESTAMP: {
      const len = r.u8();
      if (len === 0) return col.type === TYPE.DATE ? '0000-00-00' : '0000-00-00 00:00:00' + frac(0, col.decimals);
      const y = r.u16(), mo = r.u8(), d = r.u8();
      let s = `${String(y).padStart(4, '0')}-${p2(mo)}-${p2(d)}`;
      if (col.type === TYPE.DATE) { if (len > 4) r.skip(len - 4); return s; }
      let h = 0, mi = 0, se = 0, us = 0;
      if (len >= 7) { h = r.u8(); mi = r.u8(); se = r.u8(); }
      if (len >= 11) us = r.u32();
      s += ` ${p2(h)}:${p2(mi)}:${p2(se)}${frac(us, col.decimals)}`;
      return s;
    }
    case TYPE.TIME: {
      const len = r.u8();
      if (len === 0) return '00:00:00' + frac(0, col.decimals);
      const neg = r.u8(), days = r.u32(), h = r.u8(), mi = r.u8(), se = r.u8();
      const us = len >= 12 ? r.u32() : 0;
      return `${neg ? '-' : ''}${p2(days * 24 + h)}:${p2(mi)}:${p2(se)}${frac(us, col.decimals)}`;
    }
    default: {
      const b = r.lenencBytes() ?? Buffer.alloc(0);
      return decodeText(col, b);
    }
  }
}

/** Text row: one length-encoded string (or 0xfb for NULL) per column. */
export function decodeTextRow(columns: Column[], payload: Buffer): Value[] {
  const r = new Reader(payload);
  return columns.map((c) => { const b = r.lenencBytes(); return b === null ? null : decodeText(c, b); });
}

/** Binary row: 0x00 header, NULL bitmap with offset 2, then the non-NULL values. */
export function decodeBinaryRow(columns: Column[], payload: Buffer): Value[] {
  const r = new Reader(payload, 1);
  const bitmap = r.bytes((columns.length + 9) >> 3);
  return columns.map((c, i) => ((bitmap[(i + 2) >> 3]! >> ((i + 2) & 7)) & 1 ? null : decodeBinary(c, r)));
}
