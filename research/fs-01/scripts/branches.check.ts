// Branch count per contract, by the rule in README.md ("Branch counting rule"). Writes results/branches.json.
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { listSourceFiles, toPosix } from "../../../tests/architecture/check.ts";
import { tokenize, scanSource } from "../../../tests/architecture/scan.ts";
import { CONTRACTS, CORE_DECL, FILE_CONTRACT, type AnyContract } from "./lib/contract-map.ts";
import { FS01 } from "./lib/ext.ts";

const SRC = `${FS01}/src`;
const NAMES = /(postgres|mysql|mariadb|sqlite|libsql|hrana|sqld|cloudflare)/i;
const D1 = /\bd1\b/i;
const SQL_FIRST = /^\s*(select|insert|update|delete|begin|commit|rollback|savepoint|release|create|drop|alter|pragma|set|show|start)\b/i;
const DESCRIPTORISH = new Set(["descriptor", "desc", "d", "pkg"]);
const GUARD_PUNCT = new Set(["?", "&", "|", "=", "!"]);

interface Hit { rule: string; file: string; line: number; text: string; contract: AnyContract | "general" }
const hits: Hit[] = [];
const considered: { file: string; line: number; text: string; reason: string }[] = [];
const lineText = (src: string[], n: number): string => (src[n - 1] ?? "").trim().slice(0, 140);
const files = (dir: string): string[] => listSourceFiles(dir);

function contractOf(rel: string, line: number, src: string[]): AnyContract | "general" {
  if (rel === "platform/contracts/core.ts") {
    // nearest preceding `export interface|type X`
    for (let i = line - 1; i >= 0; i--) {
      const m = /^export (?:interface|type) (\w+)/.exec(src[i] ?? "");
      if (m !== null) return CORE_DECL[m[1]!] ?? "general";
    }
  }
  return FILE_CONTRACT[rel] ?? "general";
}

// ---- rules 1 to 3 on platform ----------------------------------------------------------------------
for (const abs of files(join(SRC, "platform"))) {
  const rel = toPosix(relative(SRC, abs));
  const text = readFileSync(abs, "utf8");
  const src = text.split("\n");
  const toks = tokenize(text);
  const add = (rule: string, line: number): void => { hits.push({ rule, file: rel, line, text: lineText(src, line), contract: contractOf(rel, line, src) }); };
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]!;
    if ((t.kind === "string" || t.kind === "template") && (NAMES.test(t.value) || D1.test(t.value))) add("engine-name-literal", t.line);
    if (t.kind === "ident" && (NAMES.test(t.value) || t.value.toLowerCase() === "d1")) add("engine-name-identifier", t.line);
    if ((t.kind === "string" || t.kind === "template") && SQL_FIRST.test(t.value)) {
      const counted = /\s/.test(t.value.trim()) || t.value === t.value.toUpperCase();
      if (counted) add("sql-keyword-literal", t.line);
      else considered.push({ file: rel, line: t.line, text: lineText(src, t.line), reason: "one lower-case taxonomy word, not SQL" });
    }
    // rule 2: `.id` / `.class` on a descriptor-like receiver inside a guard
    if (t.kind === "ident" && (t.value === "id" || t.value === "class") && toks[i - 1]?.value === "." && DESCRIPTORISH.has(toks[i - 2]?.value ?? "")) {
      const same = toks.filter((x) => x.line === t.line);
      const guard = same.some((x) => (x.kind === "ident" && ["if", "switch", "case"].includes(x.value)) || (x.kind === "punct" && GUARD_PUNCT.has(x.value)));
      if (guard) add("branch-on-descriptor-id-or-class", t.line);
    }
  }
}

// ---- rule 4: contract members used by exactly one engine -----------------------------------------------------
interface Member { iface: string; name: string; file: string; line: number; contract: AnyContract | "general" }
const members: Member[] = [];
for (const abs of files(join(SRC, "platform/contracts"))) {
  const rel = toPosix(relative(SRC, abs));
  const src = readFileSync(abs, "utf8").split("\n");
  let iface: string | undefined;
  src.forEach((l, i) => {
    const open = /^export interface (\w+)/.exec(l);
    if (open !== null) { iface = open[1]; return; }
    if (/^}/.test(l)) { iface = undefined; return; }
    if (iface === undefined) return;
    const m = /^ {2}(?:readonly )?([A-Za-z_]\w*)\??\s*[:(<]/.exec(l);
    if (m !== null) members.push({ iface, name: m[1]!, file: rel, line: i + 1, contract: rel === "platform/contracts/core.ts" ? (CORE_DECL[iface] ?? "general") : (FILE_CONTRACT[rel] ?? "general") });
  });
}
// An engine uses a member when its own code does, or when the platform's session driver for its class does on its behalf.
const ENGINE_DIRS: Record<string, string[]> = {
  postgres: ["engines/postgres", "platform/wire-session.ts"],
  mysql: ["engines/mysql-family", "engines/mysql", "platform/wire-session.ts"],
  mariadb: ["engines/mysql-family", "engines/mariadb", "platform/wire-session.ts"],
  sqlite: ["engines/sqlite", "platform/embedded-session.ts"],
  libsql: ["engines/libsql", "platform/service-session.ts"],
};
const used: Record<string, Set<string>> = {};
for (const [eng, dirs] of Object.entries(ENGINE_DIRS)) {
  const set = (used[eng] = new Set());
  for (const d of dirs) for (const abs of d.endsWith(".ts") ? [join(SRC, d)] : files(join(SRC, d))) {
    const toks = tokenize(readFileSync(abs, "utf8"));
    toks.forEach((t, i) => {
      if (t.kind !== "ident") return;
      const prev = toks[i - 1]?.value;
      const next = toks[i + 1]?.value;
      if (prev === "." || next === ":" || next === "(" || next === "?") set.add(t.value);
    });
  }
}
const memberUse = members.map((m) => ({ ...m, engines: Object.keys(ENGINE_DIRS).filter((e) => used[e]!.has(m.name)) }));
const singleEngine = memberUse.filter((m) => m.engines.length === 1);
const noEngine = memberUse.filter((m) => m.engines.length === 0);
for (const m of singleEngine) hits.push({ rule: "member-used-by-one-engine", file: m.file, line: m.line, text: `${m.iface}.${m.name} (only ${m.engines[0]})`, contract: m.contract });

