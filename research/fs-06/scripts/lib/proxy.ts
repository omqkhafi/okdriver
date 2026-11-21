// Recording TCP proxy with an optional one-way delay and its own PostgreSQL v3 framing parser.
// It shares no code with wire.ts/client.ts, so it observes the client's and the pooler's bytes independently.
// Used twice: client side (harness -> pooler, 20 ms each way) and server side (pooler -> Postgres, no delay).
// Authentication exchange: only message type and length are kept ('p' messages, R payloads, K secret key).
import net from 'node:net';

export const nowMs = (): number => performance.timeOrigin + performance.now();

export interface Chunk { t: number; conn: number; dir: 'c2s' | 's2c'; n: number }
export interface MsgRec {
  t: number; conn: number; dir: 'c2s' | 's2c'; type: string; len: number;
  /** Summary fields: statement name, SQL, SQLSTATE, ... never credentials. */
  d?: Record<string, unknown>;
  /** Raw frame bytes as hex, c2s only and never for 'p' messages. Used for the byte comparison. */
  hex?: string;
}
export interface ConnRec { id: number; openedAt: number; closedAt?: number; startup?: Record<string, string>; app?: string; pid?: number; opaque?: boolean; sslAnswer?: string; closedBy?: 'client' | 'server' }

const td = new TextDecoder();
const cs = (b: Uint8Array, o: number): [string, number] => { let e = o; while (e < b.length && b[e] !== 0) e++; return [td.decode(b.subarray(o, e)), e + 1]; };

class Parser {
  private buf = new Uint8Array(0);
  untyped = true; // c2s starts with untyped startup-phase messages
  opaque = false;
  constructor(private dir: 'c2s' | 's2c', private conn: ConnRec, private out: MsgRec[], private onSslRequest: () => void) {}
  /** s2c only: the single-byte answer to an SSLRequest is pending. */
  awaitSsl = false;

  push(chunk: Uint8Array, t: number): void {
    if (this.opaque) return;
    const nb = new Uint8Array(this.buf.length + chunk.length); nb.set(this.buf); nb.set(chunk, this.buf.length); this.buf = nb;
    for (;;) {
      if (this.opaque) { this.buf = new Uint8Array(0); return; }
      if (this.dir === 's2c' && this.awaitSsl) {
        if (this.buf.length < 1) return;
        const letter = String.fromCharCode(this.buf[0]!);
        this.conn.sslAnswer = letter;
        this.out.push({ t, conn: this.conn.id, dir: 's2c', type: 'SSLResponse', len: 1, d: { answer: letter } });
        this.buf = this.buf.slice(1); this.awaitSsl = false;
        if (letter === 'S' || letter === 'G') { this.conn.opaque = true; this.opaque = true; }
        continue;
      }
      if (this.dir === 'c2s' && this.untyped) {
        if (this.buf.length < 8) return;
        const dv = new DataView(this.buf.buffer, this.buf.byteOffset, this.buf.byteLength);
        const len = dv.getInt32(0);
        if (this.buf.length < len) return;
        const code = dv.getInt32(4);
        const frame = this.buf.slice(0, len);
        this.buf = this.buf.slice(len);
        if (code === 80877103) { this.out.push({ t, conn: this.conn.id, dir: 'c2s', type: 'SSLRequest', len }); this.onSslRequest(); }
        else if (code === 80877104) { this.out.push({ t, conn: this.conn.id, dir: 'c2s', type: 'GSSENCRequest', len }); this.onSslRequest(); }
        else if (code === 80877102) this.out.push({ t, conn: this.conn.id, dir: 'c2s', type: 'CancelRequest', len });
        else {
          const params: Record<string, string> = {};
          let o = 8;
          while (o < frame.length && frame[o] !== 0) { const [k, n1] = cs(frame, o); const [v, n2] = cs(frame, n1); params[k] = v; o = n2; }
          this.conn.startup = params; this.conn.app = params.application_name;
          this.out.push({ t, conn: this.conn.id, dir: 'c2s', type: 'Startup', len, d: { protocol: `${code >>> 16}.${code & 0xffff}`, params } });
          this.untyped = false;
        }
        continue;
      }
      if (this.buf.length < 5) return;
      const dv = new DataView(this.buf.buffer, this.buf.byteOffset, this.buf.byteLength);
      const len = dv.getInt32(1);
      if (this.buf.length < 1 + len) return;
      const type = String.fromCharCode(this.buf[0]!);
      const frame = this.buf.slice(0, 1 + len);
      this.buf = this.buf.slice(1 + len);
      this.out.push(this.summarise(type, frame, len, t));
    }
  }

