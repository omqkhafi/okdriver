import {
  ByteWriter,
  type ColumnMeta,
  type CoreCommand,
  type CoreEvent,
  type EncodedParam,
  type ObservedTx,
  type RawResult,
  type WireCore,
  type Writer,
} from "../../platform/contracts/index.ts";

export interface MyServerError {
  readonly kind: "server";
  readonly errno: number;
  readonly sqlState: string;
  readonly message: string;
}
export interface MyUnsupportedAuth {
  readonly kind: "unsupported-auth";
  readonly detail: string;
}

/** Bits packed into ColumnMeta.flags: column flags (16), charset (bits 16-23), binary-protocol marker (bit 24). */
export const FLAG_BINARY_PROTOCOL = 1 << 24;
export const COLUMN_UNSIGNED = 0x20;
export const CHARSET_BINARY = 63;

// client capability flags
const CLIENT_LONG_PASSWORD = 0x1;
const CLIENT_CONNECT_WITH_DB = 0x8;
const CLIENT_PROTOCOL_41 = 0x200;
const CLIENT_TRANSACTIONS = 0x2000;
const CLIENT_SECURE_CONNECTION = 0x8000;
const CLIENT_MULTI_RESULTS = 0x20000;
const CLIENT_PS_MULTI_RESULTS = 0x40000;
const CLIENT_PLUGIN_AUTH = 0x80000;

const SERVER_STATUS_IN_TRANS = 0x1;
const EMPTY: readonly CoreEvent[] = Object.freeze([]);
const EMPTY_BYTES = new Uint8Array(0);
const dec = new TextDecoder();

type Stage =
  | "greeting" | "auth" | "idle"
  | "q-head" | "q-cols" | "q-cols-eof" | "q-rows"
  | "p-head" | "p-params" | "p-params-eof" | "p-cols" | "p-cols-eof"
  | "ping";

interface Cmd {
  id: number;
  sql: string;
  params: readonly EncodedParam[];
}

function txOf(status: number): ObservedTx {
  return status & SERVER_STATUS_IN_TRANS ? "in-tx" : "idle";
}

/**
 * MySQL and MariaDB client protocol (protocol 10, 4.1 framing). Sans-IO. Statements without
 * parameters go over COM_QUERY; statements with parameters go over COM_STMT_PREPARE / EXECUTE
 * (binary protocol), so values never appear in SQL text.
 */
export class MysqlFamilyCore implements WireCore {
  phase: WireCore["phase"] = "startup";
  private stage: Stage = "greeting";
  private pending: Uint8Array = EMPTY_BYTES;
  private user = "";
  private database = "";
  private version = "";
  private authPlugin = "";
  private serverCaps = 0;
  private connectionId = 0;
  private lastTx: ObservedTx = "unknown";
  private cur: Cmd | undefined;
  private queued: Cmd[] = [];
  // current response state
  private stmtId = 0;
  private stmtOpen = false;
  private numParams = 0;
  private numCols = 0;
  private remaining = 0;
  private columns: ColumnMeta[] = [];
  private rows: unknown[][] = [];
  private binaryRows = false;
  private affected: number | null = null;
  private heldError: MyServerError | undefined;

  get inFlight(): number {
    return (this.cur === undefined ? 0 : 1) + this.queued.length;
  }

  // ------------------------------------------------------------------ encode
  encode(cmd: CoreCommand, w: Writer): void {
    switch (cmd.kind) {
      case "startup":
        this.user = cmd.user;
        this.database = cmd.database;
        return; // the server speaks first; the reply is sent from receive()
      case "query": {
        const c: Cmd = { id: cmd.id, sql: cmd.sql, params: cmd.params };
        if (this.cur !== undefined || this.stage !== "idle") this.queued.push(c);
        else this.begin(c, w);
        return;
      }
      case "terminate": {
        packet(w, 0, () => w.u8(0x01));
        this.phase = "closed";
        return;
      }
    }
  }

