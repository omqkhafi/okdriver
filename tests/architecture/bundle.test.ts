import { describe, expect, test } from "bun:test";
import { join, resolve } from "node:path";
import { checkBundles } from "./bundle.ts";
import { formatViolation } from "./check.ts";

const SRC = resolve(import.meta.dir, "../../src");
const fixture = (name: string): string => join(import.meta.dir, "fixtures", name);

describe("bundle isolation", () => {
  test("real tree: every engine bundle holds only allowed folders", async () => {
    const report = await checkBundles(SRC);
    expect(report.violations.map((v) => formatViolation(v, "src/"))).toEqual([]);
    // The check must have bundled every engine, not skipped them.
    expect(Object.keys(report.bundled)).toEqual([
      "engines/mariadb",
      "engines/mysql",
      "engines/mysql-family",
      "engines/postgres",
      "engines/sqlite",
    ]);
    for (const [engine, files] of Object.entries(report.bundled)) {
      expect(files).toContain(`${engine}/index.ts`);
    }
  });

  test("valid fixture: bundles hold exactly their own folder, mysql-family and platform", async () => {
    const report = await checkBundles(fixture("valid"));
    expect(report.violations).toEqual([]);
    expect(report.bundled).toEqual({
      "engines/mariadb": ["engines/mariadb/index.ts", "engines/mysql-family/index.ts", "platform/index.ts"],
      "engines/mysql": ["engines/mysql-family/index.ts", "engines/mysql/index.ts", "platform/index.ts"],
      "engines/mysql-family": ["engines/mysql-family/index.ts", "platform/index.ts"],
      "engines/postgres": ["engines/postgres/index.ts", "platform/index.ts"],
      "engines/sqlite": ["engines/sqlite/index.ts", "platform/index.ts"],
    });
  });

  test("bundle-other-engine: postgres bundle pulling in mysql-family fails", async () => {
    const report = await checkBundles(fixture("bundle-other-engine"));
    expect(report.violations).toHaveLength(1);
    expect(report.violations[0]).toMatchObject({
      file: "engines/postgres/index.ts",
      line: 1,
      rule: "bundle-isolation",
    });
    expect(report.violations[0]!.message).toContain("engines/mysql-family/helper.ts");
    expect(report.bundled["engines/postgres"]).toEqual([
      "engines/mysql-family/helper.ts",
      "engines/postgres/index.ts",
    ]);
  });

  test("engine-to-engine: postgres bundle pulling in sqlite fails", async () => {
    const report = await checkBundles(fixture("engine-to-engine"));
    expect(report.violations).toHaveLength(1);
    expect(report.violations[0]).toMatchObject({ file: "engines/postgres/index.ts", rule: "bundle-isolation" });
  });

  test("mysql and mariadb bundles may not hold each other", async () => {
    for (const [name, importer] of [
      ["mysql-to-mariadb", "engines/mysql/index.ts"],
      ["mariadb-to-mysql", "engines/mariadb/index.ts"],
    ] as const) {
      const report = await checkBundles(fixture(name));
      expect(report.violations).toHaveLength(1);
      expect(report.violations[0]).toMatchObject({ file: importer, line: 1, rule: "bundle-isolation" });
    }
  });
});
