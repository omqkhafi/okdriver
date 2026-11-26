// A scripted PostgreSQL-speaking server for the study. Runs on Node, never on the Bun under test, and has its own framing code
// (it shares nothing with lib/core.ts). Modes are chosen by the SQL text of the statement:
//   SELECT 1                              tiny result (RowDescription, one DataRow, CommandComplete)
//   -- fs03 stream rows=N row=R burst=B   N DataRows of R payload bytes written in bursts of B bytes
//   -- fs03 script                        replays the connection's script (set in the options) once
//   COPY ... -- fs03 rate=M                CopyIn; M MB/s read throttle (0 = unthrottled)
import net from 'node:net';
import tls from 'node:tls';
import { createHash } from 'node:crypto';

export const sha256hex = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');
const be32 = (v: number): Buffer => { const b = Buffer.allocUnsafe(4); b.writeInt32BE(v); return b; };
const be16 = (v: number): Buffer => { const b = Buffer.allocUnsafe(2); b.writeInt16BE(v); return b; };
export const msg = (type: string, body: Buffer | Uint8Array = Buffer.alloc(0)): Buffer => Buffer.concat([Buffer.from(type), be32(body.length + 4), body]);

export interface ScriptDef { wire: Buffer; /** per message: type, payload length */ items: { type: string; len: number }[] }
export interface SentLog { lines: string[]; ends: number[]; bytes: number }

/** Seeded generator so the script is reproducible. */
export const rng = (seed: number) => { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; };

export function buildScript(name: 'mix' | 'small' | 'tiny', seed: number): ScriptDef {
  const r = rng(seed);
  const sizes: number[] = [];
  if (name === 'tiny') {
    for (let i = 0; i < 10; i++) sizes.push(0, 1);
    for (let i = 0; i < 130; i++) sizes.push(2 + Math.floor(r() * 29));
  } else if (name === 'small') {
    for (let i = 0; i < 30; i++) sizes.push(0, 1);
    for (let i = 0; i < 340; i++) sizes.push(2 + Math.floor(r() * 59));
  } else {
    for (let i = 0; i < 300; i++) sizes.push(0, 1);
    for (let i = 0; i < 2000; i++) sizes.push(2 + Math.floor(r() * 299));
    for (let i = 0; i < 60; i++) sizes.push(16384 + Math.floor(r() * 5) - 2);
    for (let i = 0; i < 40; i++) sizes.push(65536 + Math.floor(r() * 5) - 2);
    for (let i = 0; i < 4; i++) sizes.push(1_100_000 + Math.floor(r() * 400_000));
  }
  for (let i = sizes.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [sizes[i], sizes[j]] = [sizes[j]!, sizes[i]!]; }
  const parts: Buffer[] = [];
  const items: ScriptDef['items'] = [];
  for (const n of sizes) {
    const payload = Buffer.allocUnsafe(n);
    for (let i = 0; i < n; i++) payload[i] = Math.floor(r() * 256);
    const type = r() < 0.9 ? 'D' : 'N';
    parts.push(msg(type, payload));
    items.push({ type, len: n });
  }
  return { wire: Buffer.concat(parts), items };
}

/** Lines `type length sha256(payload)` for a wire buffer holding whole messages. Own parser. */
export function describeWire(wire: Buffer, into: SentLog, base = 0): void {
  let o = 0;
  while (o < wire.length) {
    const len = wire.readInt32BE(o + 1) - 4;
    into.lines.push(`${String.fromCharCode(wire[o]!)} ${len} ${sha256hex(wire.subarray(o + 5, o + 5 + len))}`);
    o += 5 + len;
    into.ends.push(base + o);
  }
}

