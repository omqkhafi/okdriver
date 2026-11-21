import type { CapabilitySet, ConnectContext, EngineDescriptor } from "../../platform/contracts/index.ts";
import { mysqlCodecs } from "./codecs.ts";
import { MysqlFamilyCore } from "./core.ts";
import { mysqlFamilyErrors } from "./errors.ts";

const CLIENT_TRANSACTIONS = 0x2000;

/** The part of a descriptor that MySQL and MariaDB share. `id` and the version syntax are the engine's own. */
export function familyDescriptor(id: string, majorOf: (version: string) => number): EngineDescriptor {
  return {
    id,
    class: "wire",
    contractVersion: "fs01-provisional",
    transactions: { begin: "BEGIN", commit: "COMMIT", rollback: "ROLLBACK" },
    errors: mysqlFamilyErrors,
    codecs: mysqlCodecs,
    capabilities(ctx: ConnectContext): CapabilitySet {
      const caps = Number(ctx.facts.params.serverCapabilities ?? 0);
      return {
        pipelining: false,
        // COM_STMT_PREPARE exists since 4.1; the version is what the greeting said.
        protocolPrepared: majorOf(ctx.facts.version) >= 5,
        // The greeting advertises CLIENT_TRANSACTIONS and OK packets carry the in-transaction flag.
        interactiveTransactions: (caps & CLIENT_TRANSACTIONS) !== 0 && ctx.facts.observedTx !== "unknown",
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
}

export const newMysqlFamilyCore = (): MysqlFamilyCore => new MysqlFamilyCore();
export { MysqlFamilyCore };
