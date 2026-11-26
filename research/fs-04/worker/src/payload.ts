// Deterministic payload: byte i depends only on (seed, i), so any chunking gives the same bytes and the harness can
// recompute the expected sha256 without the Worker's help.
const mix = (x: number): number => {
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b); x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35); return (x ^ (x >>> 16)) >>> 0;
};
export function fillPayload(out: Uint8Array, seed: number, start = 0): void {
  for (let i = 0; i < out.length; i++) {
    const idx = start + i;
    out[i] = (mix((seed + Math.imul(idx >>> 2, 0x9e3779b1)) | 0) >>> ((idx & 3) * 8)) & 0xff;
  }
}
const i32 = (v: number) => { const b = new Uint8Array(4); new DataView(b.buffer).setInt32(0, v); return b; };
const i16 = (v: number) => { const b = new Uint8Array(2); new DataView(b.buffer).setInt16(0, v); return b; };
/** Bind frame for the unnamed portal and unnamed statement with ONE binary-format parameter of `size` bytes. Header and trailer. */
export function bindByteaParts(size: number): { head: Uint8Array; tail: Uint8Array; total: number } {
  const pre = [new Uint8Array([0]), new Uint8Array([0]), i16(1), i16(1), i16(1), i32(size)]; // portal "", stmt "", 1 format code (binary), 1 param, length
  const preLen = pre.reduce((n, p) => n + p.length, 0);
  const tail = i16(0); // no result format codes
  const bodyLen = preLen + size + tail.length;
  const head = new Uint8Array(1 + 4 + preLen);
  head[0] = 'B'.charCodeAt(0); head.set(i32(bodyLen + 4), 1);
  let o = 5; for (const p of pre) { head.set(p, o); o += p.length; }
  return { head, tail, total: head.length + size + tail.length };
}
/** PGCOPY binary stream (header, one tuple with one bytea column, trailer) split into its three pieces. */
export function copyBinaryParts(size: number): { head: Uint8Array; tail: Uint8Array } {
  const sig = new Uint8Array([0x50, 0x47, 0x43, 0x4f, 0x50, 0x59, 0x0a, 0xff, 0x0d, 0x0a, 0x00]);
  const head = new Uint8Array(sig.length + 8 + 2 + 4);
  head.set(sig, 0); // flags (4) and extension length (4) stay zero
  new DataView(head.buffer).setInt16(sig.length + 8, 1); new DataView(head.buffer).setInt32(sig.length + 10, size);
  return { head, tail: i16(-1) };
}
