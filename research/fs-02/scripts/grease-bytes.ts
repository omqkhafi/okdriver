// FS-02 oracle 1c: the StartupMessage libpq from postgres:19beta3 sends by default (grease), captured on a local
// socket, against the bytes the probe builds for R3 with the same parameters. Writes results/grease-bytes.json.
//   needs the fs02-psql-beta container (see oracle-psql.ts) with host networking.
import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import { buildStartup, REQUESTS } from "./probe.ts";

const here = path.resolve(import.meta.dir, "..");
let captured: Buffer | null = null;
const srv = net.createServer((s) => {
  s.on("data", (d: Buffer) => {
    if (d.length === 8 && d.readInt32BE(4) === 80877103) return void s.write("N"); // SSLRequest first (sslmode=prefer): say no
    captured ??= d;
    s.destroy();
  });
  s.on("error", () => {});
});
await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
const port = (srv.address() as net.AddressInfo).port;
const p = Bun.spawn(["docker", "exec", "fs02-psql-beta", "psql", `host=127.0.0.1 port=${port} user=fs02 dbname=fs02 application_name=fs02-probe connect_timeout=5`, "-X", "-c", "select 1"], { stdout: "pipe", stderr: "pipe", env: { ...process.env, PGPASSWORD: "unused" } });
await p.exited;
srv.close();
if (!captured) throw new Error("no startup packet captured");
const r3 = REQUESTS.find((r) => r.id === "R3")!;
const mine = buildStartup(r3.version, [["user", "fs02"], ["database", "fs02"], ["application_name", "fs02-probe"], ...r3.extra]);
const lib = captured as Buffer;
const out = { libpq19beta3: lib.toString("hex"), probeR3: mine.toString("hex"), identical: lib.equals(mine), libpqAscii: lib.toString("latin1").replace(/\0/g, "·") };
fs.mkdirSync(path.join(here, "results"), { recursive: true });
fs.writeFileSync(path.join(here, "results", "grease-bytes.json"), JSON.stringify(out, null, 1) + "\n");
console.log(JSON.stringify(out, null, 1));