  private begin(c: Cmd, w: Writer): void {
    this.cur = c;
    this.phase = "busy";
    this.columns = [];
    this.rows = [];
    this.affected = null;
    if (c.params.length === 0) {
      packet(w, 0, () => {
        w.u8(0x03);
        w.utf8(c.sql);
      });
      this.binaryRows = false;
      this.stage = "q-head";
    } else {
      packet(w, 0, () => {
        w.u8(0x16);
        w.utf8(c.sql);
      });
      this.stage = "p-head";
    }
  }

  private execute(c: Cmd, w: Writer): void {
    const n = c.params.length;
    packet(w, 0, () => {
      w.u8(0x17);
      w.u32le(this.stmtId);
      w.u8(0); // no cursor
      w.u32le(1); // iteration count
      if (n > 0) {
        const bitmapAt = w.length;
        const bytes = (n + 7) >> 3;
        for (let i = 0; i < bytes; i++) w.u8(0);
        w.u8(1); // new parameters bound
        for (let i = 0; i < n; i++) {
          const tag = c.params[i]!.tag as number;
          w.u8(tag & 0xff);
          w.u8(tag & 0x8000 ? 0x80 : 0); // unsigned flag
        }
        for (let i = 0; i < n; i++) {
          const d = c.params[i]!.data;
          if (d === null) {
            (w as ByteWriter).buf[bitmapAt + (i >> 3)]! |= 1 << (i & 7);
          } else if (d instanceof Uint8Array) {
            const tag = (c.params[i]!.tag as number) & 0xff;
            if (tag === 253 || tag === 252) lenenc(w, d.length);
            w.bytes(d);
          } else throw new TypeError("MySQL parameter data must be bytes or null");
        }
      }
    });
    this.binaryRows = true;
    this.stage = "q-head";
  }

  // ----------------------------------------------------------------- receive
  receive(buf: Uint8Array, len: number): readonly CoreEvent[] {
    let data: Uint8Array;
    if (this.pending.length > 0) {
      data = new Uint8Array(this.pending.length + len);
      data.set(this.pending);
      data.set(buf.subarray(0, len), this.pending.length);
    } else data = len === buf.length ? buf : buf.subarray(0, len);
    let off = 0;
    const out: CoreEvent[] = [];
    while (data.length - off >= 4) {
      const plen = data[off]! | (data[off + 1]! << 8) | (data[off + 2]! << 16);
      if (data.length - off - 4 < plen) break;
      const seq = data[off + 3]!;
      this.packet(data.subarray(off + 4, off + 4 + plen), seq, out);
      off += 4 + plen;
    }
    this.pending = off < data.length ? data.slice(off) : EMPTY_BYTES;
    return out.length === 0 ? EMPTY : out;
  }