  private summarise(type: string, frame: Uint8Array, len: number, t: number): MsgRec {
    const body = frame.subarray(5);
    const rec: MsgRec = { t, conn: this.conn.id, dir: this.dir, type, len: len + 1 };
    const dv = new DataView(body.buffer, body.byteOffset, body.byteLength);
    if (this.dir === 'c2s') {
      if (type !== 'p') rec.hex = Array.from(frame, (x) => x.toString(16).padStart(2, '0')).join('');
      if (type === 'P') { const [name, o1] = cs(body, 0); const [sql, o2] = cs(body, o1); rec.d = { name, sql, nOids: dv.getInt16(o2), oids: Array.from({ length: dv.getInt16(o2) }, (_, i) => dv.getInt32(o2 + 2 + 4 * i)) }; }
      else if (type === 'B') {
        const [portal, o1] = cs(body, 0); const [stmt, o2] = cs(body, o1);
        const nf = dv.getInt16(o2); let o = o2 + 2 + 2 * nf; const np = dv.getInt16(o); o += 2;
        for (let i = 0; i < np; i++) { const l = dv.getInt32(o); o += 4 + (l > 0 ? l : 0); }
        rec.d = { portal, stmt, nParamFormats: nf, nParams: np, nResultFormats: dv.getInt16(o) };
      } else if (type === 'D' || type === 'C') { const [name] = cs(body, 1); rec.d = { kind: String.fromCharCode(body[0]!), name }; }
      else if (type === 'E') { const [portal, o] = cs(body, 0); rec.d = { portal, maxRows: dv.getInt32(o) }; }
      else if (type === 'Q') { rec.d = { sql: cs(body, 0)[0] }; }
    } else {
      if (type === 'E' || type === 'N') {
        const f: Record<string, string> = {}; let o = 0;
        while (o < body.length && body[o] !== 0) { const k = String.fromCharCode(body[o]!); const [v, n] = cs(body, o + 1); f[k] = v; o = n; }
        rec.d = { severity: f.S, code: f.C, message: f.M };
      } else if (type === 'R') rec.d = { auth: dv.getInt32(0) };
      else if (type === 'S') { const [k, o] = cs(body, 0); const [v] = cs(body, o); rec.d = { name: k, value: v }; }
      else if (type === 'K') { this.conn.pid = dv.getInt32(0); rec.d = { pid: this.conn.pid }; }
      else if (type === 'Z') rec.d = { status: String.fromCharCode(body[0]!) };
      else if (type === 'T') rec.d = { columns: dv.getInt16(0) };
      else if (type === 'C') rec.d = { tag: cs(body, 0)[0] };
    }
    return rec;
  }
}

interface QItem { due: number; data?: Uint8Array; end?: boolean }

export class RecordingProxy {
  chunks: Chunk[] = [];
  msgs: MsgRec[] = [];
  conns = new Map<number, ConnRec>();
  private nextId = 1;
  private server!: net.Server;
  private sockets = new Set<net.Socket>();
  constructor(public readonly o: { name: string; port: number; listenHost?: string; targetHost: string; targetPort: number; delayMs: number }) {}

