// FS-02: repeat selected probe requests many times against one endpoint, to measure intermittent behaviour.
//
//   FS02_PASSWORD=... bun scripts/repeat.ts --endpoint pgpool-4.7.3-pg19 --requests R0,R1,R2,R3,R4,R5 --n 20 [--beta3-psql 25]
//
// Writes results/optional/repeat-<endpoint>.json and prints a count per request and class. With --beta3-psql N it
// also connects N times with psql from postgres:19beta3 (libpq that sends the grease startup by default; the
// fs02-psql-beta container must exist, see oracle-psql.ts) and counts connected / error texts.
import fs from "node:fs";
import path from "node:path";
import { REQUESTS, DIAGNOSTICS, runRequest } from "./probe.ts";

const args = process.argv.slice(2);
const arg = (n: string) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const here = path.resolve(import.meta.dir, "..");
const password = process.env["FS02_PASSWORD"];
if (!password) throw new Error("FS02_PASSWORD is empty");
const id = arg("endpoint");
if (!id) throw new Error("--endpoint is required");
const ep = (JSON.parse(fs.readFileSync(path.join(here, "endpoints.json"), "utf8")) as Array<{ id: string; host: string; port: number; user: string; database: string }>).find((e) => e.id === id);
if (!ep) throw new Error(`unknown endpoint ${id}`);
const reqs = (arg("requests") ?? "R0,R1,R2,R3,R4,R5").split(",");
const n = Number(arg("n") ?? 20);

const counts: Record<string, Record<string, number>> = {};
const reasons: Record<string, string> = {};
for (let i = 0; i < n; i++) {
  for (const r of [...REQUESTS, ...DIAGNOSTICS].filter((x) => reqs.includes(x.id))) {
    const c = await runRequest({ host: ep.host, port: ep.port, user: ep.user, database: ep.database, password, id, tls: false, timeoutMs: 10_000, appName: "fs02-probe", cancelAfterMs: 1000 }, r);
    const k = c.class;
    (counts[r.id] ??= {})[k] = (counts[r.id]?.[k] ?? 0) + 1;
    if (k !== "OK-exact" && k !== "OK-negotiated") reasons[`${r.id} ${k}`] = c.classReason;
  }
}
const result: Record<string, unknown> = { endpoint: id, repetitions: n, counts, sampleReasons: reasons };

const nb = Number(arg("beta3-psql") ?? 0);
if (nb > 0) {
  const outcomes: Record<string, number> = {};
  for (let i = 0; i < nb; i++) {
    const p = Bun.spawn(["docker", "exec", "-e", "PGPASSWORD", "fs02-psql-beta", "psql", `host=${ep.host} port=${ep.port} user=${ep.user} dbname=${ep.database} sslmode=disable connect_timeout=10`, "-X", "-A", "-t", "-c", "select 1"], { stdout: "pipe", stderr: "pipe", env: { ...process.env, PGPASSWORD: password } });
    const [o, e] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
    const code = await p.exited;
    const key = code === 0 ? "connected" : (e.split("\n")[0] ?? "").replace(/port \d+/, "port N").split(password).join("<redacted>");
    outcomes[key] = (outcomes[key] ?? 0) + 1;
    void o;
  }
  result["beta3Psql"] = { connections: nb, outcomes };
}
fs.mkdirSync(path.join(here, "results", "optional"), { recursive: true });
fs.writeFileSync(path.join(here, "results", "optional", `repeat-${id}.json`), JSON.stringify(result, null, 1) + "\n");
console.log(JSON.stringify(result, null, 1));
