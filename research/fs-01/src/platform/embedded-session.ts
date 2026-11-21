import {
  type CapabilitySet,
  type EmbeddedCore,
  type EngineDescriptor,
  type ObservedTx,
  type Param,
  type QueryResult,
  type Session,
  type TransactionState,
  DriverError,
} from "./contracts/index.ts";
import { cancelled } from "./failures.ts";
import { decodeResult, mapRaw, stateOf } from "./session-common.ts";

/** Drives any EmbeddedCore. The work is synchronous; the interface is async so that every class looks alike. */
export class EmbeddedSession implements Session {
  readonly capabilities: CapabilitySet;
  transactionState: TransactionState = "none";
  constructor(private readonly d: EngineDescriptor, private readonly core: EmbeddedCore) {
    this.capabilities = d.capabilities({ facts: core.facts, transport: undefined });
  }

  private observed(): ObservedTx {
    return this.core.inTransaction ? "in-tx" : "idle";
  }

  private runSync(sql: string, params: readonly Param[]): QueryResult {
    const enc = params.map((p) => this.d.codecs.encode(p));
    const stmt = this.core.prepare(sql);
    try {
      const raw = stmt.execute(enc);
      this.transactionState = stateOf(this.observed());
      return decodeResult(this.d.codecs, raw, this.transactionState);
    } finally {
      stmt.finalize();
    }
  }

  async query(sql: string, params: readonly Param[], signal: AbortSignal): Promise<QueryResult> {
    if (signal.aborted) throw cancelled("aborted before execution");
    try {
      return this.runSync(sql, params);
    } catch (e) {
      if (e instanceof DriverError) throw e;
      const observed = this.observed();
      const before = this.transactionState === "open";
      this.transactionState = stateOf(observed);
      throw await mapRaw(this.d.errors, e, sql, params, observed, before, async (s, ps) => this.runSync(s, ps).rows);
    }
  }
  async begin(signal: AbortSignal): Promise<TransactionState> {
    return (await this.query(this.d.transactions.begin, [], signal)).transactionState;
  }
  async commit(signal: AbortSignal): Promise<TransactionState> {
    await this.query(this.d.transactions.commit, [], signal);
    return (this.transactionState = "committed");
  }
  async rollback(signal: AbortSignal): Promise<TransactionState> {
    await this.query(this.d.transactions.rollback, [], signal);
    return (this.transactionState = "rolled-back");
  }
  async close(): Promise<void> {
    this.core.close();
  }
}
