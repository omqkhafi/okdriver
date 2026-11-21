import type { ConnectionPool, PooledConnection } from "./contracts/index.ts";
import { cancelled } from "./failures.ts";

interface PoolWaiter<C> {
  resolve(p: PooledConnection<C>): void;
  reject(e: unknown): void;
  signal: AbortSignal;
  onAbort: () => void;
}

export interface SimplePoolOptions<C> {
  max: number;
  create(): Promise<C>;
  destroy(conn: C): void | Promise<void>;
}

/** A resource provider for engines that have persistent connections. Creation is decoupled from the waiter that triggered it. */
export class SimplePool<C> implements ConnectionPool<C> {
  private idle: C[] = [];
  private waiters: PoolWaiter<C>[] = [];
  private size = 0;
  private creating = 0;
  private closed = false;
  private busy = 0;
  constructor(private readonly o: SimplePoolOptions<C>) {}

  get stats(): { size: number; idle: number; busy: number; waiting: number } {
    return { size: this.size, idle: this.idle.length, busy: this.busy, waiting: this.waiters.length };
  }

  acquire(signal: AbortSignal): Promise<PooledConnection<C>> {
    if (signal.aborted) return Promise.reject(cancelled("aborted before acquire"));
    if (this.waiters.length === 0 && this.idle.length > 0) return Promise.resolve(this.wrap(this.idle.pop() as C));
    return new Promise((resolve, reject) => {
      const w: PoolWaiter<C> = {
        resolve,
        reject,
        signal,
        onAbort: () => {
          const i = this.waiters.indexOf(w);
          if (i < 0) return;
          this.waiters.splice(i, 1);
          reject(cancelled("aborted while waiting for a connection"));
        },
      };
      signal.addEventListener("abort", w.onAbort, { once: true });
      this.waiters.push(w);
      this.pump();
    });
  }

  private wrap(conn: C): PooledConnection<C> {
    this.busy++;
    let done = false;
    return {
      conn,
      release: () => {
        if (done) return;
        done = true;
        this.busy--;
        if (this.closed) void this.o.destroy(conn);
        else this.idle.push(conn);
        this.pump();
      },
      destroy: () => {
        if (done) return;
        done = true;
        this.busy--;
        this.size--;
        void this.o.destroy(conn);
        this.pump();
      },
    };
  }

  private pump(): void {
    while (this.waiters.length > 0 && this.idle.length > 0) {
      const w = this.waiters.shift() as PoolWaiter<C>;
      w.signal.removeEventListener("abort", w.onAbort);
      w.resolve(this.wrap(this.idle.pop() as C));
    }
    while (!this.closed && this.waiters.length > this.creating && this.size < this.o.max) {
      this.size++;
      this.creating++;
      this.o.create().then(
        (conn) => {
          this.creating--;
          this.idle.push(conn);
          this.pump();
        },
        (err) => {
          this.creating--;
          this.size--;
          const w = this.waiters.shift();
          if (w !== undefined) {
            w.signal.removeEventListener("abort", w.onAbort);
            w.reject(err);
          }
          this.pump();
        },
      );
    }
  }

  async drain(deadline: number): Promise<void> {
    this.closed = true;
    for (const w of this.waiters.splice(0)) {
      w.signal.removeEventListener("abort", w.onAbort);
      w.reject(cancelled("pool drained"));
    }
    while (this.busy > 0 || this.creating > 0) {
      if (Date.now() > deadline) break;
      await new Promise((r) => setTimeout(r, 5));
    }
    for (const c of this.idle.splice(0)) {
      this.size--;
      await this.o.destroy(c);
    }
  }
}

/** Retry `attempt` while it fails with a connection-class error, until `timeoutMs` has passed or `signal` aborts. */
export async function connectWithRetry<T>(
  attempt: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let delay = 20;
  for (;;) {
    if (signal.aborted) throw cancelled("aborted while connecting", "connect");
    try {
      return await attempt(signal);
    } catch (e) {
      const retryable = typeof e === "object" && e !== null && (e as { class?: string }).class === "connection";
      if (!retryable || Date.now() + delay > deadline) throw e;
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(delay * 2, 250);
    }
  }
}
