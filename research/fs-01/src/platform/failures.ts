// Platform-level failures: nothing here depends on which engine is connected.
import { DriverError, type MappedError, type Phase } from "./contracts/index.ts";

const base = { retry: "never", redacted: false } as const;

/** The taxonomy has no queue phase; `execute` is used for work that never reached the engine (finding F-04). */
export function cancelled(message = "operation aborted", phase: Phase = "execute"): DriverError {
  return new DriverError({
    ...base,
    class: "cancelled",
    phase,
    statementOutcome: "not-sent",
    transactionState: "none",
    retry: "safe",
    message,
  });
}

/** The caller aborted after bytes were sent: the statement may or may not have run. */
export function abortedInFlight(message = "operation aborted after the request was sent"): DriverError {
  return new DriverError({
    ...base,
    class: "cancelled",
    phase: "execute",
    statementOutcome: "unknown",
    transactionState: "unknown",
    message,
  });
}

export function queueTimeout(ms: number): DriverError {
  return new DriverError({
    ...base,
    class: "timeout",
    phase: "execute",
    statementOutcome: "not-sent",
    transactionState: "none",
    retry: "safe",
    message: `queue timeout after ${ms} ms`,
  });
}

export function connectionFailure(cause: unknown, phase: Phase, sent: boolean): DriverError {
  const message = cause instanceof Error ? cause.message : String(cause);
  const code = cause instanceof Error && "code" in cause ? String((cause as { code: unknown }).code) : undefined;
  const m: MappedError = {
    ...base,
    class: "connection",
    phase,
    statementOutcome: sent ? "unknown" : "not-sent",
    transactionState: sent ? "unknown" : "none",
    retry: sent ? "never" : "safe",
    message,
    ...(code === undefined ? {} : { vendor: { code } }),
  };
  return new DriverError(m);
}

export function capabilityFailure(what: string): DriverError {
  return new DriverError({
    ...base,
    class: "capability",
    phase: "prepare",
    statementOutcome: "not-sent",
    transactionState: "none",
    message: `capability not available: ${what}`,
  });
}

export function isAbort(e: unknown): boolean {
  return e instanceof Error && (e.name === "AbortError" || e.name === "TimeoutError");
}

export const NEVER_ABORTED: AbortSignal = new AbortController().signal;
