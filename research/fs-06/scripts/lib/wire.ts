// Minimal PostgreSQL v3 wire encoder/decoder used by the FS-06 client. Raw bytes only; no dependency.
// The recording proxies do NOT use this file (they have their own parser in proxy.ts), so a bug here cannot
// hide itself from the trace.

const enc = new TextEncoder();
const dec = new TextDecoder('utf-8');

export const u8 = (...parts: (Uint8Array | number[])[]): Uint8Array => {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};
const i32 = (v: number) => { const b = new Uint8Array(4); new DataView(b.buffer).setInt32(0, v); return b; };
const i16 = (v: number) => { const b = new Uint8Array(2); new DataView(b.buffer).setInt16(0, v); return b; };
const cstr = (s: string) => u8(enc.encode(s), [0]);

/** Typed frontend message: type byte, int32 length (counts itself, not the type byte), body. */
export const typed = (type: string, body: Uint8Array = new Uint8Array(0)): Uint8Array =>
  u8([type.charCodeAt(0)], i32(body.length + 4), body);

export const startup = (params: Record<string, string>, protocol = 196608): Uint8Array => {
  const body = u8(i32(protocol), ...Object.entries(params).flatMap(([k, v]) => [cstr(k), cstr(v)]), [0]);
  return u8(i32(body.length + 4), body);
};
export const sslRequest = (): Uint8Array => u8(i32(8), i32(80877103));

export const parse = (name: string, sql: string, oids: number[] = []): Uint8Array =>
  typed('P', u8(cstr(name), cstr(sql), i16(oids.length), ...oids.map(i32)));

/** Text-format parameters; null is SQL NULL. Result format codes default to none (all text). */
export const bind = (portal: string, stmt: string, params: (string | null)[] = [], resultFormats: number[] = []): Uint8Array =>
  typed('B', u8(
    cstr(portal), cstr(stmt),
    i16(0), // no parameter format codes: all text
    i16(params.length),
    ...params.map((p) => (p === null ? i32(-1) : u8(i32(enc.encode(p).length), enc.encode(p)))),
    i16(resultFormats.length), ...resultFormats.map(i16),
  ));

export const describe = (kind: 'S' | 'P', name: string): Uint8Array => typed('D', u8([kind.charCodeAt(0)], cstr(name)));
export const execute = (portal: string, maxRows = 0): Uint8Array => typed('E', u8(cstr(portal), i32(maxRows)));
export const closeMsg = (kind: 'S' | 'P', name: string): Uint8Array => typed('C', u8([kind.charCodeAt(0)], cstr(name)));
export const sync = (): Uint8Array => typed('S');
export const flushMsg = (): Uint8Array => typed('H');
export const query = (sql: string): Uint8Array => typed('Q', cstr(sql));
export const terminate = (): Uint8Array => typed('X');
export const passwordMsg = (body: Uint8Array): Uint8Array => typed('p', body);
export const saslInitial = (mech: string, first: Uint8Array): Uint8Array => typed('p', u8(cstr(mech), i32(first.length), first));

export interface BackendMessage { type: string; body: Uint8Array }

/** Incremental framing parser for the server-to-client direction after startup. */
export class MessageReader {
  private buf: Uint8Array = new Uint8Array(0);
  push(chunk: Uint8Array): BackendMessage[] {
    this.buf = this.buf.length ? u8(this.buf, chunk) : chunk;
    const out: BackendMessage[] = [];
    for (;;) {
      if (this.buf.length < 5) break;
      const len = new DataView(this.buf.buffer, this.buf.byteOffset + 1, 4).getInt32(0);
      if (this.buf.length < 1 + len) break;
      out.push({ type: String.fromCharCode(this.buf[0]!), body: this.buf.slice(5, 1 + len) });
      this.buf = this.buf.slice(1 + len);
    }
    return out;
  }
}

export const readCString = (b: Uint8Array, off: number): [string, number] => {
  let e = off;
  while (e < b.length && b[e] !== 0) e++;
  return [dec.decode(b.subarray(off, e)), e + 1];
};

export interface PgError { severity?: string; code?: string; message?: string; detail?: string; hint?: string; routine?: string; fields: Record<string, string> }
export const decodeError = (body: Uint8Array): PgError => {
  const fields: Record<string, string> = {};
  let o = 0;
  while (o < body.length && body[o] !== 0) {
    const k = String.fromCharCode(body[o]!);
    const [v, n] = readCString(body, o + 1);
    fields[k] = v;
    o = n;
  }
  return { severity: fields.S, code: fields.C, message: fields.M, detail: fields.D, hint: fields.H, routine: fields.R, fields };
};

export const decodeParameterStatus = (body: Uint8Array): [string, string] => {
  const [k, o] = readCString(body, 0);
  const [v] = readCString(body, o);
  return [k, v];
};

/** Text-format DataRow to strings (null for SQL NULL). */
export const decodeDataRow = (body: Uint8Array): (string | null)[] => {
  const dv = new DataView(body.buffer, body.byteOffset, body.byteLength);
  const n = dv.getInt16(0);
  const out: (string | null)[] = [];
  let o = 2;
  for (let i = 0; i < n; i++) {
    const len = dv.getInt32(o); o += 4;
    if (len === -1) out.push(null);
    else { out.push(dec.decode(body.subarray(o, o + len))); o += len; }
  }
  return out;
};

export const decodeRowDescription = (body: Uint8Array): { name: string; oid: number; format: number }[] => {
  const dv = new DataView(body.buffer, body.byteOffset, body.byteLength);
  const n = dv.getInt16(0);
  let o = 2;
  const cols: { name: string; oid: number; format: number }[] = [];
  for (let i = 0; i < n; i++) {
    const [name, next] = readCString(body, o);
    o = next;
    const oid = dv.getInt32(o + 6);
    const format = dv.getInt16(o + 16);
    o += 18;
    cols.push({ name, oid, format });
  }
  return cols;
};

export const hex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
export const text = (b: Uint8Array): string => dec.decode(b);
export const bytes = (s: string): Uint8Array => enc.encode(s);
