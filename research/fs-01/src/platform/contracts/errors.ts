// Shared error taxonomy (A5) and outcomes (A6), plus the mapper contract.
import type { ObservedTx, Param } from "./types.ts";

export type ErrorClass =
  | "connection" | "auth" | "tls" | "protocol" | "syntax" | "constraint" | "serialization"
  | "deadlock" | "timeout" | "cancelled" | "resource" | "capability" | "internal";
export type Phase = "connect" | "auth" | "prepare" | "bind" | "execute" | "fetch" | "commit" | "close";
export type StatementOutcome =
  | "not-sent" | "rejected-no-effects" | "rejected-effects-possible" | "applied" | "partially-applied" | "unknown";
export type TransactionState =
  | "none" | "open" | "committed" | "rolled-back" | "implicitly-committed" | "failed-open" | "unknown";
export type Retry = "safe" | "safe-in-new-transaction" | "never" | "caller-decides";

/** The engine's own code, untouched. R4: the sketch's single `vendor` field could not hold a MySQL errno and its SQLSTATE. */
export interface Vendor {
  readonly code: string | number;
  readonly sqlState?: string;
  readonly name?: string;
}

export interface MappedError {
  readonly class: ErrorClass;
  readonly phase: Phase;
  readonly statementOutcome: StatementOutcome;
  readonly transactionState: TransactionState;
  readonly retry: Retry;
  readonly vendor?: Vendor | undefined;
  readonly redacted: boolean;
  readonly message: string;
}

/** R15: the sketch names no context for the mapper; this is what the five engines needed. */
export interface ErrorContext {
  readonly phase: Phase;
  readonly sql: string;
  readonly params: readonly Param[];
  /** What the transaction machinery said after the failure, from the core. */
  readonly observedTx: ObservedTx;
  /** True when the platform knows a transaction was open before the statement. */
  readonly txOpenBefore: boolean;
  /**
   * A follow-up query on the same session, for engines that cannot classify from the error alone.
   * Only valid while the mapper runs. R5: forced by MySQL and MariaDB, whose error packet does not
   * say whether the target table is transactional.
   */
  readonly probe: (sql: string, params: readonly Param[]) => Promise<readonly (readonly unknown[])[]>;
}

export interface ErrorMapper {
  /** `raw` is whatever the engine's core produced. R5: may be async. */
  map(raw: unknown, ctx: ErrorContext): MappedError | Promise<MappedError>;
}

export class DriverError extends Error implements MappedError {
  readonly class: ErrorClass;
  readonly phase: Phase;
  readonly statementOutcome: StatementOutcome;
  readonly transactionState: TransactionState;
  readonly retry: Retry;
  readonly vendor: Vendor | undefined;
  readonly redacted: boolean;
  constructor(m: MappedError) {
    super(m.message);
    this.name = "DriverError";
    this.class = m.class;
    this.phase = m.phase;
    this.statementOutcome = m.statementOutcome;
    this.transactionState = m.transactionState;
    this.retry = m.retry;
    this.vendor = m.vendor;
    this.redacted = m.redacted;
  }
}

/** R16: runtime classes in contracts, because engines import platform only through contracts. A failure a core raises, carrying what the server said about the transaction. Embedded and service cores throw this. */
export class RawFailure extends Error {
  constructor(readonly raw: unknown, readonly observedTx: ObservedTx) {
    super(raw instanceof Error ? raw.message : String(raw));
    this.name = "RawFailure";
  }
}
