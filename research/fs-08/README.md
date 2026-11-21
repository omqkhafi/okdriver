# FS-08: SQLite bindings, integer width, worker, Durable Objects placement

Research only. This folder contains scripts, small result files and these notes. It changes no OKDriver
source, no test, no ADR, no gate and no root tooling, and it makes **no claim about OKDriver** and no public
comparison. Spec area: none yet. Feature record: none (research). ADR: none (findings, not decisions).

Base: `origin/main` at `dc921f6f5a5648a8e16db3852603d7d377173fb2`. Branch `chore/fs-08-sqlite-bindings`.

Question: which SQLite bindings, and is a worker worth it? The roadmap row (FS-08) asks for a capability diff
per binding, overhead over the raw binding, worker transfer cost by result size, the integer-width rule, and
whether Durable Objects SQLite belongs to the embedded or the service contract. The tables below are rendered
from the JSON in `results/` by `scripts/render.mjs`; nothing in them is typed by hand. The probe interface in
`scripts/lib/adapters.mjs` is private to this folder: it is not a proposal for the Driver Contract and does not
depend on `research/fs-01`.

## Findings in short

1. **Bindings.** All three bindings can carry the embedded shape (in-process handle, no transport, one writer
   plus readers in WAL). None is a superset of the others. `bun:sqlite` loads only on Bun. `node:sqlite` loads on
   Node 22.13+ (22.12 needs `--experimental-sqlite`), 24 and 26, and on Bun; its stability is 1.1 on 22
   (warning emitted) and 1.2 release candidate on 24 and 26 (no warning). `better-sqlite3` 13.2.0 loads on all four
   runtimes from the prebuilds in its package, with no install script and no trusted dependency. The differences
   that matter (full diff in section 1): `node:sqlite` on Node 22 lacks `serialize`, `deserialize`, statement
   `close`, the statement cache and `setAuthorizer`; `bun:sqlite` has no online backup API and its `close()` leaves
   the connection open while statements are alive; `bun:sqlite` and `better-sqlite3` load an extension with no
   opt-in at all; `better-sqlite3` cannot reach `SQLITE_LOCKED` (it refuses the call first) and has no hooks or
   session extension; `node:sqlite` reports `ERR_SQLITE_ERROR` as the code and the SQLite code only in `errcode`;
   no binding has a collation API; defaults differ (`foreign_keys` 0 on `bun:sqlite`, `busy_timeout` 5000 on
   `better-sqlite3`). The three bundle the same SQLite (3.54.1) on the pinned Bun 1.4.5 and on Node 22.23.5,
   24.22.3, 26.13.1.
2. **Integer width.** Settled rule, verified on all three bindings on all four runtimes (882 of 882 checked result
   sets, with negative controls that fail): **read every integer cell in the binding's lossless mode (bigint);
   take the column's declared type from statement metadata (null for expressions); a declared `BIGINT`, `INT8` or
   `UNSIGNED BIG INT` column gives bigint; any other integer cell gives number when `|v| <= 2^53-1` and a data error
   otherwise; REAL, TEXT, BLOB, NULL are never touched.** The bindings' own default modes cannot be used:
   `better-sqlite3` and `bun:sqlite` round silently (2^53+1 reads as 2^53), `node:sqlite` throws but its check is not
   uniform (it returns exactly -2^63 as a number on Node 22 and 24). Two limits of the roadmap wording, both
   observed: a STRICT table cannot declare `BIGINT` (SQLite refuses it), so "STRICT recommended" and "declared
   64-bit decodes to bigint" cannot both hold for one table; and an expression column has no declared type, so
   `max(x)` over a `BIGINT` column raises the data error above 2^53-1. Cost: the lossless read plus narrowing is
   x1.06 to x1.27 on a point select, x1.16 to x2.03 on 100 rows and x1.23 to x2.00 on 10,000 rows (medians over
   21 runs, per binding and runtime).
3. **Worker.** **No threshold found** on Node 22, 24, 26 or Bun under the criteria fixed before the runs: the
   worker has to win end-to-end latency and main-thread blocking together (see section 3). It never won latency: it
   adds about 0.2 to 0.3 ms per request, and structured clone of result rows makes things worse (100,000 wide rows
   on Node 24: 297 ms in-thread, 652 ms by clone with a 173 ms block on the main thread). What the worker does win
   is blocking: from a 10 ms query on Node 24, Node 26 and Bun (1 ms on one Node 22 cell) the longest main-thread
   block drops from the query time to about 0.1 to 1.3 ms, for a latency change of -4 to +91 ms (mostly inside the
   run-to-run spread). A packed
   ArrayBuffer cuts the transfer block from 173 ms to 6 ms (22 ms with row objects rebuilt) at 100,000 wide rows.
   Throughput with 4 readers is 2.4x to 4.0x in-thread for CPU-bound queries; for 1,000-row results it is 0.4x
   to 1.0x with clone and 0.8x to 1.7x with the packed buffer. A reader in a worker sees every commit of the main-thread writer and none of an open
   transaction, and the writer is not blocked by a long worker read. Whether the blocking win is worth the latency
   cost is a decision for the roadmap or an ADR, not made here.
4. **Durable Objects SQLite: service contract.** Observed on local workerd 1.20261118.1: the call is synchronous
   and in-process like the embedded shape, but of the 12 rows below 10 match the service shape (platform API with
   its own transaction rules and limits), 1 the embedded shape and 1 neither. `BEGIN` and `SAVEPOINT` are refused in SQL
   (only `transactionSync` and `transaction`); `journal_mode`, `synchronous`, `busy_timeout`, `wal_checkpoint`,
   `ATTACH`, `load_extension()` and `sqlite_version()` are not authorized; there is no second connection, so no
   reader pool, no WAL control and no busy handling; integers always come back as JavaScript numbers (silently
   rounded above 2^53-1) and bigint parameters are refused, so the integer rule of finding 2 cannot be applied;
   BLOBs come back as `ArrayBuffer`; errors are plain `Error` with the SQLite code only in the message. The
   roadmap's guess ("may fit the embedded contract better") is not supported. Everything in this finding is
   local-observed or marked documented-only; none of it is a statement about production Cloudflare.

## Roadmap claims marked [A]

Evidence paths are relative to `results/`. "Confirmed" means observed in this folder on the versions listed
below; it does not extend to other platforms.

