# 047. Composition lives in one `src/entry/<name>` project per public entry

## Status
Accepted

Decided on 2026-11-22 under the owner's delegation, from FS-01 finding F1. It extends ADR 042 and does not replace it.

## Context
ADR 042 has no owner for the code that joins an engine, a transport and the platform machinery (coordinator, pool,
session drivers, client). Engines may import the platform only through `platform/contracts` (ADR 044), so an engine
cannot compose itself. In FS-01 an `entry` folder needed edges to `platform`, `transports` and all five engine folders;
one module importing every engine pulled `bun:sqlite` and every engine into any bundle, which breaks the per-engine
bundle-isolation rule.

## Decision
1. Composition lives in `src/entry/<name>`, one composite TypeScript project per public entry: `postgres`, `mysql`,
   `mariadb` and `sqlite` first; the other engine and service integrations follow the same pattern.
2. A public subpath (`okdriver/postgres`) maps to its `src/entry/<name>/index.ts`.
3. Allowed references: `entry/postgres` to `platform`, `transports` and `engines/postgres`; `entry/mysql` to `platform`,
   `transports` and `engines/mysql`; `entry/mariadb` to `platform`, `transports` and `engines/mariadb`; `entry/sqlite` to
   `platform` and `engines/sqlite`. An entry imports no other entry. Engines, `platform` and `transports` never import an
   entry.
4. A new entry whose references follow that pattern (platform, the transports it needs, its own engine folders) needs the
   edge-table change in its PR and no new ADR. Any other edge needs an ADR (ADR 042).
5. The bundle-isolation test covers `src/entry/*/index.ts` as it covers `src/engines/*/index.ts`: an entry bundle may hold
   only `platform`, its listed transports and its own engine folders.
6. The engine-literal lint stays on `src/platform` only. Entries may name their engine.
7. Whether `okdriver` itself has a root export, and what it holds, is left to P2. It must not import any entry.

## Consequences
- `tests/architecture/edges.ts`, the external allowlist, the root `tsconfig.json` solution file and AGENTS.md's Layout
  paragraph change in the PR that creates the folders, which belongs to P2-T04 or its follow-up. This ADR creates none.
- `src/index.ts` still has no owner in the edge table (`unowned-file`); decision 7 keeps it that way until P2 settles it.
- Per-engine bundles stay free of other engines, and a SQLite entry's runtime binding choice (ADR 046) stays inside
  `engines/sqlite`.
- FS-01's `entry/compose.ts` held one `switch` on the engine class choosing the session driver. Per-entry projects make
  that choice a per-entry import instead of a branch.

## Evidence
- FS-01 README findings F1 and F4, and the import-graph and bundle-isolation checks in `research/fs-01/scripts/boundary.check.ts`.
  Those checks ran on one `entry` folder with edges to `platform`, `transports` and all five engine folders and found 0
  violations on the real tree; the per-entry split is derived from that finding.
- Not run: the per-entry layout itself. No folder is created by this ADR.

## Basis
FS-01 finding F1; ADR 042, 044 and 046.
