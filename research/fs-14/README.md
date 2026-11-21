# FS-14: how Drizzle's Postgres driver is fast, and a reproduced benchmark

Research only. This folder contains notes, scripts and small result files. It changes no OKDriver
source, no gate, no ADR and no root tooling, and it makes no claim about OKDriver and no public
comparison. Spec area: none yet. Feature record: none (research).

Question: why is Drizzle's Postgres driver fast, and how exactly was that measured? The roadmap item
(FS-14) asks for the published driver's source read, the published benchmark harness run locally with
documented settings for every driver, reproduced ratios, and the techniques actually in use.

## Findings in short

1. **The benchmarked driver is the copy vendored inside `drizzle-orm`, not the standalone package.**
   `drizzle-orm/postgres` resolves its `#postgres` import to `drizzle-orm/postgres/client/dist`. That
   directory in `drizzle-orm@1.0.0-rc.6` is byte-identical to the one in the harness's pinned preview
   (`drizzle-orm` at commit `45b4a38`) and to the harness's `@drizzle-team/postgres` preview. The
   published standalone `@drizzle-team/postgres@0.4.4` is an older build: its pool checks a connection
   out per standalone query and its pooled connections default to a pipeline depth of 1. It has no
   pool-level sharing of connections and no automatic depth. Reading 0.4.4 alone would describe a
   different driver from the one that was benchmarked.
2. **The headline technique is pool-level pipelining**: standalone queries from unrelated callers share
   the least-loaded connection and ride the same socket write, up to a depth that follows the measured
   round trip. Named statements, binary formats and generated row decoders also exist, but several of
   them are shared with the other drivers in the harness or are smaller effects; the pool design is
   what the harness's `PIPELINE=off` switch removes.
3. **The benchmark profile this task allowed never exercises it.** With `--requests 100000` the ramp
   ends at about 900 virtual users, about 3,200 rps, set by the users' think time and not by the
   server. A protocol trace shows at most one statement in flight per connection on Node under that
   profile. Under a heavier profile (3,000 users) the same pool reaches about 47 to 67 statements in
   flight per connection. So the reproduced ratios below are CPU per request and latency at a
   load-limited step. The published peak-rps ratio (Node: 1.56x over node-postgres) was **not**
   reproduced and cannot be with this profile.
4. **Several behaviours collide with locked OKDriver decisions** (ADR 019, ADR 024, ADR 018, ADR 034,
   constitution principle 6); see "Conflicts with locked decisions". No code is proposed.

## What was read

| item | version | note |
|---|---|---|
| `drizzle-orm` (npm) | `1.0.0-rc.6` | vendored driver at `postgres/client/dist`, connector at `postgres/*.js` |
| `@drizzle-team/postgres` (npm, MIT) | `0.4.4` | standalone package; differs from the benchmarked driver (finding 1) |
| `drizzle-orm` and `@drizzle-team/postgres` as the harness installs them | `0.0.0-preview-45b4a38` from `pkg.pr.new` | what was actually benchmarked; driver files identical to rc.6's vendored copy |
| TypeScript source | `drizzle-team/drizzle-orm` at `45b4a38`: `postgres/src/*.ts`, `drizzle-orm/src/postgres/*.ts` | fetched file by file from raw.githubusercontent.com into the ignored work dir; the GitHub API and fetching a bare short SHA were not available |
| harness | `drizzle-team/drizzle-benchmarks` at `6e669c7` | cloned into `work/`, not vendored (it has no license file) |
| Stable `drizzle-orm@0.45.4` and `beta` | not used | they have no `drizzle-orm/postgres` |

Where the two builds differ, 0.4.4 lacks `shareQueries`, `pickShared`, `autoDepth` and `pipelineAuto`
(a text search finds none), and its pooled default is `pooled ? 1`. Both have the generated row
decoders, `BINARY_FAST`, the generated Bind encoder and the microtask write flush.

## Techniques

