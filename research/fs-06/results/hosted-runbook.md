# Hosted targets: what to run and what to send back

No account for RDS Proxy, Neon or Cloudflare Hyperdrive exists in the study environment, so those three were **not verified here**
(`results/hosted/rdsproxy.json` and `results/hosted/neon.json` say so; the harness writes that file when its variable is unset).
The same harness that produced the local results runs against a hosted URL with one command. It sends no URL, host, user, password or
database name anywhere: they are replaced by `<redacted>` in everything it writes, and nothing is printed.

## Before you run anything

- Needs `bun` (1.4.4 was used) and a checkout of the FS-06 commit. Docker is not needed for the hosted run.
- Run it from a machine that can reach the endpoint. **RDS Proxy endpoints are reachable only from inside the VPC**: use an EC2 instance
  in the same VPC (and a security group that allows 5432 from it). Neon is reachable from anywhere.
- Put the URL in the environment without it landing in shell history or a terminal log:

  ```bash
  read -rs FS06_RDSPROXY_URL && export FS06_RDSPROXY_URL     # paste the URL, press Enter; nothing is echoed
  read -rs FS06_NEON_URL && export FS06_NEON_URL
  ```

  URL form: `postgres://USER:PASSWORD@HOST:5432/DBNAME?sslmode=require`. `sslmode=disable` turns TLS off. Any other value uses TLS with
  full certificate and host-name verification against the system trust store (SNI is sent; an IP address as host sends none).
  `FS06_TLS_INSECURE=1` skips verification, only for a test against a self-signed certificate.

## Commands

```bash
cd research/fs-06
bun scripts/hosted.ts rdsproxy      # reads FS06_RDSPROXY_URL, writes results/hosted/rdsproxy.json
bun scripts/hosted.ts neon          # reads FS06_NEON_URL,      writes results/hosted/neon.json
```

Before sending a file, check that it holds nothing that identifies the account:

```bash
grep -i -E 'amazonaws|rds\.|neon\.tech|password|secret' results/hosted/rdsproxy.json results/hosted/neon.json   # expect no output
```

Send back the two JSON files (paste or attach). Do not send the URLs. If a command prints an error, send the error text; it contains no URL.

## What the JSON holds

Same layout as `results/targets/*.json`: for every sequence (S1 to S7b, S3 variants, S4a to S4c) the runs that succeeded out of 5, every
SQLSTATE and message seen, round trips counted from the client's own read/write trace, elapsed time, the login `ParameterStatus` list, the
pinning probe (8 clients x 20 transactions, backend PIDs seen), the readback of `pg_prepared_statements` through the pooler, and the
reference-client-free parts only (the reference clients `pg` and `postgres` are not run against hosted targets).
Two things differ from the local runs, because a hosted target has no server-side proxy and no injected delay:

- There is no "did the pooler forward Parse and Bind as sent" column (nothing sits between the pooler and its database).
- `impliedRoundTrips` divides elapsed time by `baselineRttMs`, the median round trip of nine `select 1` queries on an open connection.
  It is only meaningful when that round trip is much larger than the pooler's own processing time. The trace count is the primary figure.

`p04` (extra block) is the observation for claim P-04: four clients share the pooler; one of them runs 20 transactions after (a) nothing,
(b) `SET application_name = ...`, (c) a statement text above 16 KB. `subjectDistinctPids` is how many backends that client landed on
(1 means the session stayed on one backend while `othersDistinctPids` shows whether the others still shared). RDS Proxy's own metric for this
is `DatabaseConnectionsCurrentlySessionPinned` in CloudWatch; reading it next to the run is a second, independent view.

## Account-side set-up (commands as documented, **not run here**)

### RDS Proxy (PostgreSQL)

1. An RDS for PostgreSQL instance, and a Secrets Manager secret with its `username` and `password`.
2. The proxy (the AWS CLI reference documents these two commands; the role needs `secretsmanager:GetSecretValue` on the secret):

   ```bash
   aws rds create-db-proxy --db-proxy-name fs06 --engine-family POSTGRESQL \
     --auth AuthScheme=SECRETS,SecretArn=<secret-arn>,IAMAuth=DISABLED \
     --role-arn <role-arn> --vpc-subnet-ids <subnet-a> <subnet-b> --vpc-security-group-ids <sg> --require-tls
   aws rds register-db-proxy-targets --db-proxy-name fs06 --db-instance-identifiers <instance-id>
   ```

3. To make the 8 clients really share connections, cap the proxy's share of `max_connections` low, for example
   `aws rds modify-db-proxy-target-group --db-proxy-name fs06 --target-group-name default --connection-pool-config MaxConnectionsPercent=5`
   (the minimum the service accepts and the resulting pool size depend on the instance class; note the value used when sending results).
4. The URL host is the proxy endpoint (`aws rds describe-db-proxies --db-proxy-name fs06` lists it).

### Neon pooled

1. A Neon project and database. In the Console, open **Connect** and turn **Connection pooling** on: the host then has a `-pooler` suffix.
   Neon's pooled endpoint is PgBouncer in transaction mode (Neon's connection-pooling page, read as raw page text, says so and lists
   `max_prepared_statements=1000` among the settings), so expect results close to the local PgBouncer rows.
2. Use that pooled connection string as `FS06_NEON_URL`. The direct (non-pooled) string is not what this study needs.

### Hyperdrive: not attempted

Hyperdrive needs a Cloudflare account, a Worker and a binding; the harness is a raw-socket Bun program and was not ported to a Worker.
Claim P-05 stays "Not verifiable here". What a port would need: `wrangler hyperdrive create`, a Worker that opens the binding's connection
and sends the same byte sequences (`scripts/lib/seq.ts` builds them as plain byte arrays), and a way to read the replies back out.
