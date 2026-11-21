import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { toPosix } from "./check.ts";
import { ALLOWED_EDGES, EXTERNAL_ALLOWLIST } from "./edges.ts";

const SRC = resolve(import.meta.dir, "../../src");

function tsconfigDirs(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) found.push(...tsconfigDirs(join(dir, entry.name)));
    else if (entry.isFile() && entry.name === "tsconfig.json") found.push(dir);
  }
  return found;
}

describe("edge table", () => {
  const dirs = tsconfigDirs(SRC).sort();

  test("every src project has a table entry, and every entry has a project", () => {
    expect(dirs.map((d) => toPosix(relative(SRC, d)))).toEqual(Object.keys(ALLOWED_EDGES).sort());
  });

  for (const dir of dirs) {
    const project = toPosix(relative(SRC, dir));
    test(`${project}: tsconfig references equal the table`, () => {
      // The per-folder tsconfig files are plain JSON, with no comments.
      const config = JSON.parse(readFileSync(join(dir, "tsconfig.json"), "utf8")) as {
        references?: { path: string }[];
      };
      const referenced = (config.references ?? []).map((ref) => {
        const target = resolve(dir, ref.path);
        return toPosix(relative(SRC, ref.path.endsWith(".json") ? dirname(target) : target));
      });
      const allowed = (ALLOWED_EDGES as Record<string, readonly string[]>)[project];
      expect(referenced.sort()).toEqual([...(allowed ?? [])].sort());
    });
  }

  test("the external allowlist covers exactly the same projects, and is empty", () => {
    expect(Object.keys(EXTERNAL_ALLOWLIST).sort()).toEqual(Object.keys(ALLOWED_EDGES).sort());
    for (const list of Object.values(EXTERNAL_ALLOWLIST)) expect(list).toEqual([]);
  });
});
