import type { CoordinatorStats, ExecutionCoordinator, Lease, WorkItem } from "./contracts/index.ts";
import { cancelled, queueTimeout } from "./failures.ts";

interface Waiter {
  resolve(lease: Lease): void;
  reject(e: unknown): void;
  signal: AbortSignal;
  onAbort: () => void;
  timer: ReturnType<typeof setTimeout> | undefined;
  work: WorkItem;
}

/** FIFO admission with a concurrency limit. Governs every engine class. */
export class SimpleCoordinator implements ExecutionCoordinator {
  private active = 0;
  private maxActive = 0;
  private admitted = 0;
  private cancelledInQueue = 0;
  private timedOutInQueue = 0;
  private queue: Waiter[] = [];
  constructor(readonly limit: number) {}

  get stats(): CoordinatorStats {
    return {
      limit: this.limit,
      active: this.active,
      queued: this.queue.length,
      maxActive: this.maxActive,
      admitted: this.admitted,
      cancelledInQueue: this.cancelledInQueue,
      timedOutInQueue: this.timedOutInQueue,
    };
  }

  admit(work: WorkItem, signal: AbortSignal): Promise<Lease> {
    if (signal.aborted) {
      this.cancelledInQueue++;
      return Promise.reject(cancelled("aborted before admission"));
    }
    if (this.active < this.limit && this.queue.length === 0) return Promise.resolve(this.grant());
    return new Promise<Lease>((resolve, reject) => {
      const w: Waiter = {
        resolve,
        reject,
        signal,
        work,
        timer: undefined,
        onAbort: () => {
          const i = this.queue.indexOf(w);
          if (i < 0) return; // already granted: the caller re-checks the signal after the await
          this.queue.splice(i, 1);
          if (w.timer !== undefined) clearTimeout(w.timer);
          this.cancelledInQueue++;
          reject(cancelled("aborted while queued"));
        },
      };
      signal.addEventListener("abort", w.onAbort, { once: true });
      if (work.queueTimeoutMs !== undefined) {
        w.timer = setTimeout(() => {
          const i = this.queue.indexOf(w);
          if (i < 0) return;
          this.queue.splice(i, 1);
          signal.removeEventListener("abort", w.onAbort);
          this.timedOutInQueue++;
          reject(queueTimeout(work.queueTimeoutMs as number));
        }, work.queueTimeoutMs);
      }
      this.queue.push(w);
    });
  }

  private grant(): Lease {
    this.active++;
    this.admitted++;
    if (this.active > this.maxActive) this.maxActive = this.active;
    let released = false;
    return {
      release: () => {
        if (released) return;
        released = true;
        this.active--;
        this.pump();
      },
    };
  }

  private pump(): void {
    while (this.active < this.limit && this.queue.length > 0) {
      const w = this.queue.shift() as Waiter;
      if (w.timer !== undefined) clearTimeout(w.timer);
      w.signal.removeEventListener("abort", w.onAbort);
      if (w.signal.aborted) {
        // The abort fired in the same tick as the release, before its listener ran: do not spend a slot on it.
        this.cancelledInQueue++;
        w.reject(cancelled("aborted while queued (raced with release)"));
        continue;
      }
      w.resolve(this.grant());
    }
  }
}
