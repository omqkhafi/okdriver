// Cursor-style reader and writer for the MySQL-family wire encodings (little endian integers,
// length-encoded integers and strings, NUL-terminated strings). No family branches.

export class Reader {
  constructor(public buf: Buffer, public pos = 0) {}
  get left(): number { return this.buf.length - this.pos; }
  eof(): boolean { return this.pos >= this.buf.length; }
  u8(): number { return this.buf.readUInt8(this.pos++); }
  u16(): number { const v = this.buf.readUInt16LE(this.pos); this.pos += 2; return v; }
  u24(): number { const v = this.buf.readUIntLE(this.pos, 3); this.pos += 3; return v; }
  u32(): number { const v = this.buf.readUInt32LE(this.pos); this.pos += 4; return v; }
  u64(): bigint { const v = this.buf.readBigUInt64LE(this.pos); this.pos += 8; return v; }
  skip(n: number): void { this.pos += n; }
  bytes(n: number): Buffer { const b = this.buf.subarray(this.pos, this.pos + n); this.pos += n; return b; }
  rest(): Buffer { const b = this.buf.subarray(this.pos); this.pos = this.buf.length; return b; }
  /** Length-encoded integer. Returns null for the 0xfb NULL marker (only meaningful in text rows). */
  lenenc(): number | null {
    const b = this.u8();
    if (b < 0xfb) return b;
    if (b === 0xfb) return null;
    if (b === 0xfc) return this.u16();
    if (b === 0xfd) return this.u24();
    if (b === 0xfe) {
      const v = this.u64();
      if (v > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError('lenenc beyond 2^53');
      return Number(v);
    }
    throw new Error('invalid lenenc prefix 0xff');
  }
  lenencBytes(): Buffer | null {
    const n = this.lenenc();
    return n === null ? null : this.bytes(n);
  }
  lenencString(): string | null {
    const b = this.lenencBytes();
    return b === null ? null : b.toString('utf8');
  }
  nulString(): string {
    const end = this.buf.indexOf(0, this.pos);
    const stop = end < 0 ? this.buf.length : end;
    const s = this.buf.toString('utf8', this.pos, stop);
    this.pos = Math.min(stop + 1, this.buf.length);
    return s;
  }
}

export class Writer {
  private parts: Buffer[] = [];
  u8(v: number): this { const b = Buffer.allocUnsafe(1); b.writeUInt8(v); this.parts.push(b); return this; }
  u16(v: number): this { const b = Buffer.allocUnsafe(2); b.writeUInt16LE(v); this.parts.push(b); return this; }
  u24(v: number): this { const b = Buffer.allocUnsafe(3); b.writeUIntLE(v, 0, 3); this.parts.push(b); return this; }
  u32(v: number): this { const b = Buffer.allocUnsafe(4); b.writeUInt32LE(v >>> 0); this.parts.push(b); return this; }
  u64(v: bigint): this { const b = Buffer.allocUnsafe(8); b.writeBigUInt64LE(BigInt.asUintN(64, v)); this.parts.push(b); return this; }
  bytes(b: Buffer | Uint8Array): this { this.parts.push(Buffer.from(b.buffer, b.byteOffset, b.byteLength)); return this; }
  zeros(n: number): this { this.parts.push(Buffer.alloc(n)); return this; }
  nul(s: string): this { this.parts.push(Buffer.from(s + '\0', 'utf8')); return this; }
  lenenc(n: number | bigint): this {
    const v = BigInt(n);
    if (v < 251n) return this.u8(Number(v));
    if (v < 65536n) return this.u8(0xfc).u16(Number(v));
    if (v < 16777216n) return this.u8(0xfd).u24(Number(v));
    return this.u8(0xfe).u64(v);
  }
  lenencBytes(b: Buffer): this { return this.lenenc(b.length).bytes(b); }
  toBuffer(): Buffer { return Buffer.concat(this.parts); }
}