// ---- rule 5: reported, not counted ----------------------------------------------------------------------
const featureTests: Hit[] = [];
for (const abs of files(join(SRC, "platform"))) {
  const rel = toPosix(relative(SRC, abs));
  readFileSync(abs, "utf8").split("\n").forEach((l, i) => {
    if (/\.(openStream|batch)\s*(===|!==)\s*undefined/.test(l)) featureTests.push({ rule: "optional-member-feature-test", file: rel, line: i + 1, text: l.trim(), contract: FILE_CONTRACT[rel] ?? "general" });
  });
}
const entryClassBranches: Hit[] = [];
for (const abs of files(join(SRC, "entry"))) {
  const rel = toPosix(relative(SRC, abs));
  const text = readFileSync(abs, "utf8");
  const src = text.split("\n");
  const toks = tokenize(text);
  toks.forEach((t, i) => {
    if (t.kind === "ident" && (t.value === "id" || t.value === "class") && toks[i - 1]?.value === "." && DESCRIPTORISH.has(toks[i - 2]?.value ?? "")) {
      const same = toks.filter((x) => x.line === t.line);
      if (same.some((x) => (x.kind === "ident" && ["if", "switch", "case"].includes(x.value)) || (x.kind === "punct" && GUARD_PUNCT.has(x.value)))) entryClassBranches.push({ rule: "branch-on-descriptor-id-or-class(entry)", file: rel, line: t.line, text: lineText(src, t.line), contract: "general" });
    }
  });
}
// capabilities: constant or derived from the connect context, per engine
const capDerived: Record<string, Record<string, boolean>> = {};
for (const [eng, file] of [["postgres", "engines/postgres/index.ts"], ["mysql-family", "engines/mysql-family/index.ts"], ["sqlite", "engines/sqlite/index.ts"], ["libsql", "engines/libsql/index.ts"]] as const) {
  const lines = readFileSync(join(SRC, file), "utf8").split("\n");
  const start = lines.findIndex((l) => /return \{/.test(l));
  const rec: Record<string, boolean> = {};
  for (let i = start + 1; i < lines.length && !/^\s*\};?\s*$/.test(lines[i]!); i++) {
    const m = /^\s+(\w+): (.*),$/.exec(lines[i]!);
    if (m !== null) rec[m[1]!] = /ctx|major|caps/.test(m[2]!);
  }
  capDerived[eng] = rec;
}
const capNames = Object.keys(capDerived.postgres!);
const capSummary = capNames.map((c) => ({ capability: c, derivedFromServerFacts: Object.entries(capDerived).filter(([, r]) => r[c]).map(([e]) => e) }));

// ---- aggregate -------------------------------------------------------------------------------------------
const perContract: Record<string, { count: number; hits: Hit[] }> = {};
for (const c of [...CONTRACTS, "Session (added in this study)"]) perContract[c] = { count: 0, hits: [] };
const general = hits.filter((h) => h.contract === "general");
for (const c of Object.keys(perContract)) {
  const mine = hits.filter((h) => h.contract === c || h.contract === "general");
  perContract[c] = { count: mine.length, hits: mine };
}
const byRule: Record<string, number> = {};
for (const h of hits) byRule[h.rule] = (byRule[h.rule] ?? 0) + 1;

const result = {
  rule: "README.md, Branch counting rule",
  platformFiles: files(join(SRC, "platform")).length,
  totalHits: hits.length,
  byRule,
  perContract,
  generalPlatformHits: general,
  consideredNotCounted: considered,
  membersNoEngineUses: noEngine.map((m) => `${m.iface}.${m.name} (${m.file}:${m.line})`),
  singleEngineMembers: singleEngine.map((m) => `${m.iface}.${m.name} (${m.file}:${m.line}) only ${m.engines[0]}`),
  optionalMemberFeatureTests: featureTests,
  entryClassBranches,
  capabilities: capSummary,
  scannerImports: scanSource("").imports.length,
};
writeFileSync(`${FS01}/results/branches.json`, JSON.stringify(result, null, 2));
console.log(`platform branch hits: ${hits.length}`, byRule);
for (const [c, v] of Object.entries(perContract)) console.log(`  ${c}: ${v.count}`);
for (const h of hits) console.log(`  HIT ${h.rule} ${h.file}:${h.line} [${h.contract}] ${h.text}`);
console.log(`considered, not counted: ${considered.length}`); for (const c of considered) console.log(`  ${c.file}:${c.line} ${c.reason}: ${c.text}`);
console.log(`members no engine uses (${noEngine.length}):`); for (const m of noEngine) console.log(`  ${m.iface}.${m.name} ${m.file}:${m.line}`);
console.log(`optional-member feature tests: ${featureTests.length}`); for (const h of featureTests) console.log(`  ${h.file}:${h.line} ${h.text}`);
console.log(`entry class branches: ${entryClassBranches.length}`); for (const h of entryClassBranches) console.log(`  ${h.file}:${h.line} ${h.text}`);
console.log("capabilities derived from server facts:"); for (const c of capSummary) console.log(`  ${c.capability}: ${c.derivedFromServerFacts.join(",") || "(constant everywhere)"}`);
void readdirSync;
