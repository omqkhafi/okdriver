// FS-02 oracle 2 runner: starts the fault servers in-process, runs the probe's seven requests against
// each, and checks that every fault yields its own distinct class on R1. Writes results/oracle-faults.csv.
import fs from "node:fs";
import path from "node:path";
import { REQUESTS, runRequest, CSV_HEADER, toCsvRow, type CellClass } from "./probe.ts";
import { startFaultServers, type FaultName } from "./fault-servers.ts";

const here = path.resolve(import.meta.dir, "..");
const expectedR1: Record<FaultName, CellClass> = {
  "close-on-minor": "Drop",
  "error-response": "Reject-clean",
  "silent-accept": "OK-exact", // a server that accepts 3.2 blindly cannot be told from one that honours it on R1 alone ...
  "bad-negotiate": "Bad-negotiate",
  hang: "Hang",
};
// ... which is why the silent accept is judged on R2 (3.9999), where accepting is never legitimate.
const expectedR2: Record<FaultName, CellClass> = {
  "close-on-minor": "Drop",
  "error-response": "Reject-clean",
  "silent-accept": "Silent-accept",
  "bad-negotiate": "Bad-negotiate",
  hang: "Hang",
};

const servers = await startFaultServers();
const rows: string[] = [];
let failures = 0;
const seenR2 = new Set<string>();
for (const s of servers) {
  for (const req of REQUESTS) {
    const cell = await runRequest(
      { host: "127.0.0.1", port: s.port, user: "fs02", database: "fs02", password: "unused-by-trust-auth", id: `fault:${s.name}`, tls: false, timeoutMs: 10_000, appName: "fs02-probe", cancelAfterMs: 500 },
      req,
    );
    rows.push(toCsvRow(cell));
    console.log(`fault:${s.name} ${req.id}: ${cell.class} (${cell.classReason})`);
    if (req.id === "R1" && cell.class !== expectedR1[s.name]) {
      failures++;
      console.log(`  UNEXPECTED: R1 expected ${expectedR1[s.name]}`);
    }
    if (req.id === "R2") {
      seenR2.add(cell.class);
      if (cell.class !== expectedR2[s.name]) {
        failures++;
        console.log(`  UNEXPECTED: R2 expected ${expectedR2[s.name]}`);
      }
    }
  }
  s.close();
}
if (seenR2.size !== servers.length) {
  failures++;
  console.log(`classes on R2 are not distinct: ${[...seenR2].join(", ")}`);
}
fs.mkdirSync(path.join(here, "results"), { recursive: true });
fs.writeFileSync(path.join(here, "results", "oracle-faults.csv"), CSV_HEADER.join(",") + "\n" + rows.join("\n") + "\n");
console.log(failures === 0 ? "oracle 2: every fault produced its own distinct class" : `oracle 2: ${failures} unexpected result(s)`);
process.exit(failures === 0 ? 0 : 1);
