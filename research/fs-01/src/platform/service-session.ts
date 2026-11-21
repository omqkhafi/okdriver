import {
  type CapabilitySet,
  type EngineDescriptor,
  type ObservedTx,
  type Param,
  type QueryResult,
  type ServiceCore,
  type ServiceResult,
  type ServiceStream,
  type Session,
  type TransactionState,
  DriverError,
  RawFailure,
} from "./contracts/index.ts";
import { abortedInFlight, cancelled, capabilityFailure, connectionFailure, isAbort } from "./failures.ts";
import { decodeResult, mapRaw, stateOf } from "./session-common.ts";

/** Drives any ServiceCore. Stateless requests go through `execute`; a transaction pins one stream. */
export class ServiceSession implements Session {
  transactionState: TransactionState = "none";
  private stream: ServiceStream | undefined;
  private constructor(readonly capabilities: CapabilitySet, private readonly d: EngineDescriptor, private readonly core: ServiceCore) {}

  /** A service has no connection to check out: a session is a cheap view over the shared core, so a transaction's stream never leaks to other callers. */
  static attach(capabilities: CapabilitySet, d: EngineDescriptor, core: ServiceCore): ServiceSession {
    return new ServiceSession(capabilities, d, core);
  }

  static async connect(d: EngineDescriptor, core: ServiceCore, signal: AbortSignal): Promise<ServiceSession> {
    let facts;
    try {
      facts = await core.handshake(signal);
    } catch (e) {
      if (e instanceof DriverError) throw e;
      throw isAbort(e) ? cancelled("aborted while connecting", "connect") : connectionFailure(e, "connect", false);
    }
    return new ServiceSession(d.capabilities({ facts, transport: undefined }), d, core);
  }

  async query(sql: string, params: readonly Param[], signal: AbortSignal): Promise<QueryResult> {
    if (signal.aborted) throw cancelled("aborted before send");
    const req = { sql, params: params.map((p) => this.d.codecs.encode(p)) };
    const before = this.transactionState === "open";
    try {
      const r: ServiceResult = this.stream !== undefined ? await this.stream.execute(req, signal) : await this.core.execute(req, signal);
      this.transactionState = stateOf(r.observedTx);
      return decodeResult(this.d.codecs, r, this.transactionState);
    } catch (e) {
      if (e instanceof DriverError) throw e;
      if (isAbort(e)) throw abortedInFlight();
      const observed: ObservedTx = e instanceof RawFailure ? e.observedTx : "unknown";
      const raw = e instanceof RawFailure ? e.raw : e;
      this.transactionState = stateOf(observed);
      throw await mapRaw(this.d.errors, raw, sql, params, observed, before, async (s, ps) => (await (this.stream ?? this.core).execute({ sql: s, params: ps.map((p) => this.d.codecs.encode(p)) }, signal)).rows);
    }
  }

  async begin(signal: AbortSignal): Promise<TransactionState> {
    if (this.core.openStream === undefined) throw capabilityFailure("interactive transactions");
    this.stream = await this.core.openStream(signal);
    return (await this.query(this.d.transactions.begin, [], signal)).transactionState;
  }
  async commit(signal: AbortSignal): Promise<TransactionState> {
    await this.query(this.d.transactions.commit, [], signal);
    await this.endStream(signal);
    return (this.transactionState = "committed");
  }
  async rollback(signal: AbortSignal): Promise<TransactionState> {
    await this.query(this.d.transactions.rollback, [], signal);
    await this.endStream(signal);
    return (this.transactionState = "rolled-back");
  }
  private async endStream(signal: AbortSignal): Promise<void> {
    const s = this.stream;
    this.stream = undefined;
    if (s !== undefined) await s.close(signal);
  }
  async close(): Promise<void> {
    await this.core.close();
  }
}
