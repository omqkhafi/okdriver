# FS-01: do the shared contracts fit all four engines?

Research only. This folder contains provisional contracts, a five-target walking skeleton, check scripts,
small result files and this report. It changes no OKDriver source, test, workflow, root tooling or ADR, and
makes no claim about OKDriver beyond the evidence below and no public comparison. Spec area: none yet.
Feature record: none (research). ADR 031 and 032 are the basis; this study's ADR follows after FS-07 and
FS-08 report.

Base: branch `chore/fs-01-four-engine-skeleton` from `origin/main` at `dc921f6f5a5648a8e16db3852603d7d377173fb2`.

## Question

Roadmap row FS-01: build a walking skeleton (connect, one parameterised query, one error, one transaction)
on PostgreSQL, MySQL, MariaDB, local SQLite and one service integration, over provisional contracts kept
under `research/fs-01/`; count the engine-specific branches the platform needs and the hot-path overhead of
the contracts on PostgreSQL against a direct implementation. Adopt a contract only if it needs zero engine
branches and adds no measurable overhead; otherwise it becomes engine-owned. The decision rule also needs
the contract to be used by at least two engine classes without a shim (roadmap section 4, constitution
principle 4).

## Result in short

- All five skeletons ran against real servers. The acceptance check passed 27, 29, 29, 24 and 24 named
  checks (PostgreSQL, MySQL, MariaDB, SQLite, libSQL). Commit and rollback visibility was read by tools
  that are not the skeleton. Every error mapping matched the expected one: class `constraint`, vendor code
  untouched, outcome `rejected-no-effects`, transaction state `failed-open` on PostgreSQL and `open` on the
  other four. There were **no differences** from the expected mapping.
- The coordinator checks passed on all five (20, 20, 20, 17, 18 checks): limit 2 with 8 callers never
  exceeded 2 as read from the server's process list (wire) or a core counter (SQLite, libSQL); an abort
  while queued gives class `cancelled` and outcome `not-sent`; an abort racing admission leaked no lease
  over 320 races per engine; a slow first connect did not wedge the queue.
- The import-graph check found no violation; each of the four required negative runs, and a fifth for the roadmap's engine-id union, fails with the named rule.
- Platform code has no engine-name literal, no branch on descriptor `id` or `class` and no SQL keyword
  literal. The count of 9 comes from contract members that only one engine uses (rule 4 below).
- **No contract reaches Adopt.** Four fit structurally (zero branches, two classes without a shim):
  descriptor with capability model, ExecutionCoordinator, error taxonomy with ErrorMapper, CodecRegistry.
  They are held back only by the overhead criterion: the direct PostgreSQL rung's own spread is above 15%
  in both scenarios, so the ladder is "inconclusive" there and the rule does not allow Adopt from it. The
  other five fail the structural criterion: WireCore, EmbeddedCore, ServiceCore, ConnectionPool and
  Transport are each used by one engine class without a shim. For the three cores and the pool that is by
  construction (the roadmap defines them per class), which the rule as written cannot satisfy; see
  "Observation for the ADR".

## Verdict table

| Contract | Verdict | Platform branch hits | Engines using | Classes using without a shim | Structural fit | Overhead on its rung | Why not Adopt |
|---|---|---|---|---|---|---|---|
| Engine descriptor + capability model | **Engine-owned** | 0 | postgres, mysql, mariadb, sqlite, libsql | wire, embedded (2) | fits | 5-full: inconclusive (direct spread above 15%) | shim in class service; overhead: 5-full: inconclusive (direct spread above 15%) |
| WireCore | **Engine-owned** | 3 | postgres, mysql, mariadb | wire (1) | does not fit | 2-wirecore: inconclusive (direct spread above 15%) | 3 branch hit(s) by the counting rule; used by 1 engine class(es) without a shim (wire); two needed; overhead: 2-wirecore: inconclusive (direct spread above 15%) |
| EmbeddedCore | **Engine-owned** | 3 | sqlite | embedded (1) | does not fit | no PostgreSQL rung (not on that hot path) | 3 branch hit(s) by the counting rule; used by 1 engine class(es) without a shim (embedded); two needed |
| ServiceCore | **Engine-owned** | 2 | libsql | service (1) | does not fit | no PostgreSQL rung (not on that hot path) | 2 branch hit(s) by the counting rule; used by 1 engine class(es) without a shim (service); two needed |
| ExecutionCoordinator | **Engine-owned** | 0 | postgres, mysql, mariadb, sqlite, libsql | wire, embedded, service (3) | fits | 4-coord-pool: inconclusive (direct spread above 15%) | overhead: 4-coord-pool: inconclusive (direct spread above 15%) |
| ConnectionPool | **Engine-owned** | 0 | postgres, mysql, mariadb | wire (1) | does not fit | 4-coord-pool: inconclusive (direct spread above 15%) | used by 1 engine class(es) without a shim (wire); two needed; overhead: 4-coord-pool: inconclusive (direct spread above 15%) |
| Transport | **Engine-owned** | 1 | postgres, mysql, mariadb, libsql | wire (1) | does not fit | 3-transport: inconclusive (direct spread above 15%) | 1 branch hit(s) by the counting rule; used by 1 engine class(es) without a shim (wire); two needed; shim in class service; overhead: 3-transport: inconclusive (direct spread above 15%) |
| Error taxonomy + ErrorMapper | **Engine-owned** | 0 | postgres, mysql, mariadb, sqlite, libsql | wire, embedded, service (3) | fits | 5-full: inconclusive (direct spread above 15%) | overhead: 5-full: inconclusive (direct spread above 15%) |
| CodecRegistry | **Engine-owned** | 0 | postgres, mysql, mariadb, sqlite, libsql | wire, service (2) | fits | 5-full: inconclusive (direct spread above 15%) | shim in class embedded; overhead: 5-full: inconclusive (direct spread above 15%) |

