import type { Writer } from "./bytes.ts";
import type { EncodedParam, ObservedTx, RawResult, ServerFacts } from "./types.ts";

// ---- wire ----------------------------------------------------------------------------------
// R2: the sketch names CoreCommand and CoreEvent without shapes; these are the ones the three
// wire engines needed.
export type CoreCommand =
  | { readonly kind: "startup"; readonly user: string; readonly database: string }
  | { readonly kind: "query"; readonly id: number; readonly sql: string; readonly params: readonly EncodedParam[] }
  | { readonly kind: "terminate" };

export type CoreEvent =
  /** Bytes the core wants written now. R3: forced by the MySQL family, whose server speaks first (so encode(startup) may produce no bytes) and whose prepare-then-execute answers input with output. */
  | { readonly kind: "send"; readonly bytes: Uint8Array }
  | { readonly kind: "ready"; readonly facts: ServerFacts }
  | { readonly kind: "result"; readonly id: number; readonly result: RawResult; readonly observedTx: ObservedTx }
  | { readonly kind: "error"; readonly id: number | null; readonly error: unknown; readonly observedTx: ObservedTx }
  | { readonly kind: "closed" };

export interface WireCore {
  receive(buf: Uint8Array, len: number): readonly CoreEvent[];
  encode(cmd: CoreCommand, out: Writer): void;
  readonly phase: "startup" | "ready" | "busy" | "stream" | "closed" | "failed";
  readonly inFlight: number;
}

// ---- embedded ------------------------------------------------------------------------------
export interface EmbeddedStatement {
  /** R10: one member for rows and for effects; the sketch's EmbeddedStatement had no members. */
  execute(params: readonly EncodedParam[]): RawResult;
  finalize(): void;
}
export interface EmbeddedCore {
  /** R11: capability negotiation needs facts; the sketch's EmbeddedCore had no way to say them. */
  readonly facts: ServerFacts;
  prepare(sql: string): EmbeddedStatement;
  exec(sql: string): void;
  readonly inTransaction: boolean;
  close(): void;
}

// ---- service -------------------------------------------------------------------------------
export interface ServiceRequest {
  readonly sql: string;
  readonly params: readonly EncodedParam[];
}
export type ServiceResult = RawResult & { readonly observedTx: ObservedTx };
export interface ServiceStream {
  execute(req: ServiceRequest, signal: AbortSignal): Promise<ServiceResult>;
  close(signal: AbortSignal): Promise<void>;
}
export interface ServiceCore {
  /** R12: same reason as R11. */
  handshake(signal: AbortSignal): Promise<ServerFacts>;
  execute(req: ServiceRequest, signal: AbortSignal): Promise<ServiceResult>;
  batch?(reqs: readonly ServiceRequest[], signal: AbortSignal): Promise<readonly ServiceResult[]>;
  openStream?(signal: AbortSignal): Promise<ServiceStream>;
  close(): Promise<void>;
}