Package paths are inside `drizzle-orm` (`postgres/client/dist/*.js`, source `postgres/src/*.ts`) unless
stated. "Evidence" is something observed outside the driver's own code: the Postgres server log, a
protocol trace taken by `scripts/pgtrace.ts` (a byte-forwarding proxy between server and Postgres that
parses the frontend messages), or a runtime probe. Numbers are in the evidence tables further down.

| technique | what it is | where | independent evidence |
|---|---|---|---|
| Pool-level pipelining | A standalone query does not check a connection out. It goes to the least-loaded checked-in connection and queues behind other callers' statements on it. If every connection is busy and the pool is below `max`, the pool opens another first, so sharing starts only once the pool is full. | `pool.ts`: `_run`, `pickShared`, `grow`, `runShared`, `afterShared`, `waitShared` | Depth probe: 400 concurrent lookups over 2 connections put 99 and 100 statements in flight per connection; node-postgres stays at 1. Heavy-profile trace: 47 to 67 in flight per connection, 24.7% of statements sent behind another. |
| Pipeline depth | Default is "auto": starts at 100, then follows the connection's lowest measured time to first byte, as `max(100, ceil(100 x ms))` capped at 4096. `pipeline: { depth: n }` fixes it. `pipeline: false` is depth 1. A detected transaction pooler (ports 6432 or 6543, `-pooler.` hosts, some provider hosts) turns it off by default. | `connection.ts`: `resolvePipeline`, `autoDepth`, `recordRtt`, `pipelineOffByPooler`, `processQueue` | Depth probe: depth 4 holds at 4 in flight, `off` holds at 1, default reaches 100. Pooler detection was not exercised (the harness uses port 5435). |
| `PIPELINE=off` | The harness maps it to `pipeline: false`. The pool's `shareQueries` becomes false, so each standalone query takes the exclusive path: acquire a connection, run, release, with waiters queued when all are out. `PIPELINE=<n>` maps to a fixed depth. | `drizzle-db.ts` in the harness; `pool.ts`: `_run`, `runExclusive`, `acquire`, `release` | Trace: at most one statement in flight per connection in both the benchmark and the heavy profile; depth probe: 1. |
| Write coalescing | Statements issued in the same tick are flushed in one socket write (microtask flush, default). A write also flushes early at 64 KiB. | `connection.ts`: `processQueue`, `scheduleFlush`, `FLUSH_THRESHOLD` | Trace: up to 66 Syncs in one TCP write under the heavy profile, 100 in the depth probe. |
| Named prepared statements | The harness gives every query `.prepare('p1')` to `.prepare('p13')`; the connector passes that as the statement name. Per connection the driver remembers name, SQL, column description and parameter OIDs. First use writes Parse, Describe, Bind, Execute, Sync in one batch. Reuse writes Bind, Execute, Sync only. A concurrent first use of the same name is not parsed twice. | `drizzle-orm/postgres/session.js`: `prepareQuery`; `connection.ts`: `startTask`, `prepared`, `parseInflight` | Postgres log and trace agree: 126 to 175 Parses for 20,000 Binds, never more than one Parse of a name on one backend, 11 distinct names. Node-postgres in the same harness is also named (175 Parses), so naming does not separate the two on Drizzle's own queries. Kysely on node-postgres is unnamed: 20,000 Parses. |
| Text versus binary | Results: the ORM passes a declared column shape, so int2, int4, oid, int8, float8, date, timestamp, timestamptz and bytea come back binary from the first execution; float4, text, numeric and json stay text. Parameters: a binary plan is compiled from the server's parameter OIDs and used from the second execution. | `decode.ts`: `BINARY_FAST`; `spec.ts`; `encode.ts`: `compileParamPlan`; `connection.ts`: `reuseBinaryOids` | Trace: every Bind of the Drizzle driver asks for mixed result formats; parameters text 5,555 / mixed 13,616 / binary 829 per 20,000. Node-postgres: all text, both ways. |
| Generated row decoder (driver) | For each distinct column set the driver builds a monomorphic row function with `new Function`, reads each column straight from the socket buffer (`readInt32BE` for binary int4, `utf8Slice` for text) and caches it on the prepared statement. | `decode.ts`: `compileRow`, `compileResultSet`; `connection.ts`: `statementMappers` | `scripts/codegen-probe.ts` with the driver's debug switch prints the generated source for the harness's own query; the second execution compiles nothing new (`results/evidence/codegen-probe.txt`). |
| `jit: true` in the connector | A different thing: the ORM generates the function that turns driver rows into relational-query objects (`makeJitQueryMapper`, `makeJitRqbMapper`) instead of generic mappers. The harness passes `jit: true` for all three drivers, so it does not separate them. | `drizzle-orm/postgres/driver-core.js` (`useJitMappers: jitCompatCheck(config.jit)`), `pg-core/dialect.js` | Probe prints the dialect's generators: `makeJitQueryMapper / makeJitRqbMapper`. |
| Generated Bind encoder | Once a statement's parameter OIDs are known, a compiled function writes Bind, Execute and Sync into the outbound buffer without per-value allocations. | `encode.ts`: `compileBindEncoder`; `connection.ts`: `jitFor` | Not independently evidenced; only its result (binary parameters on the wire) is. |
| Pool design and checkout | `max` connections, an idle list, a checked-out set, waiters only at max, idle eviction, a circuit breaker with one background probe on outage. Exclusive checkout is kept for transactions, `connect()`, batch and pipeline helpers, cursors, COPY, bulk helpers, and queries with a timeout, signal or snapshot. | `pool.ts`: `acquire`, `checkoutIndex`, `release`, `reclaim`, `checkin`, `trip`, `startProbe` | Trace: 16 backends for 2 processes x `POOL_MAX=8`. Depth probe: the pool used exactly its 2 connections. Outage behaviour not exercised. |
| Read-path buffering | A parser walks each socket chunk in place and calls the sink with (buffer, start, end) per message. Nothing is allocated per message; only a message split across chunks is joined, once, when its last piece arrives. Rows go from the chunk to the generated mapper. | `protocol.ts`: `Parser.feed`; `connection.ts`: `onData`, `onMessage`, `dataRow` | **None.** Code reading only; no external observation of it was made. |
| Node versus Bun | The driver has no runtime branch. It uses `node:net` on both (Bun implements it) and the same `new Function` codegen; the only gate is `isEvalAvailable()`. | `transport-node.ts`, `node.ts`, `mapper.ts` | Trace of `drizzle-bun14-drizzle` has the same shape as Node's (126 Parses, mixed formats). The Bun-only difference in the harness is `Bun.SQL`, a separate driver (below). |

