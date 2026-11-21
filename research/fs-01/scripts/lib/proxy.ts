// A byte-forwarding TCP proxy that records what the client sent. Independent of the skeleton:
// it sits on the socket and parses nothing the skeleton produced.
import net from "node:net";

export interface Recorded {
  /** One entry per client connection: every byte the client sent, in order. */
  conns: Buffer[];
}
export interface Proxy extends Recorded {
  port: number;
  close(): Promise<void>;
}

export async function startProxy(targetHost: string, targetPort: number): Promise<Proxy> {
  const conns: Buffer[] = [];
  const sockets = new Set<net.Socket>();
  const server = net.createServer((client) => {
    const idx = conns.length;
    conns.push(Buffer.alloc(0));
    const up = net.connect({ host: targetHost, port: targetPort });
    sockets.add(client).add(up);
    client.on("data", (b) => {
      conns[idx] = Buffer.concat([conns[idx]!, b as Uint8Array]);
      up.write(b);
    });
    up.on("data", (b) => client.write(b));
    const end = (): void => {
      client.destroy();
      up.destroy();
    };
    client.on("close", end).on("error", end);
    up.on("close", end).on("error", end);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as net.AddressInfo).port;
  return {
    port,
    conns,
    close: async () => {
      for (const s of sockets) s.destroy();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}

// ---- frontend parsers --------------------------------------------------------------------
export type PgMsg = { t: string; sql?: string; params?: (Buffer | null)[]; raw: number };
export function parsePgFrontend(b: Buffer): PgMsg[] {
  const out: PgMsg[] = [];
  let p = b.readUInt32BE(0); // startup message: length, no type byte
  while (p + 5 <= b.length) {
    const t = String.fromCharCode(b[p]!);
    const len = b.readUInt32BE(p + 1);
    const body = b.subarray(p + 5, p + 1 + len);
    if (t === "P") {
      const z1 = body.indexOf(0);
      const z2 = body.indexOf(0, z1 + 1);
      out.push({ t, sql: body.subarray(z1 + 1, z2).toString("utf8"), raw: len + 1 });
    } else if (t === "B") {
      let q = body.indexOf(0) + 1;
      q = body.indexOf(0, q) + 1;
      const nf = body.readUInt16BE(q);
      q += 2 + 2 * nf;
      const np = body.readUInt16BE(q);
      q += 2;
      const params: (Buffer | null)[] = [];
      for (let i = 0; i < np; i++) {
        const l = body.readInt32BE(q);
        q += 4;
        if (l < 0) params.push(null);
        else {
          params.push(body.subarray(q, q + l));
          q += l;
        }
      }
      out.push({ t, params, raw: len + 1 });
    } else if (t === "Q") out.push({ t, sql: body.subarray(0, body.length - 1).toString("utf8"), raw: len + 1 });
    else out.push({ t, raw: len + 1 });
    p += 1 + len;
  }
  return out;
}

export type MyMsg = { cmd: string; sql?: string; payload: Buffer };
export function parseMysqlFrontend(b: Buffer): MyMsg[] {
  const out: MyMsg[] = [];
  let p = 0;
  while (p + 4 <= b.length) {
    const len = b[p]! | (b[p + 1]! << 8) | (b[p + 2]! << 16);
    const seq = b[p + 3]!;
    const body = b.subarray(p + 4, p + 4 + len);
    p += 4 + len;
    if (seq !== 0 || len === 0) continue; // handshake response and auth replies have seq > 0
    const c = body[0]!;
    if (c === 0x03) out.push({ cmd: "COM_QUERY", sql: body.subarray(1).toString("utf8"), payload: body });
    else if (c === 0x16) out.push({ cmd: "COM_STMT_PREPARE", sql: body.subarray(1).toString("utf8"), payload: body });
    else if (c === 0x17) out.push({ cmd: "COM_STMT_EXECUTE", payload: body });
    else if (c === 0x19) out.push({ cmd: "COM_STMT_CLOSE", payload: body });
    else if (c === 0x0e) out.push({ cmd: "COM_PING", payload: body });
    else if (c === 0x01) out.push({ cmd: "COM_QUIT", payload: body });
    else out.push({ cmd: `0x${c.toString(16)}`, payload: body });
  }
  return out;
}

export type HttpMsg = { path: string; body: any };
export function parseHttpFrontend(b: Buffer): HttpMsg[] {
  const out: HttpMsg[] = [];
  const s = b.toString("utf8");
  for (const m of s.matchAll(/POST (\S+) HTTP\/1\.1\r\n([\s\S]*?)\r\n\r\n(\{[\s\S]*?\})(?=POST |$)/g)) {
    try {
      out.push({ path: m[1]!, body: JSON.parse(m[3]!) });
    } catch {
      out.push({ path: m[1]!, body: m[3] });
    }
  }
  return out;
}
