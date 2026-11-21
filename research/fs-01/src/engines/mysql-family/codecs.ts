import type { CodecRegistry, ColumnMeta, Decoder, EncodedParam, Param } from "../../platform/contracts/index.ts";
import { CHARSET_BINARY, COLUMN_UNSIGNED, FLAG_BINARY_PROTOCOL } from "./core.ts";

const TYPE = { TINY: 1, SHORT: 2, LONG: 3, FLOAT: 4, DOUBLE: 5, LONGLONG: 8, INT24: 9, YEAR: 13, NEWDECIMAL: 246, DECIMAL: 0, NULL: 6 } as const;
const dec = new TextDecoder();
const text = (r: unknown): string => dec.decode(r as Uint8Array);
const view = (r: unknown): DataView => {
  const b = r as Uint8Array;
  return new DataView(b.buffer, b.byteOffset, b.byteLength);
};
const I64 = BigInt.asIntN;

export const mysqlCodecs: CodecRegistry = {
  encode(v: Param): EncodedParam {
    if (v === null) return { tag: TYPE.NULL, data: null };
    switch (typeof v) {
      case "bigint": {
        if (v < -(2n ** 63n) || v >= 2n ** 64n) throw new RangeError("integer does not fit in 64 bits");
        const b = new Uint8Array(8);
        new DataView(b.buffer).setBigUint64(0, BigInt.asUintN(64, v), true);
        return { tag: v >= 2n ** 63n ? TYPE.LONGLONG | 0x8000 : TYPE.LONGLONG, data: b };
      }
      case "number": {
        const b = new Uint8Array(8);
        if (Number.isSafeInteger(v)) {
          new DataView(b.buffer).setBigInt64(0, BigInt(v), true);
          return { tag: TYPE.LONGLONG, data: b };
        }
        new DataView(b.buffer).setFloat64(0, v, true);
        return { tag: TYPE.DOUBLE, data: b };
      }
      case "string":
        return { tag: 253, data: new TextEncoder().encode(v) };
      case "boolean":
        return { tag: TYPE.TINY, data: Uint8Array.of(v ? 1 : 0) };
      default:
        return { tag: 252, data: v };
    }
  },
  decoder(c: ColumnMeta): Decoder {
    const binaryProto = (c.flags & FLAG_BINARY_PROTOCOL) !== 0;
    const unsigned = (c.flags & COLUMN_UNSIGNED) !== 0;
    const charset = (c.flags >> 16) & 0xff;
    const t = c.type as number;
    switch (t) {
      case TYPE.LONGLONG:
        if (!binaryProto) return (r) => BigInt(text(r));
        return unsigned ? (r) => view(r).getBigUint64(0, true) : (r) => I64(64, view(r).getBigInt64(0, true));
      case TYPE.LONG:
      case TYPE.INT24:
        if (!binaryProto) return (r) => Number(text(r));
        return unsigned ? (r) => view(r).getUint32(0, true) : (r) => view(r).getInt32(0, true);
      case TYPE.SHORT:
      case TYPE.YEAR:
        if (!binaryProto) return (r) => Number(text(r));
        return unsigned ? (r) => view(r).getUint16(0, true) : (r) => view(r).getInt16(0, true);
      case TYPE.TINY:
        if (!binaryProto) return (r) => Number(text(r));
        return unsigned ? (r) => (r as Uint8Array)[0]! : (r) => view(r).getInt8(0);
      case TYPE.FLOAT:
        return binaryProto ? (r) => view(r).getFloat32(0, true) : (r) => Number(text(r));
      case TYPE.DOUBLE:
        return binaryProto ? (r) => view(r).getFloat64(0, true) : (r) => Number(text(r));
      case TYPE.DECIMAL:
      case TYPE.NEWDECIMAL:
        return text; // exact decimals are strings
      case 7: case 10: case 11: case 12:
        return () => {
          throw new RangeError("FS-01 does not decode temporal types");
        };
      default:
        return charset === CHARSET_BINARY ? (r) => r : text;
    }
  },
};
