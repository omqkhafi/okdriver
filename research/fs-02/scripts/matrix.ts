// FS-02 matrix runner: runs the probe's seven requests against every endpoint in endpoints.json.
//
//   FS02_PASSWORD=... bun scripts/matrix.ts [--only id,id] [--tier A|B] [--out results]
//
// results/cells.json is the store (one entry per endpoint x tier x request, with the lone re-run of a
// failing cell); results/matrix.csv is regenerated from it. Raw hex goes to results/raw/.
import fs from "node:fs";
import path from "node:path";
import { REQUESTS, DIAGNOSTICS, runRequest, writeRaw, CSV_HEADER, toCsvRow, type Cell, type ProbeOptions } from "./probe.ts";

interface Endpoint {
  id: string;
  family: string;
  version: string;
  backend: string;
  mode: string;
  host: string;
  port: number;
  user: string;
  database: string;
  tls: boolean;
}
type Slim = Omit<Cell, "raw"> & { rerunClass: string; rerunReason: string };

const args = process.argv.slice(2);
const arg = (n: string) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const here = path.resolve(import.meta.dir, "..");
const out = path.resolve(here, arg("out") ?? "results");
const only = arg("only")?.split(",");
const tierArg = arg("tier") ?? "A";
const diag = args.includes("--diag");
const csvOnly = args.includes("--csv-only"); // rebuild matrix.csv from cells.json without measuring
const password = process.env["FS02_PASSWORD"] ?? "";
if (!password && !args.includes("--csv-only")) throw new Error("FS02_PASSWORD is empty");

const endpoints: Endpoint[] = JSON.parse(fs.readFileSync(path.join(here, "endpoints.json"), "utf8"));
const cellsFile = path.join(out, "cells.json");
const store: Slim[] = fs.existsSync(cellsFile) ? JSON.parse(fs.readFileSync(cellsFile, "utf8")) : [];

const isPass = (c: Cell) => (c.request === "R6" || c.request.startsWith("D") ? c.request.startsWith("D") || c.class === "Reject-clean" : c.class === "OK-exact" || c.class === "OK-negotiated");

for (const ep of endpoints) {
  if (csvOnly || (only && !only.includes(ep.id))) continue;
  for (const tier of tierArg === "B" ? ["B"] : ["A"]) {
    if (tier === "B" && !ep.tls) continue;
    const opts: ProbeOptions = {
      host: ep.host,
      port: ep.port,
      user: ep.user,
      database: ep.database,
      password,
      id: ep.id,
      tls: tier === "B",
      timeoutMs: 10_000,
      appName: "fs02-probe",
      cancelAfterMs: 1000,
    };
    // drop old rows for this endpoint and tier
    for (let i = store.length - 1; i >= 0; i--) if (store[i]!.endpoint === ep.id && store[i]!.tier === tier) store.splice(i, 1);
    for (const req of diag ? [...REQUESTS, ...DIAGNOSTICS] : REQUESTS) {
      const cell = await runRequest(opts, req);
      let rerunClass = "";
      let rerunReason = "";
      if (!isPass(cell)) {
        const again = await runRequest(opts, req); // alone, once, to see whether it is flaky
        rerunClass = again.class;
        rerunReason = again.classReason;
      }
      writeRaw(path.join(out, "raw"), cell);
      const { raw: _raw, ...slim } = cell;
      store.push({ ...slim, rerunClass, rerunReason });
      console.log(`${ep.id} ${tier} ${req.id}: ${cell.class}${rerunClass ? ` (rerun: ${rerunClass})` : ""} key=${cell.keyBytes ?? "-"} cancel=${cell.cancel}`);
    }
  }
}
fs.mkdirSync(out, { recursive: true });
const order = new Map(endpoints.map((e, i) => [e.id, i]));
store.sort((a, b) => (order.get(a.endpoint) ?? 99) - (order.get(b.endpoint) ?? 99) || a.tier.localeCompare(b.tier) || a.request.localeCompare(b.request));
fs.writeFileSync(cellsFile, JSON.stringify(store) + "\n"); // compact: keeps the committed size small
const rows = store.map((s) => toCsvRow(s as unknown as Cell) + "," + csv(s.rerunClass) + "," + csv(s.rerunReason));
fs.writeFileSync(path.join(out, "matrix.csv"), [...CSV_HEADER, "rerun_class", "rerun_reason"].join(",") + "\n" + rows.join("\n") + "\n");
function csv(s: string) {
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
