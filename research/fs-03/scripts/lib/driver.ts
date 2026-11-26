// Shared glue between one Transport and the core, identical for every candidate: the SSLRequest/TLS upgrade sequence, flushing the
// core's output, write backpressure for CopyData, and the workloads. Callbacks, not promises, in the hot paths.
import { PgCore, COPY_BLOCK_BYTES, type StatementResult, type CoreOptions } from './core.ts';
import type { Transport, TlsOptions } from './transport.ts';

export interface OpenOptions extends CoreOptions { tls?: { mode: 'upgrade' | 'direct'; opts: TlsOptions } }

export class Conn {
  core: PgCore;
  t: Transport;
  /** called once when the connection ends for any reason after open */
  onTerminal: ((e: Error) => void) | null = null;
  /** called after each received chunk was processed and output flushed */
  afterReceive: (() => void) | null = null;
  terminalCalls = 0;
  private sslWait: ((c: Uint8Array) => void) | null = null;
  private blocked = false;
  private copyLeft = 0;
  private copyDoneCb: (() => void) | null = null;
  private paused = false;

  constructor(t: Transport, opts: CoreOptions) {
    this.t = t;
    this.core = new PgCore(opts);
    this.core.onCopyIn = () => this.pumpCopy();
    this.core.onFail = (e) => { this.terminalCalls++; this.onTerminal?.(e); };
  }

  async open(host: string, port: number, tls?: OpenOptions['tls']): Promise<void> {
    await this.t.connect(host, port, {
      onData: (c) => this.data(c),
      onDrain: () => { this.blocked = false; this.pumpCopy(); },
      onEnd: () => {},
      onClose: (err) => this.core.connectionLost(err ?? new Error('connection closed')),
    }, tls?.mode === 'direct' ? tls.opts : undefined);
    if (tls?.mode === 'upgrade') {
      const reply = new Promise<Uint8Array>((resolve) => { this.sslWait = (c) => resolve(Uint8Array.from(c)); });
      this.core.sslRequest();
      this.flush();
      const accepted = this.core.sslReply(await reply);
      this.sslWait = null;
      if (!accepted) throw new Error('server refused SSLRequest');
      await this.t.upgradeTLS(tls.opts);
    }
    await new Promise<void>((resolve, reject) => {
      this.core.onReady = resolve;
      const prev = this.core.onFail;
      this.core.onFail = (e) => { reject(e); prev?.(e); };
      this.core.startup();
      this.flush();
    });
    this.core.onFail = (e) => { this.terminalCalls++; this.onTerminal?.(e); };
  }

  private data(c: Uint8Array): void {
    if (this.sslWait) { this.sslWait(c); return; }
    this.core.receive(c);
    this.flush();
    this.afterReceive?.();
  }
  flush(): void {
    const b = this.core.take();
    if (b) { if (!this.t.write(b)) this.blocked = true; }
  }
  private pumpCopy(): void {
    while (this.copyLeft > 0 && !this.blocked) {
      this.copyLeft -= COPY_BLOCK_BYTES;
      if (!this.t.write(this.core.copyBlock())) this.blocked = true;
    }
    if (this.copyLeft <= 0 && !this.blocked && this.copyDoneCb) { const cb = this.copyDoneCb; this.copyDoneCb = null; this.core.copyDone(); this.flush(); cb(); }
  }
  pauseReads(): void { if (!this.paused) { this.paused = true; this.t.pause(); } }
  resumeReads(): void { if (this.paused) { this.paused = false; this.t.resume(); } }

  /** one statement, one result */
  query(sql: string): Promise<StatementResult> {
    return new Promise((resolve, reject) => {
      this.core.onResult = resolve;
      this.onTerminal = reject;
      this.core.execute(sql);
      this.flush();
    });
  }

  // ---------- workloads ----------
  /** W1: `n` statements, one in flight. Returns seconds and per-statement latencies in microseconds. */
  w1(sql: string, n: number): Promise<{ seconds: number; lat: Float64Array }> {
    return new Promise((resolve, reject) => {
      const lat = new Float64Array(n);
      let i = 0, t0 = 0;
      const t00 = performance.now();
      this.onTerminal = reject;
      this.core.onResult = (r) => {
        if (r.error) return reject(new Error(r.error.message));
        const now = performance.now();
        lat[i++] = (now - t0) * 1000;
        if (i === n) return resolve({ seconds: (now - t00) / 1000, lat });
        t0 = now; this.core.execute(sql); this.flush();
      };
      t0 = performance.now(); this.core.execute(sql); this.flush();
    });
  }
  /** W2: `n` statements with `depth` in flight, refilled once per received chunk. */
  w2(sql: string, n: number, depth: number): Promise<{ seconds: number }> {
    return new Promise((resolve, reject) => {
      let issued = 0, done = 0;
      const t0 = performance.now();
      this.onTerminal = reject;
      const top = (): void => {
        while (issued < n && issued - done < depth) { this.core.execute(sql); issued++; }
        this.flush();
      };
      this.core.onResult = (r) => {
        if (r.error) return reject(new Error(r.error.message));
        if (++done === n) { this.afterReceive = null; resolve({ seconds: (performance.now() - t0) / 1000 }); }
      };
      this.afterReceive = top;
      top();
    });
  }
  /** W3: one statement whose answer is a long stream of DataRows. */
  w3(sql: string): Promise<{ seconds: number; rows: number; bytes: number }> {
    return new Promise((resolve, reject) => {
      const t0 = performance.now();
      this.onTerminal = reject;
      this.core.onResult = (r) => { if (r.error) reject(new Error(r.error.message)); else resolve({ seconds: (performance.now() - t0) / 1000, rows: r.rows, bytes: r.payloadBytes }); };
      this.core.execute(sql);
      this.flush();
    });
  }
  /** W4: CopyData frames, `bytes` in 1 MiB blocks, honouring write backpressure. */
  w4(sql: string, bytes: number): Promise<{ seconds: number; blocks: number }> {
    return new Promise((resolve, reject) => {
      const t0 = performance.now();
      this.onTerminal = reject;
      this.copyLeft = bytes;
      const blocks = Math.ceil(bytes / COPY_BLOCK_BYTES);
      this.copyDoneCb = () => {};
      this.core.onResult = (r) => { if (r.error) reject(new Error(r.error.message)); else resolve({ seconds: (performance.now() - t0) / 1000, blocks }); };
      this.core.simpleQuery(sql);
      this.flush();
    });
  }
}
