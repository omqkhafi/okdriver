// Recording byte-forwarding TCP proxy. Adapted from research/fs-06/scripts/lib/proxy.ts at commit 5930580 (own PostgreSQL framing parser,
// independent of the client's encoder), rewritten for FS-04: several routes, TLS-aware (the parser stops reading plaintext at the switch and
// parses the ClientHello instead), streaming sha256 of Bind ('B') frames and CopyData ('d') bodies, and two planted faults (byte flip, read stall).
import net from 'node:net';
import { createHash, type Hash } from 'node:crypto';

export const nowMs = (): number => performance.timeOrigin + performance.now();

export interface ClientHello { recordVersion: string; legacyVersion: string; sni: string | null; alpn: string[] | null; supportedVersions: string[]; cipherSuites: number; hasChannelBindingRelevantExt: boolean; extensions: number[] }
export interface Frame { type: string; bytes: number; sha256: string }
export interface ConnRec {
  id: number; route: string; openedAt: number; closedAt?: number; closedBy?: 'client' | 'server';
  c2sBytes: number; s2cBytes: number; c2sFirstAt?: number;
  label?: string; startupProtocol?: string;
  kind: 'startup' | 'cancel' | 'ssl-request' | 'direct-tls' | 'unknown';
  sslRequestAt?: number; sslAnswer?: string; bytesBeforeSslAnswer?: number;
  tlsStartsAtC2sOffset?: number; tlsStartsAtS2cOffset?: number;
  clientHello?: ClientHello; cancelPid?: number;
  c2sTypes: Record<string, number>; s2cTypes: Record<string, number>;
  s2cErrors: string[]; frames: Frame[]; copyBodySha256?: string; copyBodyBytes?: number;
  stalled?: { at: number; resumedAt?: number; atBytes: number }; flipped?: { atOffset: number };
  mysqlSslRequestAt?: number;
}
export interface Cfg { stall?: { afterBytes: number; ms: number; routes?: string[] }; flip?: { c2sOffset: number; routes?: string[] } }

const td = new TextDecoder();
function parseClientHello(rec: Uint8Array): ClientHello | null {
  try {
    if (rec[0] !== 0x16 || rec[5] !== 1) return null;
    const dv = new DataView(rec.buffer, rec.byteOffset, rec.byteLength);
    const hex = (a: number, b: number) => `${a}.${b}`;
    const out: ClientHello = { recordVersion: hex(rec[1]!, rec[2]!), legacyVersion: hex(rec[9]!, rec[10]!), sni: null, alpn: null, supportedVersions: [], cipherSuites: 0, hasChannelBindingRelevantExt: false, extensions: [] };
    let o = 5 + 4 + 2 + 32; o += 1 + rec[o]!; // session id
    const cs = dv.getUint16(o); out.cipherSuites = cs / 2; o += 2 + cs;
    o += 1 + rec[o]!; // compression
    const extEnd = o + 2 + dv.getUint16(o); o += 2;
    while (o + 4 <= extEnd) {
      const type = dv.getUint16(o), len = dv.getUint16(o + 2); const b = rec.subarray(o + 4, o + 4 + len); out.extensions.push(type);
      if (type === 0 && len > 5) { out.sni = td.decode(b.subarray(5, 5 + new DataView(b.buffer, b.byteOffset).getUint16(3))); }
      else if (type === 16) { const names: string[] = []; let p = 2; while (p < b.length) { const n = b[p]!; names.push(td.decode(b.subarray(p + 1, p + 1 + n))); p += 1 + n; } out.alpn = names; }
      else if (type === 43) { for (let p = 1; p + 1 < b.length; p += 2) out.supportedVersions.push(hex(b[p]!, b[p + 1]!)); }
      o += 4 + len;
    }
    return out;
  } catch { return null; }
}

