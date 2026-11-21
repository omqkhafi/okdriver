import type { ColumnMeta, EncodedParam, Param } from "./types.ts";

export type Decoder = (raw: unknown) => unknown;

export interface CodecRegistry {
  /** Parameter to the engine's wire form. */
  encode(value: Param): EncodedParam;
  /**
   * Decoder for one result column, resolved once per result set. R6: the sketch left the
   * registry's shape open; a per-column decoder keeps the type switch out of the row loop.
   */
  decoder(column: ColumnMeta): Decoder;
}