`Bun.SQL`, observed as a black box with the same tools: named statements (140 Parses per 20,000 Binds),
mixed binary parameters, a separate Sync after each first-use Parse and Describe (141 extra Syncs for 140
Parses, so an extra round trip per new statement per connection), and, in the depth probe, no depth cap
(200 statements in one write per connection). In the benchmark profile it never exceeded 2 in flight.

### Two harness-level observations

- node-postgres and the Drizzle driver are given identical statement names and an identical ORM mapper
  in this harness. What separates them is the pool, the wire format and the driver-level decoder.
- Kysely on `postgres.js` named 192 statements (it names by SQL text, and the SQL varies); Kysely on
  Drizzle's driver named 11 (`autoName`); Kysely on node-postgres named none.

## What it does not do, and pipelining versus multiplexing

- **No reordering and no interleaving.** Each connection is first in, first out. Each statement has its
  own Sync, so a failure inside one statement is isolated from the next, and the server still runs them
  one after another. A slow statement delays everything queued behind it on that connection.
- **No sharing of session or transaction state.** A transaction takes an exclusive checkout. Statements
  with a timeout, an abort signal or a snapshot also take one, because a cancel hits whatever the
  backend is running, which on a shared connection could be another caller's statement.
- **No automatic replay.** On socket loss every statement in flight is rejected with a "connection
  lost, may or may not have run" mark and is never re-sent.
