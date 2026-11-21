import type { ErrorClass, ErrorContext, ErrorMapper, MappedError } from "../../platform/contracts/index.ts";

const SINGLE_ROW_INSERT = /^\s*insert\s+(?:or\s+\w+\s+)?into\s+[\w."`\[\]]+\s*(?:\([^)]*\))?\s*values\s*\([^;]*\)\s*(?:returning\s+[\w\s,*"]+)?;?\s*$/i;

interface BunSqliteError {
  code?: string;
  errno?: number;
  message: string;
}

function classOf(primary: number): ErrorClass {
  switch (primary) {
    case 19: return "constraint";
    case 1: return "syntax";
    case 5: case 6: case 13: case 7: return "resource";
    case 9: return "cancelled";
    case 14: return "connection";
    case 23: return "auth";
    default: return "internal";
  }
}

export const sqliteErrors: ErrorMapper = {
  map(raw: unknown, ctx: ErrorContext): MappedError {
    const e = raw as BunSqliteError;
    const errno = typeof e.errno === "number" ? e.errno : -1;
    return {
      class: classOf(errno & 0xff),
      phase: ctx.phase,
      // SQLite statements are atomic (statement journal). Only the single-row INSERT shape is classified.
      statementOutcome: SINGLE_ROW_INSERT.test(ctx.sql) ? "rejected-no-effects" : "rejected-effects-possible",
      transactionState: ctx.observedTx === "in-tx" ? "open" : ctx.observedTx === "idle" ? "none" : "unknown",
      retry: "never",
      vendor: { code: errno, ...(e.code === undefined ? {} : { name: e.code }) },
      redacted: false,
      message: e.message,
    };
  },
};
