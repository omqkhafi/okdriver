import type { CapabilitySet } from "./capabilities.ts";
import type { TransactionState } from "./errors.ts";
import type { Param, QueryResult } from "./types.ts";

/**
 * R13 (new): what a caller holds after connect, whatever the engine class. The sketches define
 * the three cores but not the object the coordinator admits work onto.
 */
export interface Session {
  readonly capabilities: CapabilitySet;
  readonly transactionState: TransactionState;
  query(sql: string, params: readonly Param[], signal: AbortSignal): Promise<QueryResult>;
  begin(signal: AbortSignal): Promise<TransactionState>;
  commit(signal: AbortSignal): Promise<TransactionState>;
  rollback(signal: AbortSignal): Promise<TransactionState>;
  close(): Promise<void>;
}

/** R13: how a client gets a session. Wire engines back it with a pool; the other classes with one shared session. */
export interface SessionLease {
  readonly session: Session;
  release(): void;
  /** The session is broken; do not reuse it. */
  discard(): void;
}
export interface SessionSource {
  checkout(signal: AbortSignal): Promise<SessionLease>;
  close(): Promise<void>;
}
