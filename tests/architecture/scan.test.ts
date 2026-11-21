import { describe, expect, test } from "bun:test";
import { scanSource } from "./scan.ts";

const specs = (src: string) => scanSource(src).imports.map((i) => [i.specifier, i.kind, i.line]);

describe("scanner: module specifiers", () => {
  test("reads every import and export form, type-only included", () => {
    const src = [
      'import a from "./a.ts";',
      'import type { B } from "./b.ts";',
      'import * as c from "./c.ts";',
      'import "./d.ts";',
      'export { e } from "./e.ts";',
      'export type { F } from "./f.ts";',
      'export * from "./g.ts";',
      'export * as h from "./h.ts";',
      'import i = require("./i.ts");',
      'const j = await import("./j.ts");',
      'type K = typeof import("./k.ts");',
      'const l = require("./l.ts");',
      "const m = await import(`./m.ts`);",
      'const n = await import("./n.ts", { with: { type: "json" } });',
    ].join("\n");
    expect(specs(src)).toEqual([
      ["./a.ts", "static", 1],
      ["./b.ts", "static", 2],
      ["./c.ts", "static", 3],
      ["./d.ts", "static", 4],
      ["./e.ts", "static", 5],
      ["./f.ts", "static", 6],
      ["./g.ts", "static", 7],
      ["./h.ts", "static", 8],
      ["./i.ts", "require", 9],
      ["./j.ts", "dynamic", 10],
      ["./k.ts", "dynamic", 11],
      ["./l.ts", "require", 12],
      ["./m.ts", "dynamic", 13],
      ["./n.ts", "dynamic", 14],
    ]);
  });

  test("multi-line imports report the line of the specifier", () => {
    expect(specs('import {\n  a,\n  b,\n} from "./x.ts";')).toEqual([["./x.ts", "static", 4]]);
  });

  test("ignores specifiers in comments, strings and object keys", () => {
    const src = [
      '// import "./a.ts";',
      '/* import b from "./b.ts"; */',
      'const s = \'import c from "./c.ts"\';',
      "const t = `import d from \"./d.ts\"`;",
      'const o = { from: "./e.ts" };',
      "const p = foo.import('./f.ts');",
      "const q = foo.require('./g.ts');",
      "const meta = import.meta.url;",
    ].join("\n");
    expect(scanSource(src).imports).toEqual([]);
    expect(scanSource(src).unresolvable).toEqual([]);
  });

  test("reports computed import() and require() arguments as unresolvable", () => {
    const src = ["await import(name);", "await import(`./${name}.ts`);", 'require("./" + name);'].join("\n");
    expect(scanSource(src).unresolvable).toEqual([
      { line: 1, kind: "dynamic" },
      { line: 2, kind: "dynamic" },
      { line: 3, kind: "require" },
    ]);
    expect(scanSource(src).imports).toEqual([]);
  });

  test("keeps scanning after regex literals, templates with substitutions and nested braces", () => {
    const src = [
      "const re = /\"[/]/g.test(x);",
      "const half = a / b / c;",
      "const t = `a${ { k: `x${1}` }.k }b`;",
      'import "./after.ts";',
    ].join("\n");
    expect(specs(src)).toEqual([["./after.ts", "static", 4]]);
  });
});

describe("scanner: string literals", () => {
  test("collects strings and template text, skips comments and module specifiers", () => {
    const src = [
      '// "comment"',
      'import "./spec.ts";',
      'const a = "one";',
      "const b = 'two';",
      "const c = `three ${a} four`;",
      "/* \"block\" */",
    ].join("\n");
    expect(scanSource(src).literals).toEqual([
      { value: "one", line: 3 },
      { value: "two", line: 4 },
      { value: "three ", line: 5 },
      { value: " four", line: 5 },
    ]);
  });

  test("tracks lines through multi-line templates and block comments", () => {
    const src = "/*\n\n*/\nconst a = `x\ny`;\nconst b = 'z';";
    expect(scanSource(src).literals).toEqual([
      { value: "x\ny", line: 4 },
      { value: "z", line: 6 },
    ]);
  });
});
