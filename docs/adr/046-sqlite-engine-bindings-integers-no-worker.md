# 046. SQLite engine: three bindings behind one embedded contract, a fixed integer rule, no worker, Durable Objects in the service class

## Status
Accepted

Decided on 2026-11-22 under the owner's delegation, from FS-08 (`research/fs-08/`). A new ADR can change it.

## Context
The roadmap lists `bun:sqlite`, `node:sqlite` and `better-sqlite3` as SQLite bindings, leaves the integer-width rule and
the worker question to FS-08, and guesses that Durable Objects SQLite "may fit the embedded contract better". The
roadmap's decision rule for workers: adopt only above a measured result-size or query-time threshold. FS-08 ran the
three bindings on Bun 1.4.5 and Node 22.23.5, 24.22.3 and 26.13.1 (all bundle SQLite 3.54.1) and Durable Objects SQLite
on local workerd 1.20261118.1.

## Decision
1. **Bindings.** `bun:sqlite` on Bun, `node:sqlite` on Node, and `better-sqlite3` only as an optional peer the caller
   installs; never a dependency. `node:sqlite` loads without a flag from Node 22.13.0 and not on 22.12.0. The engine never
   passes `--experimental-sqlite`: on an older Node without `better-sqlite3` it reports itself unavailable.
2. **Loading.** Each binding lives in its own module under `engines/sqlite` and is loaded by a literal dynamic import, so
   a runtime never loads another runtime's module (a static `bun:sqlite` import fails on Node). The external allowlist of
   `engines/sqlite` gains `bun:sqlite`, `node:sqlite` and `better-sqlite3`.
3. **Capabilities** come from per-binding probes and are claimed only when a named check passed (ADR 044). None of the
   three is a superset of the others.
4. **Integer rule.** Read every integer cell in the binding's lossless mode (bigint). Take the column's declared type from
   statement metadata (null for expressions). A declared `BIGINT`, `INT8` or `UNSIGNED BIG INT` column gives bigint. Any
   other integer cell gives number when `|v| <= 2^53-1` and a data error otherwise. REAL, TEXT, BLOB and NULL are never
   touched. The bindings' default modes are not used: `better-sqlite3` and `bun:sqlite` round silently and `node:sqlite`
   is not uniform.
5. **STRICT.** The roadmap's pair "STRICT recommended" and "declared 64-bit decodes to bigint" does not hold: SQLite
   refuses `BIGINT` in a STRICT table. STRICT tables follow decision 4 on their INTEGER columns; full 64-bit values in a
   STRICT table need a per-column opt-in in the type contract. An expression such as `max(x)` has no declared type and
   raises the data error above 2^53-1.
6. **Explicit configuration.** The engine sets `journal_mode`, `synchronous`, `foreign_keys` and `busy_timeout` at open and
   never relies on a binding's defaults (they differ: `foreign_keys` is 0 on `bun:sqlite`, `busy_timeout` is 5000 on
   `better-sqlite3`). The values are fixed in the engine specification.
7. **Extensions.** The engine never calls a binding's extension loader without an explicit caller opt-in. `bun:sqlite` and
   `better-sqlite3` load an extension with no opt-in of their own.
8. **Closing.** The engine closes `bun:sqlite` with `close(true)`; plain `close()` leaves the connection open while
   statements are alive.
9. **No worker.** Worker execution is not adopted. The engine runs in the calling thread and its blocking is documented.
   A new ADR can reopen this with a study that uses a packed-buffer result path.
10. **Durable Objects SQLite is a service-class integration**, not embedded. Its `int64` capability is false: integers
    come back as JavaScript numbers (rounded above 2^53-1) and bigint parameters are refused, which the error mapper
    reports as a typed error. D1 is not decided here.
11. **The ledger is the record.** Where the roadmap's SQLite claims differ from the FS-08 table (no binding has a
    collation API; `serialize` of a WAL database cannot be deserialized; Durable Objects does not fit embedded), the FS-08
    table wins.

## Consequences
- The integer rule costs x1.06 to x1.27 on a point select, x1.16 to x2.03 on 100 rows and x1.23 to x2.00 on 10,000 rows
  (medians of 21 runs per binding and runtime).
- On Node 22 `node:sqlite` lacks `serialize`, `deserialize`, statement `close`, the statement cache and `setAuthorizer`, so
  those capabilities are false there.
- EmbeddedCore (ADR 044) was run in FS-01 on `bun:sqlite` only. P2-T04 runs all three bindings against the final contract
  before EmbeddedCore can leave class ownership.
- SQLite work is synchronous: in FS-01 the binding blocked the event loop for 2.0 s behind another process's lock, connect
  included. Aborts and timeouts apply only while a caller is queued (ADR 044).
- The worker finding stands on measurements: it adds about 0.2 to 0.3 ms per request and never won latency; structured
  clone of 100,000 wide rows on Node 24 took 652 ms with a 173 ms block against 297 ms in-thread; it did cut the longest
  main-thread block to about 0.1 to 1.3 ms from a 10 ms query. A packed ArrayBuffer cut the transfer block from 173 ms to
  6 ms.

## Evidence
- `research/fs-08/README.md` and `results/`: integer rule verified on 882 of 882 result sets across three bindings and
  four runtimes, with failing negative controls; capability diff per binding and runtime; the worker matrix; Durable
  Objects rows (10 of 12 match the service shape, 1 the embedded shape, 1 neither).
- Not verified: production Cloudflare (everything is local workerd), `SQLITE_LOCKED` on `better-sqlite3`, D1, WASM, OPFS,
  macOS and Windows, allocations, the packed-buffer path under the integer rule. Reference reader was CPython's `sqlite3`
  (a different SQLite version).

## Basis
FS-08 findings; ADR 029, 039, 044, 005; the roadmap's FS-08 decision rule.
