// MariaDB-only: COM_STMT_BULK_EXECUTE (0xfa), array binding of one parameter type per column.
import { Writer } from '../shared/bytes.ts';

export const COM_STMT_BULK_EXECUTE = 0xfa;
export const BULK_FLAG = { SEND_UNIT_RESULTS: 64, SEND_TYPES_TO_SERVER: 128 } as const;
/** Placeholder id: "the statement prepared by the previous command on this connection". */
export const LAST_PREPARED = 0xffffffff;

/** Rows of BIGINT parameters. Indicator byte per value: 0 = value follows, 1 = NULL. */
export function encodeBulkBigint(stmtId: number, rows: (bigint | null)[][], flags: number = BULK_FLAG.SEND_TYPES_TO_SERVER): Buffer {
  const w = new Writer().u8(COM_STMT_BULK_EXECUTE).u32(stmtId).u16(flags);
  if (flags & BULK_FLAG.SEND_TYPES_TO_SERVER) for (let i = 0; i < rows[0]!.length; i++) w.u8(8).u8(0);
  for (const row of rows) for (const v of row) { if (v === null) w.u8(1); else w.u8(0).u64(v); }
  return w.toBuffer();
}

/** COM_STMT_EXECUTE against the placeholder id with a single BIGINT parameter. */
export function encodeExecuteLastPrepared(v: bigint): Buffer {
  return new Writer().u8(0x17).u32(LAST_PREPARED).u8(0).u32(1).u8(0).u8(1).u8(8).u8(0).u64(v).toBuffer();
}
