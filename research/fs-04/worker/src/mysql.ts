// MySQL / MariaDB handshake, TLS upgrade, COM_QUERY, on Web APIs only.
// Ported from research/fs-07/wire/shared/{constants,greeting,packet,connection}.ts and wire/shared/{auth,sha2}.ts at commit 3e2fc81
// ("research: FS-07 how much MySQL and MariaDB share (#15)"): the capability bits, packet framing, greeting layout, handshake order and the
// caching_sha2_password / mysql_native_password exchanges are the same; Buffer became Uint8Array and node:crypto became WebCrypto.
// Not copied: RSA key exchange for caching_sha2_password on a plaintext link (this study upgrades to TLS first, so full authentication sends the password after the TLS switch).
import { Conn, errInfo, withTimeout, type ConnectFn } from './sock.ts';
import { bytes, u8, text } from './wire.ts';
import type { Target } from './pg.ts';

export const CAP = { LONG_PASSWORD: 1, CONNECT_WITH_DB: 1 << 3, PROTOCOL_41: 1 << 9, SSL: 1 << 11, TRANSACTIONS: 1 << 13, SECURE_CONNECTION: 1 << 15, MULTI_RESULTS: 1 << 17, PLUGIN_AUTH: 1 << 19, PLUGIN_AUTH_LENENC_CLIENT_DATA: 1 << 21, DEPRECATE_EOF: 1 << 24 } as const;
const BASE_CAPS = CAP.LONG_PASSWORD | CAP.PROTOCOL_41 | CAP.TRANSACTIONS | CAP.SECURE_CONNECTION | CAP.MULTI_RESULTS | CAP.PLUGIN_AUTH | CAP.PLUGIN_AUTH_LENENC_CLIENT_DATA | CAP.DEPRECATE_EOF;

const subtle = crypto.subtle;
const digest = async (alg: 'SHA-1' | 'SHA-256', ...parts: Uint8Array[]) => new Uint8Array(await subtle.digest(alg, u8(...parts) as unknown as BufferSource));
const xor = (a: Uint8Array, b: Uint8Array) => a.map((x, i) => x ^ b[i % b.length]!);
export const nativeResponse = async (pw: string, salt: Uint8Array) => { if (!pw) return new Uint8Array(0); const s1 = await digest('SHA-1', bytes(pw)); return xor(s1, await digest('SHA-1', salt.subarray(0, 20), await digest('SHA-1', s1))); };
export const sha2Response = async (pw: string, salt: Uint8Array) => { if (!pw) return new Uint8Array(0); const h1 = await digest('SHA-256', bytes(pw)); return xor(h1, await digest('SHA-256', await digest('SHA-256', h1), salt.subarray(0, 20))); };

const lenenc = (b: Uint8Array) => { if (b.length >= 251) throw new Error('lenenc > 250 not needed here'); return u8([b.length], b); };
const u32le = (v: number) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v >>> 0, true); return b; };
const nul = (s: string) => u8(bytes(s), [0]);

export interface Greeting { serverVersion: string; connectionId: number; salt: Uint8Array; capabilities: number; authPlugin: string; family: 'mysql' | 'mariadb' }
export function parseGreeting(p: Uint8Array): Greeting {
  let o = 1; const e = p.indexOf(0, o); const serverVersion = text(p.subarray(o, e)); o = e + 1;
  const dv = new DataView(p.buffer, p.byteOffset, p.byteLength);
  const connectionId = dv.getUint32(o, true); o += 4;
  const part1 = p.slice(o, o + 8); o += 9;
  let caps = dv.getUint16(o, true); o += 2;
  o += 1 + 2; caps = (caps | (dv.getUint16(o, true) << 16)) >>> 0; o += 2;
  const authLen = p[o]!; o += 1 + 10;
  const n = Math.max(13, authLen - 8); let part2 = p.slice(o, o + n); o += n;
  if (part2.length && part2[part2.length - 1] === 0) part2 = part2.slice(0, -1);
  const e2 = p.indexOf(0, o); const authPlugin = text(p.subarray(o, e2 < 0 ? p.length : e2));
  return { serverVersion, connectionId, salt: u8(part1, part2), capabilities: caps, authPlugin, family: /mariadb/i.test(serverVersion) ? 'mariadb' : 'mysql' };
}

