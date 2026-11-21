// Verdict table, computed from recorded data. Usage: bun run scripts/verdicts.ts
// Rule (the FS-01 row): Adopt = zero engine branches AND used by at least two engine classes without a shim
// AND no measurable overhead on its rung. Otherwise Engine-owned. Thresholds are not moved.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { CONTRACTS, ADDED } from "./lib/contract-map.ts";
import { FS01 } from "./lib/ext.ts";

type Cls = "wire" | "embedded" | "service";
const ENGINE_CLASS: Record<string, Cls> = { postgres: "wire", mysql: "wire", mariadb: "wire", sqlite: "embedded", libsql: "service" };
const ENGINES = Object.keys(ENGINE_CLASS);
const read = (p: string): string => readFileSync(`${FS01}/${p}`, "utf8");
const json = <T,>(p: string): T => JSON.parse(read(p)) as T;
const has = (p: string, re: RegExp): boolean => re.test(read(p));

// ---- named checks that passed, per engine ----------------------------------------------------------------
interface Acc { checks: { check: string; pass: boolean; detail: string }[] }
const accept: Record<string, Acc> = {};
const coord: Record<string, Acc> = {};
for (const e of ENGINES) {
  accept[e] = json<Acc>(`results/accept-${e}.json`);
  coord[e] = json<Acc>(`results/coordinator-${e}.json`);
}
const passed = (m: Record<string, Acc>, e: string, name: string): boolean => m[e]!.checks.some((c) => c.check === name && c.pass);

// ---- which engines use which contract, with evidence --------------------------------------------------------
const compose = read("src/entry/compose.ts");
const block = (cls: Cls): string => { const i = compose.indexOf(`case "${cls}":`); const j = [...compose.matchAll(/case "(\w+)":/g)].map((m) => m.index!).filter((x) => x > i)[0] ?? compose.length; return compose.slice(i, j); };
const usedBy: Record<string, { engines: string[]; evidence: string }> = {
  [CONTRACTS[0]]: { engines: ENGINES.filter((e) => passed(accept, e, "connect.ok") && passed(accept, e, "capabilities.from-facts")), evidence: "accept: connect.ok + capabilities.from-facts" },
  WireCore: { engines: ["postgres", "mysql", "mariadb"].filter((e) => passed(accept, e, "query.bigint") && (has("src/engines/postgres/core.ts", /implements WireCore/) || has("src/engines/mysql-family/core.ts", /implements WireCore/))), evidence: "implements WireCore (postgres/core.ts, mysql-family/core.ts) + accept query.bigint" },
  EmbeddedCore: { engines: has("src/engines/sqlite/core.ts", /implements EmbeddedCore/) && passed(accept, "sqlite", "query.bigint") ? ["sqlite"] : [], evidence: "implements EmbeddedCore (sqlite/core.ts) + accept query.bigint" },
  ServiceCore: { engines: has("src/engines/libsql/core.ts", /implements ServiceCore/) && passed(accept, "libsql", "query.bigint") ? ["libsql"] : [], evidence: "implements ServiceCore (libsql/core.ts) + accept query.bigint" },
  ExecutionCoordinator: { engines: ENGINES.filter((e) => passed(coord, e, "limit2.all-completed") && passed(coord, e, "limit2.coordinator-maxActive<=2")), evidence: "coordinator-<engine>.json limit2 checks" },
  ConnectionPool: { engines: ENGINES.filter((e) => block(ENGINE_CLASS[e]!).includes("SimplePool") && passed(coord, e, "limit2.all-completed")), evidence: "src/entry/compose.ts: which class block creates a SimplePool" },
  Transport: { engines: ENGINES.filter((e) => /TcpTransport|HttpTransport/.test(block(ENGINE_CLASS[e]!)) && passed(accept, e, "query.bigint")), evidence: "src/entry/compose.ts: which class block creates a Transport" },
  [CONTRACTS[7]]: { engines: ENGINES.filter((e) => passed(accept, e, "error.class-constraint") && passed(accept, e, "error.vendor-untouched")), evidence: "accept: error.class-constraint + error.vendor-untouched" },
  CodecRegistry: { engines: ENGINES.filter((e) => passed(accept, e, "query.bigint") && passed(accept, e, "query.text")), evidence: "accept: query.bigint + query.text" },
  [ADDED[0]]: { engines: ENGINES.filter((e) => passed(accept, e, "tx.commit-visible-external") && passed(accept, e, "tx.rollback-invisible-external")), evidence: "accept: tx.commit-visible-external + tx.rollback-invisible-external" },
};

