import type { CodecRegistry, Decoder, EncodedParam, Param } from "../../platform/contracts/index.ts";

const identity: Decoder = (r) => r;

/**
 * bun:sqlite binds and returns JS values itself, so this registry only wraps: it is the shim
 * recorded in shims.json for this engine.
 */
export const sqliteCodecs: CodecRegistry = {
  encode(v: Param): EncodedParam {
    if (typeof v === "boolean") return { tag: "integer", data: v ? 1n : 0n };
    if (typeof v === "number" && Number.isInteger(v)) return { tag: "integer", data: BigInt(v) };
    return { tag: typeof v, data: v as EncodedParam["data"] };
  },
  decoder: () => identity,
};
