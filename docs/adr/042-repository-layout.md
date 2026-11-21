# 042. Repository layout: plain folders under `src/` with TypeScript project references

## Status
Accepted

## Context
OKDriver ships as one published package, `okdriver` (ADR 030). The roadmap's P0-T01
described a "Bun workspaces monorepo" with internal packages under `packages/`. That
wording does not fit a single published package: internal workspace packages would each
need a name, a version and an entry point that never reach npm, and they would invite a
`workspaces` field and per-package manifests for no consumer.

We still need hard module boundaries (roadmap section 4): the platform layer depends on
nothing, engines never depend on each other, and the MySQL and MariaDB engines share a
`mysql-family` layer.

## Decision
- Source lives in plain folders under `src/`. The roadmap section 5 tree is kept, with
  `packages/` becoming `src/`.
- Each folder is one composite TypeScript project (its own `tsconfig.json`), wired to the
  others with project references. There are no internal workspace packages and no
  `workspaces` field in `package.json`.
- Folders: `platform`, `transports`, `engines/postgres`, `engines/mysql-family`,
  `engines/mysql`, `engines/mariadb`, `engines/sqlite`, `verify`, `compile`, `adapters`.
- References encode the section 4 boundary rules and nothing else:
  - `platform` references nothing.
  - `transports`, `engines/postgres`, `engines/mysql-family`, `engines/sqlite`, `verify`,
    `compile` and `adapters` reference `platform`.
  - `engines/mysql` and `engines/mariadb` reference `engines/mysql-family` and `platform`.
  - Engines never reference each other.
- The root `tsconfig.json` is a solution file (`files: []` plus references). Shared
  compiler options live in `tsconfig.base.json`, which every folder extends.
- Project references require `composite`, which emits. Projects use
  `emitDeclarationOnly` into `.build/`, which is gitignored and outside `package.json`
  `files`, so nothing from it is published.
- `typecheck` runs `tsc -b` over the solution.
- Where benchmark competitor dependencies live is not decided here; phase P4 decides.

## Consequences
- Boundaries are enforced by the compiler: a file may only import from its own project or
  a referenced one. Importing against the rules fails `tsc -b`.
- Project references isolate type-level imports only. Dependency isolation (for example,
  that an engine's runtime import graph does not reach another engine, or that `platform`
  pulls in no third-party module) is not provided by this layout and moves to the import
  graph test in P0-T05.
- A new folder needs its own `tsconfig.json` and an entry in the root solution file.
- `tsc -b` writes declaration files and `.tsbuildinfo` to `.build/`; it is a cache and can
  be deleted at any time.
- The published package contains no `src/` yet. Build and `exports` decisions are left to
  later tasks.

## Evidence
- `tsc -b` passes on the layout with TypeScript 7.0.2.
- Negative checks, each reverted afterwards (a failed build can leave stray `.d.ts` files next to the sources, so check `git status` after a negative check): a file in `platform` importing
  `engines/postgres`, and a file in `engines/mysql` importing `engines/mariadb`, both fail
  `tsc -b` (TS6059/TS6307, the target is outside the project and not referenced).
- `bun pm pack --dry-run` lists only `README.md`, `LICENSE`, `NOTICE` and `package.json`.
