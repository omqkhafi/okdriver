import type { ErrorClass, ErrorContext, ErrorMapper, MappedError, Retry } from "../../platform/contracts/index.ts";
import type { MyServerError, MyUnsupportedAuth } from "./core.ts";

const SINGLE_ROW_INSERT = /^\s*insert\s+(?:ignore\s+)?into\s+((?:`[^`]+`|[\w$]+)(?:\.(?:`[^`]+`|[\w$]+))?)\s*(?:\([^)]*\))?\s*values?\s*\([^;]*\)\s*;?\s*$/i;

function classOf(errno: number): ErrorClass {
  switch (errno) {
    case 1062: case 1048: case 1451: case 1452: case 1216: case 1217: case 3819: return "constraint";
    case 1064: case 1054: case 1146: case 1049: case 1050: case 1051: case 1109: case 1136: return "syntax";
    case 1213: return "deadlock";
    case 1205: return "timeout";
    case 1045: case 1044: case 1698: return "auth";
    case 1317: case 3024: return "cancelled";
    case 1040: case 1041: case 1203: return "resource";
    default: return "internal";
  }
}

function tableOf(sql: string): { schema: string | undefined; table: string } | undefined {
  const m = SINGLE_ROW_INSERT.exec(sql);
  if (m === null) return undefined;
  const parts = m[1]!.split(".").map((s) => s.replace(/`/g, ""));
  return parts.length === 2 ? { schema: parts[0], table: parts[1]! } : { schema: undefined, table: parts[0]! };
}

/** Transactional storage engines of the MySQL family. MyISAM, MEMORY, ARCHIVE and the rest are not. */
const TRANSACTIONAL = new Set(["INNODB", "ROCKSDB", "TOKUDB"]);

export const mysqlFamilyErrors: ErrorMapper = {
  async map(raw: unknown, ctx: ErrorContext): Promise<MappedError> {
    if ((raw as MyUnsupportedAuth).kind === "unsupported-auth") {
      return {
        class: "auth", phase: "auth", statementOutcome: "not-sent", transactionState: "none", retry: "never",
        redacted: false, message: `authentication not implemented in the FS-01 skeleton: ${(raw as MyUnsupportedAuth).detail}`,
      };
    }
    const e = raw as MyServerError;
    const cls = classOf(e.errno);
    const retry: Retry = cls === "deadlock" ? "safe-in-new-transaction" : "never";
    const during = ctx.phase === "connect" || ctx.phase === "auth";
    let outcome: MappedError["statementOutcome"] = during ? "not-sent" : "rejected-effects-possible";
    if (!during) {
      const t = tableOf(ctx.sql);
      if (t !== undefined) {
        // The error packet does not say whether the table is transactional. Ask the server.
        const rows = await ctx.probe(
          "SELECT ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA = COALESCE(?, DATABASE()) AND TABLE_NAME = ?",
          [t.schema ?? null, t.table],
        );
        const engine = rows[0]?.[0];
        if (typeof engine === "string" && TRANSACTIONAL.has(engine.toUpperCase())) outcome = "rejected-no-effects";
      }
    }
    // Messages for duplicate keys carry the key value (parameter data): replace them.
    const dup = e.errno === 1062 ? /for key '([^']*)'/.exec(e.message) : null;
    return {
      class: cls,
      phase: ctx.phase,
      statementOutcome: outcome,
      transactionState: ctx.observedTx === "in-tx" ? "open" : ctx.observedTx === "idle" ? "none" : ctx.observedTx === "failed" ? "failed-open" : "unknown",
      retry,
      vendor: { code: e.errno, sqlState: e.sqlState },
      redacted: dup !== null,
      message: dup !== null ? `Duplicate entry for key '${dup[1]}'` : e.message,
    };
  },
};
