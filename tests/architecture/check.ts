import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { DEFAULT_POLICY, type Policy } from "./edges.ts";
import { scanSource } from "./scan.ts";

export type Rule =
  | "illegal-edge"
  | "relative-escape"
  | "external-import"
  | "unresolvable-import"
  | "unowned-file"
  | "engine-literal"
  | "bundle-isolation";

export interface Violation {
  /** Path relative to the scanned root, with `/` separators. */
  file: string;
  line: number;
  rule: Rule;
  message: string;
}

/** `file:line: rule: message`, with an optional prefix such as `src/` on the file. */
export function formatViolation(v: Violation, prefix = ""): string {
  return `${prefix}${v.file}:${v.line}: ${v.rule}: ${v.message}`;
}

const SOURCE_FILE = /\.(?:ts|mts|cts)$/;

export const toPosix = (p: string): string => p.split(sep).join("/");

/** Every `.ts`, `.mts` and `.cts` file under `dir`, absolute and sorted. */
export function listSourceFiles(dir: string): string[] {
  const found: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules") walk(join(current, entry.name));
      } else if (entry.isFile() && SOURCE_FILE.test(entry.name)) {
        found.push(join(current, entry.name));
      }
    }
  };
  walk(dir);
  return found.sort();
}

/** The project that owns a path relative to the root: the longest project folder prefix. */
export function ownerOf(relPath: string, policy: Policy): string | undefined {
  let best: string | undefined;
  for (const project of Object.keys(policy.edges)) {
    if (relPath.startsWith(`${project}/`) && (best === undefined || project.length > best.length)) {
      best = project;
    }
  }
  return best;
}

const isRelative = (spec: string): boolean =>
  spec === "." || spec === ".." || spec.startsWith("./") || spec.startsWith("../");

/**
 * Import graph rules over every source file under `root`, laid out like `src/`.
 * Edges are project to project; a project may import itself.
 */
export function checkImportGraph(root: string, policy: Policy = DEFAULT_POLICY): Violation[] {
  const violations: Violation[] = [];
  for (const abs of listSourceFiles(root)) {
    const file = toPosix(relative(root, abs));
    const project = ownerOf(file, policy);
    if (project === undefined) {
      violations.push({ file, line: 1, rule: "unowned-file", message: "file is not inside any project folder" });
      continue;
    }
    const allowedEdges = policy.edges[project] ?? [];
    const allowedExternal = policy.externals[project] ?? [];
    const scan = scanSource(readFileSync(abs, "utf8"));

    for (const u of scan.unresolvable) {
      violations.push({
        file,
        line: u.line,
        rule: "unresolvable-import",
        message: `${u.kind === "dynamic" ? "import()" : "require()"} argument is not a string literal, so the edge cannot be checked`,
      });
    }
    for (const ref of scan.imports) {
      if (!isRelative(ref.specifier)) {
        if (!allowedExternal.includes(ref.specifier)) {
          violations.push({
            file,
            line: ref.line,
            rule: "external-import",
            message: `"${ref.specifier}" is not in the external allowlist of ${project}`,
          });
        }
        continue;
      }
      const target = relative(root, resolve(dirname(abs), ref.specifier));
      if (target === ".." || target.startsWith(`..${sep}`) || isAbsolute(target)) {
        violations.push({
          file,
          line: ref.line,
          rule: "relative-escape",
          message: `"${ref.specifier}" leaves the source root`,
        });
        continue;
      }
      const targetProject = ownerOf(`${toPosix(target)}/`, policy);
      if (targetProject === undefined) {
        violations.push({
          file,
          line: ref.line,
          rule: "illegal-edge",
          message: `"${ref.specifier}" points at ${toPosix(target)}, which is not inside any project folder`,
        });
      } else if (targetProject !== project && !allowedEdges.includes(targetProject)) {
        violations.push({
          file,
          line: ref.line,
          rule: "illegal-edge",
          message: `${project} may not import ${targetProject} ("${ref.specifier}"); allowed: ${allowedEdges.join(", ") || "none"}`,
        });
      }
    }
  }
  return violations;
}

const ENGINE_WORD = /\b(postgres|postgresql|mysql|mariadb|sqlite)\b/i;

/**
 * Engine names inside string or template literals in `<root>/platform`. Comments and
 * module specifiers are not checked.
 */
export function checkEngineLiterals(root: string): Violation[] {
  const dir = join(root, "platform");
  if (!existsSync(dir)) return [];
  const violations: Violation[] = [];
  for (const abs of listSourceFiles(dir)) {
    const file = toPosix(relative(root, abs));
    for (const lit of scanSource(readFileSync(abs, "utf8")).literals) {
      const hit = ENGINE_WORD.exec(lit.value);
      if (hit !== null) {
        violations.push({
          file,
          line: lit.line,
          rule: "engine-literal",
          message: `string literal contains the engine name "${hit[0]}"`,
        });
      }
    }
  }
  return violations;
}