class ClientParser {
  startupDone = false;
  private hdr = Buffer.allocUnsafe(8);
  private hdrN = 0;
  private remaining = 0;
  private keep: Buffer[] = [];
  private wantBody = false;
  private type = '';
  private startup = false;
  push(buf: Buffer, cb: { startup(code: number, body: Buffer): void; typed(type: string, body: Buffer): void }): void {
    let off = 0;
    while (off < buf.length) {
      if (this.remaining > 0) {
        const n = Math.min(this.remaining, buf.length - off);
        if (this.wantBody) this.keep.push(buf.subarray(off, off + n));
        this.remaining -= n; off += n;
        if (this.remaining === 0) this.finish(cb);
        continue;
      }
      const need = this.startupDone ? 5 : 8;
      while (this.hdrN < need && off < buf.length) this.hdr[this.hdrN++] = buf[off++]!;
      if (this.hdrN < need) return;
      this.hdrN = 0;
      if (this.startupDone) {
        this.type = String.fromCharCode(this.hdr[0]!);
        this.remaining = this.hdr.readInt32BE(1) - 4;
        this.wantBody = this.type === 'P' || this.type === 'Q';
        this.startup = false;
      } else {
        this.startup = true;
        this.type = '';
        this.remaining = this.hdr.readInt32BE(0) - 8;
        this.wantBody = true;
        this.hdr.writeInt32BE(this.hdr.readInt32BE(4), 0);
      }
      this.keep = [];
      if (this.remaining === 0) this.finish(cb);
    }
  }
  private finish(cb: { startup(code: number, body: Buffer): void; typed(type: string, body: Buffer): void }): void {
    const body = this.keep.length === 1 ? this.keep[0]! : Buffer.concat(this.keep);
    this.keep = [];
    if (this.startup) cb.startup(this.hdr.readInt32BE(0), body); else cb.typed(this.type, body);
  }
}

const cstrAt = (b: Buffer, o: number): [string, number] => { let e = o; while (e < b.length && b[e] !== 0) e++; return [b.toString('utf8', o, e), e + 1]; };

export interface FakeOptions {
  tls?: { key: Buffer; cert: Buffer };
  /** direct TLS listener (no SSLRequest), with ALPN */
  directTls?: { key: Buffer; cert: Buffer; alpn: string[] };
  script?: ScriptDef;
}
export interface ConnInfo { sent: SentLog; c2sBytes: number; startupSeen: boolean; sslRequests: number; alpn?: string | false }

export class FakePg {
  port = 0;
  conns: ConnInfo[] = [];
  private server!: net.Server | tls.Server;
  private open = new Set<net.Socket>();
  opts: FakeOptions;
  constructor(opts: FakeOptions = {}) { this.opts = opts; }

  async listen(): Promise<this> {
    const onConn = (s: net.Socket) => this.serve(s, !!this.opts.directTls);
    this.server = this.opts.directTls
      ? tls.createServer({ key: this.opts.directTls.key, cert: this.opts.directTls.cert, ALPNProtocols: this.opts.directTls.alpn }, onConn)
      : net.createServer({ noDelay: true }, onConn);
    await new Promise<void>((r) => this.server.listen(0, '127.0.0.1', r));
    this.port = (this.server.address() as net.AddressInfo).port;
    return this;
  }
  close(): void { this.server.close(); for (const s of this.open) s.destroy(); }
  /** Destroys every open connection and forgets the log; the listener stays. */
  reset(): void { for (const s of this.open) s.destroy(); this.conns = []; }

