// Rung 1: a direct PostgreSQL client for one job: `SELECT $1::int8` with one bigint parameter.
// Own socket loop. It shares nothing with src/ except that it is written against the same protocol:
// no platform contract, no WireCore, no ByteWriter. Frontend bytes are built here, independently.
import net from "node:net";

const SQL = Buffer.from("SELECT $1::int8\0", "latin1");
const PARSE_HEAD = Buffer.concat([Buffer.from([0x50]), Buffer.alloc(4), Buffer.from([0]), SQL, Buffer.from([0, 0])]);
PARSE_HEAD.writeUInt32BE(PARSE_HEAD.length - 1, 1);
// Describe portal "", Execute portal "" no limit, Sync
const TAIL = Buffer.from([0x44, 0, 0, 0, 6, 0x50, 0, 0x45, 0, 0, 0, 9, 0, 0, 0, 0, 0, 0x53, 0, 0, 0, 4]);

export function directStartup(user: string, database: string): Buffer {
  const body = Buffer.from(`user\0${user}\0database\0${database}\0client_encoding\0UTF8\0\0`, "latin1");
  const b = Buffer.alloc(8 + body.length);
  b.writeUInt32BE(b.length, 0);
  b.writeUInt32BE(196608, 4);
  body.copy(b, 8);
  return b;
}

export function directQueryBytes(value: string): Buffer {
  const v = Buffer.from(value, "latin1");
  // Bind: portal "", statement "", 1 format code (text), 1 parameter, value, 1 result format (text)
  const bindLen = 4 + 1 + 1 + 2 + 2 + 2 + 4 + v.length + 2 + 2;
  const out = Buffer.allocUnsafe(PARSE_HEAD.length + 1 + bindLen + TAIL.length);
  let o = PARSE_HEAD.copy(out, 0);
  out[o++] = 0x42;
  o = out.writeUInt32BE(bindLen, o);
  out[o++] = 0;
  out[o++] = 0;
  o = out.writeUInt16BE(1, o);
  o = out.writeUInt16BE(0, o);
  o = out.writeUInt16BE(1, o);
  o = out.writeUInt32BE(v.length, o);
  o += v.copy(out, o);
  o = out.writeUInt16BE(1, o);
  o = out.writeUInt16BE(0, o);
  TAIL.copy(out, o);
  return out;
}

export class DirectPg {
  private sock!: net.Socket;
  private carry: Buffer | null = null;
  private value = 0n;
  private failed = false;
  private done: ((v: bigint) => void) | undefined;
  private fail: ((e: Error) => void) | undefined;
  private starting: (() => void) | undefined;

  static async connect(port: number, user = "postgres", database = "fs01"): Promise<DirectPg> {
    const c = new DirectPg();
    c.sock = net.connect({ host: "127.0.0.1", port });
    c.sock.setNoDelay(true);
    await new Promise<void>((resolve, reject) => {
      c.sock.once("connect", resolve);
      c.sock.once("error", reject);
    });
    c.sock.on("data", (b: Buffer) => c.onData(b));
    c.sock.on("close", () => c.fail?.(new Error("closed")));
    const ready = new Promise<void>((r) => (c.starting = r));
    c.sock.write(directStartup(user, database));
    await ready;
    return c;
  }

  private onData(chunk: Buffer): void {
    const b = this.carry === null ? chunk : Buffer.concat([this.carry, chunk]);
    let off = 0;
    while (b.length - off >= 5) {
      const len = b.readUInt32BE(off + 1);
      if (b.length - off - 1 < len) break;
      const t = b[off]!;
      if (t === 0x44) {
        const l = b.readInt32BE(off + 7);
        this.value = BigInt(b.toString("latin1", off + 11, off + 11 + l));
      } else if (t === 0x45) this.failed = true;
      else if (t === 0x5a) {
        if (this.starting !== undefined) {
          const s = this.starting;
          this.starting = undefined;
          s();
        } else if (this.failed) {
          this.failed = false;
          this.fail?.(new Error("server error"));
        } else this.done?.(this.value);
      }
      off += 1 + len;
    }
    this.carry = off < b.length ? b.subarray(off) : null;
  }

  query(value: bigint): Promise<bigint> {
    return new Promise((resolve, reject) => {
      this.done = resolve;
      this.fail = reject;
      this.sock.write(directQueryBytes(String(value)));
    });
  }

  close(): Promise<void> {
    this.sock.destroy();
    return Promise.resolve();
  }
}