class Side {
  private buf: Uint8Array = new Uint8Array(0);
  mode: 'startup' | 'typed' | 'tls' | 'mysql' = 'startup';
  awaitAnswer = false;
  private cur: { type: string; need: number; got: number; hash: Hash | null; head: Uint8Array[]; keep: boolean } | null = null;
  private mysqlPackets = 0;
  private mysqlNeed = 0; private mysqlHead: Uint8Array[] = []; private mysqlGot = 0;
  tlsBytes = 0; private tlsHello: Uint8Array = new Uint8Array(0);
  copy: Hash | null = null;
  constructor(public dir: 'c2s' | 's2c', public rec: ConnRec, private kind: 'pg' | 'mysql') { if (kind === 'mysql') this.mode = 'mysql'; }
  private cat(a: Uint8Array, b: Uint8Array) { if (!a.length) return b; const o = new Uint8Array(a.length + b.length); o.set(a); o.set(b, a.length); return o; }

  push(chunk: Uint8Array, t: number, offsetBefore: number): void {
    if (this.mode === 'tls') { this.tls(chunk); return; }
    if (this.dir === 's2c') return this.s2c(chunk, t);
    if (this.kind === 'mysql') return this.mysql(chunk, t, offsetBefore);
    this.c2s(chunk, t, offsetBefore);
  }
  private tls(chunk: Uint8Array) {
    if (this.dir === 'c2s' && !this.rec.clientHello && this.tlsHello.length < 70000) {
      this.tlsHello = this.cat(this.tlsHello, chunk);
      if (this.tlsHello.length >= 5) { const need = 5 + new DataView(this.tlsHello.buffer, this.tlsHello.byteOffset).getUint16(3); if (this.tlsHello.length >= need) { const ch = parseClientHello(this.tlsHello.subarray(0, need)); if (ch) this.rec.clientHello = ch; this.tlsHello = new Uint8Array(70001); } }
    }
  }
  private s2c(chunk: Uint8Array, t: number) {
    // only the PostgreSQL plaintext phase is parsed; once the server said S the rest is ciphertext
    if (this.kind === 'mysql') return;
    this.buf = this.cat(this.buf, chunk);
    if (this.awaitAnswer) {
      if (!this.buf.length) return;
      const letter = String.fromCharCode(this.buf[0]!); this.rec.sslAnswer = letter; this.buf = this.buf.slice(1); this.awaitAnswer = false;
      this.rec.tlsStartsAtS2cOffset = undefined;
      if (letter === 'S') { this.mode = 'tls'; this.buf = new Uint8Array(0); (this as any).onSwitch?.(); return; }
      (this as any).onNo?.();
    }
    for (;;) {
      if (this.buf.length < 5) return;
      const dv = new DataView(this.buf.buffer, this.buf.byteOffset, this.buf.byteLength);
      const len = dv.getInt32(1);
      if (this.buf.length < 1 + len) return;
      const type = String.fromCharCode(this.buf[0]!);
      this.rec.s2cTypes[type] = (this.rec.s2cTypes[type] ?? 0) + 1;
      if (type === 'E') { const body = this.buf.subarray(5, 1 + len); let o = 0; while (o < body.length && body[o] !== 0) { const k = String.fromCharCode(body[o]!); let e = o + 1; while (body[e] !== 0) e++; if (k === 'C') this.rec.s2cErrors.push(td.decode(body.subarray(o + 1, e))); o = e + 1; } }
      this.buf = this.buf.slice(1 + len);
    }
  }
  private c2s(chunk: Uint8Array, t: number, offsetBefore: number) {
    if (this.awaitAnswer) { this.rec.bytesBeforeSslAnswer = (this.rec.bytesBeforeSslAnswer ?? 0) + chunk.length; this.buf = this.cat(this.buf, chunk); return; }
    this.buf = this.buf.length ? this.cat(this.buf, chunk) : chunk;
    for (;;) {
      if (this.mode === 'tls') { const rest = this.buf; this.buf = new Uint8Array(0); if (rest.length) this.tls(rest); return; }
      if (this.mode === 'startup') {
        if (this.buf.length < 8) return;
        if (this.buf[0] === 0x16) { this.rec.kind = 'direct-tls'; this.mode = 'tls'; this.rec.tlsStartsAtC2sOffset = offsetBefore; continue; }
        const dv = new DataView(this.buf.buffer, this.buf.byteOffset, this.buf.byteLength);
        const len = dv.getInt32(0), code = dv.getInt32(4);
        if (this.buf.length < len) return;
        const frame = this.buf.slice(0, len); this.buf = this.buf.slice(len);
        this.rec.c2sTypes[code === 80877103 ? 'SSLRequest' : code === 80877102 ? 'CancelRequest' : 'Startup'] = 1;
        if (code === 80877103) { this.rec.kind = 'ssl-request'; this.rec.sslRequestAt = t; this.awaitAnswer = true; (this as any).onSslRequest?.(); if (this.buf.length) this.rec.bytesBeforeSslAnswer = this.buf.length; return; }
        if (code === 80877102) { this.rec.kind = 'cancel'; this.rec.cancelPid = new DataView(frame.buffer, frame.byteOffset).getInt32(8); continue; }
        this.rec.kind = this.rec.kind === 'ssl-request' ? 'ssl-request' : 'startup'; this.rec.startupProtocol = `${code >>> 16}.${code & 0xffff}`;
        let o = 8; while (o < frame.length && frame[o] !== 0) { let e = o; while (frame[e] !== 0) e++; const k = td.decode(frame.subarray(o, e)); let e2 = e + 1; while (frame[e2] !== 0) e2++; if (k === 'application_name') this.rec.label = td.decode(frame.subarray(e + 1, e2)); o = e2 + 1; }
        this.mode = 'typed';
        continue;
      }
      // typed frames, streamed: B and d frames are hashed incrementally, the rest is only counted
      if (!this.cur) {
        if (this.buf.length < 5) return;
        const dv = new DataView(this.buf.buffer, this.buf.byteOffset, this.buf.byteLength);
        const type = String.fromCharCode(this.buf[0]!); const len = dv.getInt32(1);
        this.rec.c2sTypes[type] = (this.rec.c2sTypes[type] ?? 0) + 1;
        const hashed = type === 'B';
        this.cur = { type, need: 1 + len, got: 0, hash: hashed ? createHash('sha256') : null, head: [], keep: false };
        if (type === 'd') { this.copy ??= createHash('sha256'); }
      }
      const c = this.cur!;
      const take = Math.min(c.need - c.got, this.buf.length);
      if (!take) return;
      const piece = this.buf.subarray(0, take);
      c.hash?.update(piece);
      if (c.type === 'd') { // skip the 5-byte header for the body hash
        const skip = Math.max(0, 5 - c.got); const body = piece.subarray(Math.min(skip, piece.length));
        this.copy!.update(body); this.rec.copyBodyBytes = (this.rec.copyBodyBytes ?? 0) + body.length;
      }
      c.got += take; this.buf = this.buf.subarray(take);
      if (c.got === c.need) { if (c.hash) this.rec.frames.push({ type: c.type, bytes: c.need, sha256: c.hash.digest('hex') }); this.cur = null; if (!this.buf.length) return; } else return;
    }
  }
  private mysql(chunk: Uint8Array, t: number, offsetBefore: number) {
    if (this.mode === 'tls') return this.tls(chunk);
    this.buf = this.cat(this.buf, chunk);
    for (;;) {
      if (this.buf.length < 4) return;
      const len = this.buf[0]! | (this.buf[1]! << 8) | (this.buf[2]! << 16);
      if (this.buf.length < 4 + len) return;
      const pkt = this.buf.slice(4, 4 + len); this.buf = this.buf.slice(4 + len); this.mysqlPackets++;
      this.rec.c2sTypes['packet'] = this.mysqlPackets;
      if (this.mysqlPackets === 1 && len === 32 && (pkt[1]! & 0x08) !== 0) { // CLIENT_SSL = 0x800
        this.rec.mysqlSslRequestAt = t; this.rec.kind = 'ssl-request'; this.rec.sslAnswer = '(none)'; this.mode = 'tls'; this.rec.tlsStartsAtC2sOffset = offsetBefore + (chunk.length - this.buf.length);
        const rest = this.buf; this.buf = new Uint8Array(0); if (rest.length) this.tls(rest); return;
      }
    }
  }
}