- **No client-side SQL interpolation**; parameters are bound (text or binary).
- **Named statements are off behind transaction poolers** unless the host is known to keep them.
- Pipelining and multiplexing are close here. Pipelining in the strict sense is many statements in order
  on one connection. What the pool adds is a scheduler that assigns statements from many independent
  callers to a small set of connections, by load, and batches them into shared writes. That scheduler is
  the part that other ecosystems call multiplexing.

## Conflicts with locked decisions

Stated as observations; no proposal.

- **ADR 019 (no connection multiplexing).** The pool's default behaviour for standalone queries is the
  caller-to-connection scheduling described above. Whether it counts as the multiplexing the ADR
  rejects depends on how the ADR defines the term; the ADR text in the repo does not define it.
- **ADR 024 (no auto-batching across a tick by default) and ADR 018 (simple pipeline scheduler by
  default).** The default flush mode batches statements issued in the same tick into one write, and the
  depth is chosen automatically from the round trip, which is a smarter policy than a simple one.
- **ADR 034 (two-level outcomes) and principle 6 (no unsafe automatic retries).** Replay is absent,
  which agrees with principle 6. But on socket loss every in-flight statement gets the same
  "may or may not have run" mark, including statements whose bytes were still in the unflushed batch
  and never reached the wire; there is no statement-level distinction between "not sent" and "sent,
  outcome unknown". Where per-connection reconnect is enabled, statements still queued behind the
  pipeline depth when a connection drops are kept and sent after reconnect, and pool waiters re-run
  when the breaker recovers; those were never sent, but it is an automatic resend path. This was read
  from the source and not fault-tested.
- **A plain `BEGIN` sent as ordinary SQL** runs on a shared connection with other callers' statements
  behind it. The pool notices at check-in and queues a ROLLBACK (comment in `pool.ts`). That is a
  semantic hazard outside the documented transaction API.

## Exact settings per driver

Common: Hono, 2 server processes (`WORKERS=2`, Node `cluster` or Bun `reusePort`), pool of 8 per process
(`POOL_MAX=8`), 16 backends in total, Postgres 18.6 with default settings, `max_connections` 100, request
mix and seed as in the harness, ORM `jit: true`, queries prepared once with names `p1` to `p13`.

| config | runtime | server file, env | driver construction |
|---|---|---|---|
| drizzle-node24-pg | Node 24.22.2 | `src/drizzle-server-node.ts`, `DRIVER=pg` | `new pg.Pool({ connectionString, min: 8, max: 8 })` |
| drizzle-node24-drizzle | Node 24.22.2 | same, `DRIVER=drizzle` | `new Pool({ url, max: 8, pipeline: undefined })` from `drizzle-orm/postgres` (auto depth) |
| drizzle-node24-drizzle-nopipe | Node 24.22.2 | same, `DRIVER=drizzle PIPELINE=off` | same with `pipeline: false` |
| drizzle-bun14-bunsql | Bun 1.4.4 | `src/drizzle-server-bun.ts`, `DRIVER=bun` | `new Bun.SQL(url, { bigint: true, prepare: true, max: 8 })` |
| drizzle-bun14-drizzle | Bun 1.4.4 | same, `DRIVER=drizzle` | as the Node Drizzle row |
| kysely-node24-pg | Node 24.22.2 | `src/kysely-server-node.ts`, `DRIVER=pg`, port 3004 | `new pg.Pool({ connectionString, min: 8, max: 8 })`, no names |
| kysely-node24-postgresjs | Node 24.22.2 | same, `DRIVER=postgresjs` | `postgres(url, { max: 8 })` via `kysely-postgres-js`, `prepare: true` |
| kysely-node24-drizzle | Node 24.22.2 | same, `DRIVER=drizzle` | `createPool({ url, max: 8 })` from `@drizzle-team/postgres/compat-kysely`, `autoName` |

