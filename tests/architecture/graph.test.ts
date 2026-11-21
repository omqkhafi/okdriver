import { afterAll, describe, expect, test } from "bun:test";
import { appendFileSync, cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { checkEngineLiterals, checkImportGraph, formatViolation, type Rule, type Violation } from "./check.ts";
import { DEFAULT_POLICY } from "./edges.ts";

const SRC = resolve(import.meta.dir, "../../src");
const fixture = (name: string): string => join(import.meta.dir, "fixtures", name);

const format = (violations: Violation[], prefix = ""): string[] =>
  violations.map((v) => formatViolation(v, prefix));

describe("real tree", () => {
  test("src passes the import graph rules", () => {
    expect(format(checkImportGraph(SRC), "src/")).toEqual([]);
  });

  test("src passes the engine literal lint", () => {
    expect(format(checkEngineLiterals(SRC), "src/")).toEqual([]);
  });

  describe("copy of src with one illegal import added", () => {
    const copy = mkdtempSync(join(tmpdir(), "okdriver-boundary-"));
    afterAll(() => rmSync(copy, { recursive: true, force: true }));

    test("the checker fails on it", () => {
      cpSync(SRC, copy, { recursive: true });
      expect(checkImportGraph(copy)).toEqual([]);
      appendFileSync(join(copy, "platform", "index.ts"), 'import "../engines/postgres/index.ts";\n');
      const violations = checkImportGraph(copy);
      expect(violations).toHaveLength(1);
      expect(violations[0]).toMatchObject({ file: "platform/index.ts", line: 2, rule: "illegal-edge" });
    });
  });
});

describe("negative fixtures", () => {
  const graphCases: { name: string; file: string; line: number; rule: Rule; mentions: string }[] = [
    { name: "engine-to-engine", file: "engines/postgres/index.ts", line: 1, rule: "illegal-edge", mentions: "engines/sqlite" },
    { name: "platform-to-engine", file: "platform/index.ts", line: 1, rule: "illegal-edge", mentions: "engines/postgres" },
    { name: "mysql-to-mariadb", file: "engines/mysql/index.ts", line: 1, rule: "illegal-edge", mentions: "engines/mariadb" },
    { name: "mariadb-to-mysql", file: "engines/mariadb/index.ts", line: 1, rule: "illegal-edge", mentions: "engines/mysql" },
    { name: "external-import", file: "platform/index.ts", line: 1, rule: "external-import", mentions: "node:fs" },
    { name: "relative-escape", file: "platform/index.ts", line: 1, rule: "relative-escape", mentions: "research/fs-01" },
    { name: "bundle-other-engine", file: "engines/postgres/index.ts", line: 1, rule: "illegal-edge", mentions: "engines/mysql-family" },
  ];

  for (const c of graphCases) {
    test(`${c.name}: one ${c.rule} at ${c.file}:${c.line}`, () => {
      const violations = checkImportGraph(fixture(c.name));
      expect(violations).toHaveLength(1);
      expect(violations[0]).toMatchObject({ file: c.file, line: c.line, rule: c.rule });
      expect(violations[0]!.message).toContain(c.mentions);
      expect(formatViolation(violations[0]!)).toStartWith(`${c.file}:${c.line}: ${c.rule}: `);
      // The graph checker leaves engine literals to the literal lint.
      expect(checkEngineLiterals(fixture(c.name))).toEqual([]);
    });
  }

  test("engine-literal: one engine-literal at platform/index.ts:2", () => {
    const violations = checkEngineLiterals(fixture("engine-literal"));
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ file: "platform/index.ts", line: 2, rule: "engine-literal" });
    expect(violations[0]!.message).toContain("postgres");
    expect(checkImportGraph(fixture("engine-literal"))).toEqual([]);
  });
});

describe("policy", () => {
  test("an allowlisted external specifier passes", () => {
    const policy = { ...DEFAULT_POLICY, externals: { ...DEFAULT_POLICY.externals, platform: ["node:fs"] } };
    expect(checkImportGraph(fixture("external-import"), policy)).toEqual([]);
  });

  test("the valid fixture passes every source-level check", () => {
    expect(checkImportGraph(fixture("valid"))).toEqual([]);
    expect(checkEngineLiterals(fixture("valid"))).toEqual([]);
  });
});

describe("fail-closed rules", () => {
  const root = mkdtempSync(join(tmpdir(), "okdriver-closed-"));
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  const write = (rel: string, text: string): void => {
    mkdirSync(join(root, rel, ".."), { recursive: true });
    writeFileSync(join(root, rel), text);
  };

  test("a computed import() is reported, not skipped", () => {
    write("platform/index.ts", "export const load = (n: string) => import(n);\n");
    const violations = checkImportGraph(root);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ file: "platform/index.ts", line: 1, rule: "unresolvable-import" });
  });

  test("a file outside every project folder is reported", () => {
    rmSync(join(root, "platform"), { recursive: true, force: true });
    write("stray.ts", "export {};\n");
    write("engines/loose.ts", "export {};\n");
    expect(checkImportGraph(root).map((v) => `${v.file}:${v.rule}`)).toEqual([
      "engines/loose.ts:unowned-file",
      "stray.ts:unowned-file",
    ]);
  });
});
