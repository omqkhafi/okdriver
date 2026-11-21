import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkEngineLiterals } from "./check.ts";

const root = mkdtempSync(join(tmpdir(), "okdriver-literals-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

function lint(files: Record<string, string>): string[] {
  rmSync(join(root, "platform"), { recursive: true, force: true });
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(join(root, "platform", name, ".."), { recursive: true });
    writeFileSync(join(root, "platform", name), text);
  }
  return checkEngineLiterals(root).map((v) => `${v.file}:${v.line}`);
}

describe("engine literal lint", () => {
  test("flags each engine name as a whole word, any case, in strings and templates", () => {
    for (const name of ["postgres", "postgresql", "mysql", "mariadb", "sqlite", "PostgreSQL", "MySQL"]) {
      expect(lint({ "a.ts": `export const x = "${name}";` })).toEqual(["platform/a.ts:1"]);
      expect(lint({ "a.ts": `export const x = '${name}';` })).toEqual(["platform/a.ts:1"]);
      expect(lint({ "a.ts": `export const x = \`${name}\`;` })).toEqual(["platform/a.ts:1"]);
    }
    expect(lint({ "a.ts": 'export const x = "engine is mysql, really";' })).toEqual(["platform/a.ts:1"]);
    expect(lint({ "a.ts": "export const x = (y: string) => `${y}-postgres-${y}`;" })).toEqual(["platform/a.ts:1"]);
  });

  test("does not flag comments, identifiers, partial words or module specifiers", () => {
    expect(
      lint({
        "a.ts": [
          "// postgres mysql",
          "/* mariadb sqlite */",
          "export const postgres = 1;",
          'export const a = "mysql2";',
          'export const b = "sqlite3";',
          'export const c = "not_mysql";',
          'export const d = "postgresish";',
        ].join("\n"),
      }),
    ).toEqual([]);
  });

  test("looks at subfolders of platform, and only platform", () => {
    expect(lint({ "deep/er/a.ts": 'export const x = "sqlite";' })).toEqual(["platform/deep/er/a.ts:1"]);
    mkdirSync(join(root, "engines", "postgres"), { recursive: true });
    writeFileSync(join(root, "engines", "postgres", "index.ts"), 'export const name = "postgres";');
    expect(lint({ "a.ts": "export {};" })).toEqual([]);
  });
});
