import type { CodecRegistry, ColumnMeta, Decoder, EncodedParam, Param } from "../../platform/contracts/index.ts";

const dec = new TextDecoder();
const asText = (raw: unknown): string => dec.decode(raw as Uint8Array);

/** Text-format decoders by type OID. Anything not listed comes back as its text: never lossy, never guessed. */
const BY_OID: Record<number, Decoder> = {
  16: (r) => (r as Uint8Array)[0] === 0x74, // bool
  17: (r) => hexToBytes(asText(r)), // bytea, hex output format
  20: (r) => BigInt(asText(r)), // int8 -> bigint
  21: (r) => Number(asText(r)),
  23: (r) => Number(asText(r)),
  700: (r) => Number(asText(r)),
  701: (r) => Number(asText(r)),
};
const TEXT: Decoder = asText;

function hexToBytes(s: string): Uint8Array {
  const hex = s.startsWith("\\x") ? s.slice(2) : s;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(2 * i, 2 * i + 2), 16);
  return out;
}

export const pgCodecs: CodecRegistry = {
  encode(v: Param): EncodedParam {
    if (v === null) return { tag: 0, data: null };
    switch (typeof v) {
      case "bigint":
        return { tag: 0, data: v.toString() };
      case "number":
        return { tag: 0, data: String(v) };
      case "string":
        return { tag: 0, data: v };
      case "boolean":
        return { tag: 0, data: v ? "t" : "f" };
      default:
        return { tag: 1, data: v }; // Uint8Array, binary format
    }
  },
  decoder(c: ColumnMeta): Decoder {
    return BY_OID[c.type as number] ?? TEXT;
  },
};