  private serve(raw: net.Socket, direct: boolean): void {
    const info: ConnInfo = { sent: { lines: [], ends: [], bytes: 0 }, c2sBytes: 0, startupSeen: false, sslRequests: 0 };
    this.conns.push(info);
    let sock: net.Socket = raw;
    this.open.add(raw);
    raw.setNoDelay(true);
    if (direct) info.alpn = (raw as tls.TLSSocket).alpnProtocol ?? undefined;
    const parser = new ClientParser();
    let lastSql = '';
    let scriptPlayed = false;
    let copyRate = 0, copyStart = 0, copyBytes = 0, inCopy = false;
    const send = (b: Buffer, log = true): boolean => {
      if (log) describeWire(b, info.sent, info.sent.bytes);
      info.sent.bytes += b.length;
      return sock.write(b);
    };
    const loginReply = (): void => {
      send(Buffer.concat([
        msg('R', be32(0)),
        msg('S', Buffer.from('server_version\x0019.0-fs03\x00')),
        msg('S', Buffer.from('client_encoding\x00UTF8\x00')),
        msg('K', Buffer.concat([be32(4242), be32(1717)])),
        msg('Z', Buffer.from('I')),
      ]));
    };
    const tiny = Buffer.concat([
      msg('1'), msg('2'),
      msg('T', Buffer.concat([be16(1), Buffer.from('x\x00'), be32(0), be16(0), be32(23), be16(4), be32(-1), be16(0)])),
      msg('D', Buffer.concat([be16(1), be32(1), Buffer.from('1')])),
      msg('C', Buffer.from('SELECT 1\x00')),
      msg('Z', Buffer.from('I')),
    ]);
    const tinyMany = new Map<number, Buffer>();
    const tinyN = (k: number): Buffer => { let b = tinyMany.get(k); if (!b) { b = Buffer.concat(Array.from({ length: k }, () => tiny)); tinyMany.set(k, b); } return b; };
    let syncRun = 0; // consecutive tiny syncs counted in one chunk, answered with one write
    const flushSyncs = (): void => { let k = syncRun; syncRun = 0; while (k > 0) { const n = Math.min(k, 128); sock.write(tinyN(n)); info.sent.bytes += tiny.length * n; k -= n; } };

    const stream = (rows: number, rowLen: number, burst: number): void => {
      const row = msg('D', Buffer.concat([be16(1), be32(rowLen), Buffer.alloc(rowLen, 0x61)]));
      const unit = Math.max(1, Math.floor((4 << 20) / row.length));
      const L = unit * row.length;
      const pat = Buffer.concat(Array.from({ length: 2 * unit }, () => row));
      const total = rows * row.length;
      let sent = 0;
      send(Buffer.concat([msg('1'), msg('2'), msg('T', Buffer.concat([be16(1), Buffer.from('x\x00'), be32(0), be16(0), be32(25), be16(-1), be32(-1), be16(0)]))]), false);
      const pump = (): void => {
        while (sent < total) {
          const n = Math.min(burst, total - sent);
          const s = sent % L;
          sent += n;
          info.sent.bytes += n;
          if (!sock.write(pat.subarray(s, s + n))) { sock.once('drain', pump); return; }
        }
        send(Buffer.concat([msg('C', Buffer.from(`SELECT ${rows}\x00`)), msg('Z', Buffer.from('I'))]), false);
      };
      pump();
    };

    const onStatement = (): void => {
      if (this.opts.script && lastSql.includes('-- fs03 script')) {
        flushSyncs();
        if (!scriptPlayed) {
          scriptPlayed = true;
          send(Buffer.concat([msg('1'), msg('2')]));
          send(this.opts.script.wire);
          send(Buffer.concat([msg('C', Buffer.from('SELECT script\x00')), msg('Z', Buffer.from('I'))]));
        } else send(msg('Z', Buffer.from('I')));
        return;
      }
      const m = /-- fs03 stream rows=(\d+) row=(\d+) burst=(\d+)/.exec(lastSql);
      if (m) { flushSyncs(); return stream(Number(m[1]), Number(m[2]), Number(m[3])); }
      syncRun++;
    };

    const attach = (s: net.Socket): void => {
      sock = s;
      s.on('error', () => {});
      s.on('close', () => { this.open.delete(s); this.open.delete(raw); });
      s.on('data', (buf: Buffer) => {
        info.c2sBytes += buf.length;
        if (inCopy) {
          copyBytes += buf.length;
          if (copyRate > 0) {
            const due = copyStart + (copyBytes / (copyRate * 1e6)) * 1000;
            const wait = due - performance.now();
            if (wait > 1) { s.pause(); setTimeout(() => s.resume(), wait); }
          }
        }
        parser.push(buf, {
          startup: (code, body) => {
            if (code === 80877103) {
              info.sslRequests++;
              if (!this.opts.tls) { s.write('N'); return; }
              s.write('S');
              const t = new tls.TLSSocket(raw, { isServer: true, key: this.opts.tls.key, cert: this.opts.tls.cert });
              this.open.add(t);
              s.removeAllListeners('data');
              attach(t);
              return;
            }
            info.startupSeen = true;
            parser.startupDone = true;
            void body;
            loginReply();
          },
          typed: (type, body) => {
            if (inCopy) {
              if (type === 'd') return;
              if (type === 'c') { inCopy = false; send(Buffer.concat([msg('C', Buffer.from('COPY 1\x00')), msg('Z', Buffer.from('I'))])); }
              return;
            }
            if (type === 'P') { const [, o] = cstrAt(body, 0); lastSql = cstrAt(body, o)[0]; return; }
            if (type === 'S') { onStatement(); return; }
            if (type === 'Q') {
              const sql = cstrAt(body, 0)[0];
              const m = /-- fs03 rate=(\d+)/.exec(sql);
              if (/^COPY /i.test(sql)) {
                inCopy = true; copyRate = m ? Number(m[1]) : 0; copyStart = performance.now(); copyBytes = 0;
                send(msg('G', Buffer.concat([Buffer.from([0]), be16(0)])));
              } else send(Buffer.concat([msg('C', Buffer.from('SELECT 1\x00')), msg('Z', Buffer.from('I'))]));
              return;
            }
            if (type === 'X') { s.end(); }
          },
        });
        flushSyncs();
      });
    };
    attach(raw);
  }
}