Kysely rows are compared only with each other.

## Package versions

Resolved by the harness lockfile (`pnpm-lock.yaml` at `6e669c7`, `--frozen-lockfile`): `drizzle-orm`
and `@drizzle-team/postgres` `0.0.0-preview-45b4a38`, `pg` 8.20.0, `postgres` (postgres.js) 3.4.7,
`kysely` 0.29.8, `kysely-postgres-js` 5.1.0, `hono` 4.13.17, `@hono/node-server` 2.1.6, `dotenv` 16.6.1,
`dockerode` 3.3.5. `Bun.SQL` is built into Bun 1.4.4. Node 24.22.2 (the version the harness README
lists for its published runs), downloaded from nodejs.org. Bun 1.4.4 (the published runs' version);
the repo's `.bun-version` says 1.4.5, so the repo checks ran on 1.4.4. Postgres `postgres:18.6`, digest
`sha256:e3d24f6906d0760bf4da0dae872415391ededefad23fd471c47dc53b0ddf3c42`, started by the harness's
`src/docker.ts` with host networking. Seed: `micro`, 376,220 rows, 43 MB. `pkg.pr.new` was reachable,
so the pinned previews installed as the harness pins them and no version was replaced.

## Reproduce

Needs docker (or its daemon started), bun, node, curl, git. From the repo root:

```bash
research/fs-14/scripts/setup.sh                      # clone at 6e669c7, install, Node 24, Postgres 18.6, seed micro
research/fs-14/scripts/smoke.sh                      # every route once on every server; compare bodies
research/fs-14/scripts/run.sh 3                      # 3 rounds x 8 configs, 100,000 requests each
research/fs-14/scripts/report.sh                     # peaks.ts + cpu-split.ts, summary.csv, tables.md
research/fs-14/scripts/evidence.sh 20000             # protocol trace + Postgres log, benchmark profile
EV_PGLOG=0 EV_FILTER='drizzle-node24-*' EV_BENCH='--quick --no-warmup' EV_TAG=quick- research/fs-14/scripts/evidence.sh
research/fs-14/scripts/depth-probe.sh                # pipeline depth with 400 callers over 2 connections
```

`setup.sh` runs the harness's `bunx pnpm install --frozen-lockfile` inside the scratch clone only. The
scripts also need `node` 24 on the path for `pgtrace.ts` and the probes; `env.sh` puts the downloaded
Node 24 first.

Files: `scripts/` (the above plus `pgtrace.ts`, `pglog-summary.ts`, `codegen-probe.ts`,
`summarize.ts`, `evidence-summary.ts`, `extract-published.mjs`), `results/summary.csv` (one row per
run), `results/tables.md`, `results/evidence.md`, `results/peaks.md` and `results/cpu-split.txt` (the
harness scripts' own output), `results/runs/` (bench output per run), `results/evidence/` (traces, log
summaries, probe output), `results/smoke/{status,compare}.txt`.

## Results

Hardware: 4 vCPU Intel Xeon @ 2.30 GHz (KVM guest, one thread per core), 15 GiB RAM, no swap, Linux
6.18.44. Load generator, both servers' processes and Postgres all run on this one machine. The machine
was not saturated: at the 600-user step it was 184 to 289 percent idle out of 400 across all 24 runs,
and everything outside the server and Postgres (mostly the load generator) used 23 to 37 percent of one
core. But one machine means these are **ratios and CPU per request, not absolute rps**, and the load
generator's CPU and cache are in the same box as the server's.

Profile: `bench/index.ts <url> <name> --requests 100000 --procs`, a fresh server per run, the harness's
10 s unrecorded warm-up, three runs per config in round-robin order. The ramp starts at 300 users and
adds 300 every 20 s, so the run ends partway through the 900-user step. The only steps with enough
steady seconds are 300 and 600 users; every table below is the 600-user step. Throughput there is
about 3,190 rps for every config because it is set by the users' think time. **So rps does not
separate configs here; CPU per request and latency do.**

#### Reproduced, per config: median (min–max) of 3 runs, at the 600-VU step

| config | rps | p95 ms | p99 ms | server µs/req | Postgres µs/req | rest µs/req | total µs/req | server CPU % | Postgres CPU % | other CPU % (load gen) | idle CPU % |
|---|---|---|---|---|---|---|---|---|---|---|---|
| drizzle-bun14-bunsql | 3189 (3189–3190) | 1.3 (1.2–1.4) | 2.4 (2.4–2.6) | 137 (131–141) | 144 (140–150) | 134 (128–137) | 414 (399–428) | 44 (42–45) | 46 (45–47) | 27 (26–27) | 279 (276–283) |
| drizzle-bun14-drizzle | 3190 (3187–3191) | 1.3 (1.1–1.5) | 2.5 (2.5–2.8) | 139 (134–149) | 137 (126–142) | 130 (122–136) | 399 (390–426) | 44 (42–48) | 44 (40–46) | 25 (24–27) | 283 (273–288) |
| drizzle-node24-drizzle | 3188 (3186–3189) | 1.3 (1.1–1.6) | 2.5 (2.3–3.0) | 161 (140–181) | 138 (123–153) | 138 (111–145) | 438 (374–480) | 52 (45–58) | 44 (39–49) | 28 (23–28) | 272 (260–289) |
| drizzle-node24-drizzle-nopipe | 3185 (3179–3188) | 1.8 (1.3–2.3) | 3.1 (2.4–4.6) | 225 (167–226) | 177 (147–178) | 158 (134–173) | 561 (448–576) | 71 (53–71) | 56 (47–56) | 32 (26–37) | 234 (228–269) |
| drizzle-node24-pg | 3186 (3182–3186) | 1.7 (1.6–2.1) | 3.0 (3.0–3.8) | 177 (172–227) | 141 (135–169) | 125 (125–155) | 442 (432–550) | 56 (55–71) | 45 (43–53) | 25 (24–30) | 269 (239–273) |
| kysely-node24-drizzle | 3187 (3186–3189) | 1.8 (1.7–2.0) | 3.8 (3.3–3.8) | 196 (195–204) | 148 (147–152) | 142 (139–143) | 485 (481–499) | 63 (62–65) | 47 (47–48) | 28 (28–29) | 256 (252–257) |
| kysely-node24-pg | 3181 (3179–3184) | 2.3 (2.2–2.7) | 4.2 (3.7–5.1) | 192 (191–231) | 287 (285–326) | 137 (134–157) | 615 (612–714) | 61 (61–73) | 91 (90–104) | 27 (27–32) | 216 (184–216) |
| kysely-node24-postgresjs | 3181 (3180–3184) | 2.3 (1.8–2.4) | 4.4 (3.0–5.0) | 252 (244–310) | 172 (172–190) | 146 (146–171) | 569 (562–671) | 80 (77–99) | 55 (54–61) | 29 (28–33) | 232 (199–234) |

#### Published (orm.drizzle.team/benchmarks data, 2026-11-20), same step logic

| config | peak rps (at VUs) | at 600 VUs: rps | p95 ms | p99 ms | machine CPU µs/req (all 4 cores) |
|---|---|---|---|---|---|
| drizzle-node24-pg | 13852 (3300) | 3175 | 3.7 | 8.8 | 666 |
| drizzle-node24-drizzle | 21651 (4800) | 3179 | 2.8 | 6.9 | 654 |
| drizzle-bun14-bunsql | 22571 (4500) | 3180 | 2.2 | 6.2 | 639 |
| drizzle-bun14-drizzle | 22533 (4500) | 3180 | 2.9 | 6.6 | 677 |

#### Ratios A / B at 600 VUs (reproduced = ratio of medians; published where a series exists; flag = more than 25% apart)

| A / B | rps | p95 | p99 | server µs/req | total µs/req (ours) vs machine µs/req (published) | flag |
|---|---|---|---|---|---|---|
| drizzle-node24-drizzle / drizzle-node24-pg | 1.00 | 0.76 | 0.83 | 0.91 | 0.99 (published: rps 1.00, p95 0.76, p99 0.78, CPU 0.98) | within 25% |
| drizzle-bun14-drizzle / drizzle-bun14-bunsql | 1.00 | 1.00 | 1.04 | 1.01 | 0.96 (published: rps 1.00, p95 1.28, p99 1.08, CPU 1.06) | within 25% |
| drizzle-node24-drizzle-nopipe / drizzle-node24-pg | 1.00 | 1.06 | 1.03 | 1.27 | 1.27 | no published series |
| drizzle-node24-drizzle / drizzle-node24-drizzle-nopipe | 1.00 | 0.72 | 0.81 | 0.72 | 0.78 | no published series |
| kysely-node24-drizzle / kysely-node24-pg | 1.00 | 0.78 | 0.90 | 1.02 | 0.79 | no published series |
| kysely-node24-postgresjs / kysely-node24-pg | 1.00 | 1.00 | 1.05 | 1.31 | 0.93 | no published series |
| kysely-node24-drizzle / kysely-node24-postgresjs | 1.00 | 0.78 | 0.86 | 0.78 | 0.85 | no published series |

Published peak-rps ratios (not reproducible with the 100,000-request profile, which ends before saturation): node24 drizzle/pg 1.56, bun14 drizzle/bunsql 1.00.


Reproduced and published ratios agree within 25% on every metric where a published series exists
(p95, p99 and CPU per request at 600 users, Node drizzle over pg and Bun drizzle over Bun.SQL).
Differences in method: the published p95 and p99 are means of per-second percentiles, ours are
per-request percentiles from `peaks.ts`; the published CPU is the whole server machine, and our "total"
also counts the load generator that shares this box. The spread across three runs is wide for CPU (for
example Node drizzle server CPU 140 to 181 µs against pg 172 to 227), so the Node CPU gain is within
noise on three runs, while the latency gain (p95 0.76 of pg) matches the published ratio. There are no
published series for `PIPELINE=off` or Kysely, so those ratios have no comparison. The default uses
less CPU than `PIPELINE=off` (server 0.72x, total 0.78x) although the trace shows no pipelining in
either at this load; the two ranges overlap, and no attempt was made to find a cause. The effect of
`PIPELINE=off` on throughput at saturation was not measured.

### Evidence tables

#### Benchmark-profile trace (20,000 requests per config, 16 backends = 2 processes x 8 connections)

| config | Parse (named / unnamed) | distinct named statements | most Parses of one name on one backend | Bind | Describe | result formats (per Bind) | param formats (per Bind) | max statements in flight on a connection | share of statements sent behind another |
|---|---|---|---|---|---|---|---|---|---|
| drizzle-node24-pg | 175 / 0 | 11 | 1 | 20000 | P 20000 | text 20000 | text 20000 | 1 | 0.00% |
| drizzle-node24-drizzle | 135 / 0 | 11 | 1 | 20000 | S 135 | mixed 20000 | text 5555, mixed 13616, binary 829 | 1 | 0.00% |
| drizzle-node24-drizzle-nopipe | 173 / 0 | 11 | 1 | 20000 | S 173 | mixed 20000 | text 5593, mixed 13606, binary 801 | 1 | 0.00% |
| drizzle-bun14-bunsql | 140 / 0 | 11 | 1 | 20000 | S 140 | mixed 20000 | text 5436, mixed 13686, binary 878 | 2 | 0.07% |
| drizzle-bun14-drizzle | 126 / 0 | 11 | 1 | 20000 | S 127 | mixed 20000 | text 5547, mixed 13617, binary 836 | 2 | 0.04% |
| kysely-node24-pg | 0 / 20000 | 0 | 0 | 20000 | P 20000 | text 20000 | text 20000 | 1 | 0.00% |
| kysely-node24-postgresjs | 192 / 0 | 192 | 1 | 20016 | S 192 | text 20016 | text 20000 | 1 | 0.00% |
| kysely-node24-drizzle | 127 / 0 | 11 | 1 | 20000 | S 127 | text 127, mixed 19873 | text 127, binary 19873 | 1 | 0.00% |

(The Postgres log and the protocol trace give the same Parse and Bind counts for every config; the table shows the log's Parse counts and the trace for everything else.)

#### Heavier profile through the trace proxy (`--quick`, 500 to 3000 VUs; not a benchmark)

| config | max statements in flight on a connection (per connection) | share of statements sent behind another | largest Syncs in one TCP write |
|---|---|---|---|
| drizzle-node24-pg | 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 | 0.00% | 1 |
| drizzle-node24-drizzle | 56 56 50 65 63 47 56 61 64 66 63 61 67 52 56 56 | 24.71% | 66 |
| drizzle-node24-drizzle-nopipe | 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 | 0.00% | 1 |

#### Depth probe: 400 concurrent single-row lookups over a pool of 2 connections

| variant | connections used | max statements in flight per connection | largest Syncs in one TCP write | Parse | Bind |
|---|---|---|---|---|---|
| drizzle | 2 | 99, 100 | 100 | 2 | 401 |
| drizzle-depth4 | 2 | 4, 4 | 4 | 2 | 401 |
| drizzle-off | 2 | 1, 1 | 1 | 2 | 401 |
| pg | 2 | 1, 1 | 1 | 2 | 400 |
| bunsql | 2 | 200, 200 | 200 | 2 | 400 |


## Deviations from the published setup

- One machine instead of two (the published runs use a separate load generator over 1 Gb Ethernet on a
  4-core i3-9100T server). Everything here is on loopback with Postgres on the host network.
- `--requests 100000` instead of the 300 to 4800 user profile, as the brief required. Peak rps is not
  measured. The published peaks (from the same website data) are Node drizzle 21,651 against pg 13,852
  (1.56x) and Bun drizzle 22,533 against Bun.SQL 22,571 (1.00x); they are quoted, not reproduced.
- The bench's flag is `--procs`; `--cpu` belongs to `scripts/matrix.ts`, which is not in the repo.
- The load generator runs from a copy of the same Bun binary named `loadgen`. The harness's CPU split
  counts any process called `bun*` or `node*` as the server under test, so on one machine an
  unrenamed generator would have been counted as the server.
- Servers are started by `scripts/lib.sh` with the README's commands, `WORKERS=2 POOL_MAX=8`, instead of
  the matrix runner. Cooldown between runs is 15 s (the harness default is 60 s).
- `ANALYZE` after seeding, so autovacuum cannot change plans mid-run.
- Docker's daemon was not running in this sandbox and was started by hand.
- Hardware, kernel and CPU differ from the published machine. Runtimes and Postgres match.
- The published numbers come from the data embedded in the website's JavaScript bundle
  (`orm.drizzle.team/benchmarks`, series dated 2026-11-20), parsed as data and not executed. The README
  of the harness carries no ratios.
- The evidence runs add a proxy and temporary Postgres statement logging; they are not benchmark data.

## What could not be verified

- Peak (saturation) rps ratios, and with them the claim that the pool-level pipelining is what gives
  Node its published 1.56x over node-postgres. Only a profile that saturates the server can test it.
- Read-path buffering and the generated Bind encoder: read in source, not observed from outside.
- Any per-technique contribution to a ratio: the only ablation is `PIPELINE=off`, and only at a load
  where it does not pipeline.
- Behaviour on connection loss, outage, timeout and cancel: read in source, no fault injection.
- Transaction-pooler detection and TLS: not exercised.
- `@drizzle-team/postgres@0.4.4` was read, not benchmarked.
- `Bun.SQL` internals: black-box traces only.
