// B: Bun.connect. Writes may be partial: the unwritten tail is kept and re-offered on the drain callback.
import { newStats, type Transport, type TransportHandlers, type TlsOptions } from '../lib/transport.ts';

type S = Bun.Socket<undefined>;

/** Bun takes ALPN as wire-format bytes (length-prefixed names); a plain string is accepted and silently not offered (found by the ALPN probe). */
const alpnBytes = (names?: string[]): Uint8Array | undefined => {
  if (!names) return undefined;
  const enc = names.map((n) => new TextEncoder().encode(n));
  const out = new Uint8Array(enc.reduce((a, e) => a + 1 + e.length, 0));
  let o = 0;
  for (const e of enc) { out[o++] = e.length; out.set(e, o); o += e.length; }
  return out;
};

export class BunConnect implements Transport {
  readonly name = 'B';
  readonly stats = newStats();
  private sock: S | null = null;
  private h: TransportHandlers | null = null;
  private closed = false;
  private lastError: Error | undefined;
  private queue: Uint8Array[] = [];
  private off = 0;
  private halfOpen: boolean;
  private tlsSock: S | null = null;
  /** after upgradeTLS the raw socket still reports the ciphertext; those callbacks are ignored */
  private upgraded = false;

  constructor(opts: { allowHalfOpen?: boolean } = {}) { this.halfOpen = opts.allowHalfOpen ?? false; }

  private handlers(tlsRole: boolean, onOpen?: (s: S) => void, onFail?: (e: Error) => void): Bun.SocketHandler<undefined, 'uint8array'> {
    const stale = (): boolean => !tlsRole && this.upgraded;
    return {
      binaryType: 'uint8array',
      open: (s) => { onOpen?.(s); },
      connectError: (_s, e) => { onFail?.(e); },
      data: (_s, d) => {
        if (stale()) return;
        if (this.closed) { this.stats.dataAfterClose++; return; }
        this.stats.dataCalls++; this.stats.bytes += d.length;
        this.h!.onData(d);
      },
      drain: () => { if (stale()) return; this.stats.drainEvents++; if (this.flushQueue()) this.h!.onDrain(); },
      end: () => { if (stale()) return; this.stats.endEvents++; this.h!.onEnd(); },
      error: (_s, e) => { if (stale()) return; this.stats.errorEvents++; this.lastError = e; },
      close: (_s, e) => {
        if (stale()) return;
        this.stats.closeEvents++;
        if (this.closed) return;
        this.closed = true;
        this.h!.onClose(e ?? this.lastError);
      },
    };
  }

  async connect(host: string, port: number, h: TransportHandlers, t?: TlsOptions): Promise<void> {
    this.h = h;
    await new Promise<void>((resolve, reject) => {
      Bun.connect<undefined>({
        hostname: host, port, allowHalfOpen: this.halfOpen,
        tls: t ? { serverName: t.servername, ca: t.ca, rejectUnauthorized: t.rejectUnauthorized ?? true, ALPNProtocols: alpnBytes(t.alpn) } : undefined,
        socket: this.handlers(false, (s) => { this.sock = s; resolve(); }, reject),
      } as unknown as Bun.SocketOptions<undefined> & Bun.TCPSocketConnectOptions).catch(reject);
    });
  }

  /** true when the queue is empty */
  private flushQueue(): boolean {
    const s = this.tlsSock ?? this.sock!;
    while (this.queue.length) {
      const d = this.queue[0]!;
      const n = s.write(d, this.off, d.length - this.off);
      this.off += n;
      if (this.off < d.length) return false;
      this.queue.shift(); this.off = 0;
    }
    return true;
  }
  write(data: Uint8Array): boolean {
    if (this.queue.length) { this.queue.push(data); return false; }
    const s = this.tlsSock ?? this.sock!;
    const n = s.write(data);
    if (n === data.length) return true;
    this.queue.push(data); this.off = n;
    return false;
  }
  pause(): void { (this.tlsSock ?? this.sock!).pause(); }
  resume(): void { (this.tlsSock ?? this.sock!).resume(); }
  endWrite(): void { (this.tlsSock ?? this.sock!).shutdown(); }
  destroy(): void { (this.tlsSock ?? this.sock!).end(); }
  setNoDelay(on: boolean): void { (this.tlsSock ?? this.sock!).setNoDelay(on); }
  setKeepAlive(on: boolean, ms: number): void { (this.tlsSock ?? this.sock!).setKeepAlive(on, ms); }
  peerCertificate(): Uint8Array | null {
    const c = (this.tlsSock ?? this.sock!).getPeerCertificate() as { raw?: Uint8Array } | null;
    return c && c.raw ? new Uint8Array(c.raw) : null;
  }
  alpnProtocol(): string | null {
    const s = this.tlsSock ?? this.sock!;
    const a = (s as unknown as { alpnProtocol?: string | false | null }).alpnProtocol;
    return typeof a === 'string' ? a : null;
  }

  async upgradeTLS(t: TlsOptions): Promise<void> {
    const raw = this.sock!;
    await new Promise<void>((resolve, reject) => {
      const handlers = this.handlers(true);
      this.upgraded = true;
      const hs: Bun.SocketHandler<undefined, 'uint8array'> = {
        ...handlers,
        handshake: (s, success, err) => { if (success) { this.tlsSock = s; resolve(); } else reject(err ?? new Error('TLS handshake failed')); },
        close: (s, e) => { if (!this.tlsSock) { reject(e ?? new Error('closed during TLS handshake')); return; } handlers.close!(s, e); },
        error: (s, e) => { if (!this.tlsSock) { reject(e); return; } handlers.error!(s, e); },
      };
      raw.upgradeTLS({ tls: { serverName: t.servername, ca: t.ca, rejectUnauthorized: t.rejectUnauthorized ?? true, ALPNProtocols: alpnBytes(t.alpn) }, socket: hs as unknown as Bun.SocketHandler<undefined> });
    });
  }
}
