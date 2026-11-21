// Packet framing: 3-byte little-endian payload length, 1-byte sequence id, payload.
// A payload of exactly 0xffffff bytes (and every multiple of it) is followed by another packet;
// the last fragment is shorter than 0xffffff, possibly empty.

export const MAX_PAYLOAD = 0xffffff;

export interface Packet {
  /** Sequence id of the first physical packet. */
  firstSeq: number;
  /** Sequence id of the last physical packet; the next packet in the same exchange is lastSeq + 1. */
  lastSeq: number;
  payload: Buffer;
  /** Number of physical packets that were joined. */
  fragments: number;
}

/** Frame one logical payload into physical packets. Returns the bytes and the next sequence id. */
export function frame(payload: Buffer, seq: number): { bytes: Buffer; nextSeq: number } {
  const out: Buffer[] = [];
  let off = 0;
  for (;;) {
    const n = Math.min(MAX_PAYLOAD, payload.length - off);
    const head = Buffer.allocUnsafe(4);
    head.writeUIntLE(n, 0, 3);
    head.writeUInt8(seq & 0xff, 3);
    out.push(head, payload.subarray(off, off + n));
    seq = (seq + 1) & 0xff;
    off += n;
    if (n < MAX_PAYLOAD) break;
  }
  return { bytes: Buffer.concat(out), nextSeq: seq };
}

/** Incremental parser: push socket chunks, pull whole logical packets. */
export class PacketParser {
  private chunks: Buffer[] = [];
  private size = 0;
  private partial: { first: number; frags: Buffer[]; count: number } | null = null;

  push(chunk: Buffer): void {
    this.chunks.push(chunk);
    this.size += chunk.length;
  }

  private take(n: number): Buffer {
    if (this.chunks.length > 1) this.chunks = [Buffer.concat(this.chunks)];
    const all = this.chunks[0]!;
    const out = all.subarray(0, n);
    this.chunks = n === all.length ? [] : [all.subarray(n)];
    this.size -= n;
    return out;
  }

  /** Next complete logical packet, or undefined when more bytes are needed. */
  next(): Packet | undefined {
    for (;;) {
      if (this.size < 4) return undefined;
      if (this.chunks.length > 1) this.chunks = [Buffer.concat(this.chunks)];
      const head = this.chunks[0]!;
      const len = head.readUIntLE(0, 3);
      if (this.size < 4 + len) return undefined;
      const seq = head.readUInt8(3);
      const body = Buffer.from(this.take(4 + len).subarray(4));
      const p = this.partial ?? { first: seq, frags: [], count: 0 };
      p.frags.push(body);
      p.count++;
      if (len === MAX_PAYLOAD) { this.partial = p; continue; }
      this.partial = null;
      return { firstSeq: p.first, lastSeq: seq, payload: p.frags.length === 1 ? p.frags[0]! : Buffer.concat(p.frags), fragments: p.count };
    }
  }
}
