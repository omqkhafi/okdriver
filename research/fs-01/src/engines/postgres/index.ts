import type { CapabilitySet, ConnectContext, EngineDescriptor } from "../../platform/contracts/index.ts";
import { pgCodecs } from "./codecs.ts";
import { PgCore } from "./core.ts";
import { pgErrors } from "./errors.ts";

export const postgresDescriptor: EngineDescriptor = {
  id: "postgres",
  class: "wire",
  contractVersion: "fs01-provisional",
  transactions: { begin: "BEGIN", commit: "COMMIT", rollback: "ROLLBACK" },
  errors: pgErrors,
  codecs: pgCodecs,
  capabilities(ctx: ConnectContext): CapabilitySet {
    const major = parseInt(ctx.facts.params.server_version ?? ctx.facts.version, 10);
    return {
      pipelining: false,
      // The server said its version; the extended protocol exists from 7.4.
      protocolPrepared: Number.isFinite(major) && major >= 8,
      // ReadyForQuery carries the transaction status byte.
      interactiveTransactions: ctx.facts.observedTx !== "unknown",
      savepoints: false,
      returning: false,
      streamingResults: false,
      bulkLoad: false,
      notifications: false,
      changeStream: false,
      cancel: "none",
      int64: "bigint",
      multiResult: false,
    };
  },
};

export const newPgCore = (): PgCore => new PgCore();
export { PgCore };
