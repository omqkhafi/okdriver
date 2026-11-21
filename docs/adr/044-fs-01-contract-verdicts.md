# 044. FS-01 contract verdicts: no contract is adopted yet

## Status
Proposed

## Open question
The admission rule (roadmap section 4, FS-01 row) asks for use by two engine classes without a shim.
WireCore, EmbeddedCore, ServiceCore and ConnectionPool are each defined for one class (ADR 005), so the rule
cannot admit them whatever the evidence. Proposed reading, for the owner to confirm or reject: the two-class
test applies to contracts that cross classes; a class-defining contract is judged on "every engine of that
class implements it, with no shim and no platform branch". Until the owner decides, decision 4 below holds.

## Context
FS-01 built a walking skeleton (connect, one parameterised query, one error, one transaction) on PostgreSQL,
MySQL, MariaDB, SQLite and libSQL over provisional contracts (ADR 031), and judged each contract by the
roadmap rule: adopt only with zero engine branches in platform code, use by two engine classes without a
shim, and no measurable hot-path overhead; otherwise the contract stays engine-owned. ADR 003 freezes the
shared contracts only after this study. ADR 032 left the final shape of the coordinator open for it. FS-07
and FS-08 have reported, so this is the study's ADR.

## Decision
1. **Verdicts.** By the rule as written, every contract is Engine-owned. Nothing is Adopted.
   - Fit structurally (0 branches, two or more classes without a shim): descriptor with capability model,
     ExecutionCoordinator, error taxonomy with ErrorMapper, CodecRegistry, and Session (added by the study).
     Held back only by the overhead leg.
   - Do not fit structurally: WireCore (3 branch hits, wire only), EmbeddedCore (3, embedded only),
     ServiceCore (2, service only), ConnectionPool (wire only), Transport (1 hit, wire only; libSQL needed a shim).
2. **The overhead leg is inconclusive, not failed.** On PostgreSQL the direct rung's own spread was above 15%
   in both scenarios, which the rule treats as inconclusive. The medians were higher at every rung. A contract
   is Adopted only after the ladder is re-run with a direct-rung spread at or below 15%. The re-run is an
   acceptance condition of P2-T04 for the five contracts in decision 1; how to get a quieter direct rung is
   left to that task's brief.
3. **Carried into P2-T04.** Those five contracts start from the final shapes in
   `research/fs-01/src/platform/contracts/` (revisions R1 to R16 in the study README). Per ADR 031 the final
   contracts are written in P2 from the findings, not copied. Nothing under `research/fs-01/` is imported.
4. **Class-defining contracts** (WireCore, EmbeddedCore, ServiceCore, ConnectionPool, Transport) stay owned by
   their engine class. P2-T04 does not present them as shared across classes.
5. **Engine id is a plain `string`** in the platform contracts. The roadmap's union of engine names is dropped:
   it trips the engine-name literal lint four times on one line. No exemption is added to the lint.
6. **ADR 032's open question is answered structurally.** The coordinator is separate from the pool and admits
   work for all three classes; the pool is used by wire engines only; the admitted object is a Session obtained
   from a SessionSource under a lease. Admission of the coordinator to the platform still waits on decision 2.
7. **A capability is claimed only when a named check passed in the same run.** Three of twelve were claimable
   in the skeleton; the other nine stay false until a check exists.
8. **Boundary.** Engines import the platform only through `platform/contracts`. That folder holds runtime code
   as well as types (a byte writer, the raw failure and driver error classes). P2-T04 adds the rule to
   `tests/architecture/` (the study's `engine-platform-deep-import` check is the model).
9. **Composition has no owner in ADR 042.** The skeleton's `entry` folder needed edges to the platform, the
   transports and every engine. This ADR does not decide where composition lives; a new ADR amends or extends
   ADR 042 before P2-T04 adds composition code, with one composition module per engine so bundle isolation holds.
10. **Taxonomy gaps to close in P2-T04:** a phase for admission and queueing, a name for an abort after the
    request was sent (class `cancelled`, outcome `unknown`), and a class for data-conversion errors.
11. **Embedded work is synchronous.** The coordinator cannot interrupt a running embedded call. Timeouts and
    aborts apply only while the caller is queued. FS-08 found no worker threshold that wins on latency.

## Consequences
- P2-T04's gate "zero engine branches in platform code" stays; the three class cores and the pool will carry
  one-engine members (byte helpers used only by PostgreSQL, one-engine embedded and service members) until the
  open question is settled or the shapes change.
- The libSQL transport shim (HTTP dressed as a byte stream) says the Transport contract does not fit a
  stateless service. ServiceCore owns its transport. FS-08 puts Durable Objects SQLite in the service class, a
  second service-shaped integration that FS-01 did not run.
- MySQL and MariaDB shared one family library in both FS-01 (710 lines, forks of 5 and 7 lines) and FS-07
  (82.7% shared); consistent with ADR 004 and the `mysql-family` folder. No change to either.
- Statement classification was written four times in the skeleton; each engine's specification owns it.
- A contract could be Adopted later only by a new ADR after the re-run.

## Evidence
- `research/fs-01/README.md` (PR #14, 28d9b1a): acceptance checks passed 27, 29, 29, 24 and 24 on
  PostgreSQL, MySQL, MariaDB, SQLite and libSQL, with commit and rollback read by independent tools; every
  error mapping matched; coordinator checks 20, 20, 20, 17 and 18, no lease leaked in 320 abort races per
  engine; import-graph check clean with five negative runs failing by named rule.
- Overhead ladder: direct spread wall 15.4% and CPU 20.4% (one caller), wall 20.2% and CPU 22.9% (64 callers
  over 8 connections). Full path over direct: +18.3% wall and +47.4% CPU, then +29.5% and +83.6%. Bun 1.4.4,
  one machine, loopback, one server version per engine; indicative only.
- Branch counts, shims and verdicts are produced by `scripts/verdicts.ts` from recorded data.
- Not validated: authentication beyond trust and empty password, TLS, pooler behaviour, pipelining, cancel on
  the wire, other server versions, Node, D1.
- `research/fs-07/README.md` (PR #15) and `research/fs-08/README.md` (PR #13) for the observations above.

## Basis
FS-01 verdict table; roadmap section 4 admission rule; ADR 003, 005, 031, 032, 042.
