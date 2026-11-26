// Copied from research/fs-06/scripts/lib/client.ts at commit 5930580; unchanged except the two import paths.
// Minimal PostgreSQL v3 client for FS-06: startup, MD5/cleartext/SCRAM-SHA-256 authentication, optional TLS
// (SSLRequest, then TLS with SNI), raw writes and message collection. It keeps its own timestamped trace of
// every write and every read, so a hosted target (where the bytes are TLS) still has a client-side record.
import net from 'node:net';
import tls from 'node:tls';
import { createHash } from 'node:crypto';
import { MessageReader, type BackendMessage, startup, sslRequest, passwordMsg, saslInitial, terminate, readCString, decodeError, decodeParameterStatus, u8, bytes, text } from '../../worker/src/wire.ts';
import { ScramClient } from './scram-node.ts';

export const nowMs = (): number => performance.timeOrigin + performance.now();

export interface ConnOptions {
  host: string; port: number; user: string; password: string; database: string;
  appName?: string;
  /** Extra StartupMessage parameters, e.g. `options`. */
  params?: Record<string, string>;
  tls?: { servername?: string; ca?: string; rejectUnauthorized?: boolean } | false;
  connectTimeoutMs?: number;
}

export interface TraceEv { t: number; dir: 'w' | 'r'; bytes: number }
export interface Timed extends BackendMessage { t: number }

export class ConnClosed extends Error {}

export class PgConn {
  sock!: net.Socket | tls.TLSSocket;
  private reader = new MessageReader();
  private inbox: Timed[] = [];
  private wake: (() => void) | null = null;
  ended = false;
  endError: string | null = null;
  trace: TraceEv[] = [];
  parameterStatus: [string, string][] = [];
  backendPid = 0;
  authMethod = '';
  /** Message types and lengths seen during login (no secrets are kept). */
  loginMessages: { dir: 'in' | 'out'; type: string; len: number; detail?: string }[] = [];
  tlsUsed = false;
  tlsProtocol = '';

  static async connect(o: ConnOptions): Promise<PgConn> {
    const c = new PgConn();
    await c.open(o);
    return c;
  }

  private onRaw(chunk: Buffer) {
    this.trace.push({ t: nowMs(), dir: 'r', bytes: chunk.length });
    for (const m of this.reader.push(chunk)) this.inbox.push({ ...m, t: nowMs() });
    this.notify();
  }
  private notify() { const w = this.wake; this.wake = null; w?.(); }

  private attach(s: net.Socket | tls.TLSSocket) {
    this.sock = s;
    s.on('data', (d: Buffer) => this.onRaw(d));
    s.on('close', () => { this.ended = true; this.notify(); });
    s.on('error', (e) => { this.endError = String(e.message ?? e); this.ended = true; this.notify(); });
    s.on('end', () => { this.ended = true; this.notify(); });
  }

  private async open(o: ConnOptions): Promise<void> {
    const raw = await new Promise<net.Socket>((res, rej) => {
      const s = net.connect({ host: o.host, port: o.port });
      s.setNoDelay(true);
      const to = setTimeout(() => { s.destroy(); rej(new Error('connect timeout')); }, o.connectTimeoutMs ?? 10000);
      s.once('connect', () => { clearTimeout(to); res(s); });
      s.once('error', (e) => { clearTimeout(to); rej(e); });
    });
    if (o.tls) {
      raw.write(sslRequest());
      this.loginMessages.push({ dir: 'out', type: 'SSLRequest', len: 8 });
      const ans: Buffer = await new Promise((res, rej) => {
        raw.once('data', res); raw.once('error', rej); raw.once('close', () => rej(new Error('closed during SSLRequest')));
      });
      const letter = String.fromCharCode(ans[0]!);
      this.loginMessages.push({ dir: 'in', type: 'SSLResponse', len: 1, detail: letter });
      if (letter !== 'S') throw new Error(`server answered ${letter} to SSLRequest`);
      const sn = o.tls.servername ?? o.host; // TLS forbids an IP address as server name: then no SNI is sent
      const ts = tls.connect({ socket: raw, servername: net.isIP(sn) ? undefined : sn, ca: o.tls.ca, rejectUnauthorized: o.tls.rejectUnauthorized ?? true });
      await new Promise<void>((res, rej) => { ts.once('secureConnect', () => res()); ts.once('error', rej); });
      this.tlsUsed = true; this.tlsProtocol = ts.getProtocol() ?? '';
      this.attach(ts);
    } else {
      this.attach(raw);
    }
    const params: Record<string, string> = { user: o.user, database: o.database, client_encoding: 'UTF8', ...(o.appName ? { application_name: o.appName } : {}), ...(o.params ?? {}) };
    const sm = startup(params);
    this.write(sm);
    this.loginMessages.push({ dir: 'out', type: 'StartupMessage', len: sm.length });
    await this.login(o);
  }