export class MyConn {
  seq = 0;
  constructor(public c: Conn) {}
  async readPacket(timeoutMs = 15000): Promise<Uint8Array> {
    const h = await this.c.readExact(4, timeoutMs);
    const len = h[0]! | (h[1]! << 8) | (h[2]! << 16); this.seq = (h[3]! + 1) & 0xff;
    return len ? this.c.readExact(len, timeoutMs) : new Uint8Array(0);
  }
  async writePacket(payload: Uint8Array): Promise<void> {
    const h = new Uint8Array(4); h[0] = payload.length & 0xff; h[1] = (payload.length >> 8) & 0xff; h[2] = (payload.length >> 16) & 0xff; h[3] = this.seq; this.seq = (this.seq + 1) & 0xff;
    await this.c.write(u8(h, payload));
  }
  /** A command starts a new sequence at 0. */
  async command(payload: Uint8Array): Promise<void> { this.seq = 0; await this.writePacket(payload); }
}

export const errOf = (p: Uint8Array) => { const dv = new DataView(p.buffer, p.byteOffset, p.byteLength); return { errno: dv.getUint16(1, true), message: text(p.subarray(p[3] === 0x23 ? 9 : 3)) }; };

export interface MyLogin { greeting: Greeting; plugin: string; secure: boolean }
/**
 * Handshake: greeting, SSLRequest (CLIENT_SSL, 32 bytes), startTls(), HandshakeResponse41, authentication. `tlsMode`:
 *   'none'  no TLS; 'upgrade' release locks, startTls() right after the SSLRequest (nothing was read from the server since the greeting);
 *   'read-pending' a read is outstanding when the locks are released.
 */
