// FS-03 sans-IO PostgreSQL message core. The same file serves every candidate; it never touches a socket.
//
// Copied and adapted from research/fs-06 at commit 5930580cd61a7bf5e03ab0f77f7c2f2320bf1d8d:
//   scripts/lib/wire.ts   (message encoders, ErrorResponse decoding)
//   scripts/lib/scram.ts  (SCRAM-SHA-256 client)
//   scripts/lib/client.ts (login sequence)
// The framing decoder is new: it is written for the lifetime question. A complete message inside a delivered chunk is handed to
// the sink as a view of that chunk, valid only during the call; a partial message is copied once into its own buffer.
// Nothing the core keeps points into a delivered chunk.
import { createHash, createHmac, pbkdf2Sync, randomBytes, timingSafeEqual } from 'node:crypto';

const enc = new TextEncoder();
const dec = new TextDecoder('utf-8');
const EMPTY = new Uint8Array(0);

// ---------- encoders ----------
const u8 = (...parts: (Uint8Array | number[])[]): Uint8Array => {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};
const i32 = (v: number): Uint8Array => { const b = new Uint8Array(4); new DataView(b.buffer).setInt32(0, v); return b; };
const i16 = (v: number): Uint8Array => { const b = new Uint8Array(2); new DataView(b.buffer).setInt16(0, v); return b; };
const cstr = (s: string): Uint8Array => u8(enc.encode(s), [0]);
export const typed = (type: string, body: Uint8Array = EMPTY): Uint8Array => u8([type.charCodeAt(0)], i32(body.length + 4), body);
export const startupMessage = (params: Record<string, string>): Uint8Array => {
  const body = u8(i32(196608), ...Object.entries(params).flatMap(([k, v]) => [cstr(k), cstr(v)]), [0]);
  return u8(i32(body.length + 4), body);
};
export const sslRequestMessage = (): Uint8Array => u8(i32(8), i32(80877103));

// ---------- SCRAM-SHA-256 (fs-06 scram.ts, no channel binding) ----------
const hmac = (k: Buffer, d: string | Buffer): Buffer => createHmac('sha256', k).update(d).digest();
const sha256 = (d: Buffer): Buffer => createHash('sha256').update(d).digest();
class ScramClient {
  nonce = randomBytes(18).toString('base64');
  clientFirstBare = '';
  serverSignature: Buffer | null = null;
  password: string;
  constructor(password: string) { this.password = password; }
  first(): string { this.clientFirstBare = `n=,r=${this.nonce}`; return `n,,${this.clientFirstBare}`; }
  final(serverFirst: string): string {
    const a = Object.fromEntries(serverFirst.split(',').map((p) => [p[0]!, p.slice(2)]));
    const r = a.r!, s = Buffer.from(a.s!, 'base64'), i = parseInt(a.i!, 10);
    if (!r.startsWith(this.nonce)) throw new Error('SCRAM: server nonce does not extend client nonce');
    const salted = pbkdf2Sync(this.password, s, i, 32, 'sha256');
    const clientKey = hmac(salted, 'Client Key');
    const storedKey = sha256(clientKey);
    const withoutProof = `c=biws,r=${r}`;
    const authMessage = `${this.clientFirstBare},${serverFirst},${withoutProof}`;
    const sig = hmac(storedKey, authMessage);
    const proof = Buffer.from(clientKey.map((b, idx) => b ^ sig[idx]!));
    this.serverSignature = hmac(hmac(salted, 'Server Key'), authMessage);
    return `${withoutProof},p=${proof.toString('base64')}`;
  }
  verify(serverFinal: string): void {
    const v = serverFinal.split(',').find((p) => p.startsWith('v='));
    if (!v || !this.serverSignature) throw new Error('SCRAM: no server signature');
    const got = Buffer.from(v.slice(2), 'base64');
    if (got.length !== this.serverSignature.length || !timingSafeEqual(got, this.serverSignature)) throw new Error('SCRAM: server signature mismatch');
  }
}

// ---------- framing ----------
export class ProtocolError extends Error {}
export type Sink = (type: number, payload: Uint8Array) => void;
const MAX_PAYLOAD = 1 << 30;

/** Incremental framing of server-to-client messages. `payload` passed to the sink is valid only during the call. */
export class FrameDecoder {
  private hdr = new Uint8Array(5);
  private hdrN = 0;
  private body: Uint8Array | null = null;
  private bodyN = 0;
  private bodyType = 0;
  /** true while a message is partly received */
  get midMessage(): boolean { return this.hdrN > 0 || this.body !== null; }

