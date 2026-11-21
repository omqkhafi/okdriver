// Small recorded observations that the verdicts do not need but the README cites. Usage: bun run scripts/observations.ts
import { writeFileSync } from "node:fs";
import { openClient } from "../src/entry/compose.ts";
import { FS01 } from "./lib/ext.ts";
import { TARGETS, ENGINES } from "./lib/targets.ts";

const out: Record<string, unknown> = {};
for (const name of ENGINES) {
  const cfg = TARGETS[name];
  await cfg.setup();
  const o = await openClient(cfg.pkg, cfg.target, { limit: 1 });
  const lit = await o.client.query("select 1 as one");
  const dec = await o.client.query(name === "postgres" ? "select 1.5::numeric as d" : name === "sqlite" || name === "libsql" ? "select 1.5 as d" : "select cast(1.5 as decimal(4,1)) as d");
  const blob = await o.client.query(name === "postgres" ? "select '\\xdeadbeef'::bytea as b" : name === "mysql" || name === "mariadb" ? "select x'deadbeef' as b" : "select x'deadbeef' as b");
  const typed = (v: unknown): string => `${v instanceof Uint8Array ? "Uint8Array" : typeof v} ${v instanceof Uint8Array ? Buffer.from(v).toString("hex") : String(v)}`;
  out[name] = { "select 1": typed(lit.rows[0]![0]), "decimal 1.5": typed(dec.rows[0]![0]), "x'deadbeef'": typed(blob.rows[0]![0]) };
  console.log(name, JSON.stringify(out[name]));
  await o.close();
}
writeFileSync(`${FS01}/results/observations.json`, JSON.stringify(out, null, 2));