  start(): Promise<void> {
    this.server = net.createServer((cli) => this.accept(cli));
    return new Promise((res, rej) => { this.server.once('error', rej); this.server.listen(this.o.port, this.o.listenHost ?? '127.0.0.1', () => res()); });
  }
  async stop(): Promise<void> {
    for (const s of this.sockets) s.destroy();
    await new Promise<void>((res) => this.server.close(() => res()));
  }
  /** In place: connection parsers hold a reference to the msgs array. */
  reset(): void { this.chunks.length = 0; this.msgs.length = 0; }

  private accept(cli: net.Socket): void {
    const id = this.nextId++;
    const conn: ConnRec = { id, openedAt: nowMs() };
    this.conns.set(id, conn);
    const up = net.connect({ host: this.o.targetHost, port: this.o.targetPort });
    cli.setNoDelay(true); up.setNoDelay(true);
    this.sockets.add(cli); this.sockets.add(up);
    const pc = new Parser('c2s', conn, this.msgs, () => { ps.awaitSsl = true; });
    const ps: Parser = new Parser('s2c', conn, this.msgs, () => {});
    let upReady = false; const pre: Buffer[] = [];
    up.once('connect', () => { upReady = true; for (const b of pre) up.write(b); pre.length = 0; });
    const mkPipe = (from: net.Socket, to: net.Socket, dir: 'c2s' | 's2c', parser: Parser, gate?: () => boolean, hold?: Buffer[]) => {
      const q: QItem[] = []; let timer: ReturnType<typeof setTimeout> | null = null;
      const pump = () => {
        timer = null;
        while (q.length) {
          const h = q[0]!;
          const wait = h.due - nowMs();
          if (wait > 0.5) { timer = setTimeout(pump, wait); return; }
          q.shift();
          if (h.end) { to.end(); continue; }
          if (gate && !gate()) hold!.push(Buffer.from(h.data!)); else to.write(h.data!);
        }
      };
      from.on('data', (d: Buffer) => {
        const t = nowMs();
        this.chunks.push({ t, conn: id, dir, n: d.length });
        parser.push(d, t);
        q.push({ due: t + this.o.delayMs, data: d });
        if (!timer) pump();
      });
      from.on('end', () => { conn.closedBy ??= dir === 'c2s' ? 'client' : 'server'; q.push({ due: nowMs() + this.o.delayMs, end: true }); if (!timer) pump(); });
    };
    mkPipe(cli, up, 'c2s', pc, () => upReady, pre);
    mkPipe(up, cli, 's2c', ps);
    const done = () => { conn.closedAt ??= nowMs(); cli.destroy(); up.destroy(); this.sockets.delete(cli); this.sockets.delete(up); };
    cli.on('close', () => { conn.closedBy ??= 'client'; setTimeout(done, this.o.delayMs + 5); });
    up.on('close', () => { conn.closedBy ??= 'server'; setTimeout(done, this.o.delayMs + 5); });
    cli.on('error', () => { /* connection reset is recorded by close */ });
    up.on('error', () => { cli.destroy(); });
  }
}

/** Client-side round trips for one connection and time window: runs of c2s chunks that are followed by s2c traffic. */
export function roundTrips(chunks: Chunk[], conn: number, t0: number, t1: number): { trips: number; c2sChunks: number; s2cChunks: number; c2sBytes: number; s2cBytes: number } {
  let last: 'c2s' | 's2c' | null = null; let trips = 0; let pendingC2S = false; let c2sChunks = 0, s2cChunks = 0, c2sBytes = 0, s2cBytes = 0;
  for (const c of chunks) {
    if (c.conn !== conn || c.t < t0 || c.t > t1) continue;
    if (c.dir === 'c2s') { c2sChunks++; c2sBytes += c.n; if (last !== 'c2s') pendingC2S = true; }
    else { s2cChunks++; s2cBytes += c.n; if (pendingC2S) { trips++; pendingC2S = false; } }
    last = c.dir;
  }
  return { trips, c2sChunks, s2cChunks, c2sBytes, s2cBytes };
}