  push(chunk: Uint8Array, sink: Sink): void {
    let off = 0;
    const end = chunk.length;
    while (off < end) {
      if (this.body === null) {
        let type: number, plen: number;
        if (this.hdrN === 0 && end - off >= 5) {
          type = chunk[off]!;
          plen = new DataView(chunk.buffer, chunk.byteOffset + off + 1, 4).getInt32(0) - 4;
          off += 5;
        } else {
          while (this.hdrN < 5 && off < end) this.hdr[this.hdrN++] = chunk[off++]!;
          if (this.hdrN < 5) return;
          type = this.hdr[0]!;
          plen = new DataView(this.hdr.buffer, 1, 4).getInt32(0) - 4;
          this.hdrN = 0;
        }
        if (plen < 0 || plen > MAX_PAYLOAD) throw new ProtocolError(`bad message length ${plen + 4} for type ${type}`);
        if (end - off >= plen) { sink(type, chunk.subarray(off, off + plen)); off += plen; continue; }
        this.bodyType = type;
        this.body = new Uint8Array(plen);
        this.bodyN = 0;
      }
      const body = this.body;
      const take = Math.min(body.length - this.bodyN, end - off);
      body.set(chunk.subarray(off, off + take), this.bodyN);
      this.bodyN += take;
      off += take;
      if (this.bodyN === body.length) { this.body = null; sink(this.bodyType, body); }
    }
  }
}

// ---------- decoding helpers ----------
const cString = (b: Uint8Array, off: number): [string, number] => {
  let e = off;
  while (e < b.length && b[e] !== 0) e++;
  return [dec.decode(b.subarray(off, e)), e + 1];
};
export interface PgError { code: string; message: string; severity: string }
const decodeError = (body: Uint8Array): PgError => {
  const f: Record<string, string> = {};
  let o = 0;
  while (o < body.length && body[o] !== 0) { const k = String.fromCharCode(body[o]!); const [v, n] = cString(body, o + 1); f[k] = v; o = n; }
  return { code: f.C ?? '', message: f.M ?? '', severity: f.S ?? '' };
};
const decodeDataRow = (body: Uint8Array): (string | null)[] => {
  const dv = new DataView(body.buffer, body.byteOffset, body.byteLength);
  const n = dv.getInt16(0);
  const out: (string | null)[] = [];
  let o = 2;
  for (let i = 0; i < n; i++) {
    const len = dv.getInt32(o); o += 4;
    if (len === -1) out.push(null); else { out.push(dec.decode(body.subarray(o, o + len))); o += len; }
  }
  return out;
};

export interface StatementResult { id: number; rows: number; payloadBytes: number; tag: string; error: PgError | null; data: (string | null)[][] | null }
export interface CoreOptions { user: string; database: string; password?: string; collect?: boolean }
type Stage = 'init' | 'ssl' | 'startup' | 'auth' | 'ready' | 'closed';

const COPY_FRAME_PAYLOAD = 65531; // 'd' + int32 length + 65531 = 64 KiB per frame
/** 1 MiB of CopyData frames; immutable, shared by every write. */
const COPY_BLOCK = (() => {
  const frame = typed('d', new Uint8Array(COPY_FRAME_PAYLOAD).map((_, i) => (i * 31 + 7) & 0xff));
  const block = new Uint8Array(16 * frame.length);
  for (let i = 0; i < 16; i++) block.set(frame, i * frame.length);
  return block;
})();
export const COPY_BLOCK_BYTES = COPY_BLOCK.length;

/** The protocol core: bytes in, bytes out, callbacks for outcomes. */
export class PgCore {
  tap: Sink | null = null;
  onReady: (() => void) | null = null;
  onResult: ((r: StatementResult) => void) | null = null;
  onFail: ((e: Error) => void) | null = null;
  onCopyIn: (() => void) | null = null;
  stage: Stage = 'init';
  readonly params: Record<string, string> = {};
  private opts: CoreOptions;
  private out: Uint8Array[] = [];
  private frames = new FrameDecoder();
  private pending: StatementResult[] = [];
  private nextId = 1;
  private scram: ScramClient | null = null;
  private current: StatementResult | null = null;
  messagesSeen = 0;

  constructor(opts: CoreOptions) { this.opts = opts; }
  get inFlight(): number { return this.pending.length; }

  sslRequest(): void { this.stage = 'ssl'; this.out.push(sslRequestMessage()); }
  /** The one-byte answer to SSLRequest; returns true when the server accepts. Extra bytes after it are refused. */
  sslReply(chunk: Uint8Array): boolean {
    if (this.stage !== 'ssl') throw new ProtocolError('unexpected SSL reply');
    if (chunk.length !== 1) throw new ProtocolError(`SSLRequest reply carried ${chunk.length} bytes`);
    if (chunk[0] === 0x53) return true;
    if (chunk[0] === 0x4e) return false;
    throw new ProtocolError(`SSLRequest reply byte ${chunk[0]}`);
  }
  startup(): void {
    this.stage = 'startup';
    this.out.push(startupMessage({ user: this.opts.user, database: this.opts.database, client_encoding: 'UTF8', application_name: 'fs03' }));
  }

