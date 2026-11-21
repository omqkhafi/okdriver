# 029. Minimum Node.js version

## Status
Accepted

Roadmap status: Open. Decided by P0-T10 on 2026-11-21.

## Context
Node.js stays a supported target runtime (AGENTS.md). The roadmap rule is that Node.js is
supported on every release line that is still maintained upstream. The earlier plan listed
Node 20, and its end-of-life status was to be checked in P0. Node 20 reached end of life on
2026-04-30, so it is no longer maintained upstream.

## Decision
- The minimum supported Node.js version is 22. The supported lines are 22, 24 and 26.
- Node 20 and odd-numbered lines are not supported.
- Each line is tested on the newest release of that line (`setup-node` by major).
- `package.json` declares `"engines": { "node": ">=22" }`.
- The matrix changes only by a new ADR: a line is dropped when it reaches upstream end of life,
  and a new even-numbered line is added when it enters LTS.

## Consequences
- The `engines` field changes the packed tarball bytes. The sha256 of the 0.0.0 pack recorded in
  ADR 043 no longer applies to the new bytes. ADR 043 itself stays untouched.
- `engines` is a lower bound only. It does not stop installs on unsupported lines such as
  Node 23 or 25. Real support is exactly the tested lines 22, 24 and 26.
- The CI matrix and its check names are unchanged by this decision. Any later matrix change
  (dropping 22 on 2027-04-30, adding v27) changes the check names, so the required checks of the
  repository ruleset must be changed in the same step.
- The next matrix change is Node 22 reaching end of life on 2027-04-30.

## Evidence
- Upstream schedule (nodejs/Release `schedule.json`, read on 2026-11-21):
  - v20: end 2026-04-30 (already ended).
  - v22: maintenance since 2025-10-21, end 2027-04-30.
  - v24: maintenance since 2026-10-20, end 2028-04-30.
  - v26: LTS since 2026-10-28, end 2029-04-30.
  - v25: end 2026-06-01. v27: starts 2027-04-22, LTS 2027-10-20.
- On the same day the npm registry showed `engines.node` `>=22.0.0` for kysely and `>=22` for
  better-sqlite3.

## Basis
Check upstream support status in P0
