// Bun-side `connect()` with the cloudflare:sockets shape (readable/writable web streams, opened, closed, close, startTls) on top of
// node:net and node:tls. The control runs the very same probe code as the Worker through this adapter, so a probe that passes here and
// fails in workerd shows a platform difference and not a probe defect. Embedder-level TLS trust is the `ca` option given at creation.
import net from 'node:net';
import tls from 'node:tls';
import type { SockLike, ConnectFn } from '../../worker/src/sock.ts';

export interface AdapterOpts { ca?: string; rejectUnauthorized?: boolean; connectTimeoutMs?: number }

class NodeSock implements SockLike {
  readable: ReadableStream<Uint8Array>; writable: WritableStream<Uint8Array>; opened: Promise<unknown>; closed: Promise<void>;
  private raw: net.Socket | tls.TLSSocket;
  private ctrl!: ReadableStreamDefaultController<Uint8Array>;
  private readonly onData = (d: Buffer) => { try { this.ctrl.enqueue(new Uint8Array(d)); } catch { /* closed */ } };
  constructor(private o: AdapterOpts, private host: string, sock: net.Socket | tls.TLSSocket, private secure: 'on' | 'off' | 'starttls', alreadyOpen = false) {
    this.raw = sock;
    this.readable = new ReadableStream<Uint8Array>({
      start: (c) => { this.ctrl = c; sock.on('data', this.onData); sock.on('end', () => { try { c.close(); } catch { /* */ } }); sock.on('error', (e) => { try { c.error(e); } catch { /* */ } }); },
      pull: () => { sock.resume(); }, cancel: () => { sock.destroy(); },
    }, { highWaterMark: 0 });
    this.writable = new WritableStream<Uint8Array>({
      write: (chunk) => new Promise<void>((res, rej) => { if (sock.write(chunk, (e) => (e ? rej(e) : res()))) { /* flushed or buffered */ } }),
      close: () => new Promise<void>((res) => sock.end(() => res())),
      abort: () => { sock.destroy(); },
    });
    this.closed = new Promise<void>((res) => sock.once('close', () => res()));
    this.opened = alreadyOpen ? Promise.resolve({ remoteAddress: '' }) : new Promise((res, rej) => {
      const ev = secure === 'on' ? 'secureConnect' : 'connect';
      sock.once(ev, () => res({ remoteAddress: '' })); sock.once('error', rej);
    });
    this.opened.catch(() => { /* surfaced by the caller */ });
  }
  async close(): Promise<void> { this.raw.destroy(); await this.closed; }
  startTls(options?: Record<string, unknown>): SockLike {
    if (this.secure !== 'starttls') throw new TypeError('startTls() can only be called on a socket created with secureTransport "starttls"');
    this.raw.off('data', this.onData);
    this.raw.pause();
    const op = { ...((this as any).connectOpts ?? {}), ...((options ?? {}) as Record<string, any>) };
    const name = (op.servername as string | undefined) ?? (op.expectedServerHostname as string | undefined) ?? this.host;
    const alpn = (op.alpn ?? op.alpnProtocols) as string[] | undefined;
    const t = tls.connect({ socket: this.raw as net.Socket, servername: net.isIP(name) ? undefined : name, ca: (op.ca as string | undefined) ?? this.o.ca, rejectUnauthorized: (op.rejectUnauthorized as boolean | undefined) ?? this.o.rejectUnauthorized ?? true,
      ...(alpn ? { ALPNProtocols: alpn } : {}), ...(op.cert ? { cert: op.cert as string, key: op.key as string } : {}), ...(op.expectedServerHostname ? { checkServerIdentity: (_h: string, c: tls.PeerCertificate) => tls.checkServerIdentity(op.expectedServerHostname as string, c) } : {}) });
    return new NodeSock(this.o, this.host, t, 'off', true);
  }
}

export const nodeConnect = (o: AdapterOpts = {}): ConnectFn => (addr, opts) => {
  const secure = ((opts?.secureTransport as string) ?? 'off') as 'on' | 'off' | 'starttls';
  const op = (opts ?? {}) as Record<string, any>; const alpn = (op.alpn ?? op.alpnProtocols) as string[] | undefined;
  const sock = secure === 'on' ? tls.connect({ host: addr.hostname, port: addr.port, servername: (op.servername as string | undefined) ?? (net.isIP(addr.hostname) ? undefined : addr.hostname), ca: (op.ca as string | undefined) ?? o.ca, rejectUnauthorized: (op.rejectUnauthorized as boolean | undefined) ?? o.rejectUnauthorized ?? true, ...(alpn ? { ALPNProtocols: alpn } : {}), ...(op.cert ? { cert: op.cert as string, key: op.key as string } : {}) }) : net.connect({ host: addr.hostname, port: addr.port });
  sock.setNoDelay(true);
  const ns = new NodeSock(o, addr.hostname, sock, secure); (ns as any).connectOpts = op; return ns;
};
