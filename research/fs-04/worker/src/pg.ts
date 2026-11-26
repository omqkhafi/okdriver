// Raw-bytes PostgreSQL client on Web APIs only: no node:* import, no nodejs_compat. SCRAM-SHA-256 uses WebCrypto.
import { Conn, errInfo, type ConnectFn, type SockLike } from './sock.ts';
import { bytes, decodeDataRow, decodeError, decodeParameterStatus, passwordMsg, query, readCString, saslInitial, sslRequest, startup, sync, terminate, text, typed, u8, parse, execute } from './wire.ts';
import { bindByteaParts, copyBinaryParts, fillPayload } from './payload.ts';

export interface Target { host: string; port: number; user: string; password: string; database: string }

export function parseUrl(url: string): Target {
  const u = new URL(url);
  return { host: u.hostname, port: Number(u.port || 5432), user: decodeURIComponent(u.username), password: decodeURIComponent(u.password), database: decodeURIComponent(u.pathname.slice(1)) };
}

const subtle = crypto.subtle;
const bs = (b: Uint8Array) => b as unknown as BufferSource;
const hmac = async (key: Uint8Array, data: Uint8Array): Promise<Uint8Array> => {
  const k = await subtle.importKey('raw', bs(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await subtle.sign('HMAC', k, bs(data)));
};
export const sha256 = async (d: Uint8Array): Promise<Uint8Array> => new Uint8Array(await subtle.digest('SHA-256', bs(d)));
const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** SCRAM-SHA-256 without channel binding ("n,,"). PBKDF2 and HMAC come from WebCrypto. */
export class Scram {
  private nonce = b64(crypto.getRandomValues(new Uint8Array(18)));
  private bare = '';
  private serverSig: Uint8Array | null = null;
  constructor(private password: string) {}
  first(): string { this.bare = `n=,r=${this.nonce}`; return `n,,${this.bare}`; }
  async final(serverFirst: string): Promise<string> {
    const a = Object.fromEntries(serverFirst.split(',').map((p) => [p[0]!, p.slice(2)]));
    if (!a.r!.startsWith(this.nonce)) throw new Error('SCRAM: server nonce does not extend client nonce');
    const pk = await subtle.importKey('raw', bs(bytes(this.password)), 'PBKDF2', false, ['deriveBits']);
    const salted = new Uint8Array(await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: bs(unb64(a.s!)), iterations: parseInt(a.i!, 10) }, pk, 256));
    const clientKey = await hmac(salted, bytes('Client Key'));
    const storedKey = await sha256(clientKey);
    const withoutProof = `c=biws,r=${a.r}`;
    const authMessage = bytes(`${this.bare},${serverFirst},${withoutProof}`);
    const sig = await hmac(storedKey, authMessage);
    const proof = clientKey.map((x, i) => x ^ sig[i]!);
    this.serverSig = await hmac(await hmac(salted, bytes('Server Key')), authMessage);
    return `${withoutProof},p=${b64(proof)}`;
  }
  verify(serverFinal: string): void {
    const v = serverFinal.split(',').find((p) => p.startsWith('v='));
    if (!v || !this.serverSig) throw new Error('SCRAM: no server signature');
    const got = unb64(v.slice(2));
    if (got.length !== this.serverSig.length || got.some((x, i) => x !== this.serverSig![i])) throw new Error('SCRAM: server signature mismatch');
  }
}

export interface LoginInfo { pid: number; key: number; mechs: string[]; authCodes: number[]; params: Record<string, string> }

/** StartupMessage and authentication up to ReadyForQuery. Throws on ErrorResponse with the SQLSTATE in the message. */
export async function login(c: Conn, t: Target, appName: string, timeoutMs = 15000): Promise<LoginInfo> {
  await c.write(startup({ user: t.user, database: t.database, client_encoding: 'UTF8', application_name: appName }));
  const info: LoginInfo = { pid: 0, key: 0, mechs: [], authCodes: [], params: {} };
  let scram: Scram | null = null;
  for (;;) {
    const m = await c.readMessage(timeoutMs);
    if (m.type === 'R') {
      const code = new DataView(m.body.buffer, m.body.byteOffset, 4).getInt32(0);
      info.authCodes.push(code);
      if (code === 0) continue;
      if (code === 10) {
        let off = 4; while (m.body[off] !== 0) { const [s, n] = readCString(m.body, off); info.mechs.push(s); off = n; }
        scram = new Scram(t.password);
        await c.write(saslInitial('SCRAM-SHA-256', bytes(scram.first())));
      } else if (code === 11) await c.write(passwordMsg(bytes(await scram!.final(text(m.body.subarray(4))))));
      else if (code === 12) scram!.verify(text(m.body.subarray(4)));
      else throw new Error('unsupported authentication request ' + code);
    } else if (m.type === 'S') { const [k, v] = decodeParameterStatus(m.body); info.params[k] = v; }
    else if (m.type === 'K') { const dv = new DataView(m.body.buffer, m.body.byteOffset, 8); info.pid = dv.getInt32(0); info.key = dv.getInt32(4); }
    else if (m.type === 'Z') return info;
    else if (m.type === 'E') { const e = decodeError(m.body); throw new PgFail(e.code ?? '', e.message ?? ''); }
  }
}
export class PgFail extends Error { constructor(public code: string, message: string) { super(`${code} ${message}`); } }