Added by this study (not in the row's list, same rule):

| Contract | Verdict | Platform branch hits | Engines using | Classes using without a shim | Structural fit | Overhead on its rung | Why not Adopt |
|---|---|---|---|---|---|---|---|
| Session (added in this study) | **Engine-owned** | 0 | postgres, mysql, mariadb, sqlite, libsql | wire, embedded, service (3) | fits | 5-full: inconclusive (direct spread above 15%) | overhead: 5-full: inconclusive (direct spread above 15%) |

Entry composition (not platform code, reported apart): 1 class switch(es): entry/compose.ts:55.

The rule, applied by `scripts/verdicts.ts` to the recorded data and not by prose: Adopt means zero platform
engine branches, used by at least two engine classes without a shim, and no measurable overhead on its
rung; otherwise Engine-owned. "Measurable" and "inconclusive" are as the brief defines them. A contract
that has no PostgreSQL rung (EmbeddedCore, ServiceCore) is not charged overhead. The descriptor,
taxonomy/mapper and codecs are all on the full-path rung because the ladder has no rung of their own.
No contract shape was revised after the measurements; the table covers the final shapes.

### Observation for the ADR (no change made)

The rule asks for two engine classes, but WireCore, EmbeddedCore and ServiceCore are by definition used by one
class each (ADR 005), and the pool is wire-only by the roadmap's own statement. Under the rule as written
none of the four can be Adopted whatever the evidence. This is reported, not worked around; the thresholds
were not moved.

## What was built

`src/` is laid out like the repository's `src/`, with one extra folder:

```
src/platform/                 coordinator, pool, three session drivers (wire, embedded, service), client, failures
src/platform/contracts/       the provisional contracts (types, plus ByteWriter, DriverError, RawFailure)
src/transports/               tcp.ts (node:net), http.ts (fetch)
src/engines/postgres/         core, codecs, errors, descriptor
src/engines/mysql-family/     core, codecs, errors, shared descriptor factory
src/engines/mysql/            descriptor (5 lines)
src/engines/mariadb/          descriptor (7 lines)
src/engines/sqlite/           core over bun:sqlite, codecs, errors, descriptor
src/engines/libsql/           core (Hrana 3 over HTTP, through the Transport contract), codecs, errors, descriptor
src/entry/                    composition: an engine package + a transport + the coordinator and pool
scripts/                      checks (*.check.ts), ladder, verdicts; run with `bun run`
results/                      raw run output and small JSON files
```

The coordinator sits in front of every engine class (`Client.query` and `Client.begin` admit first). The
connection pool is used by the wire engines only; the embedded engine shares one session and the service
engine builds a session per checkout over a shared core. The platform contains no SQL text: transaction
statements come from each engine's descriptor. Parameters are bound by the server in all five: PostgreSQL
extended protocol (Parse/Bind, text-format values, the server decides types), MySQL and MariaDB
COM_STMT_PREPARE/EXECUTE (binary protocol), `bun:sqlite` prepared statements, Hrana typed arguments. 64-bit
integers come back as `bigint` on all five.

Capabilities come from what the server said during connect (`ServerFacts`: version, parameter status or
greeting flags, the transaction status the server reported, the Hrana baton), and are checked by a function of
those facts (`capabilities.respond-to-facts`: with empty facts the claims turn false). Only three of the
twelve capabilities are claimed, each tied to named checks that must have passed in the same run
(`cap.protocolPrepared`, `cap.interactiveTransactions`, `cap.int64`). The other nine are false or `'none'`
in every engine and are "not validated".

### Targets and evidence

Image tags, digests and versions are in `results/environment.json`: `postgres:17` (17.12), `mysql:8.4`
(8.4.13), `mariadb:11.8` (11.8.9), `ghcr.io/tursodatabase/libsql-server:latest` (sqld 0.24.33, pulled
by tag; the digest pins it), `bun:sqlite` in Bun 1.4.4 (SQLite 3.53.4 as reported at connect).

| Evidence | Where |
|---|---|
| Commit and rollback visible or not to another connection, read by `psql`, `mysql`, `mariadb` (inside the containers), Python `sqlite3` on the file, and raw JSON over `curl` to sqld | `accept-<engine>.txt` (`tx.*-external` checks) |
| Differential against `Bun.SQL` (same parameterised statement, same duplicate-key error code) on PostgreSQL, MySQL, MariaDB, SQLite; skipped for libSQL because `Bun.SQL` has no Hrana adapter | `differential.*` checks |
| Protocol record: a byte-forwarding proxy in front of PostgreSQL, MySQL, MariaDB and sqld records what the client sent; PostgreSQL's `log_statement=all` and the MySQL family's general log are second records; for SQLite the SQL strings passed to the binding are tapped | `protocol.*` checks, `protocol` array in `accept-<engine>.json` |
| Capability true only if a named check passed | `cap.*` checks |

The protocol record found one defect in this study's own MySQL family core: after a failed `COM_STMT_EXECUTE` it
did not send `COM_STMT_CLOSE`, leaking the prepared statement on the error path. It was fixed and the check
`protocol.no-statement-leak` (every PREPARE has a CLOSE) was added; the results are from the fixed code.

Error mapping observed (all `class: constraint`, `phase: execute`, `retry: never`):

| Engine | statementOutcome | transactionState | vendor | redacted |
|---|---|---|---|---|
| PostgreSQL | rejected-no-effects | failed-open | `23505` | true (DETAIL carries key values; dropped) |
| MySQL | rejected-no-effects | open | errno `1062`, SQLSTATE `23000` | true (message carries the key value; replaced) |
| MariaDB | rejected-no-effects | open | errno `1062`, SQLSTATE `23000` | true |
| SQLite | rejected-no-effects | open | `1555`, name `SQLITE_CONSTRAINT_PRIMARYKEY` | false |
| libSQL | rejected-no-effects | open | `SQLITE_CONSTRAINT` (symbolic, primary code only) | false |

Statement classification: each engine classifies one shape, a single-row `INSERT ... VALUES (...)`; everything
else the mapper cannot classify is `rejected-effects-possible`. MySQL and MariaDB cannot know from the error
packet that the table is transactional, so the mapper asks the server (`information_schema.TABLES.ENGINE`)
through `ErrorContext.probe`; the probe is visible in the protocol record.

## Contract revisions

The initial contracts are saved verbatim in `contracts.initial.md` (appendix A4 and A5). The final shapes are
in `src/platform/contracts/`. Each revision was made while building the skeleton, before any measurement.

| # | Change | Why | Forced by |
|---|---|---|---|
| R1a | `EngineDescriptor.id` is `string`, not the literal union | The union trips the engine-name lint in `platform` (finding F2) | all engines (the lint) |
| R1b | Descriptor gains `transactions: {begin, commit, rollback}` | Platform code contains no SQL text | all five |
| R2 | `CoreCommand` and `CoreEvent` given shapes | The sketch names them without shapes | PostgreSQL, MySQL, MariaDB |
| R3 | `CoreEvent` gains `send`; `encode(startup)` may produce no bytes | The MySQL server speaks first; prepare-then-execute answers input with output | MySQL, MariaDB |
| R4 | `vendor` is `{code, sqlState?, name?}` | An errno and its SQLSTATE; a numeric code and its symbolic name | MySQL, MariaDB, SQLite |
| R5 | `ErrorMapper.map` may be async and gets `ErrorContext.probe` | The error packet does not say whether the table is transactional | MySQL, MariaDB |
| R6 | `CodecRegistry` is `encode(value) -> EncodedParam` and `decoder(column) -> fn` | The sketch gives no shape; a per-column decoder keeps the type switch out of the row loop | all five |
| R7 | `Endpoint` given a shape, with optional `path` and `headers` | An HTTP service needs a path and a content type | libSQL |
| R8 | `Transport` gains `onClose(cb)` | The sketch cannot report that the peer closed, errored, or that an HTTP response ended | all transports |
| R9 | `ByteWriter` lives in `platform/contracts` | Engines may import platform only through contracts, and every wire core needs it | PostgreSQL, MySQL, MariaDB |
| R10 | `EmbeddedStatement.execute(params)` is the one member | The sketch gives it none | SQLite |
| R11 | `EmbeddedCore.facts` | Capability negotiation needs server facts and the sketch has no way to give them | SQLite |
| R12 | `ServiceCore.handshake(signal)` | Same reason as R11 | libSQL |
| R13 | New `Session`, `SessionSource`, `SessionLease` | The sketches define three cores but not the object the coordinator admits work onto | all classes |
| R14 | `ConnectContext` given a shape (`facts`, `transport`) | The sketch names it without a shape | all five |
| R15 | `ErrorContext` given a shape | The sketch names no mapper input | all five |
| R16 | `DriverError` and `RawFailure` are runtime classes in `contracts` | Engines throw `RawFailure`; the platform builds `DriverError` | libSQL, SQLite |

One change was made to composition code, not a contract, after a coordinator run: the service handshake moved
inside the caller's admission (shared by concurrent first callers), because doing it in `openClient` bypassed
the coordinator.

## Branch counts

Counting rule: README section "Branch counting rule" below, written before the first count. Output:
`results/branches.txt` and `results/branches.json`. Scope is `src/platform` (21 files); `src/entry` is apart.

| Contract | Hits | What the hits are |
|---|---|---|
| Engine descriptor + capability model | 0 | |
| WireCore | 3 | `Writer.u16be`, `Writer.u32be`, `Writer.patchU32be` (`contracts/bytes.ts:6,7,18`): byte helpers only PostgreSQL uses |
| EmbeddedCore | 3 | `EmbeddedStatement.finalize`, `EmbeddedCore.prepare`, `EmbeddedCore.inTransaction` (`contracts/core.ts:31,36,38`): one engine implements the class |
| ServiceCore | 2 | `ServiceCore.handshake`, `ServiceCore.openStream` (`contracts/core.ts:54,57`): one engine implements the class |
| ExecutionCoordinator | 0 | |
| ConnectionPool | 0 | |
| Transport | 1 | `Endpoint.headers` (`contracts/transport.ts:15`): only libSQL sets it. `Endpoint.path` is the same in practice; the count misses it because SQLite has an unrelated `path` parameter (the rule is a lower bound) |
| Error taxonomy + ErrorMapper | 0 | |
| CodecRegistry | 0 | |
| Session (added) | 0 | |

By rule: 0 engine-name literals, 0 engine-name identifiers, 0 branches on descriptor `id` or `class`, 0 SQL keyword
literals (two lower-case taxonomy words, the phase name `"commit"`, were considered and not counted: `contracts/errors.ts:7`,
`session-common.ts:46`), 9 one-engine members. Reported, not counted:

- `src/entry/compose.ts:55`: one `switch (pkg.class)` choosing the session driver per class. The composition
  root is where class-specific knowledge has to live; it is not platform code and was not hidden behind a lookup table.
- `src/platform/service-session.ts:59`: one optional-member feature test (`core.openStream === undefined`).
- 32 contract members no engine uses; they are platform-internal (coordinator, pool, session lease, `TransportCaps`
  fields, `TlsOptions`, `ServiceCore.batch`, `ConnectContext.transport`, `ErrorContext.txOpenBefore`). Not one
  of the six `TransportCaps` fields is read by any code.
- 9 of 12 capabilities are constant in every engine; `protocolPrepared` and `interactiveTransactions`
  are derived from server facts in all four descriptors (the MySQL family shares one).

## Shims

`shims.json` lists every place engine or adapter code fakes something to fit a contract; a shim removes the
class from that contract's count.

| Contract | Engine (class) | Shim |
|---|---|---|
| Transport | libSQL (service) | HTTP dressed as a byte stream: one transport instance per exchange, `open` connects nothing (connection failures appear at `write`), `onClose` means end of response, the HTTP status is invisible, `Endpoint` gained `path` and `headers` |
| CodecRegistry | SQLite (embedded) | `decoder()` is the identity: `bun:sqlite` binds and returns JS values itself |
| Descriptor + capability model | libSQL (service) | `ConnectContext.transport` is `undefined`: the `ServiceCore` owns its transport, so the capability model cannot read its `TransportCaps` |

Considered and not shims (the contract was changed to admit them, or the work is engine-internal): the MySQL
server-speaks-first `encode(startup)` (R3), the MySQL `probe` (R5), the MySQL core's `COM_PING` after an ERR
packet to read the transaction state, and the constant `retry: 'never'` in the SQLite and libSQL mappers
(untested rather than faked).

## Boundary check

`scripts/boundary.check.ts` imports `checkImportGraph` and `checkEngineLiterals` from
`tests/architecture/check.ts` (read-only) and runs them on `research/fs-01/src`. Output: `results/boundary.txt`.

Policy: the ADR 042 edges from `tests/architecture/edges.ts`, plus `engines/libsql` to `platform`, plus `entry`
may import everything. One rule of ours: engines import `platform` only through `platform/contracts`
(`engine-platform-deep-import`; the repository's checker allows engine to platform, so it would not catch this).

- External allowlist needed (the repository's table is empty everywhere): `transports`: `node:net`;
  `engines/sqlite`: `bun:sqlite`. `engines/libsql` needed none, but it uses the global `Buffer` and the transport uses
  the global `fetch`; the import-graph check cannot see globals (finding F4).
- Edges `entry` needed: `platform`, `transports`, `engines/postgres`, `engines/mysql`, `engines/mariadb`,
  `engines/sqlite`, `engines/libsql`. ADR 042 has no owner for code that composes an engine with a transport
  (finding F1); the table was not changed.
- Real tree: 0 violations. Files `bun test` would collect under `research/fs-01`: 0.

Negative runs, each in a throwaway copy under `work/negative`, each failing with the rule named:

```
NEGATIVE engine imports another engine: FAILS as required, rule illegal-edge
    src/engines/sqlite/index.ts:1: illegal-edge: engines/sqlite may not import engines/postgres ("../postgres/index.ts"); allowed: platform
NEGATIVE engine-name literal in platform: FAILS as required, rule engine-literal
    src/platform/failures.ts:76: engine-literal: string literal contains the engine name "postgres"
NEGATIVE platform imports an engine: FAILS as required, rule illegal-edge
    src/platform/client.ts:1: illegal-edge: platform may not import engines/postgres ("../engines/postgres/index.ts"); allowed: none
NEGATIVE engine imports platform outside contracts: FAILS as required, rule engine-platform-deep-import
    src/engines/postgres/errors.ts:1: engine-platform-deep-import: engine imports "../../platform/coordinator.ts" (platform/coordinator.ts); engines may import platform only through platform/contracts
NEGATIVE the roadmap's engine-id union in platform/contracts (the roadmap sketch `id: 'postgres' | 'mysql' | 'mariadb' | 'sqlite'`): FAILS as required, rule engine-literal
    src/platform/contracts/engine.ts:25: engine-literal: string literal contains the engine name "postgres"
    src/platform/contracts/engine.ts:25: engine-literal: string literal contains the engine name "mysql"
    src/platform/contracts/engine.ts:25: engine-literal: string literal contains the engine name "mariadb"
    src/platform/contracts/engine.ts:25: engine-literal: string literal contains the engine name "sqlite"
```

The last case is the roadmap's engine-id union in `platform/contracts/engine.ts`: it trips the engine-literal lint
four times on one line, which is why R1a made the engine id a `string`.

## Coordinator

`scripts/coordinator.check.ts <engine>`; output `results/coordinator-<engine>.txt`. Limit 2, 8 callers
submitted in the same tick, statements of 0.3 s on wire engines (`pg_sleep`, `sleep`) and a recursive-CTE
query on SQLite and libSQL; the pool allows 8 connections, so the coordinator and not the pool is the limiter.

| Engine | Observed concurrency (source) | 8 callers | Aborted while queued | Abort racing admission (320 races) | Slow first connect |
|---|---|---|---|---|---|
| PostgreSQL | max 2 (`pg_stat_activity`, 230 samples) | 1213 ms | cancelled / not-sent | 120 completed, 200 cancelled/not-sent, none other | 8/8 after 2338 ms (server killed, started 2 s late) |
| MySQL | max 2 (`information_schema.processlist`, 243 samples) | 1212 ms | cancelled / not-sent | 120 completed, 200 cancelled/not-sent, none other | 8/8 after 4110 ms |
| MariaDB | max 2 (`information_schema.processlist`, 237 samples) | 1209 ms | cancelled / not-sent | 118 completed, 202 cancelled/not-sent, none other | 8/8 after 4612 ms |
| SQLite | max 1 in flight at the core (counter); coordinator maxActive 2 | 449 ms | cancelled / not-sent | 160 / 160 | connect blocked 2033 ms by another process's lock; event loop stalled 2024 ms |
| libSQL | max 2 in flight at the core (counter) | 287 ms | cancelled / not-sent | 0 completed, 282 cancelled/not-sent, 38 cancelled/unknown (abort after the request was sent) | 8/8 after 2339 ms |

In every run no lease leaked, "not-sent" meant that no matching statement reached the recorder (the proxy, or the
tap for SQLite), and with the server never coming up 6 callers failed with class `connection` in about 0.9 s at a 400 ms connect timeout and the same
client recovered once the server returned. An abort after the request was sent (libSQL) is `cancelled` with outcome
`unknown`, not `not-sent`.

## Hot-path overhead (PostgreSQL, Bun, loopback)

Indicative, not a benchmark claim: one machine, loopback, one server version. Real load benchmarks belong to P4.

Statement `SELECT $1::int8` with a bigint parameter. Rungs: (1) a direct client with its own socket loop and no platform
contract (`scripts/ladder/direct-pg.ts`); (2) `PgCore` (WireCore) driven by a raw socket; (3) plus the Transport
contract; (4) plus `SimpleCoordinator.admit` and `SimplePool.acquire`; (5) the full path, `Client.query` with the
codec registry and error mapper. Rungs 2 to 4 use a script-local loop; rung 5 is product code, so its step also contains
the session driver's per-query bookkeeping, not only the codec registry and mapper. The direct path and the full
path send byte-identical frontend bytes for the statement: `results/ladder-bytes.txt` records both at
`net.Socket.prototype.write` (startup 58 bytes, statement 83 bytes, same sha256; also identical for rungs 2 to 4).

Scenario 1: one caller, one connection, 20,000 queries. Scenario 2: 64 callers over a pool of 8, 50,000 queries.
2,000 warm-up queries discarded per run, 10 repeats, rung order shuffled per repeat (seeded). Wall time and
CPU time (`process.cpuUsage`) per query. Bun 1.4.4, 4 vCPU; the PostgreSQL container was pinned to CPUs 2-3 and the client
ran under `taskset -c 0,1`. Raw runs: `results/ladder-runs.json`; summary: `results/ladder-summary.md`.

Runtime: bun 1.4.4; 4 vCPU; 10 repeats per rung and scenario; warm-up 2000 queries discarded.

### Scenario 1 (one caller, one connection, 20,000 queries)

| rung | wall median us/q | wall min..max | wall vs direct | wall vs previous | cpu median us/q | cpu min..max | cpu vs direct | cpu vs previous | measurable |
|---|---|---|---|---|---|---|---|---|---|
| 1-direct | 171.6 | 163.0..189.4 | - | - | 39.8 | 36.0..44.1 | - | - | (direct) |
| 2-wirecore | 189.2 | 171.6..210.0 | +10.3% | +10.3% | 51.6 | 46.4..56.4 | +29.6% | +29.6% | cpu above threshold, **inconclusive** |
| 3-transport | 183.0 | 167.5..214.8 | +6.6% | -3.3% | 50.3 | 46.1..57.8 | +26.3% | -2.5% | cpu above threshold, **inconclusive** |
| 4-coord-pool | 191.3 | 174.9..208.9 | +11.4% | +4.5% | 53.9 | 48.7..58.0 | +35.6% | +7.3% | cpu above threshold, **inconclusive** |
| 5-full | 203.1 | 183.1..223.1 | +18.3% | +6.2% | 58.7 | 55.1..69.2 | +47.4% | +8.8% | wall+cpu above threshold, **inconclusive** |

Direct rung spread (max-min)/median: wall 15.4%, cpu 20.4%. Threshold: max(3%, spread) = wall 15.4%, cpu 20.4%. **Direct spread above 15%: inconclusive in this scenario.**

### Scenario 2 (64 callers over a pool of 8, 50,000 queries)

| rung | wall median us/q | wall min..max | wall vs direct | wall vs previous | cpu median us/q | cpu min..max | cpu vs direct | cpu vs previous | measurable |
|---|---|---|---|---|---|---|---|---|---|
| 1-direct | 42.5 | 39.0..47.6 | - | - | 16.2 | 14.6..18.3 | - | - | (direct) |
| 2-wirecore | 49.2 | 42.8..54.4 | +15.7% | +15.7% | 23.5 | 20.0..26.1 | +44.9% | +44.9% | cpu above threshold, **inconclusive** |
| 3-transport | 49.8 | 45.8..56.1 | +17.0% | +1.1% | 24.3 | 21.2..27.7 | +49.6% | +3.3% | cpu above threshold, **inconclusive** |
| 4-coord-pool | 51.0 | 48.2..55.5 | +20.0% | +2.5% | 25.9 | 23.8..30.0 | +59.5% | +6.6% | cpu above threshold, **inconclusive** |
| 5-full | 55.1 | 51.2..61.4 | +29.5% | +7.9% | 29.8 | 28.1..34.7 | +83.6% | +15.1% | wall+cpu above threshold, **inconclusive** |

Direct rung spread (max-min)/median: wall 20.2%, cpu 22.9%. Threshold: max(3%, spread) = wall 20.2%, cpu 22.9%. **Direct spread above 15%: inconclusive in this scenario.**

Reading: by the brief's rule the direct rung's spread is above 15% in both scenarios (wall 15.4%, CPU 20.4% in scenario 1; wall 20.2%, CPU
22.9% in scenario 2), so the result is **inconclusive** in both and no contract can be Adopted from it. The table shows the medians anyway:
every rung above direct has a higher median on both metrics in both scenarios, the largest step in scenario 1 is
from direct to rung 2, and the full path is +18.3% wall and +47.4% CPU over direct in scenario 1 and +29.5% wall and +83.6% CPU in
scenario 2. Against the spread-based threshold, CPU is above it for every rung and wall time only for rung 5, in both
scenarios; because the direct spread is above 15% that is reported as inconclusive and the rule decides the verdict. The
ladder was run once; it was not repeated to tighten the spread.

Node 22: the same code does not run unmodified (`results/ladder-node22.txt`: type-stripping mode rejects TypeScript
parameter properties). No code was ported.

## Findings

F1. **ADR 042 has no owner for composition.** `entry` needed edges to `platform`, `transports` and all five engine
folders. `entry/packages.ts` imports every engine, so importing it pulls `bun:sqlite` and every engine; a published
per-engine entry would need one composition module per engine for the bundle-isolation rule.

F2. **The roadmap's engine-id union trips the engine-literal lint in `platform`** (four hits on one line); `id: string`
passes (R1a).

F3. **`platform/contracts` is not types-only.** Engines need `ByteWriter`, `RawFailure` and `DriverError` at runtime, and the
rule "engines import platform only through contracts" leaves no other place for them.

F4. **External allowlist.** `node:net` for transports, `bun:sqlite` for the SQLite engine. Globals (`fetch`, `Buffer`,
`TextDecoder`) are invisible to the import-graph check, so portability to a runtime without `Buffer` is not checked.

F5. **Statement classification is duplicated.** The single-row-INSERT test exists four times (PostgreSQL, MySQL family,
SQLite, libSQL) with small differences; the roadmap puts the table in each engine's specification.

F6. **MySQL family error path costs round trips.** An ERR packet carries no transaction state, so the core sends
`COM_PING` to read it; `rejected-no-effects` needs a storage-engine lookup (the probe). Both are on the error path only (visible in the protocol record).

F7. **Redaction is real work.** PostgreSQL's DETAIL line and MySQL's 1062 message carry the key value; two of five mappers
set `redacted: true`.

F8. **The vendor code differs between two bindings of one engine.** `bun:sqlite` gives `1555` with the name
`SQLITE_CONSTRAINT_PRIMARYKEY`; Hrana gives the symbolic primary code `SQLITE_CONSTRAINT` only.

F9. **Taxonomy gaps.** There is no phase for admission or queueing (`execute` was used for queue cancellation and
queue timeout); an abort after the request was sent is class `cancelled` with outcome `unknown`, which the table allows but does not
name; the PostgreSQL and MySQL mappers have no target class for data-conversion errors (they fall to `internal`; not exercised).

F10. **Capability model.** Three of twelve capabilities were claimable; `protocolPrepared` is a version comparison on
three engines; `ConnectContext.transport` and every `TransportCaps` field are read by nothing.

F11. **Embedded work is synchronous.** The SQLite binding blocked the event loop for 2.0 s while another process held a lock,
including the connect; no timer, abort or other caller could run. With synchronous work a queued caller can only exist
while another caller holds an admission across an await (a transaction), and the core counter never exceeded 1 at limit 2.

F12. **Types differ at the edges.** `SELECT 1` returns `bigint` on MySQL, SQLite and libSQL and `number` on PostgreSQL and MariaDB
(`results/observations.json`). Every SQLite INTEGER is a `bigint`; `1.5` is a `number` on SQLite and libSQL and a string on the wire engines. `Bun.SQL` with
default options returned a lossy `number` (9007199254740992) for the bound 2^53+1 on SQLite, and returned MySQL and MariaDB 64-bit
integers as strings.

F13. **Transport does not fit a stateless service.** See the shim; `TransportCaps.streaming` is the only member that
distinguishes them, and nothing reads it.

## Observations that may bear on FS-07 and FS-08 (no conclusions)

- MySQL and MariaDB share `engines/mysql-family`: 710 lines (core 528, codecs 75, errors 67, descriptor factory 40); the forked parts are `mysql/index.ts` (5 lines) and `mariadb/index.ts` (7 lines). Both pass the same
  checks. Observed differences: greeting plugin (`caching_sha2_password` on MySQL 8.4, `mysql_native_password` on MariaDB 11.8), the version string,
  the duplicate-key message (`fs01_kv.PRIMARY` against `PRIMARY`), and the type of `SELECT 1` (BIGINT against INT).
- libSQL over Hrana and `bun:sqlite` are both SQLite: the engine code (errors, classification) is duplicated rather than shared; vendor codes and the
  source of the transaction state differ (`inTransaction` against `get_autocommit`).
- Each non-transactional libSQL statement is one HTTP exchange of a three-request pipeline; a transaction pins a stream through a baton.

## Decisions beyond the brief

- PostgreSQL 17 was the "maintained line". The libSQL image was pulled by the `latest` tag; its digest is recorded.
- Added `Session`, `SessionSource`, `SessionLease` (R13) and judged `Session` by the same rule in a second table.
- Counting rule details: members count as used by an engine through the platform session driver for its class; entry apart; lower bound for member names.
- "Used without a shim" is read strictly: a recorded shim in a class removes that class from the contract's count.
- Overhead: cumulative against direct (as the brief defines it), with the step over the previous rung shown for information. Contract to rung: WireCore 2, Transport 3, coordinator and pool 4, codec, mapper, descriptor and the added Session 5. A scenario is inconclusive when the direct rung's spread is above 15% on either metric.
- PostgreSQL parameters and results are text-format in the ladder statement (consistent with ADR 015 and 016); the byte proof compares the same statement bytes.
- The MySQL family asks the server for the table's storage engine (probe) and for the transaction state (`COM_PING`); the PostgreSQL mapper does neither.
- The differential check runs `Bun.SQL` with `bigint: true` on PostgreSQL and SQLite; the SQLite default is recorded as a note.
- Slow first connect: the server container is killed and started 2 s later (`docker kill`, `docker start`); for SQLite another process holds an exclusive lock for 2 s.
- `contracts.initial.md` holds only appendix A4 and A5, as instructed; the outcome tables of A6 are not copied.

## Not validated

Listed as not validated. None of these was exercised, so no claim is made about them:

- Authentication mechanisms: PostgreSQL ran with `trust`, MySQL and MariaDB with an empty-password root (the
  MySQL family core answers the auth-switch and caching_sha2 fast-path packets with an empty reply; SCRAM,
  mysql_native_password scrambles, ed25519 and caching_sha2 full authentication are not implemented).
- TLS, including `upgradeTls`, `TlsInfo.endpointHash` and `TransportCaps.channelBinding`.
- Pooler behaviour (PgBouncer and similar), pipelining, and cancel on the wire (`cancel` stays `'none'`).
- Other server versions: one version per engine, see `results/environment.json`.
- Node and Deno: the study ran on Bun. A single information-only attempt at Node 22 is reported below.
- D1 (Miniflare): libSQL was the service integration, so D1 was not tried.
- Anything FS-02 to FS-08 owns.
- Capabilities other than `protocolPrepared`, `interactiveTransactions` and `int64`: nine of the twelve
  `CapabilitySet` members are false or `'none'` in every engine because no named check exists for them.

## Branch counting rule

Scope: every `.ts` file under `src/platform` (including `src/platform/contracts`). `src/entry` is the
composition root, which ADR 042 does not own; it is counted separately and is not platform code.
Comments are never counted as code. A "hit" is one line.

1. **Engine-name literals.** A string or template literal, or an identifier, containing one of
   `postgres`, `postgresql`, `mysql`, `mariadb`, `sqlite`, `libsql`, `hrana`, `sqld`, `cloudflare` (any
   case, substring for identifiers) or `d1` (whole word). Literals use the repository's scanner.
2. **Branch on descriptor `id` or `class`.** Any `if`, `switch`, `case`, ternary or `&&`/`||` guard whose
   operand is a member access `.id` or `.class` on a descriptor-like value (`descriptor`, `desc`, `d`,
   `pkg`). The error taxonomy's own `class` field (`e.class`) is not a descriptor class and is not counted.
3. **SQL keyword literals in platform.** A string or template literal whose first word is a SQL statement
   keyword (`select insert update delete begin commit rollback savepoint release create drop alter pragma
   set show start`) and that is either all upper case or contains whitespace. A literal that is one lower
   case taxonomy word (for example the phase name `"commit"`) is listed as considered and not counted.
4. **Contract members that only one engine uses.** Members are the properties and methods declared in
   `src/platform/contracts/*.ts` interfaces. A member is used by an engine when an identifier with that
   name appears in property position (after `.`, or before `:`, `(` or `?`) in the engine's code or in
   the platform session driver for the engine's class (`wire-session.ts`, `embedded-session.ts`,
   `service-session.ts`), which acts on the engine's behalf. `engines/mysql-family` credits both
   `mysql` and `mariadb`. A member used by exactly one of
   `postgres`, `mysql`, `mariadb`, `sqlite`, `libsql` is a hit. This is a lower bound: a common member
   name used for another purpose in an engine counts as used.
5. **Reported, not counted:** members no engine uses; capabilities that every engine leaves at their
   constant; optional-member feature tests in platform (`core.openStream === undefined`); class
   switches in `src/entry`.

Each hit is assigned to a contract by file (table in `scripts/lib/contract-map.ts`). A hit in general
platform code (`client.ts`, `session-common.ts`, `failures.ts`) counts against every contract.

## Reproduction

All commands run from the repository root. Servers: `research/fs-01/scripts/servers.sh up` (loopback ports 55432, 53306,
53307, 58080; Docker may need `sudo dockerd`).

```bash
bunx tsc -p research/fs-01/tsconfig.json
for e in postgres mysql mariadb sqlite libsql; do bun run research/fs-01/scripts/accept.check.ts $e; done
for e in postgres mysql mariadb sqlite libsql; do bun run research/fs-01/scripts/coordinator.check.ts $e; done
bun run research/fs-01/scripts/boundary.check.ts
bun run research/fs-01/scripts/branches.check.ts
bun run research/fs-01/scripts/ladder/bytes-proof.ts
taskset -c 0,1 bun run research/fs-01/scripts/ladder/ladder.ts --out research/fs-01/results/ladder-runs.json
bun run research/fs-01/scripts/ladder/summary.ts research/fs-01/results/ladder-runs.json research/fs-01/results/ladder
bun run research/fs-01/scripts/observations.ts
bun run research/fs-01/scripts/verdicts.ts
research/fs-01/scripts/servers.sh down
```

The coordinator check kills and restarts the server containers. `bun test` and `bun run typecheck` at the root are unchanged
(42 passing tests; typecheck passes).

## Verdict table for the ADR

| Contract | Verdict | Platform branch hits | Engines using | Classes using without a shim | Structural fit | Overhead on its rung | Why not Adopt |
|---|---|---|---|---|---|---|---|
| Engine descriptor + capability model | **Engine-owned** | 0 | postgres, mysql, mariadb, sqlite, libsql | wire, embedded (2) | fits | 5-full: inconclusive (direct spread above 15%) | shim in class service; overhead: 5-full: inconclusive (direct spread above 15%) |
| WireCore | **Engine-owned** | 3 | postgres, mysql, mariadb | wire (1) | does not fit | 2-wirecore: inconclusive (direct spread above 15%) | 3 branch hit(s) by the counting rule; used by 1 engine class(es) without a shim (wire); two needed; overhead: 2-wirecore: inconclusive (direct spread above 15%) |
| EmbeddedCore | **Engine-owned** | 3 | sqlite | embedded (1) | does not fit | no PostgreSQL rung (not on that hot path) | 3 branch hit(s) by the counting rule; used by 1 engine class(es) without a shim (embedded); two needed |
| ServiceCore | **Engine-owned** | 2 | libsql | service (1) | does not fit | no PostgreSQL rung (not on that hot path) | 2 branch hit(s) by the counting rule; used by 1 engine class(es) without a shim (service); two needed |
| ExecutionCoordinator | **Engine-owned** | 0 | postgres, mysql, mariadb, sqlite, libsql | wire, embedded, service (3) | fits | 4-coord-pool: inconclusive (direct spread above 15%) | overhead: 4-coord-pool: inconclusive (direct spread above 15%) |
| ConnectionPool | **Engine-owned** | 0 | postgres, mysql, mariadb | wire (1) | does not fit | 4-coord-pool: inconclusive (direct spread above 15%) | used by 1 engine class(es) without a shim (wire); two needed; overhead: 4-coord-pool: inconclusive (direct spread above 15%) |
| Transport | **Engine-owned** | 1 | postgres, mysql, mariadb, libsql | wire (1) | does not fit | 3-transport: inconclusive (direct spread above 15%) | 1 branch hit(s) by the counting rule; used by 1 engine class(es) without a shim (wire); two needed; shim in class service; overhead: 3-transport: inconclusive (direct spread above 15%) |
| Error taxonomy + ErrorMapper | **Engine-owned** | 0 | postgres, mysql, mariadb, sqlite, libsql | wire, embedded, service (3) | fits | 5-full: inconclusive (direct spread above 15%) | overhead: 5-full: inconclusive (direct spread above 15%) |
| CodecRegistry | **Engine-owned** | 0 | postgres, mysql, mariadb, sqlite, libsql | wire, service (2) | fits | 5-full: inconclusive (direct spread above 15%) | shim in class embedded; overhead: 5-full: inconclusive (direct spread above 15%) |

Added by this study (not in the row's list, same rule):

| Contract | Verdict | Platform branch hits | Engines using | Classes using without a shim | Structural fit | Overhead on its rung | Why not Adopt |
|---|---|---|---|---|---|---|---|
| Session (added in this study) | **Engine-owned** | 0 | postgres, mysql, mariadb, sqlite, libsql | wire, embedded, service (3) | fits | 5-full: inconclusive (direct spread above 15%) | overhead: 5-full: inconclusive (direct spread above 15%) |

Entry composition (not platform code, reported apart): 1 class switch(es): entry/compose.ts:55.
