// Show that the direct path and the full path send byte-identical frontend bytes for the statement.
// Both are recorded at the same independent point: net.Socket.prototype.write, patched here.
import { createHash } from "node:crypto";
import net from "node:net";
import { openClient } from "../../src/entry/compose.ts";
import { postgresPackage } from "../../src/entry/packages.ts";
import { DirectPg } from "./direct-pg.ts";
import { open } from "./rungs.ts";

const PORT = Number(process.argv[2] ?? 55432);
const VALUE = 2n ** 53n + 1n;
const recorded: { who: string; bytes: Buffer }[] = [];
let who = "";
const orig = net.Socket.prototype.write;
net.Socket.prototype.write = function (this: net.Socket, chunk: any, ...rest: any[]): boolean {
  if (who !== "") recorded.push({ who, bytes: Buffer.from(chunk) });
  return (orig as any).call(this, chunk, ...rest);
};
const sha = (b: Buffer): string => createHash("sha256").update(b).digest("hex");
const out: Record<string, { startup: Buffer; query: Buffer }> = {};

async function capture(name: string, f: () => Promise<void>): Promise<void> {
  recorded.length = 0;
  who = name;
  await f();
  who = "";
  const writes = recorded.filter((r) => r.who === name).map((r) => r.bytes);
  const startup = writes[0]!;
  const query = Buffer.concat(writes.slice(1).filter((w) => w[0] !== 0x58)); // drop Terminate
  out[name] = { startup, query };
}
await capture("direct", async () => {
  const c = await DirectPg.connect(PORT);
  await c.query(VALUE);
  await c.close();
});
await capture("full", async () => {
  const o = await openClient(postgresPackage, { endpoint: { host: "127.0.0.1", port: PORT }, user: "postgres", database: "fs01" }, { limit: 1 });
  await o.client.query("SELECT $1::int8", [VALUE]);
  await o.close();
});
for (const rung of ["2-wirecore", "3-transport", "4-coord-pool"] as const) {
  await capture(rung, async () => {
    const r = await open(rung, PORT, 1);
    await r.query(Number(VALUE - 2n ** 53n));
    await r.close();
  });
}
let ok = true;
for (const [name, v] of Object.entries(out)) {
  console.log(`${name.padEnd(14)} startup ${v.startup.length} bytes sha256 ${sha(v.startup).slice(0, 16)}  statement ${v.query.length} bytes sha256 ${sha(v.query).slice(0, 16)}`);
}
const d = out.direct!;
for (const [name, v] of Object.entries(out)) {
  const same = v.startup.equals(d.startup) && v.query.equals(d.query);
  if (!same) ok = false;
  console.log(`${name} vs direct: ${same ? "IDENTICAL" : "DIFFERENT"}`);
}
console.log("statement bytes (hex):", d.query.toString("hex"));
console.log(ok ? "BYTES IDENTICAL" : "BYTES DIFFER");
process.exit(ok ? 0 : 1);