export interface QueryResult { rows: (string | null)[][]; tags: string[]; error?: { code: string; message: string }; ready: boolean }
/** Collects backend messages until ReadyForQuery (or an exception). */
export async function collect(c: Conn, timeoutMs = 30000): Promise<QueryResult> {
  const r: QueryResult = { rows: [], tags: [], ready: false };
  for (;;) {
    const m = await c.readMessage(timeoutMs);
    if (m.type === 'D') r.rows.push(decodeDataRow(m.body));
    else if (m.type === 'C') r.tags.push(text(m.body.subarray(0, m.body.length - 1)));
    else if (m.type === 'E') { const e = decodeError(m.body); r.error = { code: e.code ?? '', message: e.message ?? '' }; }
    else if (m.type === 'Z') { r.ready = true; return r; }
  }
}
export async function simple(c: Conn, sql: string, timeoutMs = 30000): Promise<QueryResult> { await c.write(query(sql)); return collect(c, timeoutMs); }

export async function terminateAndClose(c: Conn): Promise<void> { try { await c.write(terminate()); } catch { /* ignore */ } await c.close(); }

/** The 16-byte CancelRequest. */
export const cancelRequest = (pid: number, key: number): Uint8Array => { const b = new Uint8Array(16); const dv = new DataView(b.buffer); dv.setInt32(0, 16); dv.setInt32(4, 80877102); dv.setInt32(8, pid); dv.setInt32(12, key); return b; };
export { sslRequest };

/**
 * Sends `select encode(sha256($1::bytea),'hex'), length($1::bytea)` with a bytea parameter of `size` bytes in binary format.
 * mode 'single': the whole frame in one write. mode 'chunk': header, then `chunk`-byte writes, then trailer + Sync.
 */
export async function bigBind(c: Conn, size: number, seed: number, mode: 'single' | 'chunk', chunk: number, awaitEach = true): Promise<{ writeMs: number; writes: number; maxDesired: number; minDesired: number }> {
  const sql = "select encode(sha256($1::bytea),'hex'), length($1::bytea)";
  const p = parse('', sql, [17]);
  const parts = bindByteaParts(size);
  const t0 = performance.now(); let writes = 0; let maxD = -Infinity, minD = Infinity;
  const track = () => { const d = c.writer.desiredSize; if (d !== null) { maxD = Math.max(maxD, d); minD = Math.min(minD, d); } };
  if (mode === 'single') {
    const ex = execute('', 0); const sy = sync();
    const full = new Uint8Array(p.length + parts.total + ex.length + sy.length);
    let o = 0;
    full.set(p, o); o += p.length;
    full.set(parts.head, o); o += parts.head.length;
    fillPayload(full.subarray(o, o + size), seed, 0); o += size;
    full.set(parts.tail, o); o += parts.tail.length;
    full.set(ex, o); o += ex.length; full.set(sy, o);
    writes = 1; track(); await c.write(full); track();
  } else {
    await c.write(u8(p, parts.head)); writes++;
    const pending: Promise<void>[] = [];
    for (let off = 0; off < size; off += chunk) {
      const n = Math.min(chunk, size - off); const b = new Uint8Array(n); fillPayload(b, seed, off);
      track();
      const w = c.write(b); writes++;
      if (awaitEach) await w; else pending.push(w);
      track();
    }
    await Promise.all(pending);
    await c.write(u8(parts.tail, execute('', 0), sync())); writes++;
  }
  return { writeMs: performance.now() - t0, writes, maxDesired: maxD, minDesired: minD };
}

/** COPY of one bytea value in binary format; the data goes out as CopyData messages of at most `chunk` bytes. */
export async function bigCopy(c: Conn, table: string, size: number, seed: number, chunk: number): Promise<{ writeMs: number; writes: number; result: QueryResult }> {
  const t0 = performance.now(); let writes = 0;
  await c.write(query(`copy ${table}(payload) from stdin (format binary)`)); writes++;
  const m = await c.readMessage(); if (m.type !== 'G') throw new Error('expected CopyInResponse, got ' + m.type);
  const parts = copyBinaryParts(size);
  await c.write(typed('d', parts.head)); writes++;
  for (let off = 0; off < size; off += chunk) {
    const n = Math.min(chunk, size - off); const b = new Uint8Array(n); fillPayload(b, seed, off);
    await c.write(typed('d', b)); writes++;
  }
  await c.write(u8(typed('d', parts.tail), typed('c'))); writes++;
  const result = await collect(c);
  return { writeMs: performance.now() - t0, writes, result };
}

export async function openPg(connect: ConnectFn, t: Target, o: { secureTransport: 'on' | 'off' | 'starttls'; hostname?: string; connectOpts?: Record<string, unknown>; openedTimeoutMs?: number }): Promise<Conn> {
  const s: SockLike = connect({ hostname: o.hostname ?? t.host, port: t.port }, { secureTransport: o.secureTransport, allowHalfOpen: false, ...(o.connectOpts ?? {}) });
  const c = new Conn(s);
  if (o.secureTransport === 'on') c.tls = true;
  return c;
}
export { errInfo };
