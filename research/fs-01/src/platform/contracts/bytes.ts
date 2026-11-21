// Byte helpers shared by engine cores. They sit in contracts because the boundary rule lets an
// engine import the platform only through platform/contracts. Revision R9 in README.md.
export interface Writer {
  readonly length: number;
  u8(n: number): void;
  u16be(n: number): void;
  u32be(n: number): void;
  u16le(n: number): void;
  u24le(n: number): void;
  u32le(n: number): void;
  u64le(n: bigint): void;
  bytes(b: Uint8Array): void;
  /** UTF-8 bytes of `s` with no terminator. Returns the number of bytes written. */
  utf8(s: string): number;
  /** UTF-8 bytes of `s` followed by a zero byte. */
  cstr(s: string): void;
  /** Overwrite a big-endian u32 at an earlier offset. */
  patchU32be(offset: number, n: number): void;
  patchU24le(offset: number, n: number): void;
}

const encoder = new TextEncoder();

export class ByteWriter implements Writer {
  buf: Uint8Array;
  view: DataView;
  length = 0;
  constructor(size = 1024) {
    this.buf = new Uint8Array(size);
    this.view = new DataView(this.buf.buffer);
  }
  private ensure(n: number): void {
    if (this.length + n <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.length + n) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.buf.subarray(0, this.length));
    this.buf = next;
    this.view = new DataView(next.buffer);
  }
  reset(): void {
    this.length = 0;
  }
  u8(n: number): void {
    this.ensure(1);
    this.buf[this.length++] = n;
  }
  u16be(n: number): void {
    this.ensure(2);
    this.view.setUint16(this.length, n);
    this.length += 2;
  }
  u32be(n: number): void {
    this.ensure(4);
    this.view.setUint32(this.length, n);
    this.length += 4;
  }
  u16le(n: number): void {
    this.ensure(2);
    this.view.setUint16(this.length, n, true);
    this.length += 2;
  }
  u24le(n: number): void {
    this.ensure(3);
    this.buf[this.length++] = n & 0xff;
    this.buf[this.length++] = (n >>> 8) & 0xff;
    this.buf[this.length++] = (n >>> 16) & 0xff;
  }
  u32le(n: number): void {
    this.ensure(4);
    this.view.setUint32(this.length, n, true);
    this.length += 4;
  }
  u64le(n: bigint): void {
    this.ensure(8);
    this.view.setBigUint64(this.length, BigInt.asUintN(64, n), true);
    this.length += 8;
  }
  bytes(b: Uint8Array): void {
    this.ensure(b.length);
    this.buf.set(b, this.length);
    this.length += b.length;
  }
  utf8(s: string): number {
    // A string of n UTF-16 code units needs at most 3n bytes.
    this.ensure(s.length * 3);
    const { written } = encoder.encodeInto(s, this.buf.subarray(this.length));
    this.length += written;
    return written;
  }
  cstr(s: string): void {
    this.utf8(s);
    this.u8(0);
  }
  patchU32be(offset: number, n: number): void {
    this.view.setUint32(offset, n);
  }
  patchU24le(offset: number, n: number): void {
    this.buf[offset] = n & 0xff;
    this.buf[offset + 1] = (n >>> 8) & 0xff;
    this.buf[offset + 2] = (n >>> 16) & 0xff;
  }
  /** View of the written bytes. Valid until the next write or reset. */
  view8(): Uint8Array {
    return this.buf.subarray(0, this.length);
  }
  /** Copy of the written bytes. */
  take(): Uint8Array {
    return this.buf.slice(0, this.length);
  }
}
