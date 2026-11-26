// Decorators used by the client harness: observation at the adapter boundary (what the core is handed), and the planted faults.
import { createHash } from 'node:crypto';
import type { Transport, TransportHandlers, TlsOptions, RawStats } from './transport.ts';

/** Records, at the boundary between adapter and core: delivery boundaries, a hash of every delivered byte, terminal calls, data after terminal. */
export class Tapped implements Transport {
  readonly inner: Transport;
  readonly stats: RawStats;
  readonly name: string;
  hash = createHash('sha256');
  bytes = 0;
  deliveries = 0;
  bounds: number[] = [];
  terminalCalls = 0;
  terminalError: string | null = null;
  dataAfterTerminal = 0;
  endCalls = 0;
  recordBounds = true;
  /** set by the harness around core.receive to count messages per delivery */
  onDelivery: ((c: Uint8Array) => void) | null = null;
  constructor(inner: Transport) { this.inner = inner; this.stats = inner.stats; this.name = inner.name; }
  connect(host: string, port: number, h: TransportHandlers, tls?: TlsOptions): Promise<void> {
    return this.inner.connect(host, port, {
      onData: (c) => {
        if (this.terminalCalls) { this.dataAfterTerminal++; return; }
        this.hash.update(c); this.bytes += c.length; this.deliveries++;
        if (this.recordBounds) this.bounds.push(this.bytes);
        this.onDelivery?.(c);
        h.onData(c);
      },
      onDrain: () => h.onDrain(),
      onEnd: () => { this.endCalls++; h.onEnd(); },
      onClose: (e) => { this.terminalCalls++; if (e) this.terminalError = e.message; h.onClose(e); },
    }, tls);
  }
  write(d: Uint8Array): boolean { return this.inner.write(d); }
  pause(): void { this.inner.pause(); }
  resume(): void { this.inner.resume(); }
  upgradeTLS(o: TlsOptions): Promise<void> { return this.inner.upgradeTLS(o); }
  endWrite(): void { this.inner.endWrite(); }
  destroy(): void { this.inner.destroy(); }
  setNoDelay(on: boolean): void { this.inner.setNoDelay(on); }
  setKeepAlive(on: boolean, ms: number): void { this.inner.setKeepAlive(on, ms); }
  peerCertificate(): Uint8Array | null { return this.inner.peerCertificate(); }
  alpnProtocol(): string | null { return this.inner.alpnProtocol(); }
}

export type Fault = 'keep_view' | 'drop_byte_at_edge' | 'duplicate_chunk';

/** Planted faults. Each wraps a real adapter and breaks one thing the suite must notice. */
export class Faulty implements Transport {
  readonly inner: Transport;
  readonly stats: RawStats;
  readonly name: string;
  private kind: Fault;
  private n = 0;
  private held: Uint8Array | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  constructor(inner: Transport, kind: Fault) { this.inner = inner; this.kind = kind; this.stats = inner.stats; this.name = `${inner.name}+${kind}`; }
  connect(host: string, port: number, h: TransportHandlers, tls?: TlsOptions): Promise<void> {
    const release = (): void => { if (this.held) { const v = this.held; this.held = null; h.onData(v); } };
    return this.inner.connect(host, port, {
      onData: (c) => {
        this.n++;
        if (this.kind === 'keep_view') {
          // keeps a view of the delivered bytes and hands the previous one to the core late: wrong exactly when the API reuses its buffer
          if (this.timer) clearTimeout(this.timer);
          release();
          this.held = c.subarray(0, c.length);
          this.timer = setTimeout(release, 5);
        } else if (this.kind === 'drop_byte_at_edge') {
          if (c.length >= 3 && this.n % 5 === 0) h.onData(c.subarray(0, c.length - 1)); else h.onData(c);
        } else {
          h.onData(c);
          if (this.n % 11 === 0) h.onData(Uint8Array.from(c));
        }
      },
      onDrain: () => h.onDrain(),
      onEnd: () => { release(); h.onEnd(); },
      onClose: (e) => { release(); h.onClose(e); },
    }, tls);
  }
  write(d: Uint8Array): boolean { return this.inner.write(d); }
  pause(): void { this.inner.pause(); }
  resume(): void { this.inner.resume(); }
  upgradeTLS(o: TlsOptions): Promise<void> { return this.inner.upgradeTLS(o); }
  endWrite(): void { this.inner.endWrite(); }
  destroy(): void { this.inner.destroy(); }
  setNoDelay(on: boolean): void { this.inner.setNoDelay(on); }
  setKeepAlive(on: boolean, ms: number): void { this.inner.setKeepAlive(on, ms); }
  peerCertificate(): Uint8Array | null { return this.inner.peerCertificate(); }
  alpnProtocol(): string | null { return this.inner.alpnProtocol(); }
}