  private packet(p: Uint8Array, seq: number, out: CoreEvent[]): void {
    switch (this.stage) {
      case "greeting":
        return this.onGreeting(p, out);
      case "auth":
        return this.onAuth(p, seq, out);
      case "idle":
        return; // unsolicited bytes
      case "ping": {
        // OK to COM_PING: its status flags are the server's own word about the transaction.
        const tx = p[0] === 0x00 ? txOf(u16(p, readLenencEnd(p, readLenencEnd(p, 1)))) : this.lastTx;
        this.lastTx = tx;
        const err = this.heldError;
        this.heldError = undefined;
        this.finish(out, { kind: "error", id: this.cur!.id, error: err, observedTx: tx });
        return;
      }
      case "p-head": {
        if (p[0] === 0xff) return this.onError(p, out);
        this.stmtId = u32(p, 1);
        this.stmtOpen = true;
        this.numCols = u16(p, 5);
        this.numParams = u16(p, 7);
        this.remaining = this.numParams;
        if (this.numParams > 0) this.stage = "p-params";
        else if (this.numCols > 0) {
          this.remaining = this.numCols;
          this.stage = "p-cols";
        } else this.sendExecute(out);
        return;
      }
      case "p-params":
        if (--this.remaining === 0) this.stage = "p-params-eof";
        return;
      case "p-params-eof":
        if (this.numCols > 0) {
          this.remaining = this.numCols;
          this.stage = "p-cols";
        } else this.sendExecute(out);
        return;
      case "p-cols":
        if (--this.remaining === 0) this.stage = "p-cols-eof";
        return;
      case "p-cols-eof":
        this.sendExecute(out);
        return;
      case "q-head": {
        const h = p[0]!;
        if (h === 0xff) return this.onError(p, out);
        if (h === 0x00) {
          // OK: affected rows, last insert id, status flags
          let q = 1;
          const a = readLenenc(p, q);
          this.affected = a.v;
          q = a.p;
          q = readLenencEnd(p, q);
          const tx = txOf(u16(p, q));
          this.lastTx = tx;
          this.closeStatement(out);
          this.finish(out, this.resultEvent(tx));
          return;
        }
        this.numCols = readLenenc(p, 0).v;
        this.remaining = this.numCols;
        this.columns = [];
        this.stage = "q-cols";
        return;
      }
      case "q-cols":
        this.columns.push(parseColumn(p, this.binaryRows));
        if (--this.remaining === 0) this.stage = "q-cols-eof";
        return;
      case "q-cols-eof":
        this.stage = "q-rows";
        return;
      case "q-rows": {
        if (p[0] === 0xff) return this.onError(p, out);
        if (p[0] === 0xfe && p.length < 9) {
          const tx = txOf(u16(p, 3));
          this.lastTx = tx;
          this.closeStatement(out);
          this.finish(out, this.resultEvent(tx));
          return;
        }
        this.rows.push(this.binaryRows ? parseBinaryRow(p, this.columns) : parseTextRow(p, this.columns.length));
        return;
      }
    }
  }

  private sendExecute(out: CoreEvent[]): void {
    const w = new ByteWriter(128);
    this.execute(this.cur!, w);
    out.push({ kind: "send", bytes: w.take() });
  }

  private closeStatement(out: CoreEvent[]): void {
    if (!this.stmtOpen) return;
    this.stmtOpen = false;
    const w = new ByteWriter(16);
    packet(w, 0, () => {
      w.u8(0x19);
      w.u32le(this.stmtId);
    });
    out.push({ kind: "send", bytes: w.take() });
  }

  private resultEvent(tx: ObservedTx): CoreEvent {
    const result: RawResult = { columns: this.columns, rows: this.rows, affectedRows: this.columns.length > 0 ? this.rows.length : this.affected, tag: this.columns.length > 0 ? "SELECT" : "OK" };
    return { kind: "result", id: this.cur!.id, result, observedTx: tx };
  }

  private finish(out: CoreEvent[], ev: CoreEvent): void {
    out.push(ev);
    this.cur = undefined;
    this.stage = "idle";
    this.phase = "ready";
    this.columns = [];
    this.rows = [];
    const next = this.queued.shift();
    if (next !== undefined) {
      const w = new ByteWriter(128);
      this.begin(next, w);
      out.push({ kind: "send", bytes: w.take() });
    }
  }

  private onError(p: Uint8Array, out: CoreEvent[]): void {
    const errno = u16(p, 1);
    let q = 3;
    let sqlState = "";
    if (p[q] === 0x23) {
      sqlState = dec.decode(p.subarray(q + 1, q + 6));
      q += 6;
    }
    const err: MyServerError = { kind: "server", errno, sqlState, message: dec.decode(p.subarray(q)) };
    this.closeStatement(out); // a failed EXECUTE leaves the prepared statement open on the server; a failed PREPARE leaves none
    // An ERR packet carries no transaction status. Ask the server with COM_PING.
    this.heldError = err;
    this.stage = "ping";
    const w = new ByteWriter(8);
    packet(w, 0, () => w.u8(0x0e));
    out.push({ kind: "send", bytes: w.take() });
  }

