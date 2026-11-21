// Boundary checks over research/fs-01/src, using the repo's own checkers (read-only) plus one rule of ours.
// Usage: bun run scripts/boundary.check.ts            (real tree + negative runs in a throwaway copy)
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { checkEngineLiterals, checkImportGraph, formatViolation, listSourceFiles, toPosix, type Violation } from "../../../tests/architecture/check.ts";
import { ALLOWED_EDGES, EXTERNAL_ALLOWLIST, type Policy } from "../../../tests/architecture/edges.ts";
import { scanSource } from "../../../tests/architecture/scan.ts";
import { FS01 } from "./lib/ext.ts";

const SRC = `${FS01}/src`;
const PROJECTS = ["platform", "transports", "engines/postgres", "engines/mysql-family", "engines/mysql", "engines/mariadb", "engines/sqlite", "engines/libsql", "entry"];

/** ADR 042 edges, plus engines/libsql to platform, plus entry may import everything. */
export const EDGES: Record<string, readonly string[]> = {
  ...ALLOWED_EDGES,
  "engines/libsql": ["platform"],
  entry: PROJECTS.filter((p) => p !== "entry"),
};
const emptyExternals: Record<string, readonly string[]> = { ...EXTERNAL_ALLOWLIST, "engines/libsql": [], entry: [] };

type Rule = Violation["rule"] | "engine-platform-deep-import";
interface V extends Omit<Violation, "rule"> { rule: Rule }

/** Own rule: an engine imports platform only through platform/contracts. */
function checkEnginesUseContractsOnly(root: string): V[] {
  const out: V[] = [];
  for (const abs of listSourceFiles(join(root, "engines"))) {
    const file = toPosix(relative(root, abs));
    for (const ref of scanSource(readFileSync(abs, "utf8")).imports) {
      if (!ref.specifier.startsWith(".")) continue;
      const target = toPosix(relative(root, resolve(dirname(abs), ref.specifier)));
      if ((target === "platform" || target.startsWith("platform/")) && target !== "platform/contracts" && !target.startsWith("platform/contracts/")) {
        out.push({ file, line: ref.line, rule: "engine-platform-deep-import", message: `engine imports "${ref.specifier}" (${target}); engines may import platform only through platform/contracts` });
      }
    }
  }
  return out;
}

export function runAll(root: string, policy: Policy): V[] {
  return [...checkImportGraph(root, policy), ...checkEngineLiterals(root), ...checkEnginesUseContractsOnly(root)];
}
const fmt = (v: V): string => formatViolation(v as Violation, "research/fs-01/src/");

// ---- 1. the real tree --------------------------------------------------------------------------------
const log: string[] = [];
const say = (s: string): void => { log.push(s); console.log(s); };

const unallowed = checkImportGraph(SRC, { edges: EDGES, externals: emptyExternals }).filter((v) => v.rule === "external-import");
const needed: Record<string, string[]> = {};
for (const v of unallowed) {
  const spec = /"([^"]+)"/.exec(v.message)![1]!;
  const proj = PROJECTS.filter((p) => v.file.startsWith(`${p}/`)).sort((a, b) => b.length - a.length)[0]!;
  (needed[proj] ??= []).includes(spec) || needed[proj]!.push(spec);
}
say(`external allowlist needed (the repo table is empty everywhere): ${JSON.stringify(needed)}`);
const externals: Record<string, readonly string[]> = { ...emptyExternals, ...needed };
const policy: Policy = { edges: EDGES, externals };
const real = runAll(SRC, policy);
say(`real tree: ${real.length} violation(s)`);
for (const v of real) say(`  ${fmt(v)}`);

