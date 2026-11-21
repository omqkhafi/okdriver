import type { CapabilitySet } from "./capabilities.ts";
import type { CodecRegistry } from "./codec.ts";
import type { ErrorMapper } from "./errors.ts";
import type { TransportCaps } from "./transport.ts";
import type { ServerFacts } from "./types.ts";

export type EngineClass = "wire" | "embedded" | "service";

/** R14: the sketch names ConnectContext without a shape. */
export interface ConnectContext {
  readonly facts: ServerFacts;
  /** Undefined for embedded engines, which have no transport. */
  readonly transport: TransportCaps | undefined;
}

/** R1b: platform code contains no SQL text, so the engine supplies the statements. */
export interface TransactionStatements {
  readonly begin: string;
  readonly commit: string;
  readonly rollback: string;
}

export interface EngineDescriptor<Caps extends CapabilitySet = CapabilitySet> {
  /** R1a: `string`. The sketch's literal union trips the engine-name lint in platform. */
  readonly id: string;
  readonly class: EngineClass;
  readonly contractVersion: string;
  readonly transactions: TransactionStatements;
  capabilities(ctx: ConnectContext): Caps;
  readonly errors: ErrorMapper;
  readonly codecs: CodecRegistry;
}