  // ---------------------------------------------------------------- startup
  private onGreeting(p: Uint8Array, out: CoreEvent[]): void {
    if (p[0] === 0xff) {
      const errno = u16(p, 1);
      this.phase = "failed";
      out.push({ kind: "error", id: null, error: { kind: "server", errno, sqlState: "", message: dec.decode(p.subarray(3)) } satisfies MyServerError, observedTx: "unknown" });
      return;
    }
    let q = 1;
    let z = p.indexOf(0, q);
    this.version = dec.decode(p.subarray(q, z));
    q = z + 1;
    this.connectionId = u32(p, q);
    q += 4;
    const seed1 = p.slice(q, q + 8);
    q += 9; // 8 bytes + filler
    let caps = u16(p, q);
    q += 2;
    q += 1; // charset
    q += 2; // status
    caps |= u16(p, q) << 16;
    q += 2;
    this.serverCaps = caps >>> 0;
    const authLen = p[q]!;
    q += 1 + 10;
    const seed2Len = Math.max(13, authLen - 8);
    const seed2 = p.slice(q, q + seed2Len);
    q += seed2Len;
    z = p.indexOf(0, q);
    this.authPlugin = dec.decode(p.subarray(q, z < 0 ? p.length : z));
    void seed1;
    void seed2;
    // Reply. Only the empty-password case is implemented (trust / empty root): no scramble is computed.
    const flags = CLIENT_LONG_PASSWORD | CLIENT_CONNECT_WITH_DB | CLIENT_PROTOCOL_41 | CLIENT_TRANSACTIONS | CLIENT_SECURE_CONNECTION | CLIENT_MULTI_RESULTS | CLIENT_PS_MULTI_RESULTS | CLIENT_PLUGIN_AUTH;
    const w = new ByteWriter(128);
    packet(w, 1, () => {
      w.u32le(flags);
      w.u32le(0x01000000);
      w.u8(45); // utf8mb4_general_ci
      for (let i = 0; i < 23; i++) w.u8(0);
      w.cstr(this.user);
      w.u8(0); // empty auth response
      w.cstr(this.database);
      w.cstr(this.authPlugin);
    });
    out.push({ kind: "send", bytes: w.take() });
    this.stage = "auth";
  }

  private onAuth(p: Uint8Array, seq: number, out: CoreEvent[]): void {
    const h = p[0]!;
    if (h === 0x00) {
      this.lastTx = txOf(u16(p, readLenencEnd(p, readLenencEnd(p, 1))));
      this.stage = "idle";
      this.phase = "ready";
      out.push({
        kind: "ready",
        facts: {
          version: this.version,
          params: { authPlugin: this.authPlugin, serverCapabilities: String(this.serverCaps), connectionId: String(this.connectionId) },
          observedTx: this.lastTx,
        },
      });
      const next = this.queued.shift();
      if (next !== undefined) {
        const w = new ByteWriter(128);
        this.begin(next, w);
        out.push({ kind: "send", bytes: w.take() });
      }
      return;
    }
    if (h === 0xff) {
      this.phase = "failed";
      const errno = u16(p, 1);
      const hasState = p[3] === 0x23;
      out.push({
        kind: "error",
        id: null,
        error: { kind: "server", errno, sqlState: hasState ? dec.decode(p.subarray(4, 9)) : "", message: dec.decode(p.subarray(hasState ? 9 : 3)) } satisfies MyServerError,
        observedTx: "unknown",
      });
      return;
    }
    if (h === 0xfe) {
      // AuthSwitchRequest: with an empty password the answer is an empty packet.
      const w = new ByteWriter(8);
      packet(w, (seq + 1) & 0xff, () => {});
      out.push({ kind: "send", bytes: w.take() });
      return;
    }
    if (h === 0x01 && p[1] === 0x03) return; // caching_sha2_password fast-auth success; OK follows
    this.phase = "failed";
    out.push({ kind: "error", id: null, error: { kind: "unsupported-auth", detail: `auth packet 0x${h.toString(16)} (plugin ${this.authPlugin})` } satisfies MyUnsupportedAuth, observedTx: "unknown" });
  }
}

