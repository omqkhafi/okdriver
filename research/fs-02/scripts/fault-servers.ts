// FS-02 oracle 2: tiny PostgreSQL-protocol servers that misbehave on purpose. They exist only to prove
// that the probe's classes can occur and are told apart. They are not endpoints and stay out of the
// endpoint tables. Authentication is "trust" (AuthenticationOk straight away): the SCRAM client is
// verified on real PostgreSQL, not here.
//
//   bun scripts/fault-servers.ts          listens on 55801..55805 until interrupted
//   (scripts/oracle-faults.ts starts them in-process and runs the probe against them)
import net from "node:net";

export type FaultName = "close-on-minor" | "error-response" | "silent-accept" | "bad-negotiate" | "hang";
export const FAULTS: FaultName[] = ["close-on-minor", "error-response", "silent-accept", "bad-negotiate", "hang"];

const V30 = 3 * 65536;

function msg(type: string, body: Buffer): Buffer {
  const b = Buffer.alloc(5 + body.length);
  b.write(type, 0, "latin1");
  b.writeInt32BE(4 + body.length, 1);
  body.copy(b, 5);
  return b;
}
const cs = (s: string) => Buffer.concat([Buffer.from(s), Buffer.from([0])]);
const i32 = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeInt32BE(n);
  return b;
};
const authOk = () => msg("R", i32(0));
const paramStatus = (k: string, v: string) => msg("S", Buffer.concat([cs(k), cs(v)]));
const backendKey = () => msg("K", Buffer.concat([i32(4242), Buffer.from([1, 2, 3, 4])]));
const ready = () => msg("Z", Buffer.from("I"));
const errorResponse = (code: string, text: string) =>
  msg("E", Buffer.concat([Buffer.from("SFATAL"), Buffer.from([0]), Buffer.from("VFATAL"), Buffer.from([0]), Buffer.from("C" + code), Buffer.from([0]), Buffer.from("M" + text), Buffer.from([0, 0])]));
const negotiate = (version: number) => msg("v", Buffer.concat([i32(version), i32(0)]));
const rowSelect1 = () =>
  Buffer.concat([
    msg("T", Buffer.concat([Buffer.from([0, 1]), cs("?column?"), i32(0), Buffer.from([0, 0]), i32(23), Buffer.from([0, 4]), i32(-1), Buffer.from([0, 0])])),
    msg("D", Buffer.concat([Buffer.from([0, 1]), i32(1), Buffer.from("1")])),
    msg("C", cs("SELECT 1")),
    ready(),
  ]);

function serveNormally(sock: net.Socket, version: number) {
  void version;
  sock.write(Buffer.concat([authOk(), paramStatus("server_version", "fault-server"), backendKey(), ready()]));
  let buf = Buffer.alloc(0);
  sock.on("data", (d: Buffer) => {
    buf = Buffer.concat([buf, d]);
    while (buf.length >= 5) {
      const len = buf.readInt32BE(1);
      if (buf.length < 1 + len) return;
      const type = String.fromCharCode(buf[0]!);
      const body = buf.subarray(5, 1 + len);
      buf = buf.subarray(1 + len);
      if (type === "X") return void sock.end();
      if (type === "Q") {
        const sql = body.toString("utf8");
        if (sql.includes("pg_sleep")) {
          // A server that ignores cancel: the sleep simply runs to the end.
          setTimeout(() => sock.writable && sock.write(Buffer.concat([msg("C", cs("SELECT 1")), ready()])), 10_000);
        } else sock.write(rowSelect1());
      }
    }
  });
}

function handle(fault: FaultName, sock: net.Socket) {
  sock.on("error", () => {});
  let buf = Buffer.alloc(0);
  const onData = (d: Buffer) => {
    buf = Buffer.concat([buf, d]);
    if (buf.length < 8) return;
    const len = buf.readInt32BE(0);
    if (buf.length < len) return;
    const code = buf.readInt32BE(4);
    if (code === 80877103) {
      sock.write("N"); // no TLS
      buf = buf.subarray(len);
      return;
    }
    if (code === 80877102) return void sock.destroy(); // CancelRequest: ignored
    sock.off("data", onData);
    const version = code;
    switch (fault) {
      case "hang":
        return; // read the startup packet and never answer
      case "close-on-minor":
        if ((version & 0xffff) > 0) return void sock.destroy();
        return serveNormally(sock, version);
      case "error-response":
        if (version !== V30) {
          sock.end(errorResponse("08P01", `unsupported frontend protocol ${version >>> 16}.${version & 0xffff}: this fault server only speaks 3.0`));
          return;
        }
        return serveNormally(sock, version);
      case "bad-negotiate":
        if (version !== V30) {
          // "downgrade" to a version higher than the one requested
          const higher = Math.min(version + 1, version | 0xffff);
          sock.write(negotiate(higher));
        }
        return serveNormally(sock, version);
      case "silent-accept":
        return serveNormally(sock, version);
    }
  };
  sock.on("data", onData);
}

export async function startFaultServers(basePort = 0): Promise<Array<{ name: FaultName; port: number; close: () => void }>> {
  const out: Array<{ name: FaultName; port: number; close: () => void }> = [];
  for (let i = 0; i < FAULTS.length; i++) {
    const name = FAULTS[i]!;
    const srv = net.createServer((s) => handle(name, s));
    await new Promise<void>((r) => srv.listen(basePort ? basePort + i : 0, "127.0.0.1", r));
    const port = (srv.address() as net.AddressInfo).port;
    out.push({ name, port, close: () => srv.close() });
  }
  return out;
}

if (import.meta.main) {
  const s = await startFaultServers(55801);
  for (const x of s) console.log(`${x.name} on 127.0.0.1:${x.port}`);
}
