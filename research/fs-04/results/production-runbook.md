# Production runbook (owner side)

Nothing in FS-04 ran on Cloudflare: the study had no account. Every production cell in `capabilities.md` therefore reads **Not verified here**, and the claimable value of every capability is false. This runbook is how the account owner turns those cells into `production-observed` results with the same harness and the same probes.

Scope: outbound `connect()` from a deployed Worker to one public PostgreSQL server. Out of scope (see the README, "Not verified"): Hyperdrive, Neon HTTP or WebSocket, Durable Object sockets, inbound sockets, other workerd versions, performance.

## What is needed

- A Cloudflare account that can deploy a Worker on `workers.dev`.
- A PostgreSQL server that is **reachable from the public internet on a name and port, with a certificate chained to a publicly trusted CA**. Production `connect()` refuses localhost, private addresses and Cloudflare IP ranges (ledger D-09, D-13), and verifies the server certificate against Cloudflare's trust store (ledger D-16, D-19). A throwaway server and a throwaway role are the right size: the probes open up to 50 connections, write up to 128 MiB per run, and call `pg_sleep`.
- The role needs `LOGIN`, `CONNECT` on one database, and nothing else. `pg_stat_ssl` and `pg_stat_activity` show a role its own sessions, which is all the probes use. The server's `max_connections` must allow about 60.
- `bun` on the machine that runs the harness (the repository's rule: no npm, pnpm or yarn). Wrangler is run through `bunx` at an exact version and is **never added to the repository** (no `package.json`, no lockfile in `research/fs-04`). Tested without an account only as far as `deploy --dry-run` (bundle builds, 49.84 KiB, no bindings, no `nodejs_compat`).

## 1. Deploy the Worker

Run from `research/fs-04/worker`. The version is pinned; do not use `latest`.

```sh
export WRANGLER_SEND_METRICS=false
bunx wrangler@4.162.0 login                       # or set CLOUDFLARE_API_TOKEN for this shell only

# The database URL and the bearer token are Worker secrets. `secret put` reads the value from the prompt (or stdin),
# so it never appears on a command line or in shell history. The URL looks like postgres://user:password@host:5432/database
bunx wrangler@4.162.0 secret put DATABASE_URL
openssl rand -hex 24                              # make a token, keep it in your clipboard only
bunx wrangler@4.162.0 secret put PROBE_TOKEN      # paste the token

bunx wrangler@4.162.0 deploy                      # prints https://okdriver-fs04-probe.<subdomain>.workers.dev
```

`wrangler.jsonc` sets `compatibility_date` 2026-11-01 and **no** `nodejs_compat`; the Worker uses Web APIs only. If the deploy or the first request fails because a Node API is missing, that is a finding: record it in the README, do not add the flag silently.

The Worker answers `401` without `Authorization: Bearer <PROBE_TOKEN>` (only `/health` is open and returns `ok`). It redacts the host, user, password and database name of the URL from every response, including error messages.

## 2. Run the same probes

From `research/fs-04`, in a shell where the values are not echoed:

```sh
export FS04_WORKER_URL=https://okdriver-fs04-probe.<subdomain>.workers.dev
read -rs FS04_PROBE_TOKEN; export FS04_PROBE_TOKEN        # paste the token
# optional: lets the harness poll pg_stat_activity for the concurrency and leave-open probes (same URL as the secret)
read -rs FS04_DATABASE_URL; export FS04_DATABASE_URL

bun scripts/production.ts                # writes results/production/*.production.json
bun scripts/capabilities.ts              # re-renders results/capabilities.md and .json
```

With `FS04_WORKER_URL` or `FS04_PROBE_TOKEN` unset, `scripts/production.ts` writes `results/production/NOT-VERIFIED.json` and exits: that is the state of this repository. Add a filter argument (for example `bun scripts/production.ts prod.p5`) to run one probe group.

What runs (5 fresh runs each, target `main` = the `DATABASE_URL` secret): TLS upgrade, direct TLS, a second `startTls()`, the pending-read and cancel-then-release lock variants, certificate acceptance, `expectedServerHostname` right and wrong, the socket surface listing, concurrency N = 1, 2, 6, 7, 8, 24, 50, idle sockets, cross-request use, a socket left open, global scope, cancel (plain, six busy sockets, main on TLS with plain and TLS cancel), and the large-write ladder (single write and 64 KiB chunks, 64 KiB up to 128 MiB, stopping at the first failing size and testing the next size up once).

What cannot run in production, and why: the self-signed, expired and wrong-name servers, the `rejectUnauthorized`, `ca`, `servername` and `alpn` option rows (they need a failing certificate or the ClientHello, which only a local proxy sees), the backpressure stall (needs a proxy that stops reading), the client-certificate row, PostgreSQL 19.0, and MySQL and MariaDB. Those cells stay **Not verified here**.

Server-side truth in production is thinner than locally: there is no recording proxy and no server log. The checks that need them are marked not applicable (`null`) and the rest stand on what the server computes for the session: `pg_stat_ssl` for the connection itself, the SQLSTATE of a cancelled query, `sha256()` inside PostgreSQL for large writes, and, if `FS04_DATABASE_URL` is set, `pg_stat_activity` counts. A not-applicable check is skipped, never counted as a pass; a production capability becomes true only when every cell it lists passed 5 of 5 over its applicable checks. Read the result files before quoting a value.

## 3. Expected differences to look for (not predictions)

- **Connection count.** The Cloudflare limits page says a Worker invocation can have six connections *waiting for response headers* and queues a seventh; the sockets page says each open TCP socket counts toward the maximum of open connections (ledger D-11, D-14). Locally nothing was queued up to 50. Production N = 7, 8, 24 and 50 will show which reading holds: `notQueued`, `workerOpenedSpreadUnder1s` and `allUsableAtOnce` in the result files carry it, and the cancel probe with six busy sockets shows whether the cancel socket waits.
- **Memory.** A production isolate has a memory limit; the local workerd had none, and its process peaked at 322 MiB RSS for a 128 MiB single write against 128 MiB for 64 KiB chunks. A single large write may fail in production at a smaller size than 128 MiB. The ladder stops there by itself; an `exceeded memory` response is not JSON and is recorded as an HTTP-level failure of that run.
- **Trust.** Locally the trusted roots are the test CA given to workerd. Production uses Cloudflare's store (ledger D-16, D-19).

## 4. Checks before anything is committed

- `git status` shows only files under `research/fs-04/results/production/`; no `package.json`, no lockfile, no wrangler output (`.wrangler/` is not created by `deploy`, but check).
- The harness refuses to write a result file that contains the database host, user, password or name from `FS04_DATABASE_URL` and exits with code 2; with the variable unset it cannot check, so also run: `grep -rIl -e '<host>' -e '<user>' -e '<database>' results/production` with your own values typed at the prompt, not pasted into a script. Expect no output.
- Result files carry the label `production-observed`. Do not rename a local result to look like one.

## 5. Clean up

```sh
bunx wrangler@4.162.0 delete okdriver-fs04-probe
```

Then drop the throwaway role and database, unset `FS04_*` and `CLOUDFLARE_API_TOKEN`, and rotate anything that was pasted into a terminal that logs input.
