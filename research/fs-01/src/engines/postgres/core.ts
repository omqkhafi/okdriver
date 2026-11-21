import {
  type ColumnMeta,
  type CoreCommand,
  type CoreEvent,
  type ObservedTx,
  type RawResult,
  type WireCore,
  type Writer,
} from "../../platform/contracts/index.ts";

export interface PgServerError {
  readonly kind: "server";
  readonly severity: string;
  readonly code: string;
  readonly message: string;
  readonly detail: string | undefined;
}
export interface PgUnsupportedAuth {
  readonly kind: "unsupported-auth";
  readonly authCode: number;
}

const EMPTY: readonly CoreEvent[] = Object.freeze([]);
const dec = new TextDecoder();

function txOf(b: number): ObservedTx {
  return b === 0x49 /* I */ ? "idle" : b === 0x54 /* T */ ? "in-tx" : b === 0x45 /* E */ ? "failed" : "unknown";
}

/** PostgreSQL protocol 3.0, extended query only. Sans-IO. */
export class PgCore implements WireCore {
  phase: WireCore["phase"] = "startup";
  private queue: number[] = [];
  private pending: Uint8Array = new Uint8Array(0);
  private params: Record<string, string> = {};
  private columns: ColumnMeta[] = [];
  private rows: (Uint8Array | null)[][] = [];
  private tag = "";
  private err: PgServerError | undefined;

  get inFlight(): number {
    return this.queue.length;
  }

  encode(cmd: CoreCommand, w: Writer): void {
    switch (cmd.kind) {
      case "startup": {
        const at = w.length;
        w.u32be(0);
        w.u32be(196608);
        w.cstr("user");
        w.cstr(cmd.user);
        w.cstr("database");
        w.cstr(cmd.database);
        w.cstr("client_encoding");
        w.cstr("UTF8");
        w.u8(0);
        w.patchU32be(at, w.length - at);
        return;
      }
      case "query": {
        this.queue.push(cmd.id);
        if (this.phase === "ready") this.phase = "busy";
        // Parse: unnamed statement, the server decides parameter types (ADR 015).
        let at = w.length;
        w.u8(0x50); // P
        w.u32be(0);
        w.u8(0); // statement name ""
        w.cstr(cmd.sql);
        w.u16be(0);
        w.patchU32be(at + 1, w.length - at - 1);
        // Bind: per-parameter format codes, then values, then result format text.
        at = w.length;
        w.u8(0x42); // B
        w.u32be(0);
        w.u8(0); // portal ""
        w.u8(0); // statement ""
        const n = cmd.params.length;
        w.u16be(n);
        for (let i = 0; i < n; i++) w.u16be(cmd.params[i]!.tag as number);
        w.u16be(n);
        for (let i = 0; i < n; i++) {
          const d = cmd.params[i]!.data;
          if (d === null) w.u32be(0xffffffff);
          else if (typeof d === "string") {
            const lenAt = w.length;
            w.u32be(0);
            const written = w.utf8(d);
            w.patchU32be(lenAt, written);
          } else if (d instanceof Uint8Array) {
            w.u32be(d.length);
            w.bytes(d);
          } else throw new TypeError("PostgreSQL parameter data must be string, bytes or null");
        }
        w.u16be(1);
        w.u16be(0);
        w.patchU32be(at + 1, w.length - at - 1);
        // Describe portal.
        w.u8(0x44);
        w.u32be(6);
        w.u8(0x50);
        w.u8(0);
        // Execute, no row limit.
        w.u8(0x45);
        w.u32be(9);
        w.u8(0);
        w.u32be(0);
        // Sync.
        w.u8(0x53);
        w.u32be(4);
        return;
      }
      case "terminate":
        w.u8(0x58);
        w.u32be(4);
        this.phase = "closed";
        return;
    }
  }