  private async login(o: ConnOptions): Promise<void> {
    let scram: ScramClient | null = null;
    for (;;) {
      const m = await this.next(o.connectTimeoutMs ?? 15000);
      if (m.type === 'R') {
        const code = new DataView(m.body.buffer, m.body.byteOffset, 4).getInt32(0);
        this.loginMessages.push({ dir: 'in', type: 'R', len: m.body.length + 4, detail: `auth=${code}` });
        if (code === 0) continue;
        if (code === 3) { this.authMethod = 'cleartext'; const b = u8(bytes(o.password), [0]); this.write(passwordMsg(b)); this.loginMessages.push({ dir: 'out', type: 'p', len: b.length + 4 }); }
        else if (code === 5) {
          this.authMethod = 'md5';
          const salt = m.body.subarray(4, 8);
          const inner = createHash('md5').update(o.password + o.user).digest('hex');
          const outer = 'md5' + createHash('md5').update(Buffer.concat([Buffer.from(inner), Buffer.from(salt)])).digest('hex');
          const b = u8(bytes(outer), [0]); this.write(passwordMsg(b)); this.loginMessages.push({ dir: 'out', type: 'p', len: b.length + 4 });
        } else if (code === 10) {
          const mechs: string[] = []; let off = 4;
          while (m.body[off] !== 0) { const [s, n] = readCString(m.body, off); mechs.push(s); off = n; }
          if (!mechs.includes('SCRAM-SHA-256')) throw new Error('server offers no SCRAM-SHA-256: ' + mechs.join(','));
          this.authMethod = 'scram-sha-256';
          scram = new ScramClient(o.user, o.password);
          const first = bytes(scram.first());
          const w = saslInitial('SCRAM-SHA-256', first); this.write(w); this.loginMessages.push({ dir: 'out', type: 'p', len: w.length - 1 });
        } else if (code === 11) {
          const fin = bytes(scram!.final(text(m.body.subarray(4))));
          const w = passwordMsg(fin); this.write(w); this.loginMessages.push({ dir: 'out', type: 'p', len: w.length - 1 });
        } else if (code === 12) { scram!.verify(text(m.body.subarray(4))); }
        else throw new Error('unsupported authentication request ' + code);
      } else if (m.type === 'S') {
        this.parameterStatus.push(decodeParameterStatus(m.body));
        this.loginMessages.push({ dir: 'in', type: 'S', len: m.body.length + 4 });
      } else if (m.type === 'K') {
        this.backendPid = new DataView(m.body.buffer, m.body.byteOffset, 4).getInt32(0);
        this.loginMessages.push({ dir: 'in', type: 'K', len: m.body.length + 4 });
      } else if (m.type === 'Z') {
        this.loginMessages.push({ dir: 'in', type: 'Z', len: 5 });
        return;
      } else if (m.type === 'E') {
        const e = decodeError(m.body);
        this.loginMessages.push({ dir: 'in', type: 'E', len: m.body.length + 4, detail: `${e.code} ${e.message}` });
        throw new Error(`login failed: ${e.code} ${e.message}`);
      } else if (m.type === 'N') {
        this.loginMessages.push({ dir: 'in', type: 'N', len: m.body.length + 4 });
      } else {
        this.loginMessages.push({ dir: 'in', type: m.type, len: m.body.length + 4 });
      }
    }
  }

  write(b: Uint8Array): void {
    this.trace.push({ t: nowMs(), dir: 'w', bytes: b.length });
    this.sock.write(b);
  }

  /** Next backend message, or throws ConnClosed / timeout. */
  private async next(timeoutMs: number): Promise<Timed> {
    const deadline = performance.now() + timeoutMs;
    for (;;) {
      const m = this.inbox.shift();
      if (m) return m;
      if (this.ended) throw new ConnClosed(this.endError ?? 'connection closed');
      const left = deadline - performance.now();
      if (left <= 0) throw new Error('timeout');
      await new Promise<void>((res) => { this.wake = res; setTimeout(res, left); });
    }
  }

  /**
   * Reads until `syncs` ReadyForQuery messages were seen. A single frontend flush may hold several Syncs.
   * Never throws: returns what was seen plus how it ended.
   */
  async collect(syncs: number, timeoutMs = 10000): Promise<Collected> {
    const msgs: Timed[] = [];
    let z = 0; let end: Collected['end'] = 'ok'; let reason = '';
    const deadline = performance.now() + timeoutMs;
    while (z < syncs) {
      try {
        const m = await this.next(Math.max(1, deadline - performance.now()));
        msgs.push(m);
        if (m.type === 'Z') z++;
      } catch (e: any) {
        if (e instanceof ConnClosed) { end = 'closed'; reason = e.message; } else { end = 'timeout'; reason = e.message; }
        break;
      }
    }
    return { msgs, end, reason, readyCount: z };
  }

  /** Reads at least `count` backend messages (used after a Flush, which produces no ReadyForQuery). */
  async collectAny(count: number, timeoutMs = 10000): Promise<Collected> {
    const msgs: Timed[] = []; let end: Collected['end'] = 'ok'; let reason = '';
    const deadline = performance.now() + timeoutMs;
    while (msgs.length < count) {
      try { msgs.push(await this.next(Math.max(1, deadline - performance.now()))); }
      catch (e: any) { if (e instanceof ConnClosed) { end = 'closed'; reason = e.message; } else { end = 'timeout'; reason = e.message; } break; }
    }
    return { msgs, end, reason, readyCount: 0 };
  }

  /** Message type letters of everything not yet consumed, e.g. to detect unexpected trailing traffic. */
  pending(): Timed[] { return this.inbox.splice(0); }

  close(): void {
    try { if (!this.ended) this.sock.write(terminate()); } catch { /* ignore */ }
    try { this.sock.destroy(); } catch { /* ignore */ }
    this.ended = true;
  }
  destroy(): void { try { this.sock.destroy(); } catch { /* ignore */ } this.ended = true; }
}

export interface Collected { msgs: Timed[]; end: 'ok' | 'timeout' | 'closed'; reason: string; readyCount: number }
