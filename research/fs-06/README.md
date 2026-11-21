# FS-06: does one-round-trip execution work behind every PostgreSQL pooler?

Research only. This folder holds a PostgreSQL client and two recording proxies written for the study, scripts, small result files and the
claim ledger. It changes no OKDriver source, test, root file, ADR or `AGENTS.md`, and it makes no claim about OKDriver's speed. Spec area: none yet.
Feature record: none (research). ADR 014 is untouched: this study supplies evidence for its open question and decides nothing for FS-05
(scheduler) or FS-02 (protocol 3.2 negotiation).

Question (roadmap row FS-06): per pooler and configuration, which message sequences succeed, what happens when they fail (SQLSTATE and
message), how many round trips they cost, and whether the connection stays pinned. Decision rule: a per-pooler profile written from the
results, and a fallback sequence wherever the one-flush form fails.

Base: `origin/main` at `3e2fc81942f6e4006eb96361cf7fa1341131d68e`. Run date 2026-11-21.

## Findings in short

1. **The ADR 014 form works behind every pooler that could be run.** `Parse(unnamed) Bind Describe(portal) Execute Sync` in one write cost one
   client-side round trip and succeeded 5/5 on PgBouncer 1.26.1, Supavisor 2.10.1, PgDog 0.1.66 and Odyssey 1.5.2 in all 16 configurations
   (transaction mode with each prepared-statement setting, and session mode). So did the two-statement batch (S5), the pipelines of depth 2, 10
   and 100 with a Sync each (results in order), and BEGIN, S1, COMMIT in one flush (S7, S7b).
2. **Named statements are the problem, and only where the pooler does not track them.** Bind without Parse (S2b) and shared names (S4) fail
   with 26000, 42P05 or give a wrong row on `pgbouncer-off`, `supavisor-default`, `pgdog-disabled` and `odyssey-off`. PgBouncer, PgDog and
   Odyssey have tracking **on by default**; Supavisor 2.10.1 has it **off by default** (flag `NAMED_PREPARED_STATEMENTS_ENABLED`), so Supavisor
   out of the box is the one default configuration where named statements fail. In the named pinning probe (8 clients, 20 transactions each,
   5 runs) the failing share was 373 of 800 transactions on `pgbouncer-off`, 516 on `supavisor-default`, 357 on `pgdog-disabled`, 760 on
   `odyssey-off`. A single S2b run is therefore luck-dependent (it passes when the next server connection happens to hold the statement).
3. **Silent wrong rows exist, and they are the worst outcome.** With tracking off, a name used by two clients for different SQL returned the
   other client's row with no error: `pgbouncer-off` (S4b-B 5/5 runs, S4c 30/30), `supavisor-default` (S4b-B 5/5, S4c 30/30) and
   `pgdog-disabled` (S4a-B 5/5, S4b-B 5/5, S4c 30/30; PgDog answered B's Parse with a ParseComplete of its own and never forwarded it, see
   `results/trace-excerpts/pgdog-disabled.S4a-B.run2.txt`). `odyssey-off` gave 26000 instead. With tracking on there was no wrong row anywhere.
