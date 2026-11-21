import type { CodecRegistry, ColumnMeta, Decoder, EncodedParam, Param } from "../../platform/contracts/index.ts";

type HranaValue = { type: string; value?: string | number; base64?: string };

const BY_TYPE: Record<string, Decoder> = {
  integer: (r) => BigInt((r as HranaValue).value as string),
  float: (r) => Number((r as HranaValue).value),
  text: (r) => String((r as HranaValue).value),
  blob: (r) => new Uint8Array(Buffer.from((r as HranaValue).base64 as string, "base64")),
};
const decode: Decoder = (r) => BY_TYPE[(r as HranaValue).type]!(r);

export const libsqlCodecs: CodecRegistry = {
  encode(v: Param): EncodedParam {
    if (v === null) return { tag: "null", data: null };
    switch (typeof v) {
      case "bigint":
        return { tag: "integer", data: v.toString() }; // Hrana carries integers as decimal strings
      case "number":
        return Number.isSafeInteger(v) ? { tag: "integer", data: String(v) } : { tag: "float", data: v };
      case "string":
        return { tag: "text", data: v };
      case "boolean":
        return { tag: "integer", data: v ? "1" : "0" };
      default:
        return { tag: "blob", data: v };
    }
  },
  decoder(_c: ColumnMeta): Decoder {
    return decode;
  },
};
