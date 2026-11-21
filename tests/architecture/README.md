# Architecture boundary tests

Run by `bun test`. They enforce the roadmap section 4 boundary rules over `src/` (ADR 042).
Nothing here is part of `src/` or of any tsconfig project. Every checker takes a root
directory laid out like `src/`, so `fixtures/<name>/` can be scanned as if it were `src/`.

| File | Enforces |
| --- | --- |
| `edges.ts` | The allowed-edge table, copied from ADR 042, and the external-import allowlist (empty everywhere). |
| `edges.test.ts` | Every `src/**/tsconfig.json` has `references` equal to the table, and every table entry has a project. |
| `graph.test.ts` | Import graph: relative imports stay in the same project or an allowed one; a relative import that leaves `src/` (for example into `research/fs-01/`) fails; non-relative specifiers, `node:` and `bun:` included, must be in the project's allowlist; a computed `import()` or `require()` fails because it cannot be checked; a file outside every project folder fails. Type-only imports count. |
| `literals.test.ts` | No string or template literal in `src/platform` contains `postgres`, `postgresql`, `mysql`, `mariadb` or `sqlite` as a whole word, case-insensitive. Comments and module specifiers are not checked. |
| `bundle.test.ts` | Bundling each `src/engines/*/index.ts` with Bun puts only that engine's folder and the folders the table allows into the bundle. Inputs are read from the `Bun.build` metafile. |
| `scan.test.ts` | The scanner itself: import forms, comments, regex literals, templates. |

`fixtures/` holds one negative case per violation, plus `valid/`. No fixture is named
`*.test.ts`. The real-tree check in `graph.test.ts` copies `src/` to a temp directory, adds an
illegal import to the copy and expects the checker to fail on it.

Failures print `file:line: rule: message`. Rules: `illegal-edge`, `relative-escape`,
`external-import`, `unresolvable-import`, `unowned-file`, `engine-literal`, `bundle-isolation`.

The scanner is a small tokenizer, not a parser (ADR 026 keeps the TypeScript compiler API out
of the toolchain). It does not follow triple-slash `reference` directives or decode string
escapes, so `"postgres"` passes the literal lint. The lint is a guard, not a proof.

## Deferred rules

These roadmap rules cannot be enforced yet because their folders do not exist:

- Engines import the platform only through `platform/contracts`.
- Adapters import only the public API.

## Known conflict for P2

The roadmap's engine-id union in a platform contract (`'postgres' | 'mysql' | ...`) is a set of
string literals in `src/platform`, so it trips the literal lint. P2 needs an exemption, decided
by ADR, or another shape for the engine id.