// edges that entry needed: which projects its files import
const entryEdges = new Set<string>();
for (const abs of listSourceFiles(join(SRC, "entry"))) {
  for (const ref of scanSource(readFileSync(abs, "utf8")).imports) {
    if (!ref.specifier.startsWith(".")) continue;
    const target = toPosix(relative(SRC, resolve(dirname(abs), ref.specifier)));
    const p = PROJECTS.filter((x) => (target + "/").startsWith(`${x}/`)).sort((a, b) => b.length - a.length)[0];
    if (p !== undefined && p !== "entry") entryEdges.add(p);
  }
}
say(`edges entry needed: ${[...entryEdges].sort().join(", ")}`);
const testFiles: string[] = [];
const walk = (d: string): void => { for (const e of readdirSync(d, { withFileTypes: true })) { if (e.name === "work") continue; const p = join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(e.name)) testFiles.push(p); } };
walk(FS01);
say(`files under research/fs-01 that bun test would collect: ${testFiles.length}`);

// ---- 2. negative runs in a throwaway copy ----------------------------------------------------------------
interface Neg { name: string; mutate(root: string): void; expect: Rule; note?: string }
const edit = (root: string, rel: string, f: (s: string) => string): void => writeFileSync(join(root, rel), f(readFileSync(join(root, rel), "utf8")));
const negs: Neg[] = [
  { name: "engine imports another engine", expect: "illegal-edge", mutate: (r) => edit(r, "engines/sqlite/index.ts", (s) => `import "../postgres/index.ts";\n${s}`) },
  { name: "engine-name literal in platform", expect: "engine-literal", mutate: (r) => edit(r, "platform/failures.ts", (s) => `${s}\nexport const leaked = "postgres";\n`) },
  { name: "platform imports an engine", expect: "illegal-edge", mutate: (r) => edit(r, "platform/client.ts", (s) => `import "../engines/postgres/index.ts";\n${s}`) },
  { name: "engine imports platform outside contracts", expect: "engine-platform-deep-import", mutate: (r) => edit(r, "engines/postgres/errors.ts", (s) => `import { SimpleCoordinator } from "../../platform/coordinator.ts";\nvoid SimpleCoordinator;\n${s}`) },
  { name: "the roadmap's engine-id union in platform/contracts", expect: "engine-literal", note: "the roadmap sketch `id: 'postgres' | 'mysql' | 'mariadb' | 'sqlite'`", mutate: (r) => edit(r, "platform/contracts/engine.ts", (s) => s.replace("readonly id: string;", "readonly id: 'postgres' | 'mysql' | 'mariadb' | 'sqlite';")) },
];
const copyRoot = `${FS01}/work/negative`;
const negResults: unknown[] = [];
for (const n of negs) {
  rmSync(copyRoot, { recursive: true, force: true });
  mkdirSync(copyRoot, { recursive: true });
  cpSync(SRC, `${copyRoot}/src`, { recursive: true });
  n.mutate(`${copyRoot}/src`);
  const vs = runAll(`${copyRoot}/src`, policy);
  const hits = vs.filter((v) => v.rule === n.expect);
  say(`NEGATIVE ${n.name}${n.note ? ` (${n.note})` : ""}: ${hits.length > 0 ? "FAILS as required" : "NOT CAUGHT"}, rule ${n.expect}`);
  for (const v of vs) say(`    ${formatViolation(v as Violation, "src/")}`);
  negResults.push({ name: n.name, expectedRule: n.expect, caught: hits.length > 0, violations: vs.map((v) => formatViolation(v as Violation, "src/")) });
}
rmSync(copyRoot, { recursive: true, force: true });

const allCaught = negResults.every((r) => (r as { caught: boolean }).caught);
writeFileSync(`${FS01}/results/boundary.json`, JSON.stringify({ edges: EDGES, externalsNeeded: needed, realTreeViolations: real.map(fmt), entryEdges: [...entryEdges].sort(), testFilesCollectable: testFiles, negatives: negResults }, null, 2));
writeFileSync(`${FS01}/results/boundary.txt`, log.join("\n") + "\n");
const ok = real.length === 0 && testFiles.length === 0 && allCaught;
console.log(ok ? "BOUNDARY OK" : "BOUNDARY FAILED");
process.exit(ok ? 0 : 1);
void existsSync;
