import type { ErrorClass, ErrorContext, ErrorMapper, MappedError } from "../../platform/contracts/index.ts";
import type { HranaError } from "./core.ts";

const SINGLE_ROW_INSERT = /^\s*insert\s+(?:or\s+\w+\s+)?into\s+[\w."`\[\]]+\s*(?:\([^)]*\))?\s*values\s*\([^;]*\)\s*(?:returning\s+[\w\s,*"]+)?;?\s*$/i;

function classOf(code: string | undefined): ErrorClass {
  if (code === undefined) return "protocol";
  if (code.startsWith("SQLITE_CONSTRAINT")) return "constraint";
  if (code === "SQLITE_ERROR" || code.startsWith("SQLITE_ERROR_")) return "syntax";
  if (code.startsWith("SQLITE_BUSY") || code.startsWith("SQLITE_LOCKED") || code === "SQLITE_FULL") return "resource";
  if (code === "SQLITE_INTERRUPT") return "cancelled";
  return "internal";
}

export const libsqlErrors: ErrorMapper = {
  map(raw: unknown, ctx: ErrorContext): MappedError {
    const e = raw as HranaError;
    return {
      class: classOf(e.code),
      phase: ctx.phase,
      statementOutcome: SINGLE_ROW_INSERT.test(ctx.sql) ? "rejected-no-effects" : "rejected-effects-possible",
      transactionState: ctx.observedTx === "in-tx" ? "open" : ctx.observedTx === "idle" ? "none" : "unknown",
      retry: "never",
      // Hrana gives a symbolic SQLite code, not the numeric result code.
      ...(e.code === undefined ? {} : { vendor: { code: e.code } }),
      redacted: false,
      message: e.message,
    };
  },
};
