import type { CodecRegistry, ErrorMapper, ObservedTx, Param, QueryResult, RawResult, TransactionState } from "./contracts/index.ts";
import { DriverError } from "./contracts/index.ts";

export function stateOf(o: ObservedTx): TransactionState {
  switch (o) {
    case "idle": return "none";
    case "in-tx": return "open";
    case "failed": return "failed-open";
    default: return "unknown";
  }
}

/** Raw rows to caller values through the engine's codecs. Null stays null. */
export function decodeResult(codecs: CodecRegistry, raw: RawResult, tx: TransactionState): QueryResult {
  const cols = raw.columns;
  const n = cols.length;
  const decoders = new Array(n);
  for (let i = 0; i < n; i++) decoders[i] = codecs.decoder(cols[i]!);
  const rows = new Array(raw.rows.length);
  for (let r = 0; r < rows.length; r++) {
    const src = raw.rows[r]!;
    const row = new Array(n);
    for (let i = 0; i < n; i++) {
      const v = src[i];
      row[i] = v === null || v === undefined ? null : decoders[i](v);
    }
    rows[r] = row;
  }
  return {
    columns: cols.map((c) => c.name),
    rows,
    affectedRows: raw.affectedRows,
    statementOutcome: "applied",
    transactionState: tx,
  };
}

export async function mapRaw(
  errors: ErrorMapper,
  raw: unknown,
  sql: string,
  params: readonly Param[],
  observedTx: ObservedTx,
  txOpenBefore: boolean,
  probe: (sql: string, params: readonly Param[]) => Promise<readonly (readonly unknown[])[]>,
  phase: "execute" | "commit" | "connect" | "auth" = "execute",
): Promise<DriverError> {
  const mapped = await errors.map(raw, { phase, sql, params, observedTx, txOpenBefore, probe });
  return new DriverError(mapped);
}