  /** Extended query in the ADR 014 shape: Parse(unnamed) Bind Describe(portal) Execute Sync, queued for one write. */
  execute(sql: string): number {
    this.out.push(u8(
      typed('P', u8(cstr(''), cstr(sql), i16(0))),
      typed('B', u8(cstr(''), cstr(''), i16(0), i16(0), i16(0))),
      typed('D', u8([0x50], cstr(''))),
      typed('E', u8(cstr(''), i32(0))),
      typed('S'),
    ));
    return this.enqueue();
  }
  simpleQuery(sql: string): number { this.out.push(typed('Q', cstr(sql))); return this.enqueue(); }
  private enqueue(): number {
    const r: StatementResult = { id: this.nextId++, rows: 0, payloadBytes: 0, tag: '', error: null, data: this.opts.collect ? [] : null };
    this.pending.push(r);
    return r.id;
  }
  copyBlock(): Uint8Array { return COPY_BLOCK; }
  copyDone(): void { this.out.push(typed('c')); }
  terminate(): void { this.out.push(typed('X')); }

  /** All output queued so far as one buffer, or null. */
  take(): Uint8Array | null {
    if (this.out.length === 0) return null;
    const b = this.out.length === 1 ? this.out[0]! : u8(...this.out);
    this.out = [];
    return b;
  }

  receive(chunk: Uint8Array): void {
    if (this.stage === 'closed') return;
    try { this.frames.push(chunk, (t, p) => this.message(t, p)); } catch (e) { this.fail(e instanceof Error ? e : new Error(String(e))); }
  }
  /** The transport reports the end of the connection. Pending statements fail; the failure callback fires once. */
  connectionLost(why: Error): void {
    if (this.stage === 'closed') return;
    this.fail(this.frames.midMessage ? new ProtocolError(`connection lost in the middle of a message: ${why.message}`) : why);
  }
  private fail(e: Error): void {
    if (this.stage === 'closed') return;
    this.stage = 'closed';
    this.pending = [];
    this.onFail?.(e);
  }

  private message(type: number, p: Uint8Array): void {
    this.messagesSeen++;
    this.tap?.(type, p);
    switch (type) {
      case 0x52: return this.authentication(p);
      case 0x53: { const [k, o] = cString(p, 0); const [v] = cString(p, o); this.params[k] = v; return; }
      case 0x45: { // ErrorResponse
        const err = decodeError(p);
        if (this.stage !== 'ready') return this.fail(new Error(`${err.code} ${err.message}`));
        if (this.pending[0]) this.pending[0].error = err;
        return;
      }
      case 0x5a: { // ReadyForQuery
        if (this.stage === 'auth' || this.stage === 'startup') { this.stage = 'ready'; this.onReady?.(); return; }
        const r = this.pending.shift();
        if (r) this.onResult?.(r);
        return;
      }
      case 0x44: { // DataRow
        const r = this.pending[0];
        if (r) { r.rows++; r.payloadBytes += p.length; if (r.data) r.data.push(decodeDataRow(p)); }
        return;
      }
      case 0x43: { const r = this.pending[0]; if (r) r.tag = cString(p, 0)[0]; return; }
      case 0x47: this.onCopyIn?.(); return; // CopyInResponse
      default: return; // ParseComplete, BindComplete, RowDescription, NoData, notices, key data: nothing to keep
    }
  }

  private authentication(p: Uint8Array): void {
    this.stage = 'auth';
    const code = new DataView(p.buffer, p.byteOffset, p.byteLength).getInt32(0);
    if (code === 0) return;
    if (code === 3) { this.out.push(typed('p', cstr(this.requirePassword()))); return; }
    if (code === 10) {
      const mechs: string[] = [];
      for (let o = 4; o < p.length && p[o] !== 0;) { const [m, n] = cString(p, o); mechs.push(m); o = n; }
      if (!mechs.includes('SCRAM-SHA-256')) throw new ProtocolError(`no supported SASL mechanism in ${mechs.join(',')}`);
      this.scram = new ScramClient(this.requirePassword());
      const first = enc.encode(this.scram.first());
      this.out.push(typed('p', u8(cstr('SCRAM-SHA-256'), i32(first.length), first)));
      return;
    }
    if (code === 11 && this.scram) { this.out.push(typed('p', enc.encode(this.scram.final(dec.decode(p.subarray(4)))))); return; }
    if (code === 12 && this.scram) { this.scram.verify(dec.decode(p.subarray(4))); return; }
    throw new ProtocolError(`unsupported authentication request ${code}`);
  }
  private requirePassword(): string {
    if (this.opts.password === undefined) throw new ProtocolError('the server asked for a password');
    return this.opts.password;
  }
}