  receive(buf: Uint8Array, len: number): readonly CoreEvent[] {
    let data: Uint8Array;
    if (this.pending.length > 0) {
      data = new Uint8Array(this.pending.length + len);
      data.set(this.pending);
      data.set(buf.subarray(0, len), this.pending.length);
    } else data = len === buf.length ? buf : buf.subarray(0, len);
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    let off = 0;
    let out: CoreEvent[] | undefined;
    while (data.length - off >= 5) {
      const mlen = view.getUint32(off + 1);
      if (data.length - off - 1 < mlen) break;
      const type = data[off]!;
      const body = data.subarray(off + 5, off + 1 + mlen);
      const ev = this.message(type, body);
      if (ev !== undefined) (out ??= []).push(ev);
      off += 1 + mlen;
    }
    this.pending = off < data.length ? data.slice(off) : EMPTY_BYTES;
    return out ?? EMPTY;
  }

  private message(type: number, b: Uint8Array): CoreEvent | undefined {
    switch (type) {
      case 0x52: { // R authentication
        const code = new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(0);
        if (code === 0) return undefined;
        this.phase = "failed";
        return { kind: "error", id: null, error: { kind: "unsupported-auth", authCode: code } satisfies PgUnsupportedAuth, observedTx: "unknown" };
      }
      case 0x53: { // S ParameterStatus
        const z = b.indexOf(0);
        this.params[dec.decode(b.subarray(0, z))] = dec.decode(b.subarray(z + 1, b.length - 1));
        return undefined;
      }
      case 0x54: { // T RowDescription
        const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
        const n = v.getUint16(0);
        let p = 2;
        const cols: ColumnMeta[] = new Array(n);
        for (let i = 0; i < n; i++) {
          const z = b.indexOf(0, p);
          const name = dec.decode(b.subarray(p, z));
          p = z + 1;
          const oid = v.getUint32(p + 6);
          p += 18;
          cols[i] = { name, type: oid, flags: 0 };
        }
        this.columns = cols;
        return undefined;
      }
      case 0x44: { // D DataRow
        const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
        const n = v.getUint16(0);
        let p = 2;
        const row: (Uint8Array | null)[] = new Array(n);
        for (let i = 0; i < n; i++) {
          const l = v.getInt32(p);
          p += 4;
          if (l < 0) row[i] = null;
          else {
            row[i] = b.slice(p, p + l);
            p += l;
          }
        }
        this.rows.push(row);
        return undefined;
      }
      case 0x43: // C CommandComplete
        this.tag = dec.decode(b.subarray(0, b.length - 1));
        return undefined;
      case 0x45: { // E ErrorResponse
        const f = parseFields(b);
        this.err = { kind: "server", severity: f.S ?? "", code: f.C ?? "", message: f.M ?? "", detail: f.D };
        if (this.phase === "startup") {
          this.phase = "failed";
          return { kind: "error", id: null, error: this.err, observedTx: "unknown" };
        }
        return undefined;
      }
      case 0x5a: { // Z ReadyForQuery
        const tx = txOf(b[0]!);
        if (this.phase === "startup") {
          this.phase = "ready";
          return {
            kind: "ready",
            facts: { version: this.params.server_version ?? "", params: this.params, observedTx: tx },
          };
        }
        const id = this.queue.shift();
        if (this.queue.length === 0 && this.phase === "busy") this.phase = "ready";
        const err = this.err;
        const result: RawResult = { columns: this.columns, rows: this.rows, affectedRows: affected(this.tag), tag: this.tag };
        this.err = undefined;
        this.columns = [];
        this.rows = [];
        this.tag = "";
        if (id === undefined) return undefined;
        if (err !== undefined) return { kind: "error", id, error: err, observedTx: tx };
        return { kind: "result", id, result, observedTx: tx };
      }
      default: // 1 2 3 t n N K I s and anything else the skeleton does not need
        return undefined;
    }
  }
}

const EMPTY_BYTES = new Uint8Array(0);

function parseFields(b: Uint8Array): Record<string, string> {
  const out: Record<string, string> = {};
  let p = 0;
  while (p < b.length && b[p] !== 0) {
    const code = String.fromCharCode(b[p]!);
    const z = b.indexOf(0, p + 1);
    out[code] = dec.decode(b.subarray(p + 1, z));
    p = z + 1;
  }
  return out;
}

function affected(tag: string): number | null {
  const m = /^(?:INSERT \d+|UPDATE|DELETE|SELECT|MERGE|MOVE|FETCH|COPY) (\d+)$/.exec(tag);
  return m === null ? null : Number(m[1]);
}