// ------------------------------------------------------------------- helpers
function packet(w: Writer, seq: number, body: () => void): void {
  const at = w.length;
  w.u24le(0);
  w.u8(seq);
  body();
  w.patchU24le(at, w.length - at - 4);
}
function lenenc(w: Writer, n: number): void {
  if (n < 251) w.u8(n);
  else if (n < 65536) {
    w.u8(0xfc);
    w.u16le(n);
  } else if (n < 16777216) {
    w.u8(0xfd);
    w.u24le(n);
  } else {
    w.u8(0xfe);
    w.u64le(BigInt(n));
  }
}
const u16 = (p: Uint8Array, o: number): number => p[o]! | (p[o + 1]! << 8);
const u32 = (p: Uint8Array, o: number): number => (p[o]! | (p[o + 1]! << 8) | (p[o + 2]! << 16) | (p[o + 3]! << 24)) >>> 0;
function readLenenc(p: Uint8Array, o: number): { v: number; p: number } {
  const b = p[o]!;
  if (b < 0xfb) return { v: b, p: o + 1 };
  if (b === 0xfc) return { v: u16(p, o + 1), p: o + 3 };
  if (b === 0xfd) return { v: p[o + 1]! | (p[o + 2]! << 8) | (p[o + 3]! << 16), p: o + 4 };
  if (b === 0xfe) return { v: u32(p, o + 1) + u32(p, o + 5) * 2 ** 32, p: o + 9 };
  return { v: -1, p: o + 1 }; // 0xfb: NULL
}
function readLenencEnd(p: Uint8Array, o: number): number {
  return readLenenc(p, o).p;
}
function readLenencBytes(p: Uint8Array, o: number): { b: Uint8Array | null; p: number } {
  const l = readLenenc(p, o);
  if (l.v < 0) return { b: null, p: l.p };
  return { b: p.slice(l.p, l.p + l.v), p: l.p + l.v };
}

function parseColumn(p: Uint8Array, binary: boolean): ColumnMeta {
  let q = 0;
  let name = "";
  for (let i = 0; i < 6; i++) {
    const l = readLenenc(p, q);
    if (i === 4) name = dec.decode(p.subarray(l.p, l.p + l.v));
    q = l.p + l.v;
  }
  q += 1; // length of fixed fields (0x0c)
  const charset = u16(p, q);
  const type = p[q + 6]!;
  const flags = u16(p, q + 7);
  return { name, type, flags: flags | ((charset & 0xff) << 16) | (binary ? FLAG_BINARY_PROTOCOL : 0) };
}

function parseTextRow(p: Uint8Array, n: number): unknown[] {
  const row: unknown[] = new Array(n);
  let q = 0;
  for (let i = 0; i < n; i++) {
    const r = readLenencBytes(p, q);
    row[i] = r.b;
    q = r.p;
  }
  return row;
}

const FIXED: Record<number, number> = { 1: 1, 2: 2, 13: 2, 3: 4, 9: 4, 8: 8, 4: 4, 5: 8 };
const LENGTH_BYTE_TYPES = new Set([7, 10, 11, 12]); // timestamp, date, time, datetime

function parseBinaryRow(p: Uint8Array, cols: readonly ColumnMeta[]): unknown[] {
  const n = cols.length;
  const bitmap = (n + 7 + 2) >> 3;
  const row: unknown[] = new Array(n);
  let q = 1 + bitmap;
  for (let i = 0; i < n; i++) {
    const bit = i + 2;
    if (p[1 + (bit >> 3)]! & (1 << (bit & 7))) {
      row[i] = null;
      continue;
    }
    const t = cols[i]!.type as number;
    const fixed = FIXED[t];
    if (fixed !== undefined) {
      row[i] = p.slice(q, q + fixed);
      q += fixed;
    } else if (LENGTH_BYTE_TYPES.has(t)) {
      const l = p[q]!;
      row[i] = p.slice(q + 1, q + 1 + l);
      q += 1 + l;
    } else {
      const r = readLenencBytes(p, q);
      row[i] = r.b;
      q = r.p;
    }
  }
  return row;
}