export class RecordingProxy {
  conns: ConnRec[] = [];
  cfg: Cfg = {};
  private nextId = 1;
  private servers: net.Server[] = [];
  private socks = new Set<net.Socket>();
  addRoute(name: string, listenPort: number, targetPort: number, kind: 'pg' | 'mysql' = 'pg'): Promise<void> {
    const srv = net.createServer((cli) => this.accept(cli, name, targetPort, kind));
    this.servers.push(srv);
    return new Promise((res, rej) => { srv.once('error', rej); srv.listen(listenPort, '127.0.0.1', () => res()); });
  }
  async stop(): Promise<void> { for (const s of this.socks) s.destroy(); await Promise.all(this.servers.map((s) => new Promise<void>((r) => s.close(() => r())))); }
  reset(): void { this.conns = []; this.cfg = {}; }
  byLabel(prefix: string): ConnRec[] { return this.conns.filter((c) => c.label?.startsWith(prefix)); }

  private accept(cli: net.Socket, route: string, targetPort: number, kind: 'pg' | 'mysql'): void {
    const rec: ConnRec = { id: this.nextId++, route, openedAt: nowMs(), c2sBytes: 0, s2cBytes: 0, kind: 'unknown', c2sTypes: {}, s2cTypes: {}, s2cErrors: [], frames: [] };
    this.conns.push(rec);
    const up = net.connect({ host: '127.0.0.1', port: targetPort });
    cli.setNoDelay(true); up.setNoDelay(true); this.socks.add(cli); this.socks.add(up);
    const c2s = new Side('c2s', rec, kind), s2c = new Side('s2c', rec, kind);
    (c2s as any).onSslRequest = () => { s2c.awaitAnswer = true; };
    (s2c as any).onSwitch = () => { rec.tlsStartsAtS2cOffset = rec.s2cBytes; rec.tlsStartsAtC2sOffset = rec.c2sBytes; c2s.mode = 'tls'; c2s.awaitAnswer = false; };
    (s2c as any).onNo = () => { c2s.awaitAnswer = false; };
    let upReady = false; const pre: Buffer[] = [];
    up.once('connect', () => { upReady = true; for (const b of pre) up.write(b); pre.length = 0; });
    cli.on('data', (d: Buffer) => {
      const t = nowMs(); const before = rec.c2sBytes; rec.c2sFirstAt ??= t;
      rec.c2sBytes += d.length;
      c2s.push(d, t, before);
      let out: Buffer = d;
      const f = this.cfg.flip;
      if (f && !rec.flipped && (!f.routes || f.routes.includes(route)) && before <= f.c2sOffset && f.c2sOffset < before + d.length) { out = Buffer.from(d); out[f.c2sOffset - before]! ^= 0x01; rec.flipped = { atOffset: f.c2sOffset }; }
      if (upReady) up.write(out); else pre.push(out);
      const st = this.cfg.stall;
      if (st && !rec.stalled && (!st.routes || st.routes.includes(route)) && rec.c2sBytes >= st.afterBytes) {
        rec.stalled = { at: nowMs(), atBytes: rec.c2sBytes }; cli.pause();
        setTimeout(() => { rec.stalled!.resumedAt = nowMs(); cli.resume(); }, st.ms);
      }
    });
    up.on('data', (d: Buffer) => { const t = nowMs(); const before = rec.s2cBytes; rec.s2cBytes += d.length; s2c.push(d, t, before); cli.write(d); });
    const done = (by: 'client' | 'server') => { if (c2s.copy && !rec.copyBodySha256) rec.copyBodySha256 = c2s.copy.digest('hex'); rec.closedBy ??= by; rec.closedAt ??= nowMs(); cli.destroy(); up.destroy(); this.socks.delete(cli); this.socks.delete(up); };
    cli.on('close', () => done('client')); up.on('close', () => done('server'));
    cli.on('end', () => { rec.closedBy ??= 'client'; up.end(); }); up.on('end', () => { rec.closedBy ??= 'server'; cli.end(); });
    cli.on('error', () => { /* recorded by close */ }); up.on('error', () => { cli.destroy(); });
  }
}
