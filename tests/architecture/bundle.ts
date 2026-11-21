import { existsSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { ownerOf, toPosix, type Violation } from "./check.ts";
import { DEFAULT_POLICY, type Policy } from "./edges.ts";
import { scanSource } from "./scan.ts";

interface BundleImport {
  /** Absolute path of the resolved file. */
  path: string;
  /** The specifier as written in the importer. */
  original: string | undefined;
}

/** Every source file Bun put in the bundle of `entry`, keyed by absolute path. */
async function bundleGraph(entry: string): Promise<Map<string, BundleImport[]>> {
  const result = await Bun.build({
    entrypoints: [entry],
    target: "node",
    format: "esm",
    splitting: false,
    metafile: true,
    throw: false,
  });
  if (!result.success || result.metafile === undefined) {
    throw new Error(`Bun.build failed for ${entry}:\n${result.logs.map(String).join("\n")}`);
  }
  // Metafile paths are relative to the current working directory.
  const graph = new Map<string, BundleImport[]>();
  for (const [path, input] of Object.entries(result.metafile.inputs)) {
    const imports: BundleImport[] = [];
    for (const imp of input.imports) {
      if (imp.external === true) continue;
      imports.push({ path: resolve(process.cwd(), imp.path), original: imp.original });
    }
    graph.set(resolve(process.cwd(), path), imports);
  }
  return graph;
}

export interface BundleReport {
  /** Source files per engine bundle, relative to the root. */
  bundled: Record<string, string[]>;
  violations: Violation[];
}

/**
 * Bundles `<root>/<engine>/index.ts` for every `engines/*` project in the policy and checks
 * that the bundle holds only the engine's own folder and the folders its edges allow.
 * Engines without an `index.ts` under `root` are skipped.
 */
export async function checkBundles(root: string, policy: Policy = DEFAULT_POLICY): Promise<BundleReport> {
  const bundled: Record<string, string[]> = {};
  const violations: Violation[] = [];
  const engines = Object.keys(policy.edges).filter((p) => p.startsWith("engines/")).sort();

  for (const engine of engines) {
    const entry = join(root, engine, "index.ts");
    if (!existsSync(entry)) continue;
    const graph = await bundleGraph(entry);
    const rel = (abs: string): string => toPosix(relative(root, abs));
    bundled[engine] = [...graph.keys()].map(rel).sort();

    const allowed = new Set<string | undefined>([engine, ...(policy.edges[engine] ?? [])]);
    const isAllowed = (abs: string): boolean => allowed.has(ownerOf(rel(abs), policy));

    for (const file of graph.keys()) {
      if (isAllowed(file)) continue;
      // Report where the bundle pulled the file in: an importing file that is itself allowed.
      let importer: string | undefined;
      let specifier: string | undefined;
      for (const [from, imports] of graph) {
        const hit = imports.find((i) => i.path === file);
        if (hit === undefined) continue;
        importer = from;
        specifier = hit.original;
        if (isAllowed(from)) break;
      }
      const at = importer ?? file;
      let line = 1;
      if (importer !== undefined && specifier !== undefined) {
        const ref = scanSource(readFileSync(importer, "utf8")).imports.find((i) => i.specifier === specifier);
        if (ref !== undefined) line = ref.line;
      }
      violations.push({
        file: rel(at),
        line,
        rule: "bundle-isolation",
        message: `bundle of ${engine} includes ${rel(file)}, which ${engine} may not hold (allowed: ${[...allowed].join(", ")})`,
      });
    }
  }
  return { bundled, violations };
}
