import {
  ByteWriter,
  DriverError,
  type CapabilitySet,
  type ConnectContext,
  type EngineDescriptor,
  type Endpoint,
  type ObservedTx,
  type Param,
  type QueryResult,
  type RawResult,
  type Session,
  type TransactionState,
  type Transport,
  type WireCore,
} from "./contracts/index.ts";
import { cancelled, connectionFailure } from "./failures.ts";
import { decodeResult, mapRaw, stateOf } from "./session-common.ts";

interface Pending {
  resolve(r: { result: RawResult; observedTx: ObservedTx }): void;
  reject(e: unknown): void;
  sql: string;
  params: readonly Param[];
  probe: boolean;
}

export interface WireSessionInit {
  descriptor: EngineDescriptor;
  core: WireCore;
  transport: Transport;
  endpoint: Endpoint;
  user: string;
  database: string;
}

/** Drives any WireCore over any Transport. Knows neither the protocol nor the socket. */
export class WireSession implements Session {
  capabilities!: CapabilitySet;
  transactionState: TransactionState = "none";
  private readonly pending = new Map<number, Pending>();
  private nextId = 1;
  private startup: { resolve(): void; reject(e: unknown): void } | undefined;
  private dead: DriverError | undefined;
  private sentSomething = false;

  private constructor(private readonly i: WireSessionInit) {}

  static async connect(init: WireSessionInit, signal: AbortSignal): Promise<WireSession> {
    const s = new WireSession(init);
    const { transport, core, descriptor } = init;
    transport.onData((buf, len) => s.onData(buf, len));
    transport.onClose((err) => s.onClose(err));
    try {
      await transport.open(init.endpoint, signal);
    } catch (e) {
      if (e instanceof DriverError) throw e;
      throw connectionFailure(e, "connect", false);
    }
    const ready = new Promise<void>((resolve, reject) => {
      s.startup = { resolve, reject };
    });
    const w = new ByteWriter(256);
    core.encode({ kind: "startup", user: init.user, database: init.database }, w);
    if (w.length > 0) transport.write([w.take()]); // a server that speaks first (MySQL) needs no bytes from us yet
    s.sentSomething = true;
    await ready;
    return s;
  }

  private onData(buf: Uint8Array, len: number): void {
    const events = this.i.core.receive(buf, len);
    for (let k = 0; k < events.length; k++) {
      const ev = events[k]!;
      switch (ev.kind) {
        case "send":
          this.i.transport.write([ev.bytes]);
          break;
        case "ready":
          this.capabilities = this.i.descriptor.capabilities({ facts: ev.facts, transport: this.i.transport.caps } satisfies ConnectContext);
          this.transactionState = stateOf(ev.facts.observedTx);
          this.startup?.resolve();
          this.startup = undefined;
          break;
        case "result": {
          const p = this.pending.get(ev.id);
          if (p !== undefined) {
            this.pending.delete(ev.id);
            p.resolve({ result: ev.result, observedTx: ev.observedTx });
          }
          break;
        }
        case "error":
          void this.onError(ev.id, ev.error, ev.observedTx);
          break;
        case "closed":
          this.onClose(undefined);
          break;
      }
    }
  }

  private async onError(id: number | null, raw: unknown, observedTx: ObservedTx): Promise<void> {
    if (id === null) {
      const e = await mapRaw(this.i.descriptor.errors, raw, "", [], observedTx, false, noProbe, "auth");
      this.dead = e;
      this.startup?.reject(e);
      this.startup = undefined;
      return;
    }
    const p = this.pending.get(id);
    if (p === undefined) return;
    this.pending.delete(id);
    this.transactionState = stateOf(observedTx);
    if (p.probe) {
      p.reject(raw);
      return;
    }
    try {
      p.reject(
        await mapRaw(this.i.descriptor.errors, raw, p.sql, p.params, observedTx, this.transactionState === "open" || observedTx === "failed", (s, ps) => this.probe(s, ps)),
      );
    } catch (e) {
      p.reject(e);
    }
  }

  private onClose(err: Error | undefined): void {
    const e = this.dead ?? connectionFailure(err ?? new Error("connection closed"), "execute", this.pending.size > 0);
    this.dead = e;
    this.startup?.reject(e);
    this.startup = undefined;
    for (const [, p] of this.pending) p.reject(e);
    this.pending.clear();
  }

  private send(sql: string, params: readonly Param[], probe: boolean): Promise<{ result: RawResult; observedTx: ObservedTx }> {
    if (this.dead !== undefined) return Promise.reject(this.dead);
    const { codecs } = this.i.descriptor;
    const enc = new Array(params.length);
    for (let k = 0; k < params.length; k++) enc[k] = codecs.encode(params[k]!);
    const id = this.nextId++;
    const w = new ByteWriter(128 + sql.length);
    this.i.core.encode({ kind: "query", id, sql, params: enc }, w);
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, sql, params, probe });
      this.i.transport.write([w.take()]);
    });
  }

  private async probe(sql: string, params: readonly Param[]): Promise<readonly (readonly unknown[])[]> {
    const { result } = await this.send(sql, params, true);
    return decodeResult(this.i.descriptor.codecs, result, "none").rows;
  }

  async query(sql: string, params: readonly Param[], signal: AbortSignal): Promise<QueryResult> {
    if (signal.aborted) throw cancelled("aborted before send");
    const { result, observedTx } = await this.send(sql, params, false);
    this.transactionState = stateOf(observedTx);
    return decodeResult(this.i.descriptor.codecs, result, this.transactionState);
  }

  async begin(signal: AbortSignal): Promise<TransactionState> {
    const r = await this.query(this.i.descriptor.transactions.begin, [], signal);
    return r.transactionState;
  }
  async commit(signal: AbortSignal): Promise<TransactionState> {
    await this.query(this.i.descriptor.transactions.commit, [], signal);
    return (this.transactionState = "committed");
  }
  async rollback(signal: AbortSignal): Promise<TransactionState> {
    await this.query(this.i.descriptor.transactions.rollback, [], signal);
    return (this.transactionState = "rolled-back");
  }

  async close(): Promise<void> {
    if (this.dead === undefined && this.sentSomething) {
      const w = new ByteWriter(16);
      this.i.core.encode({ kind: "terminate" }, w);
      this.i.transport.write([w.take()]);
    }
    this.dead = connectionFailure(new Error("closed"), "close", false);
    this.i.transport.close();
  }

  get broken(): boolean {
    return this.dead !== undefined;
  }
}

const noProbe = (): Promise<never> => Promise.reject(new Error("no probe during startup"));