export async function myLogin(c: Conn, t: Target, o: { tls: boolean; lockMode?: 'both-released' | 'read-pending' | 'cancel-pending' | 'none-released'; startTlsOpts?: Record<string, unknown> }, rec: Record<string, any>): Promise<MyConn & { info: MyLogin }> {
  const m = new MyConn(c) as MyConn & { info: MyLogin };
  const g = parseGreeting(await m.readPacket());
  rec.greeting = { serverVersion: g.serverVersion, family: g.family, authPlugin: g.authPlugin, serverOffersSsl: (g.capabilities & CAP.SSL) !== 0 };
  let caps = (BASE_CAPS | CAP.CONNECT_WITH_DB | (o.tls ? CAP.SSL : 0)) & (g.capabilities | CAP.CONNECT_WITH_DB | CAP.SSL); caps >>>= 0;
  const head = u8(u32le(caps), u32le(0x40000000), [45], new Uint8Array(23));
  if (o.tls) {
    rec.leftoverAtSwitch = c.buf.length; // bytes read beyond the greeting before the switch
    await m.writePacket(head); rec.sslRequestBytes = head.length + 4;
    if (o.lockMode && o.lockMode !== 'both-released') {
      if (o.lockMode === 'read-pending' || o.lockMode === 'cancel-pending') {
        const pr = c.reader.read(); pr.then((v) => { rec.pendingReadSettled = v.done ? 'done' : `data(${v.value?.length})`; }, (e) => { rec.pendingReadSettled = `rejected: ${errInfo(e).message}`; });
        if (o.lockMode === 'cancel-pending') { try { await c.reader.cancel(); rec.cancel = 'ok'; } catch (e) { rec.cancel = errInfo(e); } }
      }
      if (o.lockMode !== 'none-released') {
        try { c.reader.releaseLock(); rec.readerRelease = 'ok'; } catch (e) { rec.readerRelease = errInfo(e); }
        try { c.writer.releaseLock(); rec.writerRelease = 'ok'; } catch (e) { rec.writerRelease = errInfo(e); }
      }
      try { const s = c.sock.startTls(o.startTlsOpts); c.sock = s; c.tls = true; c.buf = new Uint8Array(0); c.eof = false; c.lock(); rec.startTls = 'ok'; } catch (e) { rec.startTls = errInfo(e); throw new Error('startTls: ' + errInfo(e).message); }
    } else {
      c.upgrade(o.startTlsOpts); rec.startTls = 'ok';
    }
  }
  let plugin = ['caching_sha2_password', 'mysql_native_password'].includes(g.authPlugin) ? g.authPlugin : 'mysql_native_password';
  const first = plugin === 'caching_sha2_password' ? await sha2Response(t.password, g.salt) : await nativeResponse(t.password, g.salt);
  await m.writePacket(u8(head, nul(t.user), lenenc(first), nul(t.database), nul(plugin)));
  for (;;) {
    const p = await withTimeout(m.readPacket(), 15000, 'auth');
    if (p[0] === 0x00) { m.info = { greeting: g, plugin, secure: o.tls }; rec.authPlugin = plugin; return m; }
    if (p[0] === 0xff) { const e = errOf(p); throw new Error(`mysql ${e.errno} ${e.message}`); }
    if (p[0] === 0xfe) { // auth switch
      const e = p.indexOf(0, 1); plugin = text(p.subarray(1, e)); const salt = p.subarray(e + 1, p.length - (p[p.length - 1] === 0 ? 1 : 0));
      await m.writePacket(plugin === 'caching_sha2_password' ? await sha2Response(t.password, salt) : await nativeResponse(t.password, salt));
    } else if (p[0] === 0x01) { // more data (caching_sha2)
      if (p[1] === 3) continue; // fast auth accepted, an OK follows
      if (p[1] === 4) { if (!o.tls) throw new Error('full authentication needs TLS here'); await m.writePacket(nul(t.password)); }
    } else throw new Error('unexpected packet during authentication 0x' + p[0]!.toString(16));
  }
}

/** COM_QUERY with a text result: returns rows, or the OK/ERR. Metadata rows are skipped (DEPRECATE_EOF is on). */
export async function myQuery(m: MyConn, sql: string, timeoutMs = 60000): Promise<{ rows: (string | null)[][]; ok?: true; error?: { errno: number; message: string } }> {
  await m.command(u8([0x03], bytes(sql)));
  const first = await m.readPacket(timeoutMs);
  if (first[0] === 0xff) return { rows: [], error: errOf(first) };
  if (first[0] === 0x00) return { rows: [], ok: true };
  const ncols = first[0]!; for (let i = 0; i < ncols; i++) await m.readPacket(timeoutMs);
  const rows: (string | null)[][] = [];
  for (;;) {
    const p = await m.readPacket(timeoutMs);
    if (p[0] === 0xfe && p.length < 0xffffff && p.length < 512 && p.length <= 16 + 8) return { rows };
    if (p[0] === 0xff) return { rows, error: errOf(p) };
    const row: (string | null)[] = []; let o = 0;
    while (o < p.length) { if (p[o] === 0xfb) { row.push(null); o++; } else { const n = p[o]!; row.push(text(p.subarray(o + 1, o + 1 + n))); o += 1 + n; } }
    rows.push(row);
  }
}
export const myQuit = async (m: MyConn) => { try { await m.command(new Uint8Array([0x01])); } catch { /* ignore */ } await m.c.close(); };
export const myOpen = (connect: ConnectFn, t: Target, hostname?: string, connectOpts?: Record<string, unknown>) => new Conn(connect({ hostname: hostname ?? t.host, port: t.port }, { secureTransport: 'starttls', allowHalfOpen: false, ...(connectOpts ?? {}) }));
