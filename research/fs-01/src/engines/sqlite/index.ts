import type { CapabilitySet, ConnectContext, EngineDescriptor } from "../../platform/contracts/index.ts";
import { sqliteCodecs } from "./codecs.ts";
import { BunSqliteCore } from "./core.ts";
import { sqliteErrors } from "./errors.ts";

export const sqliteDescriptor: EngineDescriptor = {
  id: "sqlite",
  class: "embedded",
  contractVersion: "fs01-provisional",
  transactions: { begin: "BEGIN", commit: "COMMIT", rollback: "ROLLBACK" },
  errors: sqliteErrors,
  codecs: sqliteCodecs,
  capabilities(ctx: ConnectContext): CapabilitySet {
    const major = parseInt(ctx.facts.version, 10);
    return {
      pipelining: false,
      // sqlite3_prepare_v2 exists in every SQLite 3.
      protocolPrepared: Number.isFinite(major) && major >= 3,
      // sqlite3_get_autocommit answered at open.
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

export const openSqliteCore = (path: string): BunSqliteCore => new BunSqliteCore(path);
