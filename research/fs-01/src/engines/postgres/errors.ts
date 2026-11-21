import type { ErrorContext, ErrorMapper, ErrorClass, MappedError, Retry } from "../../platform/contracts/index.ts";
import type { PgServerError, PgUnsupportedAuth } from "./core.ts";

/** Single-row INSERT with one VALUES tuple and no ON CONFLICT: the one statement shape this engine classifies. */
const SINGLE_ROW_INSERT = /^\s*insert\s+into\s+[\w."]+\s*(?:\([^)]*\))?\s*values\s*\([^;]*\)\s*(?:returning\s+[\w\s,*"]+)?;?\s*$/i;

function classOf(code: string): ErrorClass {
  if (code.startsWith("23")) return "constraint";
  if (code.startsWith("42")) return "syntax";
  if (code === "40001") return "serialization";
  if (code === "40P01") return "deadlock";
  if (code === "57014") return "cancelled";
  if (code.startsWith("28")) return "auth";
  if (code.startsWith("08")) return "connection";
  if (code.startsWith("53")) return "resource";
  if (code.startsWith("0A")) return "capability";
  return "internal";
}

export const pgErrors: ErrorMapper = {
  map(raw: unknown, ctx: ErrorContext): MappedError {
    if (typeof raw === "object" && raw !== null && (raw as PgUnsupportedAuth).kind === "unsupported-auth") {
      return {
        class: "auth", phase: "auth", statementOutcome: "not-sent", transactionState: "none",
        retry: "never", redacted: false,
        message: `authentication method ${(raw as PgUnsupportedAuth).authCode} is not implemented in the FS-01 skeleton`,
      };
    }
    const e = raw as PgServerError;
    const cls = classOf(e.code);
    const retry: Retry = cls === "serialization" || cls === "deadlock" ? "safe-in-new-transaction" : "never";
    const during = ctx.phase === "connect" || ctx.phase === "auth";
    return {
      class: cls,
      phase: ctx.phase,
      // PostgreSQL statements are atomic; only the one shape in SINGLE_ROW_INSERT is classified (A6).
      statementOutcome: during ? "not-sent" : SINGLE_ROW_INSERT.test(ctx.sql) ? "rejected-no-effects" : "rejected-effects-possible",
      transactionState: ctx.observedTx === "failed" ? "failed-open" : ctx.observedTx === "in-tx" ? "open" : ctx.observedTx === "idle" ? "none" : "unknown",
      retry,
      vendor: { code: e.code, sqlState: e.code },
      // The server's DETAIL line carries key values (parameter data); it is dropped.
      redacted: e.detail !== undefined,
      message: e.message,
    };
  },
};
