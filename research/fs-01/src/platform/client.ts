import type {
  EngineDescriptor,
  ExecutionCoordinator,
  Lease,
  Param,
  QueryResult,
  SessionLease,
  SessionSource,
  TransactionState,
} from "./contracts/index.ts";
import { cancelled, NEVER_ABORTED } from "./failures.ts";

export interface Transaction {
  query(sql: string, params?: readonly Param[], signal?: AbortSignal): Promise<QueryResult>;
  commit(signal?: AbortSignal): Promise<TransactionState>;
  rollback(signal?: AbortSignal): Promise<TransactionState>;
  readonly state: TransactionState;
}

/** The same client for every engine class: admit, check out a session, run, release. */
export class Client {
  constructor(
    readonly descriptor: EngineDescriptor,
    readonly source: SessionSource,
    readonly coordinator: ExecutionCoordinator,
  ) {}

  async query(sql: string, params: readonly Param[] = [], signal: AbortSignal = NEVER_ABORTED): Promise<QueryResult> {
    const lease = await this.coordinator.admit({ kind: "query" }, signal);
    try {
      // The abort may have fired between the grant and this continuation.
      if (signal.aborted) throw cancelled("aborted at admission");
      const s = await this.source.checkout(signal);
      try {
        return await s.session.query(sql, params, signal);
      } catch (e) {
        if ((e as { class?: string }).class === "connection") s.discard();
        throw e;
      } finally {
        s.release();
      }
    } finally {
      lease.release();
    }
  }

  /** Holds one admission and one session until commit or rollback. */
  async begin(signal: AbortSignal = NEVER_ABORTED): Promise<Transaction> {
    const lease: Lease = await this.coordinator.admit({ kind: "transaction" }, signal);
    let s: SessionLease | undefined;
    try {
      if (signal.aborted) throw cancelled("aborted at admission");
      s = await this.source.checkout(signal);
      await s.session.begin(signal);
    } catch (e) {
      s?.release();
      lease.release();
      throw e;
    }
    const held = s;
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      held.release();
      lease.release();
    };
    return {
      get state() {
        return held.session.transactionState;
      },
      query: (sql, params = [], sig = NEVER_ABORTED) => held.session.query(sql, params, sig),
      commit: async (sig = NEVER_ABORTED) => {
        try {
          return await held.session.commit(sig);
        } finally {
          finish();
        }
      },
      rollback: async (sig = NEVER_ABORTED) => {
        try {
          return await held.session.rollback(sig);
        } finally {
          finish();
        }
      },
    };
  }

  async close(): Promise<void> {
    await this.source.close();
  }
}
