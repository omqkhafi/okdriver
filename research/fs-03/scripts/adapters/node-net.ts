// N and N-data: Node's `net` (Bun's Node-compatible one under Bun). mode 'onread' reads into one supplied buffer; mode 'data' uses data events.
import net from 'node:net';
import tls from 'node:tls';
import { newStats, type Transport, type TransportHandlers, type TlsOptions } from '../lib/transport.ts';

export class NodeNet implements Transport {
  readonly name: string;
  readonly stats = newStats();
  private mode: 'onread' | 'data';
  private sock: net.Socket | null = null;
  private h: TransportHandlers | null = null;
  private closed = false;
  private lastError: Error | undefined;
  private readBuf = Buffer.allocUnsafe(64 * 1024);
  private halfOpen: boolean;

  constructor(mode: 'onread' | 'data', opts: { allowHalfOpen?: boolean } = {}) {
    this.mode = mode;
    this.name = mode === 'onread' ? 'N' : 'N-data';
    this.halfOpen = opts.allowHalfOpen ?? false;
  }

  private data = (chunk: Uint8Array): void => {
    if (this.closed) { this.stats.dataAfterClose++; return; }
    this.stats.dataCalls++; this.stats.bytes += chunk.length;
    this.h!.onData(chunk);
  };
  private wire(s: net.Socket): void {
    s.on('error', (e) => { this.stats.errorEvents++; this.lastError = e; });
    s.on('close', () => { this.stats.closeEvents++; if (this.closed) return; this.closed = true; this.h!.onClose(this.lastError); });
    s.on('end', () => { this.stats.endEvents++; this.h!.onEnd(); });
    s.on('drain', () => { this.stats.drainEvents++; this.h!.onDrain(); });
  }

  connect(host: string, port: number, h: TransportHandlers, t?: TlsOptions): Promise<void> {
    this.h = h;
    return new Promise((resolve, reject) => {
      const ok = () => { s.off('error', fail); resolve(); };
      const fail = (e: Error) => reject(e);
      let s: net.Socket;
      if (t) {
        s = tls.connect({ host, port, servername: t.servername, ca: t.ca, rejectUnauthorized: t.rejectUnauthorized ?? true, ALPNProtocols: t.alpn });
        s.on('data', this.data);
        s.once('secureConnect', ok);
      } else if (this.mode === 'onread') {
        s = net.connect({ host, port, allowHalfOpen: this.halfOpen, onread: { buffer: this.readBuf, callback: (n: number, buf: Uint8Array) => { this.data(buf.subarray(0, n)); return true; } } });
        s.once('connect', ok);
      } else {
        s = net.connect({ host, port, allowHalfOpen: this.halfOpen });
        s.on('data', this.data);
        s.once('connect', ok);
      }
      s.once('error', fail);
      this.sock = s;
      this.wire(s);
    });
  }

  write(data: Uint8Array): boolean { return this.sock!.write(data); }
  pause(): void { this.sock!.pause(); }
  resume(): void { this.sock!.resume(); }
  endWrite(): void { this.sock!.end(); }
  destroy(): void { this.sock!.destroy(); }
  setNoDelay(on: boolean): void { this.sock!.setNoDelay(on); }
  setKeepAlive(on: boolean, ms: number): void { this.sock!.setKeepAlive(on, ms); }
  peerCertificate(): Uint8Array | null { const c = (this.sock as tls.TLSSocket).getPeerCertificate?.(true); return c && c.raw ? c.raw : null; }
  alpnProtocol(): string | null { const a = (this.sock as tls.TLSSocket).alpnProtocol; return typeof a === 'string' ? a : null; }

  upgradeTLS(t: TlsOptions): Promise<void> {
    const raw = this.sock!;
    return new Promise((resolve, reject) => {
      const s = tls.connect({ socket: raw, servername: t.servername, ca: t.ca, rejectUnauthorized: t.rejectUnauthorized ?? true, ALPNProtocols: t.alpn });
      s.on('data', this.data);
      s.once('secureConnect', () => { s.off('error', reject); this.sock = s; this.wire(s); resolve(); });
      s.once('error', reject);
    });
  }
}
