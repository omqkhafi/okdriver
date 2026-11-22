// A pipelined PostgreSQL connection for the study. Login reuses the FS-06 client (copied to lib/); after ReadyForQuery the
// socket is taken over by a writer that puts `Parse(unnamed) Bind Describe(portal) Execute Sync` for many statements into
// one write, and by a parser that turns each ReadyForQuery into one result (unique id, value, SQLSTATE).
import { PgConn } from './lib/client.ts';
import { K_CPU, K_ERR, K_FAST, K_LOCK, K_SLEEP, K_UNLOCK, type Result, type Stmt, type Transport } from '../core/pool.ts';

const SQL: Record<number, string> = {
  [K_FAST]: 'select $1::int8 as uid, v from kv where id = $2::int4',
  [K_SLEEP]: 'select $1::int8 as uid, $2::float8 as ms from pg_sleep($2::float8 / 1000.0)',
  [K_CPU]: 'select $1::int8 as uid, count(*) as c from generate_series(1, $2::int4)',
  [K_ERR]: 'select $1::int8 as uid, 1 / $2::int4 as x',
  [K_LOCK]: 'select $1::int8 as uid, $2::int8 as k from pg_advisory_lock($2::int8)',
  [K_UNLOCK]: 'select $1::int8 as uid, $2::int8 as k from pg_advisory_unlock($2::int8)',
};
/** The value a statement must return in its second column (the check of every result). */
export const expectedValue = (s: Pick<Stmt, 'kind' | 'arg'>): number => (s.kind === K_FAST ? s.arg * 3 + 1 : s.arg);

const pre: Record<number, Buffer> = {};
for (const k of Object.keys(SQL)) {
  const sql = Buffer.from(SQL[Number(k)]!, 'utf8');
  // Parse: 'P' len '\0'(unnamed) sql '\0' int16(0 parameter types)
  const len = 4 + 1 + sql.length + 1 + 2;
  const b = Buffer.alloc(1 + len);
  b[0] = 0x50; b.writeInt32BE(len, 1); b[5] = 0; sql.copy(b, 6); b[6 + sql.length] = 0; // trailing int16 stays 0
  pre[Number(k)] = b;
}
// Describe(portal "") + Execute(portal "", 0 rows) + Sync: constant tail after Bind.
const TAIL = Buffer.from([0x44, 0, 0, 0, 6, 0x50, 0, 0x45, 0, 0, 0, 9, 0, 0, 0, 0, 0, 0x53, 0, 0, 0, 4]);
const digits = (n: number): number => (n < 10 ? 1 : n < 100 ? 2 : n < 1000 ? 3 : n < 10000 ? 4 : n < 100000 ? 5 : n < 1000000 ? 6 : n < 10000000 ? 7 : String(n).length);

function writeAscii(buf: Buffer, off: number, n: number): number {
  const d = digits(n);
  let x = n;
  for (let i = d - 1; i >= 0; i--) { buf[off + i] = 48 + (x % 10); x = (x - (x % 10)) / 10; }
  return d;
}

/** Encodes statements back to back into one buffer (text parameters: uid, arg). */
export function encodeBatch(batch: Stmt[]): Buffer {
  let total = 0;
  for (const s of batch) total += pre[s.kind]!.length + (1 + 4 + 1 + 1 + 2 + 2 + 4 + digits(s.uid) + 4 + digits(s.arg) + 2) + TAIL.length;
  const out = Buffer.allocUnsafe(total);
  let o = 0;
  for (const s of batch) {
    const p = pre[s.kind]!; p.copy(out, o); o += p.length;
    const du = digits(s.uid), da = digits(s.arg);
    const blen = 4 + 1 + 1 + 2 + 2 + 4 + du + 4 + da + 2; // portal\0 stmt\0 nfmt(2) nparams(2) [len+uid] [len+arg] nres(2)
    out[o++] = 0x42; out.writeInt32BE(blen, o); o += 4;
    out[o++] = 0; out[o++] = 0;
    out.writeInt16BE(0, o); o += 2; out.writeInt16BE(2, o); o += 2;
    out.writeInt32BE(du, o); o += 4; o += writeAscii(out, o, s.uid);
    out.writeInt32BE(da, o); o += 4; o += writeAscii(out, o, s.arg);
    out.writeInt16BE(0, o); o += 2;
    TAIL.copy(out, o); o += TAIL.length;
  }
  return out;
}

export interface Target { host: string; port: number; user: string; password: string; database: string }
export const DIRECT: Target = { host: '127.0.0.1', port: 55432, user: 'fs05', password: 'fs05pw', database: 'fs05' };

export class RealConn {
  pid = 0;
  alive = true;
  closedAt = 0;
  private left: Buffer | null = null;
  private uid = -1; private v = -1; private err: string | null = null;
  results = 0;
  bytesOut = 0;
  private sock!: import('node:net').Socket;
  constructor(readonly id: number, private onResult: (id: number, r: Result) => void, private onClose: (id: number) => void) {}

  async open(t: Target): Promise<void> {
    const c = await PgConn.connect({ host: t.host, port: t.port, user: t.user, password: t.password, database: t.database, tls: false });
    this.pid = c.backendPid;
    this.sock = c.sock as import('node:net').Socket;
    this.sock.removeAllListeners('data');
    c.trace.length = 0;
    this.sock.on('data', (d: Buffer) => this.onData(d));
    this.sock.on('close', () => { if (this.alive) { this.alive = false; this.closedAt = performance.now(); this.onClose(this.id); } });
    this.sock.on('error', () => { /* close follows */ });
  }
  write(batch: Stmt[]): void { const b = encodeBatch(batch); this.bytesOut += b.length; if (this.alive) this.sock.write(b); }
  close(): void { this.alive = false; try { this.sock.destroy(); } catch { /* ignore */ } }

  private onData(chunk: Buffer): void {
    let buf = chunk;
    if (this.left) { buf = Buffer.concat([this.left, chunk]); this.left = null; }
    let o = 0;
    const n = buf.length;
    while (n - o >= 5) {
      const len = buf.readInt32BE(o + 1);
      if (n - o < 1 + len) break;
      const t = buf[o]!;
      if (t === 0x44) { // DataRow: int16 ncols, then int32 len + bytes per column
        let p = o + 5 + 2;
        const l0 = buf.readInt32BE(p); p += 4;
        let uid = 0; for (let i = 0; i < l0; i++) uid = uid * 10 + (buf[p + i]! - 48);
        p += l0;
        const l1 = buf.readInt32BE(p); p += 4;
        let v = 0; for (let i = 0; i < l1; i++) v = v * 10 + (buf[p + i]! - 48);
        this.uid = uid; this.v = v;
      } else if (t === 0x45) { // ErrorResponse: fields 'C' = SQLSTATE
        let p = o + 5; const end = o + 1 + len;
        this.err = '?';
        while (p < end && buf[p] !== 0) { const f = buf[p]!; let e = p + 1; while (buf[e] !== 0) e++; if (f === 0x43) this.err = buf.toString('latin1', p + 1, e); p = e + 1; }
      } else if (t === 0x5a) { // ReadyForQuery: the statement is complete
        const r: Result = { uid: this.uid, v: this.v, err: this.err };
        this.uid = -1; this.v = -1; this.err = null;
        this.results++;
        this.onResult(this.id, r);
      }
      o += 1 + len;
    }
    if (o < n) this.left = o === 0 ? buf : buf.subarray(o);
  }
}

export class RealTransport implements Transport {
  conns: RealConn[] = [];
  send(connId: number, batch: Stmt[]): void { this.conns[connId]!.write(batch); }
}
