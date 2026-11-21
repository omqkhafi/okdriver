// Value and result shapes that cross the platform/engine boundary.
import type { TransactionState } from "./errors.ts";

/** What a caller may bind. 64-bit integers are bigint. */
export type Param = bigint | number | string | boolean | null | Uint8Array;

/** Engine-defined type token: PostgreSQL OID, MySQL type code, a declared type name. */
export type TypeRef = number | string;

export interface ColumnMeta {
  readonly name: string;
  readonly type: TypeRef;
  /** Engine-defined flag bits (MySQL column flags). */
  readonly flags: number;
}

/** A parameter after the engine's codec encoded it. Opaque to the platform; the engine's core reads it. */
export interface EncodedParam {
  readonly tag: number | string;
  readonly data: Uint8Array | string | bigint | number | null;
}

/** What the transaction machinery of the server reported about itself. */
export type ObservedTx = "idle" | "in-tx" | "failed" | "unknown";

/** Facts the server (or the library) stated during connect. Input of EngineDescriptor.capabilities. */
export interface ServerFacts {
  readonly version: string;
  readonly params: Readonly<Record<string, string>>;
  readonly observedTx: ObservedTx;
}

export interface RawResult {
  readonly columns: readonly ColumnMeta[];
  readonly rows: readonly (readonly unknown[])[];
  readonly affectedRows: number | null;
  readonly tag: string;
}

export interface QueryResult {
  readonly columns: readonly string[];
  readonly rows: readonly (readonly unknown[])[];
  readonly affectedRows: number | null;
  readonly statementOutcome: "applied";
  readonly transactionState: TransactionState;
}