| claim (roadmap, Revision 2 rev 68) | verdict | evidence |
| --- | --- | --- |
| `bun:sqlite` "First-class on Bun" | confirmed as capability (loads and passes every probe row on Bun 1.4.5, with the `close()` caveat); "first-class" as a policy word is not testable | `capabilities/bun-sqlite__bun.json` |
| `node:sqlite` "First-class on Node where its stability level allows; status verified in FS-08" | confirmed, status recorded: stability 1.1 (Node 22, warning) and 1.2 release candidate (24, 26, no warning); loads without a flag from 22.13.0, not on 22.12.0 | `node-sqlite-stability.json`, `capabilities/node-sqlite__*.json` |
| `better-sqlite3` "Optional peer for Node features the built-in module lacks; never a hard dependency" | confirmed as feasible: installs and loads with bun, no install script, no trusted dependency, on Node 22/24/26 and Bun; it has what `node:sqlite` 22 lacks (`serialize`, `deserialize`, `transaction()`) and lacks what `node:sqlite` has (session extension). "Never a hard dependency" is a policy and is not testable | `capabilities/better-sqlite3__*.json`, `package.json`, `bun.lock` |
| Type contract: "Values are decoded by declared column type and by plan shape" | confirmed: declared types are reported by all three bindings before stepping, and plan shape changes them (a UNION takes its first branch's type, an expression has none) | `integers/*.json`, `capabilities/*.json` (`meta.declared_types`) |
| "...with STRICT tables recommended" together with "Integers declared as 64-bit decode to bigint" | **refuted as a pair**: `CREATE TABLE ... (a BIGINT) STRICT` is refused (`unknown datatype`); STRICT allows INT, INTEGER, REAL, TEXT, BLOB, ANY only | `capabilities/*.json` (`meta.strict_tables`), `integers/truth.json` (`col:s_*`) |
| "other integers decode to number and raise a data error when a value exceeds the safe range. Nothing is rounded silently." | confirmed as a rule that can be implemented on all three bindings (section 2); **refuted as a native behaviour**: bun:sqlite and better-sqlite3 round silently in default mode, node:sqlite throws only partly | `integers/*.json` |
| "The exact rule is settled in FS-08" | rule stated and verified in section 2 | `integers/*.json`, `integers/truth.json` |
| Connection lifecycle: pragmas at open, optimize on close, "explicit configuration with documented defaults" | confirmed: journal_mode, synchronous, foreign_keys, busy_timeout and `PRAGMA optimize` are settable by SQL on all three; the defaults differ per binding, so explicit configuration is required | `capabilities/*.json` (`pragma.*`) |
| WAL: recommended mode, checkpoint control, reader/writer behaviour | confirmed on file databases; the claim that it "differs on WASM and network filesystems" is not testable here | `capabilities/*.json` (`wal.*`), `worker-visibility/*.json` |
| Concurrency: one writer handle with a write queue, N reader handles | confirmed for the handle split (readers see commits, keep a snapshot, are not blocked by the writer and do not block it); the write queue itself is not a binding property and was not built | `worker-visibility/*.json`, `capabilities/*.json` |
| Busy handling: BEGIN IMMEDIATE, busy timeout, classified SQLITE_BUSY | confirmed: waiting never ends before the timeout and ends within 2.9 ms after it; BEGIN IMMEDIATE avoids the read-to-write upgrade failure, which otherwise returns `SQLITE_BUSY_SNAPSHOT` at once, ignoring the timeout; the wait blocks the calling thread | `capabilities/*.json` (`busy.*`) |
| ...classified SQLITE_LOCKED | confirmed on bun:sqlite and node:sqlite; **not observed** on better-sqlite3, which rejects the call before SQLite sees it (`TypeError`); node:sqlite classifies by `errcode`, its `code` is always `ERR_SQLITE_ERROR` | `capabilities/*.json` (`errors.classification`) |
| Transactions and savepoints: deferred, immediate, exclusive; nested savepoints | confirmed through SQL on all three; a `transaction()` helper exists on bun:sqlite and better-sqlite3 only | `capabilities/*.json` (`tx.*`) |
| Prepared statements: "statement cache, finalisation on close, reset discipline" | confirmed in part: reset after an early `break` works everywhere; a built-in cache exists on bun:sqlite (`query()`) and node:sqlite 24+ (`createTagStore`), not on better-sqlite3; **refuted for "finalisation on close" on bun:sqlite**: `close()` with live statements leaves the connection open (WAL files stay, old statements still run), only `close(true)` closes | `capabilities/*.json` (`stmt.*`) |
| Iteration: "an open iterator holds a read transaction" | confirmed: it holds a read snapshot (the reader does not see a later commit), blocks WAL checkpoint completion, blocks writers in rollback-journal mode, and is released by `return()` or `break`; the binding's in-transaction flag stays false while it is open | `capabilities/*.json` (`iter.*`) |
| Extensions: "loadable extensions behind an explicit opt-in" | **refuted as a binding property** for bun:sqlite and better-sqlite3 (`loadExtension()` loads and runs a real extension with no opt-in; only SQL `load_extension()` is off); confirmed for node:sqlite (`allowExtension`). OKDriver would have to gate it itself | `capabilities/*.json` (`ext.loading`) |
| Extensions and functions: scalar and aggregate functions | confirmed on all three | `capabilities/*.json` (`fn.*`) |
| Extensions and functions: collations "capability per binding" | **refuted**: no binding has a collation API | `capabilities/*.json` (`fn.collation`) |
| Backup: "online backup or serialise/deserialise, per binding" | confirmed with limits: online backup on node:sqlite and better-sqlite3 only; `serialize` of a WAL database works but the image cannot be deserialized (header says WAL; `SQLITE_CANTOPEN`); `VACUUM INTO` works everywhere | `capabilities/*.json` (`backup.*`) |
| Worker execution: "optional worker pool so long queries do not block the event loop; adopted only if FS-08 shows the transfer cost is acceptable" | blocking claim confirmed; transfer cost not "acceptable" by the pre-registered both-wins rule; **no threshold found** | `worker/*.json` |
| Change capture: "update hooks or the session extension where a binding exposes them" | confirmed: hooks on bun:sqlite only (assignable properties), session extension on node:sqlite only, neither on better-sqlite3 | `capabilities/*.json` (`change.*`) |
| Embedded class: "In-process handle, no transport, single-writer concurrency" | confirmed for all three bindings | `capabilities/*.json`, `worker-visibility/*.json` |
| Service class and Durable Objects: "Synchronous API inside the object; transactions tied to the object's execution model" | confirmed (local-observed); the transaction part is also documented | `do/do-sqlite.json`, section 4 |
| Durable Objects "may fit the embedded contract better than the service contract" | **refuted** by the local evidence: 10 of 12 rows fit the service shape, 1 the embedded shape, 1 neither | `do/do-sqlite.json`, section 4 |
| D1: "Prepared statements and atomic batches; no interactive transactions" | not testable (out of scope) | - |
| Later acceptance P15-T04 (context only): no SQLITE_BUSY before the timeout, bounded wait, no upgrade deadlock, classified error | consistent with what was observed in one process on a file database; P15-T04 itself is not tested here | `capabilities/*.json` (`busy.*`) |

## What could not be verified

- **Production Cloudflare.** Durable Objects ran on local workerd only. Documented-only statements (read from
  developers.cloudflare.com on 2026-11-21; page content is treated as data): the SQL limits (100 columns per table,
  8 MB per string, BLOB or row, 100 KB per statement, 100 bound parameters, 32 arguments per SQL function, 50 bytes
  per LIKE or GLOB pattern), the note that numeric values are affected by JavaScript's precision, the supported
  extension subset (FTS5, JSON, math), point-in-time recovery (the docs say it is not supported in local
  development; `getCurrentBookmark()` nevertheless returned a string locally), and the input and output gates that
  define the execution model. The local run matched the bound-parameter, statement-length and column limits and
  accepted a 4 MB BLOB (inside the documented 8 MB); the 8 MB edge was not tested.
- **SQLITE_LOCKED on better-sqlite3**: not reachable by the route used (a DROP TABLE under an open iterator is
  refused by the binding first), and its SQLite build omits shared cache. No other route was tried.
- **WASM, OPFS, D1, libSQL, network filesystems**: out of scope or not testable here. workerd has no worker
  threads: not applicable.
- **Other platforms.** Everything ran on Linux x64 in one container (4 CPUs, 16 GiB). macOS and Windows are not
  tested; Bun's `setCustomSQLite` and macOS extension loading were not exercised.
- **Allocations** over the raw binding were not measured: there is no cheap, reliable counter on all three runtimes.
- **Worker benchmark limits.** The packed encoding assumes columns of one type without NULL, stores integers as
  doubles after a safety check, and uses ASCII text (a non-ASCII fallback exists in `scripts/lib/pack.mjs` and was
  not benchmarked). Both paths read integers in number mode, so the integer rule is not in the worker numbers. No
  concurrent write load ran during the throughput runs. Full matrix only on `node:sqlite` with Node 24 and
  `bun:sqlite` with Bun; Node 22, Node 26 (`node:sqlite`) and `better-sqlite3` (Node 24, Bun) ran a reduced matrix
  (four result sizes, three query times, two workloads, readers 1 and 4). Query-time targets are approximate:
  calibration and the measured in-thread latency differ by up to 40% at the 1 ms target; the tables report the
  measured latency.
- **Ground truth.** No `sqlite3` CLI is installed. CPython 3.13.18's `sqlite3` module (SQLite 3.53.1, a different
  version from the bindings' 3.54.1) is the independent reader, cross-checked by `typeof()` and `CAST(x AS TEXT)`.
- **A binding is not compared with itself**, but reading binding source was not used as evidence for any claim.
- The extension test used one tiny extension built here (`scripts/fixtures/ext.c`); other extensions were not tried.

## Versions used

Full list in `results/versions.json`.

| item | version |
| --- | --- |
| Node.js (nodejs.org tarballs, SHASUMS256 checked) | 22.23.5, 24.22.3, 26.13.1; also 22.12.0 and 22.13.0 for the stability observation only |
| Bun (`.bun-version`; GitHub release, SHASUMS256 checked) | 1.4.5 (`a7733435`). The Bun preinstalled in this container is 1.4.4 and bundles SQLite 3.53.4; it was not used, and Bun 1.4.5 bundles 3.54.1 for both `bun:sqlite` and its `node:sqlite` |
| `node:sqlite` bundled SQLite | 3.54.1 on 22.23.5, 24.22.3, 26.13.1 and Bun 1.4.5; 3.47.0 on 22.12.0; 3.47.2 on 22.13.0 |
| better-sqlite3 | 13.2.0 (exact pin, nested `bun.lock`, no `trustedDependencies`), `node-addon-api` 8.9.2, SQLite 3.54.1 |
| workerd | 1.20261118.1 (the repo's devDependency), installed in a scratch directory outside the repo with `bun add --exact`, no install scripts |
| Python (independent reader) | 3.13.18, SQLite 3.53.1 |
| Host | Linux 6.18.44, 4 CPUs (Intel Xeon @ 2.30GHz), 16 GiB |

## Reproduce

```bash
cd research/fs-08
bun install                       # nested package only; no install scripts, no trusted dependencies
scripts/setup-runtimes.sh         # Node 22/24/26 and Bun from .bun-version into /tmp/rt/fs08 (RT_DIR to move it)
scripts/run-capabilities.sh       # results/capabilities/*.json
scripts/run-integers.sh           # results/integers/*.json (needs python3)
node scripts/node-sqlite-stability.mjs
scripts/run-benchmarks.sh         # worker, overhead, visibility; strictly sequential: run it in the background and read the log once
(cd /tmp/rt && mkdir -p workerd-pkg && cd workerd-pkg && echo '{"private":true}' > package.json && /tmp/rt/fs08/bun/bun add --exact workerd@1.20261118.1)
scripts/run-do.sh                 # results/do/do-sqlite.json
node scripts/versions.mjs && node scripts/render.mjs   # results/versions.json, results/tables.md, the tables below
```

`work/` is gitignored (database files, the extension build, logs). Scripts are plain ESM or shell, outside every
tsconfig, and their names do not match `bun test` patterns.

## 1. Capability diff

Generated from `results/capabilities/<binding>__<runtime>.json`, one file per binding and runtime. Status words:
`works` (exercised and behaved), `partial` (exercised, only part reachable), `absent` (no such API by name),
`present-not-exercised`, `fails`. A row that could not be exercised is "not-observed", never "works".

### Binding by runtime

<!-- GEN:matrix -->
| binding | node22 | node24 | node26 | bun |
| --- | --- | --- | --- | --- |
| bun:sqlite | does not load (ERR_UNSUPPORTED_ESM_URL_SCHEME) | does not load (ERR_UNSUPPORTED_ESM_URL_SCHEME) | does not load (ERR_UNSUPPORTED_ESM_URL_SCHEME) | loads; SQLite 3.54.1; no warning |
| node:sqlite | loads; SQLite 3.54.1; warns: ExperimentalWarning | loads; SQLite 3.54.1; no warning | loads; SQLite 3.54.1; no warning | loads; SQLite 3.54.1; no warning |
| better-sqlite3 | loads; SQLite 3.54.1; no warning | loads; SQLite 3.54.1; no warning | loads; SQLite 3.54.1; no warning | loads; SQLite 3.54.1; no warning |
<!-- /GEN:matrix -->

### `node:sqlite` stability

Stability levels are from the official docs (nodejs.org, reachable); the warning and the first release without a
flag are observed on real releases.

<!-- GEN:stability -->
| source | stability level | history excerpt |
| --- | --- | --- |
| Node 22.x docs | SQLite | Node.js v22.23.5 Documentation: Stability 1.1 - Active development | History Version Changes v22.13.0 SQLite is no longer behind --experimental-sqlite but still experimental. v22.5.0 Added in: v22.5.0 Stability: 1.1 - Active development. Source Code: lib/sqlite.js The node:sqlite module facilitates working with SQLite databases. To access it: import sqlite from 'node:sqlite' ; const sqlite = require ( 'node:sqlite' ); copy This module is only available under the no |
| Node 24.x docs | SQLite | Node.js v24.22.3 Documentation: Stability 1.2 - Release candidate | History Version Changes v24.15.0 SQLite is now a release candidate. v23.4.0, v22.13.0 SQLite is no longer behind --experimental-sqlite but still experimental. v22.5.0 Added in: v22.5.0 Stability: 1.2 - Release candidate. Source Code: lib/sqlite.js The node:sqlite module facilitates working with SQLite databases. To access it: import sqlite from 'node:sqlite' ; const sqlite = require ( 'node:sqlite |
| Node 26.x docs | SQLite | Node.js v26.13.1 Documentation: Stability 1.2 - Release candidate | History Version Changes v25.7.0 SQLite is now a release candidate. v23.4.0, v22.13.0 SQLite is no longer behind --experimental-sqlite but still experimental. Stability: 1.2 - Release candidate. The node:sqlite module facilitates working with SQLite databases. To access it: import sqlite from 'node:sqlite' ; const sq |

| release run | result | warning |
| --- | --- | --- |
| 22.12.0 (v22.12.0) no flag | does not load: ERR_UNKNOWN_BUILTIN_MODULE | no warning on stderr |
| 22.12.0 (v22.12.0) --experimental-sqlite | loads (SQLite 3.47.0) | ExperimentalWarning: SQLite is an experimental feature and might change at any time |
| 22.13.0 (v22.13.0) no flag | loads (SQLite 3.47.2) | ExperimentalWarning: SQLite is an experimental feature and might change at any time |
| 22 (newest) (v22.23.5) no flag | loads (SQLite 3.54.1) | ExperimentalWarning: SQLite is an experimental feature and might change at any time |
| 24 (newest) (v24.22.3) no flag | loads (SQLite 3.54.1) | no warning on stderr |
| 26 (newest) (v26.13.1) no flag | loads (SQLite 3.54.1) | no warning on stderr |
<!-- /GEN:stability -->

### Status of every row, per binding (a runtime list appears where runtimes differ)

<!-- GEN:status -->
| area | capability row | bun:sqlite | node:sqlite | better-sqlite3 |
| --- | --- | --- | --- | --- |
| Open modes and pragmas | open.constructor_options | works | works | works |
| Open modes and pragmas | open.memory | works | works | works |
| Open modes and pragmas | open.must_exist_option | works | absent | works |
| Open modes and pragmas | open.readonly_rejects_write | works | works | works |
| Open modes and pragmas | open.uri_filename | absent | works | absent |
| Open modes and pragmas | pragma.busy_timeout_constructor_option | absent | works | works |
| Open modes and pragmas | pragma.defaults_on_fresh_file_handle | works | works | works |
| Open modes and pragmas | pragma.set_via_sql_and_read_back | works | works | works |
| WAL and checkpoint | wal.checkpoint_control | works | works | works |
| WAL and checkpoint | wal.reader_sees_commit_and_snapshot | works | works | works |
| busy_timeout and BEGIN IMMEDIATE | busy.deferred_read_to_write_upgrade | works | works | works |
| busy_timeout and BEGIN IMMEDIATE | busy.immediate_avoids_upgrade_failure | works | works | works |
| busy_timeout and BEGIN IMMEDIATE | busy.immediate_blocks_second_writer | works | works | works |
| busy_timeout and BEGIN IMMEDIATE | busy.timeout_bounds_wait | works | works | works |
| Error classification | errors.classification | works | works | partial |
| Transactions and savepoints | tx.modes_and_flag | works | works | works |
| Transactions and savepoints | tx.nested_savepoints | works | works | works |
| Transactions and savepoints | tx.transaction_helper | works | absent | works |
| Statement lifecycle and close | stmt.cache | works | absent (node22); works (node24, node26, bun) | absent |
| Statement lifecycle and close | stmt.close_semantics | works | works | works |
| Statement lifecycle and close | stmt.finalize_api | works | absent (node22, bun); works (node24, node26) | absent |
| Statement lifecycle and close | stmt.reuse_after_early_break | works | works | works |
| Statement lifecycle and close | stmt.use_while_iterator_open | works | works | works |
| Iteration and early termination | iter.abandoned_iterator_holds_until_db_close | works | works | works |
| Iteration and early termination | iter.early_termination_and_return | works | works | works |
| Iteration and early termination | iter.open_iterator_holds_read_snapshot_and_blocks_checkpoint | works | works | works |
| Iteration and early termination | iter.rollback_journal_iterator_blocks_writer | works | works | works |
| Iteration and early termination | iter.streams_row_by_row | works | works | works |
| Custom functions, aggregates, collations | fn.aggregate | works | works | works |
| Custom functions, aggregates, collations | fn.collation | absent | absent | absent |
| Custom functions, aggregates, collations | fn.scalar | works | works | works |
| Custom functions, aggregates, collations | fn.virtual_tables_and_other_hooks | works | works | works |
| Extension loading | ext.loading | works | works | works |
| Backup | backup.online_backup_api | absent | works | works |
| Backup | backup.serialize_deserialize | works | absent (node22); works (node24, node26, bun) | works |
| Backup | backup.vacuum_into | works | works | works |
| Change capture | change.authorizer | absent | absent (node22); present-not-exercised (node24, node26, bun) | absent |
| Change capture | change.session_extension | absent | works | absent |
| Change capture | change.update_hooks | works | absent | absent |
| Declared-type and column metadata | meta.declared_types | works | works | works |
| Declared-type and column metadata | meta.strict_tables | works | works | works |
<!-- /GEN:status -->

### Observed values (reference runtime: Bun for `bun:sqlite`, Node 24 for the other two)

<!-- GEN:values -->
| area | observed | bun:sqlite (bun) | node:sqlite (node24) | better-sqlite3 (node24) |
| --- | --- | --- | --- | --- |
| Open | read-only handle: write rejected with | SQLITE_READONLY errno=8 | ERR_SQLITE_ERROR errcode=8 | SQLITE_READONLY |
| Open | must-exist-style open option | works (missing file: SQLITE_CANTOPEN errno=14) | absent | works (missing file: SQLITE_CANTOPEN) |
| Open | file: URI filenames | not interpreted | honoured (mode=ro enforced) | not interpreted |
| Pragmas | defaults on a fresh file handle: foreign_keys / busy_timeout / cache_size | 0 / 0 / -2000 | 1 / 0 / -2000 | 1 / 5000 / -16000 |
| Pragmas | busy timeout as a constructor option | absent (PRAGMA busy_timeout) | works | works |
| WAL | journal_mode=WAL via PRAGMA | wal | wal | wal |
| WAL | reader sees a commit / keeps its snapshot inside BEGIN | 10->11 / 11->11 | 10->11 / 11->11 | 10->11 / 11->11 |
| WAL | wal_checkpoint(TRUNCATE) row | busy=0 log=0 checkpointed=0 | busy=0 log=0 checkpointed=0 | busy=0 log=0 checkpointed=0 |
| Busy | BEGIN IMMEDIATE against a held write lock: timeout 0 / 300 ms | 0 ms SQLITE_BUSY errno=5 / 302 ms | 0 ms ERR_SQLITE_ERROR errcode=5 / 302 ms | 0 ms SQLITE_BUSY / 301 ms |
| Busy | wait never ends before the timeout (50/200/600 ms rows) | yes: 50.7 / 201.3 / 602.1 ms | yes: 50.9 / 201.6 / 602.4 ms | yes: 50.8 / 201.6 / 602.2 ms |
| Busy | deferred read-then-write after another commit (timeout 500 ms) | 0 ms, SQLITE_BUSY_SNAPSHOT errno=517 | 0 ms, ERR_SQLITE_ERROR errcode=517 | 0 ms, SQLITE_BUSY_SNAPSHOT |
| Busy | BEGIN IMMEDIATE first: own write and commit succeed, other writer blocked | true, true | true, true | true, true |
| Errors | property carrying the SQLite code | code, errno | code, errcode, errstr | code |
| Errors | SQLITE_BUSY reachable / SQLITE_LOCKED reachable as a code | true / true | true / true | true / false (This database connection is busy executing a query) |
| Errors | busy and locked told apart by that property | true | true | false |
| Errors | extended code kept (BUSY_SNAPSHOT / UNIQUE) | SQLITE_BUSY_SNAPSHOT errno=517 / SQLITE_CONSTRAINT_UNIQUE errno=2067 | ERR_SQLITE_ERROR errcode=517 / ERR_SQLITE_ERROR errcode=2067 | SQLITE_BUSY_SNAPSHOT / SQLITE_CONSTRAINT_UNIQUE |
| Transactions | transaction() helper | present: nested helper calls use savepoints ([1,2,10,20]) | absent | present: nested helper calls use savepoints ([1,2,10,20]) |
| Transactions | in-transaction flag; BEGIN inside BEGIN | inTransaction; SQLITE_ERROR errno=1 | isTransaction; ERR_SQLITE_ERROR errcode=1 | inTransaction; SQLITE_ERROR |
| Transactions | raw SAVEPOINT / ROLLBACK TO / RELEASE nesting | [1,2] (expected [1,2]) | [1,2] (expected [1,2]) | [1,2] (expected [1,2]) |
| Statements | statement finalize/close method | finalize | close | absent |
| Statements | db close with an open iterator | returns; WAL files removed: false | returns; WAL files removed: true | throws TypeError: This database connection is busy executing a query |
| Statements | db close with idle prepared statements: really closed? | WAL files removed: false; old statement afterwards: still runs | WAL files removed: true; old statement afterwards: statement has been finalized | WAL files removed: true; old statement afterwards: The database connection is not open |
| Statements | bun close(true) with live statements | WAL files removed: true | n/a | n/a |
| Statements | statement reused after an early break | all() after break: 3 rows | all() after break: 3 rows | all() after break: 3 rows |
| Statements | same statement used while its iterator is open | allowed (3 rows) | allowed (3 rows) | This statement is busy executing a query |
| Statements | built-in statement cache | db.query(sql) cache | createTagStore (LRU) | absent |
| Iteration | iterator has return() (for-of break releases it) | true | true | true |
| Iteration | open iterator: sees writer commit / checkpoint busy / WAL bytes | sees 1000 of 1001; busy=1; 32992 B | sees 1000 of 1001; busy=1; 32992 B | sees 1000 of 1001; busy=1; 32992 B |
| Iteration | after return(): reader sees commit / checkpoint busy / WAL bytes | sees 1001; busy=0; 0 B | sees 1001; busy=0; 0 B | sees 1001; busy=0; 0 B |
| Iteration | rollback-journal db: write while iterator open | SQLITE_BUSY errno=5; after return: ok | ERR_SQLITE_ERROR errcode=5; after return: ok | SQLITE_BUSY; after return: ok |
| Iteration | steps row by row (first row then break vs all(), 300k rows) | 0.001 ms vs 31 ms | 0.003 ms vs 92.5 ms | 0.009 ms vs 54.1 ms |
| Functions | scalar / aggregate | works / works | works / works | works / works |
| Functions | integer 2^53+1 as a JS argument | number (silent rounding) | throws ERR_OUT_OF_RANGE | number (silent rounding) |
| Functions | collation API | absent | absent | absent |
| Functions | virtual-table / authorizer / limits / defensive | no table API / undefined / undefined / undefined | no table API / function / object / function | table / undefined / undefined / undefined |
| Extensions | loadExtension API; SQL load_extension() by default | function; not authorized | function + enableLoadExtension; not authorized | function; not authorized |
| Extensions | loadExtension() without any opt-in (real .so built from scripts/fixtures/ext.c) | LOADS and runs (okfs08_answer() = 42) | refused: extension loading is not allowed; with allowExtension: loads, answer 42 | LOADS and runs (okfs08_answer() = 42) |
| Backup | online backup API | absent | backup(db, path) (copy has 50 rows) | db.backup(dest) (copy has 50 rows) |
| Backup | serialize then deserialize: memory db / file db (rollback journal) / file db in WAL | 3 rows back / 3 rows back / serialize ok, deserialize fails: unable to open database file | 3 rows back / 3 rows back / serialize ok, deserialize fails: unable to open database file | 3 rows back / 3 rows back / serialize ok, deserialize fails: unable to open database file |
| Backup | VACUUM INTO | works (50/50 rows) | works (50/50 rows) | works (50/50 rows) |
| Change capture | update hooks | assignable property taking (db, table, rowid, schema); events onInsert,onUpdate,onDelete | absent | absent |
| Change capture | session extension / changeset | absent | works: 26 B changeset, applied: true | absent |
| Metadata | declared type of columns a, b, c(NUMERIC(10,2)), d, e, f(no type), g, h, a+1, count(*) | ["BIGINT","INTEGER","NUMERIC(10,2)","UNSIGNED BIG INT","VARCHAR(255)",null,"custom_type","REAL",null,null] before stepping (declaredTypes) | ["BIGINT","INTEGER","NUMERIC(10,2)","UNSIGNED BIG INT","VARCHAR(255)",null,"custom_type","REAL",null,null] (columns()) | ["BIGINT","INTEGER","NUMERIC(10,2)","UNSIGNED BIG INT","VARCHAR(255)",null,"custom_type","REAL",null,null] (columns()) |
| Metadata | declared type through a view / a subquery (column a BIGINT) | ["BIGINT",null] / ["BIGINT"] | ["BIGINT",null] / ["BIGINT"] | ["BIGINT",null] / ["BIGINT"] |
| Metadata | STRICT: BIGINT column; text into INTEGER | unknown datatype for s2.a: "BIGINT"; cannot store TEXT value in INTEGER column s.a | unknown datatype for s2.a: "BIGINT"; cannot store TEXT value in INTEGER column s.a | unknown datatype for s2.a: "BIGINT"; cannot store TEXT value in INTEGER column s.a |
<!-- /GEN:values -->

### Compile options and defaults

<!-- GEN:compile -->
Compile options counted: bun:sqlite 51, node:sqlite 51, better-sqlite3 60. Rows: a fixed list of options that matter here, plus every option that differs between bindings.

| PRAGMA compile_options entry | bun:sqlite | node:sqlite | better-sqlite3 |
| --- | --- | --- | --- |
| ENABLE_COLUMN_METADATA | yes | yes | yes |
| ENABLE_SESSION | yes | yes | - |
| ENABLE_PREUPDATE_HOOK | yes | yes | - |
| ENABLE_DESERIALIZE | - | - | - |
| ENABLE_FTS5 | yes | yes | yes |
| ENABLE_DBPAGE_VTAB | - | - | - |
| OMIT_LOAD_EXTENSION | - | - | - |
| OMIT_SHARED_CACHE | - | - | yes |
| DEFAULT_FOREIGN_KEYS=1 | - | - | - |
| DQS=0 | - | - | yes |
| THREADSAFE=2 | - | - | yes |
| THREADSAFE=1 | yes | yes | - |
| ENABLE_MATH_FUNCTIONS | yes | yes | yes |
| ENABLE_RTREE | yes | yes | yes |
| ENABLE_JSON1 | - | - | - |
| ENABLE_DBSTAT_VTAB | yes | yes | yes |
| COMPILER=clang-23.1.1 | yes | - | - |
| COMPILER=gcc-11.4.0 | - | - | yes |
| COMPILER=gcc-12.2.1 20221121 (Red Hat 12.2.1-7) | - | yes | - |
| DEFAULT_CACHE_SIZE=-16000 | - | - | yes |
| DEFAULT_CACHE_SIZE=-2000 | yes | yes | - |
| DEFAULT_FOREIGN_KEYS | - | - | yes |
| DEFAULT_MEMSTATUS=0 | - | yes | yes |
| DEFAULT_WAL_SYNCHRONOUS=1 | - | - | yes |
| DEFAULT_WAL_SYNCHRONOUS=2 | yes | yes | - |
| ENABLE_FTS4 | - | - | yes |
| ENABLE_RBU | yes | yes | - |
| ENABLE_STAT4 | - | - | yes |
| ENABLE_UPDATE_DELETE_LIMIT | yes | - | yes |
| LIKE_DOESNT_MATCH_BLOBS | - | - | yes |
| MAX_VARIABLE_NUMBER=250000 | yes | - | - |
| MAX_VARIABLE_NUMBER=32766 | - | yes | yes |
| OMIT_DEPRECATED | - | - | yes |
| OMIT_PROGRESS_CALLBACK | - | - | yes |
| OMIT_TCL_VARIABLE | - | - | yes |
| SOUNDEX | - | - | yes |
| USE_URI | - | - | yes |
<!-- /GEN:compile -->

## 2. Integer-width rule

### The rule

For every integer cell of a result:

1. **Read losslessly.** Put the statement in the binding's lossless integer mode (`safeIntegers(true)` on
   `better-sqlite3` and `bun:sqlite`, `setReadBigInts(true)` on `node:sqlite`). Every integer cell then arrives as
   a bigint.
2. **Take the declared type** of the result column from statement metadata (`stmt.declaredTypes` on `bun:sqlite`,
   `stmt.columns()[i].type` on the other two; available before stepping). It is `null` for an expression, an
   aggregate and a literal.
3. **A column is 64-bit** if its declared type, upper-cased, without a parenthesised size and with spaces
   collapsed, is `BIGINT`, `INT8` or `UNSIGNED BIG INT`.
4. **64-bit column: bigint**, for every integer cell, small or large.
5. **Any other column, including no declared type: number** when the value is within -(2^53-1) to 2^53-1,
   **otherwise a data error**, raised when that cell is decoded and carrying the column name and the exact decimal
   text of the value (which the lossless read in step 1 provides). Never rounded.
6. **Cells that are not integers are not touched by the rule**: REAL gives a number, TEXT a string, BLOB bytes,
   NULL null, whatever the declared type. A `BIGINT` column holding `'abc'` gives a string; one holding `1.5` gives
   a number.

Untyped expression columns therefore behave like `INTEGER`: `count(*)` and small results give numbers, anything
above 2^53-1 gives the data error, including `max(x)` over a `BIGINT` column. SQLite itself changes some results to
REAL on overflow (`x + 1` at 2^63-1) or refuses them (`abs(-2^63)`, an overflowing `sum`); those are followed, not
second-guessed.

### How it was checked

`scripts/integers-truth.py` builds a database with literal SQL and reads every case through CPython's `sqlite3`
(exact integers) and through `typeof()` and `CAST(x AS TEXT)`; the two must agree. 64 cases: 17 stored values
(0, 1, -1, the 32-bit edges, 2^53-1, 2^53, 2^53+1, 2^53+2, the negatives, 2^63-1, -2^63) in `INT`, `INTEGER`,
`BIGINT`, `INT8`, `UNSIGNED BIG INT`, `SMALLINT`, `NUMERIC`, `DECIMAL(20,0)`, `REAL` and untyped columns, STRICT
`INT`, `INTEGER`, `REAL` and `ANY`; expressions (`x+0`, `x+1`, `x*1`, `abs`, negation, `coalesce`, `CAST`, `sum`,
`max`, `total`, `count`, literals) over `BIGINT`, `INTEGER` and untyped columns; plan shapes (subquery, view, CTE,
UNION in both orders, join); a rowid alias; three mixed-storage columns. `scripts/probe-integers.mjs` reads each
cell through each binding in default mode and in lossless mode, applies the rule to the lossless read and compares
with what the rule says the truth must decode to. The declared types the bindings report are checked against the
schema for 58 asserted columns. Two deliberately wrong rules (always number, always bigint) disagree with the
oracle in 446 and 678 cells, so the check is not vacuous.

<!-- GEN:intSummary -->
| binding | runtime | result sets checked | rule holds / fails | declared types as expected | default mode vs truth | lossless mode vs truth | negative controls that differ (always-number / always-bigint) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| bun:sqlite | bun | 933 | 882 / 0 | 58 / 58 | exact 569, exact-unsafe 197, rounded 163 | exact 929 | 446 / 678 |
| node:sqlite | node22 | 933 | 882 / 0 | 58 / 58 | exact 567, error 318, exact-unsafe 44 | exact 929 | 446 / 678 |
| node:sqlite | node24 | 933 | 882 / 0 | 58 / 58 | exact 567, error 318, exact-unsafe 44 | exact 929 | 446 / 678 |
| node:sqlite | node26 | 933 | 882 / 0 | 58 / 58 | exact 567, error 362 | exact 929 | 446 / 678 |
| node:sqlite | bun | 933 | 882 / 0 | 58 / 58 | exact 567, error 362 | exact 929 | 446 / 678 |
| better-sqlite3 | node22 | 933 | 882 / 0 | 58 / 58 | exact 569, exact-unsafe 197, rounded 163 | exact 929 | 446 / 678 |
| better-sqlite3 | node24 | 933 | 882 / 0 | 58 / 58 | exact 569, exact-unsafe 197, rounded 163 | exact 929 | 446 / 678 |
| better-sqlite3 | node26 | 933 | 882 / 0 | 58 / 58 | exact 569, exact-unsafe 197, rounded 163 | exact 929 | 446 / 678 |
| better-sqlite3 | bun | 933 | 882 / 0 | 58 / 58 | exact 569, exact-unsafe 197, rounded 163 | exact 929 | 446 / 678 |
<!-- /GEN:intSummary -->

Result: the rule holds in every checked result set on all three bindings on every runtime that loads them, and the
declared types match. No binding fails the rule. The lossless mode is what makes this possible; none of the
default modes can be used:

- `better-sqlite3` and `bun:sqlite` in default mode read 2^53+1 as 2^53 and 2^63-1 as 9223372036854776000, silently.
- `node:sqlite` in default mode throws `ERR_OUT_OF_RANGE` for values it cannot represent, but at -2^63 it returns the
  number -9223372036854776000 on Node 22 and 24 (and throws on Node 26 and on Bun), and its error does not name the
  column. The rule gets the same result everywhere from the lossless read.

### Boundary table (INTEGER and BIGINT columns, non-STRICT)

<!-- GEN:boundary -->
| stored value (INTEGER or BIGINT column) | default read, bun:sqlite (bun) | default read, node:sqlite (node24) | default read, better-sqlite3 (node24) | rule, INTEGER column | rule, BIGINT column |
| --- | --- | --- | --- | --- | --- |
| 0 | 0 | 0 | 0 | number 0 | bigint 0 |
| 1 | 1 | 1 | 1 | number 1 | bigint 1 |
| -1 | -1 | -1 | -1 | number -1 | bigint -1 |
| 2147483647 | 2147483647 | 2147483647 | 2147483647 | number 2147483647 | bigint 2147483647 |
| 2147483648 | 2147483648 | 2147483648 | 2147483648 | number 2147483648 | bigint 2147483648 |
| -2147483648 | -2147483648 | -2147483648 | -2147483648 | number -2147483648 | bigint -2147483648 |
| -2147483649 | -2147483649 | -2147483649 | -2147483649 | number -2147483649 | bigint -2147483649 |
| 9007199254740991 | 9007199254740991 | 9007199254740991 | 9007199254740991 | number 9007199254740991 | bigint 9007199254740991 |
| 9007199254740992 | 9007199254740992 (exact, not safe) | throws ERR_OUT_OF_RANGE | 9007199254740992 (exact, not safe) | DataError | bigint 9007199254740992 |
| 9007199254740993 | 9007199254740992 (ROUNDED) | throws ERR_OUT_OF_RANGE | 9007199254740992 (ROUNDED) | DataError | bigint 9007199254740993 |
| 9007199254740994 | 9007199254740994 (exact, not safe) | throws ERR_OUT_OF_RANGE | 9007199254740994 (exact, not safe) | DataError | bigint 9007199254740994 |
| -9007199254740991 | -9007199254740991 | -9007199254740991 | -9007199254740991 | number -9007199254740991 | bigint -9007199254740991 |
| -9007199254740992 | -9007199254740992 (exact, not safe) | throws ERR_OUT_OF_RANGE | -9007199254740992 (exact, not safe) | DataError | bigint -9007199254740992 |
| -9007199254740993 | -9007199254740992 (ROUNDED) | throws ERR_OUT_OF_RANGE | -9007199254740992 (ROUNDED) | DataError | bigint -9007199254740993 |
| 9223372036854775807 | 9223372036854776000 (ROUNDED) | throws ERR_OUT_OF_RANGE | 9223372036854776000 (ROUNDED) | DataError | bigint 9223372036854775807 |
| -9223372036854775808 | -9223372036854776000 (exact, not safe) | -9223372036854776000 (exact, not safe) | -9223372036854776000 (exact, not safe) | DataError | bigint -9223372036854775808 |
<!-- /GEN:boundary -->

Every case (column types, STRICT, expressions, plan shapes, mixed storage), with what the rule gives, is in
`results/tables.md` under `intCases`. Highlights from it:

- **STRICT.** `BIGINT` is not a STRICT type. A STRICT 64-bit column is `INT` or `INTEGER`, which the rule decodes as
  number with the data error. `ANY` behaves the same. So a STRICT table cannot signal "64-bit" through its declared
  type.
- **Plan shape.** A subquery, a view and a CTE keep the declared type of a direct column reference. A UNION takes
  its first branch's type: `BIGINT` first gives bigint for both branches, `INTEGER` first gives the data error for a
  value that came from the `BIGINT` branch. A join keeps each side's type.
- **Mixed storage.** In a non-STRICT `BIGINT` column, `5` and `'12'` become integers (affinity), `'abc'` stays text,
  `1.5` stays real: the rule decodes each cell by its storage class.

### Bind side (what a parameter does), both modes

<!-- GEN:bind -->
| bound value | bun:sqlite, default mode | bun:sqlite, lossless mode | node:sqlite, default mode | node:sqlite, lossless mode | better-sqlite3, default mode | better-sqlite3, lossless mode |
| --- | --- | --- | --- | --- | --- | --- |
| number 3 | integer | integer | real | real | real | real |
| number 2147483648 | integer | integer | real | real | real | real |
| number 1099511627776 | integer | integer | real | real | real | real |
| number 9007199254740991 | integer | integer | real | real | real | real |
| number 9007199254740992 | real | real | real | real | real | real |
| number 1.5 | real | real | real | real | real | real |
| number 0 | real | real | real | real | real | real |
| bigint 3 | integer | integer | integer | integer | integer | integer |
| bigint 9007199254740993 | integer | integer | integer | integer | integer | integer |
| bigint 9223372036854775807 | integer | integer | integer | integer | integer | integer |
| bigint -9223372036854775808 | integer | integer | integer | integer | integer | integer |
| bigint 9223372036854775808 | integer, stored as -9223372036854775808 (WRAPPED) | throws RangeError | throws TypeError ERR_INVALID_ARG_VALUE | throws TypeError ERR_INVALID_ARG_VALUE | throws RangeError | throws RangeError |
| bigint -9223372036854775809 | integer, stored as 9223372036854775807 (WRAPPED) | throws RangeError | throws TypeError ERR_INVALID_ARG_VALUE | throws TypeError ERR_INVALID_ARG_VALUE | throws RangeError | throws RangeError |
| bigint 18446744073709551616 | integer, stored as 0 (WRAPPED) | throws RangeError | throws TypeError ERR_INVALID_ARG_VALUE | throws TypeError ERR_INVALID_ARG_VALUE | throws RangeError | throws RangeError |
| bigint 18446744073709551621 | integer, stored as 5 (WRAPPED) | throws RangeError | throws TypeError ERR_INVALID_ARG_VALUE | throws TypeError ERR_INVALID_ARG_VALUE | throws RangeError | throws RangeError |
<!-- /GEN:bind -->

JavaScript numbers are bound as REAL by `node:sqlite` and `better-sqlite3` (an integral 3 becomes `3.0`, which an
INTEGER-affinity column converts back). `bun:sqlite` binds integral numbers up to 2^53-1 as integers. In default mode
`bun:sqlite` **wraps** a bigint outside int64 silently (2^64+5 is stored as 5); in lossless mode it throws, like the
other two. A user function receives 2^53+1 as the rounded number on `bun:sqlite` and `better-sqlite3`, throws on
`node:sqlite`, and gets a bigint with the `safeIntegers` function option on the first two.

### What the rule costs

The lossless read allocates a BigInt per integer cell and a narrowing pass converts it. From the overhead runs
(section 3): x1.06 to x1.27 on a point select, x1.16 to x2.03 on 100 rows and x1.23 to x2.00 on 10,000 rows
(median ratios over 21 runs across all binding and runtime pairs; Bun is at the high end, `node:sqlite` on Node at
the low end). The label in the overhead table follows the rule given for this task (a difference inside the
run-to-run spread is "no measurable overhead"); the spread of 21 runs is wide, so read the ratio next to it.

## 3. Overhead and worker

### Overhead over the raw binding (same process)

Variants: `raw` (the binding's own calls, number mode), `adapter` (the private probe adapter in
`scripts/lib/adapters.mjs`: argument spreading and one extra call frame), `adapter + rule` (section 2). Warm-up
runs are discarded, 21 measured runs are interleaved, median and min-max reported. A difference between medians
inside the larger run-to-run spread (max minus min) is "no measurable overhead". The thin adapter shows no
measurable overhead anywhere (median ratios 0.80 to 1.17). Allocations were not measured.

<!-- GEN:overhead -->
| binding / runtime | benchmark (median, min-max of 21 runs) | raw binding | thin adapter | adapter vs raw | adapter + integer rule | rule vs raw |
| --- | --- | --- | --- | --- | --- | --- |
| bun:sqlite / bun | point select by primary key | 1.28 us (1.16-1.59) | 1.31 us (1.21-1.64) | no measurable overhead (median x1.02) | 1.53 us (1.42-1.95) | no measurable overhead (median x1.19) |
| bun:sqlite / bun | select 100 rows | 0.024 ms (0.021-0.035) | 0.024 ms (0.019-0.036) | no measurable overhead (median x1.01) | 0.049 ms (0.040-0.063) | overhead (median x2.03) |
| bun:sqlite / bun | select 10,000 rows | 1.937 ms (1.617-2.612) | 2.203 ms (1.768-2.681) | no measurable overhead (median x1.14) | 3.875 ms (3.423-4.709) | overhead (median x2.00) |
| bun:sqlite / bun | insert 5,000 rows in one transaction | 0.63 us (0.56-1.28) | 0.51 us (0.43-0.90) | no measurable overhead (median x0.80) | n/a | n/a |
| node:sqlite / node22 | point select by primary key | 1.94 us (1.84-3.10) | 1.97 us (1.88-2.89) | no measurable overhead (median x1.02) | 2.06 us (2.00-3.56) | no measurable overhead (median x1.06) |
| node:sqlite / node22 | select 100 rows | 0.054 ms (0.051-0.083) | 0.054 ms (0.050-0.076) | no measurable overhead (median x1.00) | 0.064 ms (0.062-0.087) | no measurable overhead (median x1.21) |
| node:sqlite / node22 | select 10,000 rows | 5.428 ms (5.283-8.536) | 4.977 ms (4.744-8.036) | no measurable overhead (median x0.92) | 7.368 ms (6.601-11.481) | no measurable overhead (median x1.36) |
| node:sqlite / node22 | insert 5,000 rows in one transaction | 0.91 us (0.82-1.49) | 0.75 us (0.70-1.13) | no measurable overhead (median x0.83) | n/a | n/a |
| node:sqlite / node24 | point select by primary key | 1.95 us (1.90-2.66) | 1.95 us (1.89-2.18) | no measurable overhead (median x1.00) | 2.10 us (2.05-2.21) | no measurable overhead (median x1.08) |
| node:sqlite / node24 | select 100 rows | 0.055 ms (0.050-0.093) | 0.054 ms (0.049-0.097) | no measurable overhead (median x0.98) | 0.064 ms (0.062-0.097) | no measurable overhead (median x1.16) |
| node:sqlite / node24 | select 10,000 rows | 5.056 ms (4.544-5.546) | 5.128 ms (4.590-5.550) | no measurable overhead (median x1.01) | 6.441 ms (6.071-7.992) | no measurable overhead (median x1.27) |
| node:sqlite / node24 | insert 5,000 rows in one transaction | 0.66 us (0.61-1.16) | 0.55 us (0.51-0.74) | no measurable overhead (median x0.84) | n/a | n/a |
| node:sqlite / node26 | point select by primary key | 1.73 us (1.62-2.24) | 1.73 us (1.65-1.81) | no measurable overhead (median x1.00) | 1.87 us (1.77-2.44) | no measurable overhead (median x1.08) |
| node:sqlite / node26 | select 100 rows | 0.052 ms (0.048-0.107) | 0.049 ms (0.048-0.074) | no measurable overhead (median x0.94) | 0.061 ms (0.057-0.064) | no measurable overhead (median x1.17) |
| node:sqlite / node26 | select 10,000 rows | 5.104 ms (4.613-8.165) | 4.791 ms (4.597-8.262) | no measurable overhead (median x0.94) | 6.278 ms (5.912-10.658) | no measurable overhead (median x1.23) |
| node:sqlite / node26 | insert 5,000 rows in one transaction | 0.69 us (0.64-1.29) | 0.55 us (0.53-0.77) | no measurable overhead (median x0.80) | n/a | n/a |
| node:sqlite / bun | point select by primary key | 1.33 us (1.21-1.79) | 1.47 us (1.29-1.97) | no measurable overhead (median x1.10) | 1.69 us (1.59-2.27) | no measurable overhead (median x1.27) |
| node:sqlite / bun | select 100 rows | 0.024 ms (0.021-0.031) | 0.025 ms (0.021-0.035) | no measurable overhead (median x1.04) | 0.045 ms (0.041-0.049) | overhead (median x1.92) |
| node:sqlite / bun | select 10,000 rows | 2.228 ms (1.845-2.607) | 2.332 ms (1.860-3.061) | no measurable overhead (median x1.05) | 4.306 ms (3.706-5.106) | overhead (median x1.93) |
| node:sqlite / bun | insert 5,000 rows in one transaction | 0.83 us (0.69-1.45) | 0.73 us (0.50-1.16) | no measurable overhead (median x0.88) | n/a | n/a |
| better-sqlite3 / node22 | point select by primary key | 1.59 us (1.51-2.64) | 1.58 us (1.51-5.70) | no measurable overhead (median x0.99) | 1.77 us (1.68-2.85) | no measurable overhead (median x1.11) |
| better-sqlite3 / node22 | select 100 rows | 0.032 ms (0.030-0.052) | 0.032 ms (0.030-0.042) | no measurable overhead (median x1.01) | 0.046 ms (0.043-0.060) | no measurable overhead (median x1.47) |
| better-sqlite3 / node22 | select 10,000 rows | 3.060 ms (2.859-4.247) | 3.175 ms (2.971-3.829) | no measurable overhead (median x1.04) | 4.435 ms (4.138-5.128) | no measurable overhead (median x1.45) |
| better-sqlite3 / node22 | insert 5,000 rows in one transaction | 0.90 us (0.86-3.39) | 0.90 us (0.86-2.08) | no measurable overhead (median x1.00) | n/a | n/a |
| better-sqlite3 / node24 | point select by primary key | 1.48 us (1.41-1.55) | 1.47 us (1.40-1.53) | no measurable overhead (median x0.99) | 1.66 us (1.56-1.71) | overhead (median x1.12) |
| better-sqlite3 / node24 | select 100 rows | 0.030 ms (0.029-0.033) | 0.030 ms (0.029-0.032) | no measurable overhead (median x1.00) | 0.044 ms (0.042-0.047) | overhead (median x1.45) |
| better-sqlite3 / node24 | select 10,000 rows | 3.164 ms (2.883-3.670) | 3.175 ms (2.873-3.463) | no measurable overhead (median x1.00) | 4.477 ms (4.127-5.469) | no measurable overhead (median x1.41) |
| better-sqlite3 / node24 | insert 5,000 rows in one transaction | 0.81 us (0.78-2.50) | 0.82 us (0.79-1.84) | no measurable overhead (median x1.01) | n/a | n/a |
| better-sqlite3 / node26 | point select by primary key | 1.55 us (1.50-2.57) | 1.59 us (1.49-2.81) | no measurable overhead (median x1.02) | 1.77 us (1.64-2.74) | no measurable overhead (median x1.14) |
| better-sqlite3 / node26 | select 100 rows | 0.030 ms (0.029-0.032) | 0.030 ms (0.029-0.033) | no measurable overhead (median x1.00) | 0.042 ms (0.041-0.044) | overhead (median x1.41) |
| better-sqlite3 / node26 | select 10,000 rows | 3.306 ms (2.997-4.474) | 3.345 ms (2.992-5.478) | no measurable overhead (median x1.01) | 4.484 ms (4.026-7.284) | no measurable overhead (median x1.36) |
| better-sqlite3 / node26 | insert 5,000 rows in one transaction | 1.09 us (0.85-3.56) | 1.19 us (0.84-2.85) | no measurable overhead (median x1.09) | n/a | n/a |
| better-sqlite3 / bun | point select by primary key | 1.65 us (1.53-2.16) | 1.81 us (1.70-2.62) | no measurable overhead (median x1.10) | 2.03 us (1.91-3.34) | no measurable overhead (median x1.23) |
| better-sqlite3 / bun | select 100 rows | 0.037 ms (0.033-0.055) | 0.039 ms (0.033-0.058) | no measurable overhead (median x1.06) | 0.062 ms (0.056-0.088) | no measurable overhead (median x1.68) |
| better-sqlite3 / bun | select 10,000 rows | 4.073 ms (3.198-6.185) | 3.453 ms (3.243-5.045) | no measurable overhead (median x0.85) | 6.064 ms (5.462-9.468) | no measurable overhead (median x1.49) |
| better-sqlite3 / bun | insert 5,000 rows in one transaction | 1.03 us (0.84-2.89) | 1.21 us (0.89-2.73) | no measurable overhead (median x1.17) | n/a | n/a |
<!-- /GEN:overhead -->

### Worker execution: method and criteria

File database in WAL; one read-only connection per worker; the main thread keeps its own connection (the writer).
Node uses `worker_threads`, Bun the web `Worker`. Three paths per request: in-thread; worker returning rows by
**structured clone** (`clone`); worker returning **one packed ArrayBuffer, transferred** (`scripts/lib/pack.mjs`),
measured both as views only (`packed-lazy`) and with plain row objects rebuilt on the main thread
(`packed-decode`, what a row-object consumer pays). All paths return the same rows (checked before each run and
recorded as `verify` in the JSON). Tables: `narrow(id, v)` and an 18-column `wide` row, 100,000 rows each.
Latency is end to end. Main-thread blocking is measured by a timer-lag sampler (re-armed `setTimeout(1)`; a
synchronous block of B ms is one gap of about B ms): the table shows the **longest block** per request, and the
JSON also has timer-lag p99 and max and blocked time per request.

**Criteria, fixed in the header of `scripts/bench-worker.mjs` before any run and not changed afterwards:**

- the spread of a path in a cell is max minus min over its runs;
- *latency win*: worker median latency below in-thread median by more than the larger spread;
- *blocking win*: worker median longest block below in-thread's by more than the larger spread;
- the worker is **adopted** from the smallest cell (by result rows, or by query time) from which **both** wins hold
  in that cell and in every larger cell of the sweep; otherwise "no threshold found";
- blocking-only wins are reported separately, as a different statement.

The roadmap gives no number, so these criteria are this task's reading of "adopted only above a measured
result-size or query-time threshold"; they are listed under decisions beyond the brief.

### Thresholds

<!-- GEN:workerThreshold -->
| binding / runtime | sweep | threshold: worker wins latency AND blocking from here up | blocking-only win from here up (latency not won) |
| --- | --- | --- | --- |
| bun:sqlite / bun | result size, narrow rows, clone | no threshold found | none |
| bun:sqlite / bun | result size, narrow rows, packed-lazy | no threshold found | 100000 rows |
| bun:sqlite / bun | result size, narrow rows, packed-decode | no threshold found | 100000 rows |
| bun:sqlite / bun | result size, wide rows, clone | no threshold found | none |
| bun:sqlite / bun | result size, wide rows, packed-lazy | no threshold found | 10000 rows |
| bun:sqlite / bun | result size, wide rows, packed-decode | no threshold found | 10000 rows |
| bun:sqlite / bun | query time (tiny result), clone | no threshold found | 10 ms |
| node:sqlite / node22 | result size, narrow rows, clone | no threshold found | none |
| node:sqlite / node22 | result size, narrow rows, packed-lazy | no threshold found | 10000 rows |
| node:sqlite / node22 | result size, narrow rows, packed-decode | no threshold found | 10000 rows |
| node:sqlite / node22 | result size, wide rows, clone | no threshold found | 100000 rows |
| node:sqlite / node22 | result size, wide rows, packed-lazy | no threshold found | 10000 rows |
| node:sqlite / node22 | result size, wide rows, packed-decode | no threshold found | 10000 rows |
| node:sqlite / node22 | query time (tiny result), clone | no threshold found | 1 ms |
| node:sqlite / node24 | result size, narrow rows, clone | no threshold found | none |
| node:sqlite / node24 | result size, narrow rows, packed-lazy | no threshold found | 10000 rows |
| node:sqlite / node24 | result size, narrow rows, packed-decode | no threshold found | 10000 rows |
| node:sqlite / node24 | result size, wide rows, clone | no threshold found | none |
| node:sqlite / node24 | result size, wide rows, packed-lazy | no threshold found | 1000 rows |
| node:sqlite / node24 | result size, wide rows, packed-decode | no threshold found | 1000 rows |
| node:sqlite / node24 | query time (tiny result), clone | no threshold found | 10 ms |
| node:sqlite / node26 | result size, narrow rows, clone | no threshold found | none |
| node:sqlite / node26 | result size, narrow rows, packed-lazy | no threshold found | 10000 rows |
| node:sqlite / node26 | result size, narrow rows, packed-decode | no threshold found | 10000 rows |
| node:sqlite / node26 | result size, wide rows, clone | no threshold found | 100000 rows |
| node:sqlite / node26 | result size, wide rows, packed-lazy | no threshold found | 10000 rows |
| node:sqlite / node26 | result size, wide rows, packed-decode | no threshold found | 10000 rows |
| node:sqlite / node26 | query time (tiny result), clone | no threshold found | 10 ms |
| better-sqlite3 / node24 | result size, narrow rows, clone | no threshold found | none |
| better-sqlite3 / node24 | result size, narrow rows, packed-lazy | no threshold found | 10000 rows |
| better-sqlite3 / node24 | result size, narrow rows, packed-decode | no threshold found | 10000 rows |
| better-sqlite3 / node24 | result size, wide rows, clone | no threshold found | none |
| better-sqlite3 / node24 | result size, wide rows, packed-lazy | no threshold found | 10000 rows |
| better-sqlite3 / node24 | result size, wide rows, packed-decode | no threshold found | 100000 rows |
| better-sqlite3 / node24 | query time (tiny result), clone | no threshold found | 10 ms |
| better-sqlite3 / bun | result size, narrow rows, clone | no threshold found | none |
| better-sqlite3 / bun | result size, narrow rows, packed-lazy | no threshold found | 100000 rows |
| better-sqlite3 / bun | result size, narrow rows, packed-decode | no threshold found | 100000 rows |
| better-sqlite3 / bun | result size, wide rows, clone | no threshold found | none |
| better-sqlite3 / bun | result size, wide rows, packed-lazy | no threshold found | 10000 rows |
| better-sqlite3 / bun | result size, wide rows, packed-decode | no threshold found | 100000 rows |
| better-sqlite3 / bun | query time (tiny result), clone | no threshold found | 10 ms |
<!-- /GEN:workerThreshold -->

Reading the table: under the both-wins criteria there is no threshold on any runtime, binding or transfer variant.
The right column is a separate observation: from that size or query time upward the worker keeps the main thread
free (blocking win) without winning latency.

### Result-size sweep (full matrix runs; all runs in `results/tables.md`)

<!-- GEN:workerSizeFull -->
**bun:sqlite on bun 1.4.5** (full matrix; cells are latency ms median (min-max) / longest main-thread block ms median; verdict from the pre-registered criteria)

| shape | result rows | in-thread | worker, clone | worker, packed (views only) | worker, packed (row objects rebuilt) |
| --- | --- | --- | --- | --- | --- |
| narrow | 1 | 0.032 (0.010-0.081) / 0.11 | 0.234 (0.158-0.332) / 0.12 (none) | 0.288 (0.247-0.549) / 0.10 (none) | 0.322 (0.150-0.441) / 0.11 (none) |
| narrow | 10 | 0.035 (0.018-0.123) / 0.13 | 0.290 (0.208-0.368) / 0.11 (none) | 0.304 (0.184-0.644) / 0.11 (none) | 0.313 (0.261-0.402) / 0.10 (none) |
| narrow | 100 | 0.047 (0.038-0.067) / 0.15 | 0.347 (0.216-0.646) / 0.14 (none) | 0.365 (0.273-0.494) / 0.15 (none) | 0.275 (0.208-0.337) / 0.12 (none) |
| narrow | 1000 | 0.107 (0.083-0.972) / 0.12 | 0.549 (0.462-1.544) / 0.14 (none) | 0.381 (0.272-1.934) / 0.14 (none) | 0.441 (0.393-1.207) / 0.13 (none) |
| narrow | 10000 | 0.917 (0.590-1.791) / 0.88 | 4.893 (3.368-7.159) / 0.97 (none) | 1.449 (0.995-2.504) / 0.12 (none) | 1.779 (1.307-3.854) / 0.20 (none) |
| narrow | 100000 | 8.337 (6.081-10.5) / 8.43 | 52.9 (41.4-61.5) / 13.0 (none) | 13.6 (11.3-16.5) / 0.40 (blocking-only) | 17.8 (11.3-23.8) / 1.94 (blocking-only) |
| wide | 1 | 0.033 (0.007-0.069) / 0.13 | 0.184 (0.149-0.277) / 0.12 (none) | 0.295 (0.209-1.136) / 0.14 (none) | 0.312 (0.191-0.396) / 0.13 (none) |
| wide | 10 | 0.068 (0.024-0.134) / 0.11 | 0.276 (0.195-0.775) / 0.11 (none) | 0.302 (0.254-0.386) / 0.11 (none) | 0.359 (0.248-0.465) / 0.10 (none) |
| wide | 100 | 0.200 (0.157-0.255) / 0.10 | 0.772 (0.616-3.034) / 0.15 (none) | 0.473 (0.423-0.834) / 0.14 (none) | 0.559 (0.422-2.907) / 0.14 (none) |
| wide | 1000 | 0.853 (0.612-3.034) / 0.68 | 6.086 (4.943-9.719) / 1.46 (none) | 1.775 (1.378-3.476) / 0.16 (none) | 2.369 (1.737-5.711) / 0.28 (none) |
| wide | 10000 | 11.4 (9.915-14.8) / 11.5 | 61.2 (49.9-76.9) / 14.8 (none) | 15.6 (13.8-22.5) / 0.55 (blocking-only) | 19.7 (16.7-23.0) / 3.60 (blocking-only) |
| wide | 100000 | 71.9 (61.9-97.7) / 71.8 | 780.9 (698.3-887.8) / 160.8 (none) | 160.7 (133.5-199.0) / 3.15 (blocking-only) | 195.5 (154.2-235.1) / 24.4 (blocking-only) |

**node:sqlite on node24 24.22.3** (full matrix; cells are latency ms median (min-max) / longest main-thread block ms median; verdict from the pre-registered criteria)

| shape | result rows | in-thread | worker, clone | worker, packed (views only) | worker, packed (row objects rebuilt) |
| --- | --- | --- | --- | --- | --- |
| narrow | 1 | 0.045 (0.015-0.155) / 0.17 | 0.252 (0.187-0.742) / 0.30 (none) | 0.309 (0.212-0.392) / 0.36 (none) | 0.358 (0.248-1.849) / 0.35 (none) |
| narrow | 10 | 0.055 (0.027-0.103) / 0.18 | 0.271 (0.188-0.474) / 0.36 (none) | 0.359 (0.250-1.750) / 0.42 (none) | 0.388 (0.253-1.364) / 0.42 (none) |
| narrow | 100 | 0.075 (0.059-0.114) / 0.22 | 0.352 (0.235-0.557) / 0.36 (none) | 0.427 (0.318-0.598) / 0.42 (none) | 0.346 (0.269-0.533) / 0.41 (none) |
| narrow | 1000 | 0.312 (0.283-0.517) / 0.45 | 1.063 (0.939-2.206) / 0.18 (none) | 0.818 (0.479-2.705) / 0.20 (none) | 0.875 (0.771-1.093) / 0.17 (none) |
| narrow | 10000 | 3.731 (2.726-5.163) / 3.87 | 8.061 (6.784-9.751) / 2.25 (none) | 3.423 (2.963-3.923) / 0.23 (blocking-only) | 4.436 (3.290-6.405) / 0.19 (blocking-only) |
| narrow | 100000 | 32.9 (25.7-46.2) / 32.1 | 87.7 (74.8-133.9) / 22.9 (none) | 34.7 (33.1-53.6) / 0.45 (blocking-only) | 35.5 (33.5-54.0) / 2.38 (blocking-only) |
| wide | 1 | 0.051 (0.021-0.084) / 0.17 | 0.276 (0.199-0.313) / 0.35 (none) | 0.327 (0.234-0.387) / 0.38 (none) | 0.372 (0.247-0.465) / 0.42 (none) |
| wide | 10 | 0.077 (0.055-0.091) / 0.17 | 0.337 (0.187-0.413) / 0.34 (none) | 0.377 (0.296-0.760) / 0.42 (none) | 0.426 (0.299-0.546) / 0.41 (none) |
| wide | 100 | 0.245 (0.193-0.462) / 0.34 | 0.788 (0.638-3.252) / 0.17 (none) | 0.481 (0.379-0.643) / 0.53 (none) | 0.594 (0.494-0.877) / 0.21 (none) |
| wide | 1000 | 1.875 (1.675-3.078) / 1.99 | 5.641 (4.517-8.122) / 1.30 (none) | 3.757 (2.635-5.119) / 0.21 (blocking-only) | 3.285 (2.767-8.796) / 0.18 (blocking-only) |
| wide | 10000 | 20.5 (17.8-36.0) / 20.6 | 50.0 (45.0-58.1) / 12.7 (none) | 33.9 (32.7-39.1) / 0.24 (blocking-only) | 33.8 (31.1-39.4) / 2.23 (blocking-only) |
| wide | 100000 | 297.4 (220.3-477.8) / 297.5 | 651.7 (599.9-785.8) / 173.3 (none) | 619.2 (530.8-788.8) / 5.85 (blocking-only) | 622.3 (587.0-680.9) / 22.6 (blocking-only) |
<!-- /GEN:workerSizeFull -->

### Query-time sweep, tiny result

<!-- GEN:workerTimeFull -->
**bun:sqlite on bun**

| target query ms | measured in-thread ms | in-thread: latency / longest block | worker: latency / longest block | verdict |
| --- | --- | --- | --- | --- |
| 0.1 | 0.105 | 0.070 (0.056-0.152) / 0.12 | 0.341 (0.229-0.416) / 0.13 | none |
| 1 | 0.889 | 0.623 (0.519-1.000) / 0.46 | 1.140 (1.095-1.254) / 0.14 | none |
| 10 | 9.47 | 9.721 (9.580-16.1) / 9.74 | 14.6 (9.756-17.4) / 0.16 | blocking-only |
| 100 | 104.846 | 111.5 (101.1-126.5) / 111.5 | 107.9 (99.6-158.5) / 0.28 | blocking-only |
| 1000 | 893.663 | 884.0 (866.9-1069.5) / 883.9 | 974.9 (874.4-1170.7) / 1.11 | blocking-only |

**node:sqlite on node24**

| target query ms | measured in-thread ms | in-thread: latency / longest block | worker: latency / longest block | verdict |
| --- | --- | --- | --- | --- |
| 0.1 | 0.104 | 0.133 (0.110-0.188) / 0.23 | 0.366 (0.213-0.481) / 0.42 | none |
| 1 | 1.013 | 0.591 (0.554-0.707) / 0.69 | 0.819 (0.727-1.302) / 0.17 | none |
| 10 | 9.92 | 9.907 (9.673-10.1) / 9.99 | 10.2 (9.942-16.4) / 0.23 | blocking-only |
| 100 | 100.419 | 99.9 (99.7-105.7) / 99.9 | 100.9 (99.9-158.2) / 0.23 | blocking-only |
| 1000 | 1009.486 | 1039.7 (1014.4-1146.9) / 1038.7 | 1045.0 (1009.0-1094.7) / 1.27 | blocking-only |
<!-- /GEN:workerTimeFull -->

### Throughput with 1, 2 and 4 readers

Closed loop, twice as many requests in flight as readers. The main thread and the readers share the 4 CPUs.

<!-- GEN:workerThroughputFull -->
**bun:sqlite on bun** (4 CPUs: Intel(R) Xeon(R) Processor @ 2.30GHz)

| workload | path | requests/s median (min-max) | timer-lag p99 ms | timer-lag max ms |
| --- | --- | --- | --- | --- |
| cpu-1ms-tiny | in-thread (1 request per event-loop turn) | 1842 (1617-1859) | 0.88 | 1.4 |
| cpu-1ms-tiny | worker clone, 1 reader | 1768 (1695-1793) | 0.17 | 1.6 |
| cpu-1ms-tiny | worker clone, 2 readers | 2191 (2154-2222) | 0.21 | 1.1 |
| cpu-1ms-tiny | worker clone, 4 readers | 4349 (3963-4450) | 1.16 | 3.9 |
| cpu-10ms-tiny | in-thread (1 request per event-loop turn) | 104 (96-106) | 13.76 | 17.7 |
| cpu-10ms-tiny | worker clone, 1 reader | 97 (77-106) | 0.20 | 8.9 |
| cpu-10ms-tiny | worker clone, 2 readers | 196 (184-204) | 0.19 | 1.3 |
| cpu-10ms-tiny | worker clone, 4 readers | 383 (325-409) | 0.12 | 4.8 |
| narrow-1000-rows | in-thread (1 request per event-loop turn) | 12741 (12096-12982) | 1.00 | 1.0 |
| narrow-1000-rows | worker clone, 1 reader | 3035 (2984-3065) | 1.97 | 2.8 |
| narrow-1000-rows | worker clone, 2 readers | 4366 (4262-4857) | 2.37 | 2.8 |
| narrow-1000-rows | worker clone, 4 readers | 5137 (4795-6462) | 13.24 | 14.5 |
| narrow-1000-rows | worker packed-decode, 1 reader | 6809 (6366-6891) | 1.58 | 2.1 |
| narrow-1000-rows | worker packed-decode, 2 readers | 8920 (8880-9764) | 1.95 | 2.5 |
| narrow-1000-rows | worker packed-decode, 4 readers | 10463 (7655-11046) | 3.15 | 3.4 |
| wide-1000-rows | in-thread (1 request per event-loop turn) | 1096 (932-1123) | 2.64 | 3.4 |
| wide-1000-rows | worker clone, 1 reader | 282 (260-320) | 5.76 | 8.3 |
| wide-1000-rows | worker clone, 2 readers | 371 (340-389) | 85.58 | 136.7 |
| wide-1000-rows | worker clone, 4 readers | 436 (398-464) | 249.51 | 249.5 |
| wide-1000-rows | worker packed-decode, 1 reader | 712 (667-748) | 1.95 | 4.2 |
| wide-1000-rows | worker packed-decode, 2 readers | 935 (914-1094) | 5.04 | 9.8 |
| wide-1000-rows | worker packed-decode, 4 readers | 1220 (1072-1384) | 84.28 | 84.3 |

**node:sqlite on node24** (4 CPUs: Intel(R) Xeon(R) Processor @ 2.30GHz)

| workload | path | requests/s median (min-max) | timer-lag p99 ms | timer-lag max ms |
| --- | --- | --- | --- | --- |
| cpu-1ms-tiny | in-thread (1 request per event-loop turn) | 1647 (1575-1728) | 0.59 | 1.9 |
| cpu-1ms-tiny | worker clone, 1 reader | 1662 (1211-1697) | 0.76 | 2.3 |
| cpu-1ms-tiny | worker clone, 2 readers | 3337 (3331-3351) | 0.36 | 1.1 |
| cpu-1ms-tiny | worker clone, 4 readers | 5237 (4247-5799) | 1.28 | 2.6 |
| cpu-10ms-tiny | in-thread (1 request per event-loop turn) | 92 (91-96) | 15.10 | 19.2 |
| cpu-10ms-tiny | worker clone, 1 reader | 95 (89-99) | 0.56 | 4.4 |
| cpu-10ms-tiny | worker clone, 2 readers | 194 (174-196) | 0.74 | 2.7 |
| cpu-10ms-tiny | worker clone, 4 readers | 344 (286-346) | 0.90 | 4.9 |
| narrow-1000-rows | in-thread (1 request per event-loop turn) | 3595 (2850-3850) | 1.10 | 1.9 |
| narrow-1000-rows | worker clone, 1 reader | 1983 (1524-2108) | 2.58 | 9.6 |
| narrow-1000-rows | worker clone, 2 readers | 3037 (2353-3626) | 4.95 | 11.7 |
| narrow-1000-rows | worker clone, 4 readers | 2633 (2439-2932) | 7.22 | 11.2 |
| narrow-1000-rows | worker packed-decode, 1 reader | 3443 (2886-3488) | 0.81 | 3.5 |
| narrow-1000-rows | worker packed-decode, 2 readers | 3788 (2717-4609) | 0.82 | 3.1 |
| narrow-1000-rows | worker packed-decode, 4 readers | 6001 (4956-6555) | 1.15 | 2.2 |
| wide-1000-rows | in-thread (1 request per event-loop turn) | 548 (545-558) | 6.81 | 8.4 |
| wide-1000-rows | worker clone, 1 reader | 281 (240-285) | 16.31 | 25.4 |
| wide-1000-rows | worker clone, 2 readers | 405 (370-462) | 26.41 | 41.7 |
| wide-1000-rows | worker clone, 4 readers | 518 (482-563) | 42.29 | 53.4 |
| wide-1000-rows | worker packed-decode, 1 reader | 364 (292-370) | 0.82 | 3.9 |
| wide-1000-rows | worker packed-decode, 2 readers | 650 (570-689) | 1.60 | 6.8 |
| wide-1000-rows | worker packed-decode, 4 readers | 954 (828-995) | 5.99 | 30.4 |
<!-- /GEN:workerThroughputFull -->

### Does a worker reader see what the writer committed?

<!-- GEN:workerVisibility -->
| binding / runtime | autocommit writes seen by worker | uncommitted tx seen? (worker count during tx, after commit) | writer vs long worker read |
| --- | --- | --- | --- |
| better-sqlite3 / bun | 100/100 | 100 (expected 100) then 101 (expected 101) | 0.3 ms for 50 writes during a 384 ms worker read; blocked: false |
| better-sqlite3 / node22 | 100/100 | 100 (expected 100) then 101 (expected 101) | 0.3 ms for 50 writes during a 329 ms worker read; blocked: false |
| better-sqlite3 / node24 | 100/100 | 100 (expected 100) then 101 (expected 101) | 0.3 ms for 50 writes during a 360 ms worker read; blocked: false |
| better-sqlite3 / node26 | 100/100 | 100 (expected 100) then 101 (expected 101) | 0.4 ms for 50 writes during a 401 ms worker read; blocked: false |
| bun:sqlite / bun | 100/100 | 100 (expected 100) then 101 (expected 101) | 11.7 ms for 50 writes during a 367 ms worker read; blocked: false |
| node:sqlite / bun | 100/100 | 100 (expected 100) then 101 (expected 101) | 9.5 ms for 50 writes during a 325 ms worker read; blocked: false |
| node:sqlite / node22 | 100/100 | 100 (expected 100) then 101 (expected 101) | 12.6 ms for 50 writes during a 354 ms worker read; blocked: false |
| node:sqlite / node24 | 100/100 | 100 (expected 100) then 101 (expected 101) | 11.1 ms for 50 writes during a 458 ms worker read; blocked: false |
| node:sqlite / node26 | 100/100 | 100 (expected 100) then 101 (expected 101) | 9.9 ms for 50 writes during a 343 ms worker read; blocked: false |
<!-- /GEN:workerVisibility -->

## 4. Durable Objects SQLite

Run: a Durable Object class with SQLite storage (`enableSql = true`, local disk storage) under workerd 1.20261118.1,
local only (`scripts/run-do.sh`, config template `scripts/do/config.capnp.in` modelled on
`tests/runtime/workerd.capnp`, probe in `scripts/do/do-worker.mjs`). No account, no deploy, no secrets. Raw output:
`results/do/do-sqlite.json`; the full generated table is `durable` in `results/tables.md`. Every statement below is
**local-observed** unless marked **documented-only**; local workerd is not production Cloudflare.

| aspect | observed (local) | embedded shape | service shape (ADR 032: platform API, own transaction limits) | fits |
| --- | --- | --- | --- | --- |
| call shape | `ctx.storage.sql.exec(query, ...bindings)` is synchronous and returns a cursor; no connection object, no prepared-statement object used | in-process handle, no transport | platform call | embedded-like |
| cursor and rows | `SqlStorageCursor`: `columnNames`, `next`, `one`, `toArray`, `raw`, `rowsRead`, `rowsWritten`; iterable; rows are plain objects; `one()` throws on 0 or 2+ rows; a write during an open cursor is allowed | statement and iterator | platform cursor with billing counters | service |
| integers | always JavaScript numbers; 2^53+1 reads as 2^53, 2^63-1 as 9223372036854776000; bigint parameters throw `TypeError`; `CAST(x AS TEXT)` is the only lossless read. **Documented-only:** the docs say values are affected by JavaScript's precision | lossless mode exists on all three bindings | platform value model | service (the integer rule cannot be applied) |
| BLOBs | read as `ArrayBuffer`; `ArrayBuffer` and `Uint8Array` accepted as parameters | `Uint8Array` or `Buffer` | platform value model | service |
| transactions | `BEGIN`, `COMMIT`, `ROLLBACK`, `SAVEPOINT`, `RELEASE` refused with a message pointing to `transactionSync` / `transaction`; `transactionSync` commits, rolls back on throw, nested calls roll back only the inner one; an async callback to `transactionSync` returns a promise without error. **Documented-only:** the same refusal and the input/output gates | SQL `BEGIN IMMEDIATE`, savepoints | "its own transaction limits" | service |
| pragmas | `foreign_keys` is on and settable; `journal_mode`, `synchronous`, `busy_timeout`, `wal_checkpoint`, `user_version`, `cache_size`, `integrity_check` are `SQLITE_AUTH`; `ATTACH`, temp tables, `writable_schema` refused | explicit pragmas at open | platform-chosen | service |
| WAL, checkpoint, busy | no second connection can be opened, so reader pool, WAL control, `SQLITE_BUSY` and `SQLITE_LOCKED` have no way to arise (inferred from the API surface) | one writer plus N readers, busy timeout | not applicable | neither (the embedded concurrency rows do not apply) |
| extensions and functions | `load_extension()` and `sqlite_version()` not authorized; FTS5, JSON, math, R-tree and window functions accepted; no custom function, aggregate, collation or hook API. **Documented-only:** a supported subset (FTS5, JSON, math) | opt-in loading, user functions | fixed platform set | service |
| backup | no serialize or online backup; `getCurrentBookmark()` returned a string and `sync()` resolved locally; `VACUUM` / `VACUUM INTO` refused ("within a transaction"). **Documented-only:** point-in-time recovery, not supported in local development | `VACUUM INTO`, online backup, serialize | platform recovery API | service |
| errors | plain `Error`; the SQLite code appears only in the message (`SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_UNIQUE)`); `code` is empty | code on the error object | platform errors | service |
| limits | more than 100 bound parameters, a statement of 160,008 characters and 120 columns are refused; a 4 MB BLOB is accepted. **Documented-only:** 100 columns, 8 MB per row/BLOB/string, 100 KB statement, 100 parameters, 32 function arguments | SQLite compile-time limits | "its own limits" | service |
| execution model | single-threaded object, no connections. **Documented-only:** input and output gates serialize events and hold outgoing messages until writes finish | single-writer | platform-defined | service (single-writer holds trivially) |

**Placement.** Row by row, the shared parts are the SQL dialect, a synchronous in-process call and single-writer
behaviour that holds trivially. The parts the embedded contract is about (open modes and pragmas, WAL and
checkpoint, busy handling, reader pool, extensions and functions, backup, lossless integers, error codes,
SQL-level transactions) are absent, refused or different, and what remains (transactions through a platform API,
platform limits, platform value model) is the definition of the service class in the roadmap. On this evidence
Durable Objects SQLite belongs to the **service contract**, not the embedded one. Where it differs from the
embedded rows it should be recorded as platform behaviour of that integration, not as a capability of the local
engine. This is a finding; placing it is a decision for an ADR.

## Decisions beyond the brief

- Pre-registered worker criteria (both wins for adoption; blocking-only reported separately) are this task's
  reading of the roadmap rule; they are fixed in the script header and were not changed after the runs.
- "64-bit declared type" in the integer rule is the list `BIGINT`, `INT8`, `UNSIGNED BIG INT`. The roadmap does not
  define it.
- No `sqlite3` CLI is installed, so CPython's stdlib `sqlite3` (3.53.1) is the second independent reader.
- `workerd` 1.20261118.1 is installed in a scratch directory outside the repo, not in the nested `package.json`,
  because the repo's root `node_modules` does not contain it.
- Node 22.12.0 and 22.13.0 tarballs (SHASUMS256 checked) were fetched only to observe the first 22.x release that
  loads `node:sqlite` without a flag.
- A third overhead variant (`adapter + rule`) was added to price the integer rule.
- A reduced worker matrix (four sizes, three query times, two workloads) was used for Node 22, Node 26 and
  `better-sqlite3`; the full matrix ran on `node:sqlite` with Node 24 and `bun:sqlite` with Bun.
- A tiny C extension (`scripts/fixtures/ext.c`) was compiled with gcc against the SQLite headers shipped inside the
  `better-sqlite3` package to exercise real extension loading.
- The Cloudflare documentation pages named above were fetched to separate documented-only statements from
  local-observed ones.
- `.gitignore` gets one comment line and `research/fs-08/work/`.
