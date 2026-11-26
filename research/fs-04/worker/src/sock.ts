// Socket wrapper shared by the Worker and the Bun control. It only uses the Web streams surface, so the same
// probe code runs against `cloudflare:sockets` (Worker) and against a node:net adapter (Bun control).
export interface SockLike {
  readonly readable: ReadableStream<Uint8Array>;
  readonly writable: WritableStream<Uint8Array>;
  readonly opened: Promise<unknown>;
  readonly closed: Promise<unknown>;
  close(): Promise<void>;
  startTls(options?: Record<string, unknown>): SockLike;
}
export type ConnectFn = (addr: { hostname: string; port: number }, opts?: Record<string, unknown>) => SockLike;

export const errInfo = (e: unknown): { name: string; message: string } => {
  const x = e as { name?: string; message?: string };
  return { name: String(x?.name ?? typeof e), message: String(x?.message ?? e).slice(0, 400) };
};
export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
export const withTimeout = <T>(p: Promise<T>, ms: number, what = 'operation'): Promise<T> =>
  new Promise<T>((res, rej) => { const t = setTimeout(() => rej(new Error(`timeout: ${what} after ${ms} ms`)), ms); p.then((v) => { clearTimeout(t); res(v); }, (e) => { clearTimeout(t); rej(e); }); });

const cat = (a: Uint8Array, b: Uint8Array) => { if (!a.length) return b; const o = new Uint8Array(a.length + b.length); o.set(a); o.set(b, a.length); return o; };

export class Conn {
  reader!: ReadableStreamDefaultReader<Uint8Array>;
  writer!: WritableStreamDefaultWriter<Uint8Array>;
  buf: Uint8Array = new Uint8Array(0);
  written = 0;
  received = 0;
  tls = false;
  private pending: Promise<{ done: boolean; value?: Uint8Array }> | null = null;
  eof = false;
  constructor(public sock: SockLike) { this.lock(); }
  lock(): void { this.reader = this.sock.readable.getReader(); this.writer = this.sock.writable.getWriter(); }

  async write(b: Uint8Array): Promise<void> { this.written += b.length; await this.writer.write(b); }

  /** Waits for one chunk. Returns false on EOF. A timed-out wait keeps its read pending and the next call reuses it. */
  private async fill(timeoutMs: number): Promise<boolean> {
    if (this.eof) return false;
    this.pending ??= this.reader.read();
    const r = await withTimeout(this.pending, timeoutMs, 'read');
    this.pending = null;
    if (r.done || !r.value) { this.eof = true; return false; }
    this.received += r.value.length;
    this.buf = cat(this.buf, r.value);
    return true;
  }
  async readExact(n: number, timeoutMs = 10000): Promise<Uint8Array> {
    while (this.buf.length < n) if (!(await this.fill(timeoutMs))) throw new Error(`eof after ${this.buf.length} of ${n} bytes`);
    const out = this.buf.slice(0, n); this.buf = this.buf.slice(n); return out;
  }
  async readMessage(timeoutMs = 10000): Promise<{ type: string; body: Uint8Array }> {
    while (this.buf.length < 5 || this.buf.length < 1 + new DataView(this.buf.buffer, this.buf.byteOffset + 1, 4).getInt32(0)) {
      if (!(await this.fill(timeoutMs))) throw new Error('eof');
    }
    const len = new DataView(this.buf.buffer, this.buf.byteOffset + 1, 4).getInt32(0);
    const m = { type: String.fromCharCode(this.buf[0]!), body: this.buf.slice(5, 1 + len) };
    this.buf = this.buf.slice(1 + len);
    return m;
  }
  /** Reads until the peer closes; returns the number of bytes seen. */
  async drain(timeoutMs = 5000): Promise<{ bytes: number; ended: 'eof' | 'timeout' }> {
    let bytes = this.buf.length; this.buf = new Uint8Array(0);
    try { for (;;) { const before = this.received; if (!(await this.fill(timeoutMs))) return { bytes, ended: 'eof' }; bytes += this.received - before; this.buf = new Uint8Array(0); } }
    catch { return { bytes, ended: 'timeout' }; }
  }
  releaseLocks(which: 'both' | 'reader' | 'writer' = 'both'): void {
    if (which !== 'writer') this.reader.releaseLock();
    if (which !== 'reader') this.writer.releaseLock();
  }
  /** Releases both locks, upgrades, re-locks. Throws what startTls throws. */
  upgrade(opts?: Record<string, unknown>): void {
    this.releaseLocks('both');
    const s = this.sock.startTls(opts);
    this.sock = s; this.tls = true; this.pending = null; this.eof = false;
    this.lock();
  }
  async close(): Promise<void> {
    try { await withTimeout(this.sock.close(), 2000, 'close'); } catch { /* ignore */ }
  }
}