// ---- shims, branches, overhead ---------------------------------------------------------------------------------
interface Shim { contract: string; engine: string; class: Cls; what: string; where: string[] }
const shims = json<{ shims: Shim[] }>("shims.json").shims;
const branches = json<{ perContract: Record<string, { count: number; hits: { rule: string; file: string; line: number; text: string }[] }> }>("results/branches.json");
const entryBranches = json<{ entryClassBranches: { file: string; line: number; text: string }[] }>("results/branches.json").entryClassBranches;
const ladder = existsSync(`${FS01}/results/ladder-summary.json`) ? json<{ perRung: { rung: string; measurable: boolean; inconclusive: boolean; cells: string[] }[] }>("results/ladder-summary.json") : undefined;
const RUNG: Record<string, string | undefined> = {
  [CONTRACTS[0]]: "5-full", WireCore: "2-wirecore", EmbeddedCore: undefined, ServiceCore: undefined, ExecutionCoordinator: "4-coord-pool",
  ConnectionPool: "4-coord-pool", Transport: "3-transport", [CONTRACTS[7]]: "5-full", CodecRegistry: "5-full", [ADDED[0]]: "5-full",
};

interface Row { contract: string; structural: "fits" | "does not fit"; overheadStatus: "not measurable" | "measurable" | "inconclusive" | "no rung"; verdict: "Adopt" | "Engine-owned"; branches: number; classesWithoutShim: Cls[]; classesUsing: Cls[]; enginesUsing: string[]; shimmedClasses: Cls[]; rung: string | undefined; overhead: string; reasons: string[] }
const rows: Row[] = [];
for (const c of [...CONTRACTS, ...ADDED]) {
  const u = usedBy[c]!;
  const classesUsing = [...new Set(u.engines.map((e) => ENGINE_CLASS[e]!))];
  const shimmed = [...new Set(shims.filter((s) => s.contract === c).map((s) => s.class))];
  const classesWithoutShim = classesUsing.filter((k) => !shimmed.includes(k));
  const b = branches.perContract[c]?.count ?? 0;
  const rung = RUNG[c];
  const rungInfo = rung === undefined ? undefined : ladder?.perRung.find((r) => r.rung === rung);
  let overhead: string;
  let overheadOk: boolean;
  let overheadStatus: Row["overheadStatus"];
  if (rung === undefined) { overhead = "no PostgreSQL rung (not on that hot path)"; overheadOk = true; overheadStatus = "no rung"; }
  else if (rungInfo === undefined) { overhead = "ladder not run"; overheadOk = false; overheadStatus = "inconclusive"; }
  else if (rungInfo.inconclusive) { overhead = `${rung}: inconclusive (direct spread above 15%)`; overheadOk = false; overheadStatus = "inconclusive"; }
  else if (rungInfo.measurable) { overhead = `${rung}: measurable (${rungInfo.cells.filter((x) => x.includes(": measurable")).join(", ")})`; overheadOk = false; overheadStatus = "measurable"; }
  else { overhead = `${rung}: not measurable`; overheadOk = true; overheadStatus = "not measurable"; }
  const reasons: string[] = [];
  if (b > 0) reasons.push(`${b} branch hit(s) by the counting rule`);
  if (classesWithoutShim.length < 2) reasons.push(`used by ${classesWithoutShim.length} engine class(es) without a shim (${classesWithoutShim.join(", ") || "none"}); two needed`);
  if (shimmed.length > 0) reasons.push(`shim in class ${shimmed.join(", ")}`);
  if (!overheadOk) reasons.push(`overhead: ${overhead}`);
  const structural = b === 0 && classesWithoutShim.length >= 2 ? "fits" : "does not fit";
  const verdict = structural === "fits" && overheadOk ? "Adopt" : "Engine-owned";
  rows.push({ contract: c, structural, overheadStatus, verdict, branches: b, classesWithoutShim, classesUsing, enginesUsing: u.engines, shimmedClasses: shimmed, rung, overhead, reasons });
}

const main = rows.filter((r) => !ADDED.includes(r.contract as never));
const added = rows.filter((r) => ADDED.includes(r.contract as never));
const md = (rs: Row[]): string => [
  "| Contract | Verdict | Platform branch hits | Engines using | Classes using without a shim | Structural fit | Overhead on its rung | Why not Adopt |",
  "|---|---|---|---|---|---|---|---|",
  ...rs.map((r) => `| ${r.contract} | **${r.verdict}** | ${r.branches} | ${r.enginesUsing.join(", ")} | ${r.classesWithoutShim.join(", ") || "none"} (${r.classesWithoutShim.length}) | ${r.structural} | ${r.overhead} | ${r.reasons.join("; ") || "-"} |`),
].join("\n");
const text = `${md(main)}\n\nAdded by this study (not in the row's list, same rule):\n\n${md(added)}\n\nEntry composition (not platform code, reported apart): ${entryBranches.length} class switch(es): ${entryBranches.map((h) => `${h.file}:${h.line}`).join(", ")}.\n`;
writeFileSync(`${FS01}/results/verdicts.json`, JSON.stringify({ rows, entryBranches, evidence: Object.fromEntries(Object.entries(usedBy).map(([k, v]) => [k, v.evidence])) }, null, 2));
writeFileSync(`${FS01}/results/verdicts.md`, text);
console.log(text);