4. **An unnamed statement must not be held across a Sync.** Parse and Describe(statement) in one flush, Sync, other clients run, then Bind
   (S3ui) failed 0/5 on every PgBouncer transaction configuration (26000 `unnamed prepared statement does not exist`) and on Supavisor
   (**08P01** `bind message supplies 1 parameters, but prepared statement "" requires 0`: another client's unnamed statement was found).
   PgDog and Odyssey (tracking on) passed it. The Flush form (`Parse Describe(statement) Flush`, then `Bind Execute Sync`, S3f) passed 5/5 in all 16
   configurations, so it is the fallback for describe-first.
5. **Sharing is real and pinning is visible.** In every transaction-mode configuration 8 clients shared 2 backends (2 distinct PIDs per run,
   no client stayed on one backend; Supavisor used 3 backends for `pool_size` 2). In every session-mode control each client kept its backend
   (40 of 40 client runs on one PID, 8 backends). The poolers' own views agree: `SHOW POOLS` and `SHOW SERVERS` on PgBouncer, PgDog and Odyssey list 2 server connections in
   transaction mode and 8 in session mode; Supavisor's metrics report 3 and 8 database connections.
6. **The pooler adds round trips on its own link, never on the client's.** Client-side trace: 1 round trip for S1, S2, S2b, S5, S6, S7 and 2 for S3,
   identical to the direct control, in all 18 targets. On the pooler-to-Postgres link PgBouncer, PgDog and Odyssey send a simple query
   (`SET application_name ...`) before the client's statement and wait for it; Odyssey also sends a reset batch afterwards; Supavisor sends nothing of its own.
   For the depth-100 pipeline in transaction mode the pooler link carried 1 round trip (PgBouncer, Supavisor), 100 (PgDog) and 300 (Odyssey) (`results/matrix.md` section 2).
   This is a count from traces; no speed comparison is made.
7. **What a pooler does to the bytes.** PgBouncer renames named statements to `PGBOUNCER_n` and, when a backend lacks the statement, puts its own Parse
   in front of Bind in the same flush; Odyssey turns **even unnamed** statements into named `odyssey_pstmt_n` and drops Parse when the SQL is already
   prepared; PgDog (default) rewrites named statements, forwards Bind only, and sends each statement of a batch with its own Flush (S5 is four
   exchanges on its link); Supavisor with the flag on rewrites names to `sv_...`; Supavisor with the flag off forwards everything unchanged.
   Statements left on the backends after the last run (`pg_prepared_statements`, read through the pooler): PgBouncer 6 on each of 2 (32 and 38 with
   tracking off, client-chosen names), PgDog 6 and 6 (33 and 37 `disabled`), Odyssey 18 and 19, Supavisor 53 to 58 on 3 backends with the flag on (19 to 27 off).
8. **Detection from the login.** PgBouncer 1.26.1 sends `pgbouncer.version`, `pgbouncer.pool_mode` and `pgbouncer.max_prepared_statements`
   (claim P-03 confirmed), which also reveals whether tracking is on. Supavisor replaces `application_name` with `Supavisor`. PgDog and Odyssey send nothing that names
   them. No login value tells whether Supavisor's flag is on.
9. **Reference clients.** `pg` and postgres.js with named statements: 160/160 wherever tracking is on; `pg` 60/160 and postgres.js 103/160 on
   `supavisor-default`, 40/160 and 152/160 on `pgbouncer-off`, 8/160 and 80/160 on `odyssey-off`, `pg` 160/160 and postgres.js 148/160 on
   `pgdog-disabled`. Unnamed use of both libraries: 160/160 everywhere. (The reference clients share one name and one SQL text across
   their 8 connections, which hides the wrong-row case that S4 exposes.)
10. **Documentation and defaults disagreed in places.** PgBouncer's sample `pgbouncer.ini` says `;max_prepared_statements = 0` while the
    documented and effective default is 200 (confirmed by the login value); Odyssey's configuration table says `pool_reserve_prepared_statement | yes (0)` while the
    source default is on (`pool.c`) and it behaves as on; Supavisor's FAQ and Supabase's page describe different settings, not a contradiction (P-02).

Not verified here: RDS Proxy, Neon pooled, Hyperdrive (no accounts); see below and `results/hosted-runbook.md`.

## The matrix in brief

Generated by `scripts/matrix.ts` (`results/matrix.md` has the full tables, error messages, round trips, pooler statistics and login parameters).
Cell = runs that succeeded out of the runs made (5 per sequence; S3 pair, S3u pair and S4 add several sequences), then every SQLSTATE seen.
`WRONG ROW` = a row for another statement and no error. Column meanings are under the table.

| target | S1 | S2 | S2b | S3 pair | S3u pair | S3f | S4 | S5 | S6 | S7 / S7b | pinned | pg | postgres.js |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| direct-tls | 5/5 | 5/5 | 5/5 | 10/10 | 10/10 | 5/5 | 50/50 | 5/5 | 15/15 | 10/10 | 40/40 | n/a | n/a |
| direct | 5/5 | 5/5 | 5/5 | 10/10 | 10/10 | 5/5 | 50/50 | 5/5 | 15/15 | 10/10 | 40/40 | n/a | n/a |
| odyssey-default | 5/5 | 5/5 | 5/5 | 10/10 | 10/10 | 5/5 | 50/50 | 5/5 | 15/15 | 10/10 | 0/0 | 160/160 | 160/160 |
| odyssey-off | 5/5 | 5/5 | 0/5 26000 | 0/10 26000 | 0/10 26000 | 5/5 | 10/50 26000 | 5/5 | 15/15 | 10/10 | 0/0 | 8/160 26000 | 80/160 26000 |
| odyssey-on | 5/5 | 5/5 | 5/5 | 10/10 | 10/10 | 5/5 | 50/50 | 5/5 | 15/15 | 10/10 | 0/0 | 160/160 | 160/160 |
| odyssey-session | 5/5 | 5/5 | 5/5 | 10/10 | 10/10 | 5/5 | 50/50 | 5/5 | 15/15 | 10/10 | 40/40 | 160/160 | 160/160 |
| pgbouncer-default | 5/5 | 5/5 | 5/5 | 10/10 | 5/10 26000 | 5/5 | 50/50 | 5/5 | 15/15 | 10/10 | 0/0 | 160/160 | 160/160 |
| pgbouncer-off | 5/5 | 5/5 | 5/5 | 8/10 26000 | 5/10 26000 | 5/5 | 10/50 42P05,WRONG ROW | 5/5 | 15/15 | 10/10 | 0/0 | 40/160 42P05 | 152/160 26000 |
| pgbouncer-on | 5/5 | 5/5 | 5/5 | 10/10 | 5/10 26000 | 5/5 | 50/50 | 5/5 | 15/15 | 10/10 | 0/0 | 160/160 | 160/160 |
| pgbouncer-session | 5/5 | 5/5 | 5/5 | 10/10 | 10/10 | 5/5 | 50/50 | 5/5 | 15/15 | 10/10 | 40/40 | 160/160 | 160/160 |
| pgdog-default | 5/5 | 5/5 | 5/5 | 10/10 | 10/10 | 5/5 | 50/50 | 5/5 | 15/15 | 10/10 | 0/0 | 160/160 | 160/160 |
| pgdog-disabled | 5/5 | 5/5 | 1/5 26000 | 9/10 26000 | 10/10 | 5/5 | 10/50 WRONG ROW | 5/5 | 15/15 | 10/10 | 0/0 | 160/160 | 148/160 26000 |
| pgdog-extended | 5/5 | 5/5 | 5/5 | 10/10 | 10/10 | 5/5 | 50/50 | 5/5 | 15/15 | 10/10 | 0/0 | 160/160 | 160/160 |
| pgdog-extended_anonymous | 5/5 | 5/5 | 5/5 | 10/10 | 10/10 | 5/5 | 50/50 | 5/5 | 15/15 | 10/10 | 0/0 | 160/160 | 160/160 |
| pgdog-session | 5/5 | 5/5 | 5/5 | 10/10 | 10/10 | 5/5 | 50/50 | 5/5 | 15/15 | 10/10 | 40/40 | 160/160 | 160/160 |
| supavisor-default | 5/5 | 5/5 | 4/5 26000 | 7/10 26000 | 5/10 08P01 | 5/5 | 10/50 42P05,WRONG ROW | 5/5 | 15/15 | 10/10 | 0/0 | 60/160 42P05 | 103/160 26000,42P05 |
| supavisor-on | 5/5 | 5/5 | 5/5 | 10/10 | 5/10 08P01 | 5/5 | 50/50 | 5/5 | 15/15 | 10/10 | 0/0 | 160/160 | 160/160 |
| supavisor-session | 5/5 | 5/5 | 5/5 | 10/10 | 10/10 | 5/5 | 50/50 | 5/5 | 15/15 | 10/10 | 40/40 | 160/160 | 160/160 |

`S3 pair` = S3 and S3i (named, second flush after other clients ran); `S3u pair` = S3u and S3ui (unnamed statement across the first Sync);
`S4` = S4a, S4b, S4c (name collisions between clients); `S6` = depths 2, 10, 100; `pinned` = client runs (of 40) whose 20 transactions all stayed on one backend, unnamed
probe / named probe (0 means shared, 40 means pinned); `pg` and `postgres.js` = reference clients with named statements, 8 clients x 20 transactions.
Which of the 2 backends a transaction lands on varies, so an S2b count with tracking off is luck-dependent: an earlier complete pass of the same code
gave `pgbouncer-off` S2b 3/5 (5/5 in the reported pass), `supavisor-default` 3/5 (4/5), `pgdog-disabled` 2/5 (1/5), and `odyssey-off` 0/5 both times; the named probe has the stable rates.

## Pooler profiles

### PgBouncer 1.26.1 (ISC)
- **Setting**: `max_prepared_statements` (`config.md`: "When this is set to a non-zero value PgBouncer tracks protocol-level named prepared statements ... in transaction and statement pooling mode"; `Default: 200`). On by default; `default` and `on` (explicit 200) behaved identically.
- **Tracking on**: everything passes except an unnamed statement across a Sync (26000). Names are rewritten to `PGBOUNCER_n` per query text, so two clients with the same name and different SQL do not collide (S4, S4c 30/30). Bind-only on a backend without the statement: PgBouncer prepends its own Parse in the same flush. No pinning (2 PIDs per run).
- **Tracking off (`0`)**: S1 fine; named statements pass names through to the backend: 26000 (S2b, S3i), 42P05 and silent wrong rows (S4b-B 5/5, S4c 30/30), reference `pg` 40/160.
- **Session mode**: behaves like a direct connection, pinned (8 PIDs), `pgbouncer.pool_mode=session`.
- **Login**: `pgbouncer.version`, `pgbouncer.max_prepared_statements`, `pgbouncer.pool_mode`. Pooler link: `SET application_name` round trip before each client transaction.

### Supavisor 2.10.1 (Apache-2.0)
- **Setting**: `NAMED_PREPARED_STATEMENTS_ENABLED` (env, default false) or the tenant `feature_flags.named_prepared_statements`; the FAQ says named statements are supported in transaction mode "when the `named_prepared_statements` feature flag is enabled".
- **Default (flag off)**: S1 fine. Named statements pass through: 26000 (S2b, S3i), 42P05 (S4a-B 0/5), silent wrong rows (S4b-B 5/5, S4c 30/30), reference `pg` 60/160, postgres.js 103/160, named probe 284/800.
- **Flag on**: S2, S2b, S3, S4 all pass (names rewritten to `sv_...`, Parse added by the pooler when the backend lacks the statement); S3ui fails with 08P01. Reference clients 160/160.
- **Session mode** (session port): like direct, pinned.
- **Login**: `application_name=Supavisor` in place of the client's value; no flag indicator. Used 3 backends for `pool_size` 2 in transaction mode. No SQL statistics view; the Prometheus endpoint (JWT-protected) gave database connection counts.
- **Quick start forced**: its own metadata Postgres, a tenant created through the management API with an HS256 JWT, a user name of the form `user.tenant`, a manager user plus `auth_query` (a non-manager user without `auth_query` was rejected with 400), and `RLIMIT_NOFILE` emptied (the entrypoint's `ulimit` fails in this sandbox).

### PgDog 0.1.66 (AGPL-3.0; black-box only, no code copied)
- **Setting**: `prepared_statements` in `[general]` (source comment: "Enables support for prepared statements. Default: `extended`"; values `disabled`, `extended`, `extended_anonymous`, `full`); `pooler_mode` `transaction` or `session`. PgDog turns the handling off by itself in session mode (`core.rs`).
- **`default` = `extended` = `extended_anonymous`**: all sequences pass, including S3ui, with no pinning. `extended_anonymous` also passes everything; compared with `extended`, its S2 runs all show a rewritten statement name and its S2b runs all show a Parse added by the pooler (no explanation was looked for).
- **`disabled`**: S2b 26000, silent wrong rows in S4a-B, S4b-B and S4c (it answered B's Parse itself and forwarded nothing), reference postgres.js 148/160.
- **Pooler link**: `SET application_name` first; each statement of a batch is sent as `P B D E H` and awaited, the Sync comes last (S5: 4 round trips; S6-100: 100).
- **Login**: nothing names it; the parameter list is alphabetical.
- **Quick start forced**: `pgdog.toml` and `users.toml` read from `/pgdog`, the user password in plain text in `users.toml`, an `[admin]` section with its own password for `SHOW POOLS`.

### Odyssey 1.5.2 (BSD-3-Clause)
- **Setting**: `pool_reserve_prepared_statement` per route ("Enable support of prepared statements in transactional pooling."). The table in `rules.md` shows `yes (0)`; `pool.c` sets it to 1; the default behaved as on, and `default` and `on` were identical.
- **On**: all pass, including S3ui. Every statement, even unnamed, becomes `odyssey_pstmt_n` on the backend (18 and 19 statements on the 2 backends after the run); Parse is dropped when the SQL is already prepared there. No pinning.
- **Off (`no`)**: S1, S3f, S5, S6, S7 pass; S2b, S3, S3i, S3u, S3ui, S4b, S4c fail with 26000 (named probe 40/800 ok), no wrong rows; reference `pg` 8/160.
- **Session**: like direct, pinned.
- **Pooler link**: `SET application_name` before and a reset batch (`SET SESSION AUTHORIZATION DEFAULT; RESET ALL; ... DISCARD TEMP`) after every transaction: 3 round trips for S1 on its link, 300 for S6-100.
- **Login**: nothing names it; `in_hot_standby` is absent and the order differs. Console database `console` for `SHOW POOLS` / `SHOW SERVERS`.
- **Quick start forced**: SCRAM towards clients needs the plain password in the route (`password "..."`) plus `storage_user` and `storage_password`; the image uses a mounted `/etc/odyssey/odyssey.conf` unchanged.

## Version and digest table

Chosen on 2026-11-21 from Docker Hub tags (`library/postgres`, `supabase/supavisor`) and `git ls-remote --tags` (PgBouncer, PgDog, Odyssey,
Supavisor), then pinned by digest. "Newest stable" = the highest tag that is not a release candidate.

| component | version | image or source | digest / commit | license |
| --- | --- | --- | --- | --- |
| PostgreSQL (backend) | 19.0 (`19.0 (Debian 19.0-1.pgdg13+1)`; the `19` tag, newer than the `19rc2` candidate) | `docker.io/library/postgres:19.0` | `sha256:bb6e70add742cd868fb62cb3b2f67d1dd2bdd2b65a521e778420748753687c60` | PostgreSQL License |
| PgBouncer | 1.26.1 | built from the release tarball `pgbouncer-1.26.1.tar.gz` (`scripts/docker/pgbouncer.Dockerfile`, base `debian:trixie-slim` `sha256:a72b4433de1cf7d6bae0c4cee74d0547f58601a643b3375f070c51600d63b6b2`); the project's Docker Hub image was still at 1.25.2 | tarball `sha256:00886a2994b4844cd37110970df777772cfc42a74c400522c82fba509a3f42d9`; tag `pgbouncer_1_26_1` = commit `f03e9bf263d7ccd5d1d152a61811bf3258dd6b87` (tag object `c4a9e336a75bb7a05bec8661a724704170efe251`); no signature file was published at the asset URL, so the tarball was not checked against the commit | ISC (`COPYRIGHT`) |
| Supavisor | 2.10.1 | `docker.io/supabase/supavisor:2.10.1` | `sha256:b3bc49a23daa3556084a03bda62cb211cd5f62250f70f0295be12930a65073b6`; tag `v2.10.1` = commit `83ca93e1f463f37ff7882aaa87f810a0de5ef9cc` (the image carries no revision label) | Apache-2.0 |
| PgDog | 0.1.66 | `ghcr.io/pgdogdev/pgdog:v0.1.66` | `sha256:5bb1ccd631f1783af211738cde0f135858bc7dc04c2273560c7fefffae2600e4`; image revision label `4453d6d484b12b77f10dde6ada6e55c018790387` = tag `v0.1.66` | AGPL-3.0 (nothing copied; black box) |
| Odyssey | 1.5.2 (`v1.6.0-rc1` exists, a candidate) | `ghcr.io/yandex/odyssey:1.5.2` (`latest` has the same digest) | `sha256:dceed1de1a2aed0c58a29e8ccf097f61efd75c172ad0e5069b133d4e3a62d278`; revision label `2cca6bf26c1ba6d1bdce917f96a37bcb26408ffe` = tag `v1.5.2` | BSD-3-Clause |
| `pg` (node-postgres) | 8.23.1 (`pg-protocol` 1.16.1) | `bun add pg` in `work/refclients/` | | MIT |
| `postgres` (postgres.js) | 4.1.1 | `bun add postgres` in `work/refclients/` | | Unlicense |
| runtime | Bun 1.4.4, Docker 29.10.0 | 4 vCPU, 15 GiB RAM, Linux 6.18.44; every container, proxy and client on this one machine | | |

The two libraries are installed with bun into the ignored `work/refclients/` and are never imported by the harness (`scripts/ref/*.ts` load them
by path for the reference runs and the byte comparison). Supavisor's metadata database is a second `postgres:19.0` container.

## Documentation and source read

Every page, file and source line cited here or in `results/ledger.md` was read as **raw page text**: a repository file at the release tag (cloned
into the ignored `work/src/`), or a web page fetched with `curl` and stripped of HTML by a local script (`work/docs/`). No summarising tool was used.
The settings were taken from the poolers' own files: PgBouncer `doc/config.md` and `src/main.c`; PgDog `pgdog-config/src/general.rs`, `pooling.rs`, `core.rs`;
Odyssey `docs/configuration/rules.md`, `docs/features/pooling.md`, `sources/pool.c`; Supavisor `docs/faq.md`, `docs/configuration/env.md`, `docs/orms/prisma.md`, `config/runtime.exs`.

## Not verified here

- **RDS Proxy, Neon pooled, Hyperdrive.** No accounts. `scripts/hosted.ts` runs the study (TLS with SNI, no proxies, the client's own trace, a P-04
  pinning check, the reference clients) against `FS06_RDSPROXY_URL` and `FS06_NEON_URL`; an unset variable writes "Not verified here"
  (`results/hosted/*.json`). The hosted path was exercised end to end against the local TLS server (the run gave a complete result file with no host,
  user or password in it); that file was deleted so it cannot be mistaken for a hosted result. Hyperdrive needs a Worker and was not attempted. Ali's commands and the JSON to send back: `results/hosted-runbook.md`.
  The set-up commands in the runbook are as documented in the AWS CLI and Neon documentation and were **not run**.
- Protocol 3.2 (FS-02) and the scheduler (FS-05): not touched.
- Why PgDog `disabled` answers a repeated name itself, why `extended_anonymous` differs from `extended`, why Supavisor opens a third backend: observed, not traced to source.
- Other settings of each pooler (statement pooling mode, `full` in PgDog, Supavisor `txn_mode_leak_action`, per-tenant flags, TLS between pooler and server, PgBouncer `server_reset_query`), and other versions.
- Server pool 2 with 8 clients on one machine says nothing about load. All timings are from this machine; no speed claim is made.
- The claim that the two documentation sources for Supavisor named statements apply to the hosted shared pooler: the hosted pooler's flag state is not observable.

## Decisions beyond the brief

1. Added `off` configurations where the default is already on (`pgbouncer-off` = `max_prepared_statements = 0`, `odyssey-off` = `pool_reserve_prepared_statement no`, `pgdog-disabled`), and PgDog `extended_anonymous`. For PgBouncer, PgDog and Odyssey "default" and "setting turned on" are the same behaviour, so both were run to show it (`default` and `on`/`extended`) and the contrast was added. Supavisor: `default` (flag off) and `on` (flag on).
2. Sequences added to the brief's list: S3u/S3i/S3ui/S3f (a describe-first fallback needs to survive the first Sync, so it was tested named and unnamed, with and without other clients between the flushes, and with a Flush instead of a Sync), S4c (a deterministic way to a silent wrong row), S7b (extended-protocol BEGIN and COMMIT). S2b, S3i and S3ui run the other 7 clients between the two flushes so the server connection can change.
3. Session mode runs with a pool of 8 (not 2) so 8 clients can hold a backend each.
4. The proxies are Bun processes on the host, not containers; the poolers reach the server-side proxy through the Docker host gateway. The Docker network `fs06` holds Postgres, the pooler and (for Supavisor) its metadata database.
5. `pg_prepared_statements` is read through the pooler (it is per session), plus the server-side trace.
6. Supavisor: the tenant user is a manager user with an `auth_query`, because a non-manager user without one was rejected by the API; `RLIMIT_NOFILE` is emptied because the image's `ulimit` fails in this sandbox. Its development secrets (`SECRET_KEY_BASE`, `VAULT_ENC_KEY`, `API_JWT_SECRET=dev`) are the throwaway values from Supavisor's own `docker-compose.yml`; the local Postgres password `fs06pw` is likewise a throwaway for a container that exists only during the run. No real credential is used anywhere.
7. PgBouncer is built from the release tarball because the project's Docker Hub image lags (1.25.2 at the run date); the build installs only the binary (the manual pages need Python and pandoc).
8. Reference clients also run unnamed (`pg` without `name`, postgres.js with `prepare: false`), and the hosted harness also runs them.
9. A TLS control (self-signed certificate, SNI, SCRAM over TLS) and a `p04` probe in the hosted runner were added.
10. The results folder holds compact per-target summaries; the raw per-run JSON and raw message traces stay in the ignored `work/raw/`.

## Method in short

- **Harness** (`scripts/lib/`): a PostgreSQL v3 client written from the protocol description in plain bytes, Bun only, no dependencies:
  startup, MD5/cleartext/SCRAM-SHA-256 authentication, optional TLS (SSLRequest, then TLS with the host name as SNI; no SNI for an IP address).
  `seq.ts` builds the sequences as byte arrays and checks every reply: the exact backend message types per `ReadyForQuery`, the rows, their
  order. A run counts as `ok` only if all of that holds; otherwise the outcome is `error` (with SQLSTATE and message), `timeout` (10 s, the
  connection is dropped), `closed`, or `wrong-result`. A row that belongs to another statement, with no error, is flagged `WRONG ROW`.
- **Two recording proxies** (`scripts/lib/proxy.ts`, with their own framing parser, sharing no code with the client): client side (harness to
  pooler, 20 ms each way, so one round trip is about 40 ms) and server side (pooler to Postgres, no delay). For the authentication exchange
  only message types and lengths are kept.
- **Layout**: `harness -> client-side proxy -> pooler container -> server-side proxy -> Postgres container`, containers on the Docker network
  `fs06`, one pooler up at a time, server pool 2, 8 client connections (session-mode controls: pool 8, so 8 clients fit).
- **Per target, 5 runs.** Each run opens 8 fresh clients and runs S1, S2, S2b (after the other 7 clients ran 6 transactions each on the shared
  server connections), S3 variants, S4, S5, S6 (depths 2, 10, 100), S7; then two pinning probes (8 clients at once, 20 transactions each,
  unnamed and named), a readback of `pg_prepared_statements` through the pooler, and the pooler's own statistics view while the clients are
  busy and idle. After the 5 runs: the reference clients `pg` and `postgres` (postgres.js), 8 clients x 20 transactions of the same statement.
- **Round trips by two measures**: (1) from the client-side trace, a run of client bytes followed by server bytes counts as one; (2) elapsed time
  from the first byte written to the last `ReadyForQuery`, divided by 40 ms. A third view, the server-side trace, shows what the pooler did
  on its own link.
- **Controls first.** Every sequence directly against Postgres (through the client-side proxy), and again over TLS against a server with a
  self-signed certificate: all pass with 1 round trip (2 for S3) before any pooler number was used (`results/targets/direct.json`,
  `direct-tls.json`, `results/tls-control.json`).

### Sequences (results use these ids)

| id | what is written | notes |
| --- | --- | --- |
| S1 | `Parse(unnamed) Bind Describe(portal) Execute Sync`, one write | the ADR 014 form |
| S2 | the same with a statement name | first use |
| S2b | `Bind Describe(portal) Execute Sync`, no Parse | same client connection, after a transaction ended and 7 other clients ran |
| S3 | `Parse(name) Describe(statement) Sync`, then `Bind Execute Sync` | two round trips |
| S3i | S3 with 7 other clients running between the two flushes | added: forces a server-connection switch |
| S3u / S3ui | S3 with the unnamed statement, without / with the other clients in between | added: the unnamed statement has to survive the first Sync |
| S3f | `Parse Describe(statement) Flush`, then `Bind Execute Sync` | added: no Sync between, so no transaction boundary |
| S4a / S4b | two clients use the same statement name for different SQL: both first use (a), both Bind-only reuse (b) | checks the row each client gets |
| S4c | client A holds its server connection in a transaction with name N; B parses N meanwhile; then B reuses N with Bind only, 6 times | added: a way to get a silent wrong row when names are not isolated |
| S5 | two statements, one flush, one Sync | |
| S6-2 / S6-10 / S6-100 | a Sync per statement, depth 2, 10, 100, one write | results must come back in order |
| S7 / S7b | `BEGIN`, S1, `COMMIT` in one write (simple-protocol BEGIN/COMMIT / extended-protocol BEGIN/COMMIT) | |

### Bytes: harness vs `pg` vs postgres.js (`results/bytes-compare.md`)

The same statement (`SELECT $1::int AS n`, parameter 7), one named and one unnamed, captured through the client-side proxy against Postgres:
the harness and `pg` send the same five messages in the same order in one flush (`P B D(portal) E S`); Parse, Describe, Execute and Sync are
byte for byte identical. **Bind differs**: `pg` sends explicit parameter and result format codes (one `0`, text, each), the harness sends zero
format codes, which the protocol defines as "all text"; the two are equivalent on the wire. postgres.js differs in three ways: it sends
`Parse Describe(statement) Bind Execute Sync` (the Describe asks about the statement, not the portal, and comes before Bind), Parse carries one
parameter type OID of 0 (unspecified) where the harness sends none, and its statement names are generated per connection (`end17g1q1`,
`7g8e3gc51` in two runs) rather than chosen. Both libraries put the whole sequence in one flush, so one round trip, like the harness.

## Defects in the harness and proxies found during the study

1. **S3f expectation** (harness): I grouped the expected reply types by `ReadyForQuery`, but a Flush produces none, so the control failed 5/5. The
   expectation was wrong, not the check; fixed by describing the group as one (`1 t T 2 D C Z`) and reading a fixed number of messages after the Flush.
2. **Stale array in the server-side proxy**: `reset()` replaced the message array while connections opened before the reset kept appending to the
   old one, so the pooler's warm-up connection vanished from the server-side trace (PgBouncer rows showed no server traffic). Fixed by clearing in place; all numbers were regenerated.
3. **Client-side trace dropped Describe frames** (a filter meant for DataRow also removed Describe). Fixed.
4. **Deadlock in the bytes comparison**: a synchronous child process blocked the event loop that hosts the proxy. Fixed with an async spawn.
5. **"As sent" test too strict**: pooler-originated simple queries (`SET application_name`, resets) and chunking made every row "not as sent". Redefined:
   the pooler's own simple queries are listed separately; the comparison is over the client's messages only.
6. **Server-side window for S3i/S3ui** included the other clients' traffic during the gap, inflating pooler-link counts. Fixed with one window per step.
7. **TLS with an IP address as server name** threw in Node's TLS layer. Fixed (no SNI for an IP).
8. **TLS control without a message trace**: the proxies cannot parse TLS, so the client-to-connection mapping failed and round trips read 0. Fixed by using the client's own trace when the connection is not mapped.
9. Set-up mistakes, not pooler results: PgBouncer refuses to run as root (container user 65534); the first Supavisor metadata-database wait looked for the wrong text; the PgBouncer image build lacked `libc6-dev` and then needed the man-page step skipped.

Known limits that remain: harness, both proxies and the delay timer share one Bun process and one event loop (timing noise of about a millisecond
was visible in the control: 41.6 to 42.1 ms for one round trip); the round-trip count from the trace is by direction change, so a client that
splits one logical flush into two writes with a reply in between would count twice (the harness never does); `pg_prepared_statements` is
session-local and was read through the pooler, so it shows the backend the read landed on, not every backend.


## Reproduce

Needs bun, Docker (the daemon may need `dockerd` started by hand) and network access to Docker Hub and ghcr.io. From the repository root:

```bash
cd research/fs-06
mkdir -p work/refclients && (cd work/refclients && echo '{"name":"fs06-refclients","private":true}' > package.json && bun add pg@8.23.1 postgres@4.1.1)
docker pull postgres:19.0 supabase/supavisor:2.10.1 ghcr.io/pgdogdev/pgdog:v0.1.66 ghcr.io/yandex/odyssey:1.5.2
# PgBouncer: download the 1.26.1 release tarball and the session's CA bundle into work/build/, then
docker build --network host -f scripts/docker/pgbouncer.Dockerfile -t fs06/pgbouncer:1.26.1 work/build
bun scripts/control.ts            # controls: every sequence against Postgres directly, must print CONTROL OK
bun scripts/tls-control.ts        # TLS control (needs the TLS Postgres container described in the script)
bun scripts/bytes-compare.ts      # harness vs pg vs postgres.js bytes
scripts/run-all.sh                # every pooler configuration (one at a time), results/targets/*.json
bun scripts/matrix.ts             # results/matrix.md
bun scripts/check-ledger.ts       # ledger IDs against the appendix, writes results/ledger.md
bun scripts/hosted.ts rdsproxy    # hosted targets, see results/hosted-runbook.md
bunx tsc -p research/fs-06/tsconfig.json   # from the repository root: typechecks this folder once, outside every src project
```

`scripts/excerpt.ts <target> <sequence> <run> [--save]` prints the two proxies' view of one sequence run; `scripts/peek.ts <target>` prints a summary.

## Files

- `scripts/lib/` harness: `wire.ts`, `scram.ts`, `client.ts`, `proxy.ts`, `seq.ts`, `target.ts`, `admin.ts`, `paths.ts`; `scripts/*.ts` runners; `scripts/ref/` reference-client runs; `scripts/docker/` the PgBouncer Dockerfile; `scripts/ledger.json` and `scripts/claims.json` for the ledger.
- `results/targets/*.json` per-target summaries (5 runs, every error, round trips, forwarding notes, pinning, statistics, login parameters, reference clients); `results/matrix.md`; `results/ledger.md`; `results/hosted-runbook.md`; `results/hosted/*.json`; `results/bytes-compare.{md,json}`; `results/tls-control.json`; `results/trace-excerpts/` (17 sequence runs seen from both proxies; DataRow contents are left out).
- `.gitignore` here ignores `work/` (pooler checkouts, saved pages, reference-client install, certificates, throwaway configs, raw per-run JSON and raw traces) and `*.log`.

## Proposed decision

Findings only; no ADR in this PR. Per pooler and configuration: the sequence OKDriver can rely on and the fallback. "Named" means a statement
name chosen by the client with Bind-only reuse; "unnamed" means S1 for every execution. None of the poolers needs more than one round trip on the client link
for S1.

| pooler and configuration | recommended sequence | fallback sequence | detect from login | avoid |
| --- | --- | --- | --- | --- |
| PgBouncer 1.26.1, transaction, `max_prepared_statements` > 0 (default 200) | S1 unnamed; S2 then S2b for named reuse; S5/S6/S7 as written | describe-first with a Flush (S3f) or a named S3 (never an unnamed statement across a Sync, S3ui: 26000) | `pgbouncer.max_prepared_statements` > 0 | an unnamed statement held across a Sync |
| PgBouncer, transaction, `max_prepared_statements` = 0 | S1 unnamed only, every execution | S3f for describe-first | `pgbouncer.max_prepared_statements` = 0 | any named statement (26000, 42P05, silent wrong rows) |
| PgBouncer, session | anything that works directly (S1, S2, S2b, S3) | none needed | `pgbouncer.pool_mode` = session | |
| Supavisor 2.10.1, transaction, default (flag off) | S1 unnamed only, every execution | S3f for describe-first | `application_name` = `Supavisor`; the flag is not visible, so assume off | any named statement (26000, 42P05, silent wrong rows), unnamed across a Sync (08P01) |
| Supavisor, transaction, `NAMED_PREPARED_STATEMENTS_ENABLED=true` | S1; S2 then S2b | S3f | not visible: needs a user-supplied setting | an unnamed statement across a Sync (08P01) |
| Supavisor, session port | anything that works directly | none needed | `application_name` = `Supavisor` | |
| PgDog 0.1.66, transaction, `extended` (default) or `extended_anonymous` | S1; S2 then S2b; S3, S3u and S3f all passed | S3f | nothing names it | |
| PgDog, transaction, `disabled` | S1 unnamed only, every execution | S3f | nothing names it | any named statement shared by clients (silent wrong rows, 26000) |
| PgDog, session | anything that works directly | none needed | nothing names it | |
| Odyssey 1.5.2, transaction, `pool_reserve_prepared_statement yes` (default) | S1; S2 then S2b; S3 variants passed | S3f | nothing names it | |
| Odyssey, transaction, `no` | S1 unnamed only, every execution | S3f (S3, S3u fail with 26000) | nothing names it | any named statement (26000) |
| Odyssey, session | anything that works directly | none needed | nothing names it | |
| RDS Proxy, Neon pooled, Hyperdrive | not verified here: S1 only until `results/hosted-runbook.md` has been run | S3f | not verified | |

Where nothing names the pooler (PgDog, Odyssey) or the setting is invisible (Supavisor's flag), the safe profile is the one in the "off" rows
(S1 for every execution, S3f for describe-first); it costs the same single client-side round trip.
