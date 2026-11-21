# FS-07: how much do MySQL and MariaDB share?

Research only. This folder holds a prototype wire library, scripts, small result files and the claim
ledger. It changes no OKDriver source, no gate, no ADR and no root tooling, and it makes no claim about
OKDriver's speed and no public comparison. Spec area: none yet. Feature record: none (research).

Question (roadmap row FS-07): build one small wire library that talks to both MySQL and MariaDB, find where
the two behave identically on the wire and where they do not, and check every working-knowledge claim in the
roadmap's MySQL (section 7) and MariaDB (section 8) parts against primary documentation and live servers.
Rule used to decide "shared": code is shared only where bytes and behaviour are identical across the version
matrix; everything else is forked.

Base: `origin/main` at `dc921f6f5a5648a8e16db3852603d7d377173fb2`.

## Findings in short

1. **Most of the wire is shared, and the shared part is big.** Framing, handshake v10 parsing, the response
   layout, OK/ERR, text and binary rows, the prepared-statement lifecycle (prepare, execute, reset, close, fetch,
   long data), ping, reset, session tracking, TLS upgrade and the `caching_sha2` and native scramble all run
   unchanged on all nine servers. In the prototype 789 lines are shared, 38 are MySQL-only, 127 MariaDB-only and
   12 are the dispatcher (82.7 % shared, of shared plus family lines; a MySQL-only driver would be 95.4 %
   shared, a MariaDB-only driver 86.1 %). `scripts/check-boundaries.ts` finds no import that breaks ADR 004's
   graph.
2. **Where they differ, the difference is in how the sides negotiate and what they name things**, not in the
   framing: bit 0 of the capabilities and the extended-capability word (D-01), column-definition extras and the
   metadata-skip flag byte (D-02), authentication plugins and their availability per series (M-02, D-03), bulk
   execute and the placeholder statement id (D-04), types (JSON, VECTOR, UUID, INET), error numbers above 3000
   (D-09), and defaults (collation, `sql_mode`, `local_infile`, binlog format).
3. **Pipelining behaves the same on all nine servers for the generic case.** Commands written back to back came
   back in order, each error belonged to one statement, and the server log and table effects matched, 5 of 5 runs
   on every server. What differs is the two MariaDB-only forms (prepare-and-execute with id `0xFFFFFFFF`, and
   `COM_STMT_BULK_EXECUTE`), which MySQL rejects with 1243 and 1047. A client that stops reading while writing
   stalls the server on every server, and after `net_write_timeout` every server closes the connection and the
   remaining statements never run. Observations only; no change to ADR 018, 019 or 024 is proposed.
4. **The documentation was wrong or silent in places where the servers answered.** Examples: the roadmap's flag
   name `MARIADB_CLIENT_EXTENDED_TYPE_INFO` does not exist; MariaDB 11.4+ has a `caching_sha2_password` server
   plugin (TLS only) and 11.8+ has PARSEC, neither loaded by default; MySQL 9.7 and 26.10 do not have the native
   plugin at all; MariaDB 10.6 and 10.11 offer no TLS; `local_infile` is ON by default on MariaDB; the
   MySQL-side `CLIENT_MULTI_STATEMENTS` page says the flag is unchecked, and every server enforces it; for a
   command split over several packets the response sequence continues instead of restarting at 1.
5. **Two hazards found that no document states**: MySQL's optional result-set metadata (`resultset_metadata=NONE`)
   keeps skipping column definitions after `ALTER TABLE ... ADD COLUMN`, so a cached `SELECT *` silently decodes
   one column too few (MariaDB re-sends the definitions once); and ProxySQL 3.0.12 queues pipelined commands in
   order but does not renumber response sequence ids, so a client that validates them aborts mid-pipeline.
6. **Ledger**: 31 claims (M-01 to M-16, M-Q1 to M-Q4, D-01 to D-11), 9 Confirmed, 19 Corrected, 3 Not verifiable
   here (M-14, M-16, M-Q3; hosted services). See [results/ledger.md](results/ledger.md).

## Version matrix

Decided before the study (endoflife.date and Docker Hub, 2026-11-21); resolved to exact versions and digests on
the day of the runs. Official `mysql` and `mariadb` images.

| id | series | exact version | image digest |
| --- | --- | --- | --- |
| my84 | MySQL 8.4 (LTS) | 8.4.13 | `mysql@sha256:a81d043930e51745522bd5c430961cf8286f0a23f0a9a2a6e0108f7ea71b0902` |
| my97 | MySQL 9.7 (LTS) | 9.7.4 | `mysql@sha256:df90258da46f6e7ff8574ff84f17618aba0765cac749928299c69fd4e7cb8ad8` |
| my2610 | MySQL 26.10 (innovation) | 26.10.0 | `mysql@sha256:3819b2b23835c4a73c8b022fafc33c8095c0f81c929a8b7a84613d2fba6c52f5` |
| ma106 | MariaDB 10.6 (floor) | 10.6.28 | `mariadb@sha256:75079c0fb96894284d00d035bc4bef94234814f6f6c28b79877bc69d3285d760` |
| ma1011 | MariaDB 10.11 | 10.11.19 | `mariadb@sha256:e5fe75b2b9de0eb9f6f9a4d9c97272fb3a7480e389ccd487a786bab2a12cc0d7` |
| ma114 | MariaDB 11.4 | 11.4.13 | `mariadb@sha256:a8992b5e5404d11e03c54a31d0c1bdea3fd116d283aa6d1a627551f29045309b` |
| ma118 | MariaDB 11.8 | 11.8.9 | `mariadb@sha256:e1d5495f445654134f226f55a41ce0da227116f6f27f283101f405c794d841fc` |
| ma123 | MariaDB 12.3 | 12.3.3 | `mariadb@sha256:4aaf88b3106382c8c18e49f0cec60267be618fc22f858c4503afb2a2555afed3` |
| ma130 | MariaDB 13.0 (rolling) | 13.0.2 | `mariadb@sha256:54f493ea0d60b621a5bff84e5b20100f8b86b6efa6b79158e04756c5194a5e4d` |

MySQL 8.0 is out of the matrix; MariaDB 10.6 is past its end of life and kept as the floor. The roadmap's D-11
lists 10.6, 10.11, 11.4 and the rolling series; this table is the matrix of the study, and ledger row D-11
records the difference. All nine pulled and started. Second tier: ProxySQL
`proxysql/proxysql:3.0.12`, `sha256:3a96426ea17bb883820433908b49087b6027852bb92c981209e72ebe7897c4f2`.
Reference clients (installed with bun into the ignored `work/`, never imported by the prototype): mysql2 3.24.6
(MIT), MariaDB Connector/Node.js 3.5.5 (LGPL; read for protocol understanding, no code copied), plus each
image's own `mysql` or `mariadb` CLI. Runtime: bun 1.4.4. Machine: 4 vCPU Intel Xeon, 15 GiB RAM, Linux 6.18.44,
Docker 29.10.0; all servers and all clients on this one machine, so results are about behaviour, not speed.

Containers started with the server's own defaults plus `--general-log=1 --log-output=TABLE`,
`--max-connections`, `--innodb-buffer-pool-size=64M` and `--performance-schema=ON` (MariaDB's is off by
default). Throwaway root password, ports bound to 127.0.0.1 only. Defaults in `results/facts` were read from
freshly created containers.

## What was built

```
wire/shared/    framing, byte codecs, greeting, handshake, auth scrambles, caching_sha2, result decoding,
                connection (handshake, auth loop, commands, pipelined send/receive), profile interface
wire/mysql/     profile, sha256_password, OPTIONAL_RESULTSET_METADATA hooks
wire/mariadb/   profile (extended capability word, extended metadata, cache metadata), ed25519, PARSEC, bulk
wire/connect.ts the dispatcher: reads the family from the greeting and picks a profile (counted separately)
scripts/        mytrace.ts (independent packet-trace proxy), probes, check-boundaries.ts, count-lines.ts, ...
results/        small result files and generated tables
```

The prototype speaks only the binary protocol for parameters (`COM_STMT_EXECUTE`); it has no client-side
interpolation (FS-18 owns that). `shared/` imports neither family folder; a family folder imports only
`shared/` and itself. Everything that branches on family goes through the `FamilyProfile` interface in
`shared/profile.ts` and is implemented in a family folder.

**Independent evidence.** `scripts/mytrace.ts` is a byte-forwarding proxy with its own parser, written from the
protocol documentation and importing nothing from `wire/` (it forwards with backpressure in both directions; the
first version did not and hid the stall in the pipelining probes, see "Surprises"). Server-side truth comes from
the servers: `performance_schema.events_statements_history_long` (MySQL; MariaDB's is empty), the general log
table (both), table contents, `SHOW BINLOG EVENTS`, `information_schema.processlist`. Reference clients plus the
CLIs give the golden traces.

## Claim ledger

One row per claim, 31 rows, diffed against the appendix IDs by `scripts/check-ledger.ts` (every ID exactly
once). The full rows (what the documentation says with page, what the servers did with script and result file,
the corrected sentence) are in [results/ledger.md](results/ledger.md), source in `results/ledger.json`. For the
four open questions "Confirmed" means answered, with documentation and servers in agreement.

| verdict | IDs |
| --- | --- |
| Confirmed (9) | M-01, M-03, M-05, M-07, M-11, M-Q1, M-Q2, M-Q4, D-04 |
| Corrected (19) | M-02, M-04, M-06, M-08, M-09, M-10, M-12, M-13, M-15, D-01, D-02, D-03, D-05, D-06, D-07, D-08, D-09, D-10, D-11 |
| Not verifiable here (3) | M-14, M-16, M-Q3 |

Where documentation and a live server disagreed, the server wins and the row says so. Documentation was read
through a summarising fetch tool; statements that rest only on server source are marked as such in the rows, and
source (copyleft) was read, never copied.

## Wire comparison matrix

Prototype through the proxy, the same 26 commands on every server; "identical" means identical bytes of every
request and every response packet after the masks below. Full output: [results/wire/matrix.md](results/wire/matrix.md)
and masked hex of one representative per class in `results/wire/matrix-raw.json`.

| step | identical on all 9 | where it differs (classes) and why |
| --- | --- | --- |
| greeting, capabilities, login | no | MySQL / 10.6+10.11 / 11.4 / 11.8+12.3+13.0. Capabilities (bit 0, SSL bit, default plugin, charset 255 versus 45), the extended word (0x1d versus 0x3d), the client response (bit 0 cleared, extended word), the login OK (session-state entries and `redirect_url` from 11.8) |
| OK shapes (`do`, DDL, insert, update, set, ping, reset, use) | yes | none |
| ERR, unknown table | yes | none |
| ERR, syntax error | no | text: "your MySQL server version" versus "your MariaDB server version" |
| column definition (text and binary) | no | MySQL / MariaDB 10.6+10.11 / MariaDB 11.4+: charset id of text columns (45 on MySQL and 10.6/10.11, 224 on 11.4+), INT versus BIGINT for literals and `@@autocommit`, JSON as type 245 versus BLOB, MariaDB's extended-metadata field |
| text row, binary row | yes | row packets are byte-identical on all nine in every step that returns rows (4 text steps, 2 binary steps), including the JSON value and the INT versus BIGINT literals in text; binary rows of columns whose type differs by family (INT versus BIGINT) were not part of the matrix |
| prepared lifecycle | no | statement ids (MySQL allocated 3 where MariaDB allocated 2 for the second statement; ids are per-connection and not predictable in general), PARAM_DEF/COL_DEF contents as above; reset, close and ping are byte-identical apart from the id |
| `COM_RESET_CONNECTION`, `COM_PING` | yes | none |
| error numbers for 25 failing statements | see `results/behaviour/*.json` | 20 of 25 identical on all nine; differences in D-09 |

**Masks** (`scripts/mask.ts`): server version string, connection id and both salt parts in the greeting; the bytes
of every client authentication response and every server challenge or public key; the client address and
`(conn:N)` in access-denied messages; and the random 65-byte token (0x01 plus 64 hex digits) that MariaDB 11.4+
puts in the info field of the login OK (verified to differ between two connections to the same server). Nothing
else is masked: capabilities, status flags, charset ids, column definitions, rows and OK counters compare raw.

**Golden traces** (`results/wire/golden.json`; reference clients driven through the proxy on every server):

- *Text queries*: byte-identical to the prototype's on all nine, except that mysql2 and the MySQL CLI negotiate
  `CLIENT_QUERY_ATTRIBUTES` and so prefix every `COM_QUERY` on MySQL with `00 01` (parameter count, set count);
  the prototype does not negotiate that bit.
- *Prepare, reset, close*: identical apart from the statement id (masked in the comparison; the id differs per
  connection history). Connector/Node.js on MariaDB sends `COM_STMT_PREPARE` immediately followed by
  `COM_STMT_EXECUTE` with id `0xFFFFFFFF` (the first execute of each statement), which the prototype only does
  in a probe.
- *Execute*: the clients choose their own parameter type codes (Connector/Node.js sends LONG for integers,
  mysql2 DOUBLE on MariaDB and a query-attribute block with flag 0x08 on MySQL, the prototype LONGLONG), so the
  requests differ in those bytes; the response shapes are the same.
- *Handshake response*: each client sets its own capability set (prototype 0x1fea20d on MySQL and 0x1fea20c on
  MariaDB, mysql2 0x18baf3cf, Connector 0x1bea30a with extended word 0x3c on MariaDB, mysql CLI 0x19bfa28d).
  When a client's capabilities change the response shape (mysql2 does not ask for `CLIENT_DEPRECATE_EOF`;
  Connector/Node.js asks for `CACHE_METADATA`), the comparison uses a prototype run with the same capability and
  every command then matches in shape. The CLIs are text-only; they do not send prepared statements or pings,
  which the table reports as "not sent by this client".

## Shared versus forked

`scripts/count-lines.ts`, non-blank non-comment lines (`results/lines.md`): shared 789, MySQL 38, MariaDB 127,
dispatcher 12. "Shared" here means used unchanged by both profiles, with availability per version held as data in
the profile. Under the strict reading of the roadmap rule (identical bytes and behaviour on every server of the
matrix) `caching_sha2_password` (MariaDB 11.4+ only), the native scramble (absent on MySQL 9.7 and 26.10) and the
RSA branch (MySQL only) would sit outside shared; they are in `shared/` or the family folders as noted below.

Every fork, with its reason and the evidence row:

| fork | where | reason | evidence |
| --- | --- | --- | --- |
| family detection | `connect.ts` | version string contains "MariaDB" (the `5.5.5-` prefix is gone from 11.x), bit 0 clear | D-01 |
| clear bit 0, extended capability word in the response filler | `mariadb/profile.ts` | MariaDB reads extended capabilities from the last four filler bytes when bit 0 is clear | D-01 |
| column-definition extra field (type name, format) | hook `columnExtra`, `mariadb/profile.ts` | extended metadata exists only on MariaDB | D-02 |
| metadata-skip flag after the column count | hook `resultsetHeaderTail`, both profiles | MariaDB `CACHE_METADATA` (bit 4) and MySQL `OPTIONAL_RESULTSET_METADATA` (bit 25) are different mechanisms with different re-send rules | D-02 |
| prepare response metadata flag | hook `prepareMetadataSkipped`, `mysql/profile.ts` | MySQL's PREPARE_OK carries a metadata_follows byte when bit 25 is negotiated | D-02 |
| ed25519, PARSEC | `mariadb/ed25519.ts`, `parsec.ts` | MariaDB-only plugins | D-03 |
| `sha256_password` | `mysql/sha256.ts` | MySQL-only plugin | M-02 |
| plugin allowlists and defaults | both profiles | defaults differ (caching_sha2 versus native) | M-Q1, D-03 |
| bulk execute and placeholder-id execute | `mariadb/bulk.ts` | no MySQL equivalent (1047, 1243) | D-04 |

Seams that stay in `shared/` and are data, not branches: the profile interface itself (23 lines); the call
sites of the four hooks in `connection.ts`; response filler bytes 19 to 22 (zeros for MySQL, the extended word for
MariaDB); type codes 242 (VECTOR) and 245 (JSON) in `constants.ts` (MySQL wire types, harmless on MariaDB which
never sends them); the string `mysql_old_password` in one error message. No `if (family)` exists in `shared/`
(`results/boundaries.json` lists the only family-name mentions in shared code). Not built, and clearly forks if
built: the error map (D-09), per-family type contract files for JSON, VECTOR, UUID and INET (M-06, D-06), the
collation id tables, the CDC reader (D-08), failover probes (M-13), redirection handling (D-10).

## Behavioural differences

Generated list: [results/summary/differences.md](results/summary/differences.md) (54 of 80 facts and 129 of 546
behaviour items differ somewhere across the nine servers; most are the per-series defaults). The ones that matter
for a driver, each with its evidence row:

| area | MySQL 8.4, 9.7, 26.10 | MariaDB 10.6 to 13.0 | evidence |
| --- | --- | --- | --- |
| literal integer type | `SELECT 1` is BIGINT (LONGLONG) | INT (LONG) | M-06 |
| server default charset/collation | `utf8mb4_0900_ai_ci` | `utf8mb4_general_ci` (10.6, 10.11); `utf8mb4_uca1400_ai_ci` (11.4+) | facts |
| handshake collation id 45 | `utf8mb4_general_ci` | remapped to `uca1400` on 11.4+; id 255 means `0900_ai_ci` on 11.4+ and `general_ci` on 10.6/10.11 | facts, M-05 |
| default `sql_mode` | ONLY_FULL_GROUP_BY, NO_ZERO_DATE, NO_ZERO_IN_DATE and strict | strict only; zero dates accepted | M-06 |
| zero date, `838:59:59.5` | rejected (1292) | accepted | M-06 |
| JSON | type 245, normalised text | `LONGTEXT utf8mb4_bin` plus CHECK, BLOB with format `json`, text as inserted | D-06 |
| UUID, INET4, INET6, VECTOR | no UUID or INET; VECTOR 9.7+ (type 242) | UUID and INET4 from 10.11, INET6 all, VECTOR from 11.8 (binary string) | D-06 |
| RETURNING | none | INSERT, REPLACE, DELETE; UPDATE on 13.0 | D-07 |
| sequences | no | yes | D-06 |
| error numbers | CHECK 3819, invalid JSON 3140, local infile 3948 | 4025, 4025, 4166 | D-09 |
| `local_infile` server default | OFF | ON | M-11 |
| TLS | auto certificate on all three | auto certificate 11.4+, none on 10.6 and 10.11 | M-10 |
| binlog | ROW, MINIMAL metadata, log on | MIXED up to 11.8 (ROW 12.3+), NO_LOG metadata, log off | M-12, M-Q4 |
| GTID | `gtid_mode` OFF on 8.4, ON on 9.7+ | domain-server-sequence, always | M-12, D-08 |
| session tracking | MySQL OK packets carry a `statement_id` entry | `redirect_url` tracked from 11.4 | M-07, D-10 |
| isolation variable | `transaction_isolation` | `tx_isolation` (all), `transaction_isolation` from 11.4 | M-07 |
| optional metadata | `resultset_metadata`, no re-send after DDL | `CACHE_METADATA`, re-sent after DDL | D-02 |
| compression | zlib and zstd | zlib only | M-15 |
| `max_allowed_packet` | 64 MB | 16 MB | bigpacket |
| failover signals | `super_read_only`, `replication_group_members` | `read_only`, wsrep (Galera) | M-13 |

## Authentication defaults

[results/auth/summary.md](results/auth/summary.md) has the full matrix (plain and TLS logins with the prototype,
mysql2 and Connector/Node.js, and the packet sequence per plugin). Plugins loaded in a fresh server:

| server | loaded by default | new user with a password gets | accepted once available |
| --- | --- | --- | --- |
| MySQL 8.4 | caching_sha2_password, sha256_password; mysql_native_password present but DISABLED | caching_sha2_password | native after `--mysql-native-password=ON` at start-up |
| MySQL 9.7, 26.10 | caching_sha2_password, sha256_password | caching_sha2_password | native is not available (the `.so` in the image is not a server plugin) |
| MariaDB 10.6, 10.11 | mysql_native_password, mysql_old_password (logins refused, 1275), unix_socket (refused over TCP) | mysql_native_password | ed25519 (`INSTALL SONAME`) |
| MariaDB 11.4 | same three | mysql_native_password | ed25519; caching_sha2 (`auth_mysql_sha2`, TLS only) |
| MariaDB 11.8, 12.3, 13.0 | same three | mysql_native_password | ed25519; caching_sha2 (TLS only); PARSEC |

The prototype logs in with every plugin that works with a plain password on the matrix (native, caching_sha2
fast and full path, sha256, ed25519, PARSEC) and the auth-switch flow. mysql2 cannot do ed25519 or PARSEC.

## Pipelining

Definition of "safe", written before the runs: responses come back in command order; each error belongs to
exactly one statement; nothing stalls (every response within 30 s); nothing is skipped silently (the server's own
log and table effects match what was sent). Each probe ran 5 times per server; the tables are in
[results/pipeline/summary.md](results/pipeline/summary.md). Results for the three MySQL servers were identical
to each other, and for the six MariaDB servers likewise unless stated.

| probe | MySQL (3 servers) | MariaDB (6 servers) |
| --- | --- | --- |
| 50 `COM_QUERY` in one write | 5/5 safe each | 5/5 safe each |
| 50 `COM_STMT_EXECUTE` inserts in one write | 5/5 safe, server order matches | 5/5 safe |
| error at #10 of 20 queries; duplicate key at #5 of 8 executes | 5/5 safe, connection usable | 5/5 safe |
| 20 MB result in the middle of 3 commands, slow reader | 5/5 in order | 5/5 in order |
| PREPARE then EXECUTE with `0xFFFFFFFF`, no wait | 0/5: PREPARE ok, execute 1243, connection usable | 5/5: value correct |
| failing PREPARE then placeholder execute | 1064 then 1243, usable | same |
| PREPARE then EXECUTE with the next id guessed | guess right 5/5 (ids 1 then 2); not predictable in general (see wire matrix) | right 5/5 |
| client stops reading, keeps writing (24 MB behind an 80 MB result) | server in "Sending to client", 0 of 1500 queued statements started after 8 s, recovers when reading resumes (5/5) | "Writing to net", same |
| reader stops with `net_write_timeout=2` | connection closed after the first result, third statement never ran (5/5) | same |
| `COM_STMT_BULK_EXECUTE`, 100 rows | 1047, connection usable | OK, 100 rows, 5/5 |
| bulk with a duplicate at row 50 | 1047 | ERR 1062, none of the rows inserted (atomic) |
| PREPARE then bulk execute `0xFFFFFFFF` | 1047 | OK, 10 rows |
| kill the connection mid-batch (300 inserts) | committed rows always a prefix of the sent order; the server had committed exactly one more statement than the client saw responses for in 14 of 15 runs, equal in 1, never fewer | same: 26 of 30 runs one more, 4 equal, never fewer |

The server's log and the independent proxy parser agree on which statements ran and in what order in every run
of the first four probes: `scripts/pipeline-trace.ts` (5 runs per server, `results/pipeline-trace/`) saw all 20
queries in sent order with the error at exactly index 10, and all 8 executes with the error at index 5, on all
nine servers, with up to 20 commands riding in one client write. Through ProxySQL 3.0.12 (second tier): in-order, per-statement errors preserved, but sequence ids are not
renumbered (49 of 50 and 19 of 20 responses carried a surprising id), the placeholder id fails (1243) and a bulk
byte closes the connection even with a MariaDB backend. Observations only.

## Second tier

| item | result |
| --- | --- |
| TLS upgrade inside the handshake | works on 7 of 9 (not on MariaDB 10.6 and 10.11); self-signed certificates, verification fails; client certificates not verified (M-10) |
| server-side cursors (`COM_STMT_FETCH`) | work on all 9; other commands can run between fetches (M-08) |
| kill mid-pipeline | table above; `results/kill/summary.md` |
| binlog table-map metadata | `results/binlog/summary.md`; the official MySQL images ship no `mysqlbinlog`, so MySQL evidence is `SHOW BINLOG EVENTS` only; `mariadb-binlog -vv` prints `@n` even with FULL (M-Q4) |
| ProxySQL in front of MySQL 8.4 and MariaDB 13.0 | `results/proxysql.json` (M-14) |
| MariaDB progress reporting, redirection | work; progress packets 2 (10.6, 10.11) or 4 (11.4+); redirect from 11.8 (D-02, D-10) |

## Not verified here

Hyperdrive, RDS Proxy, PlanetScale, Vitess, TiDB, SingleStore, Aurora, GSSAPI, PAM, IAM: hosted or not in the
images, no sign-up (M-14, M-16, M-Q3, M-13 partly). Not run: `COM_BINLOG_DUMP_GTID` and the MariaDB replica
capability negotiation, protocol compression itself, client certificates, MaxScale and Galera, any benchmark. The
CLI traces cover text queries only.

## Observations on locked decisions

Stated as observations; no ADR is edited.

- **ADR 004 (MariaDB is an independent engine sharing a wire library)**: consistent with the measurement; the
  shared part is large and the forks are real and mostly in negotiation and naming. Whether `caching_sha2` and
  the native scramble count as shared depends on reading "identical across the matrix" strictly or as
  "identical wherever the server offers it".
- **ADR 006 (independent oracles)**: the proxy parser, the servers' own logs and two reference clients caught
  four defects, two in the prototype (response sequence ids for split commands, the prepare response under
  metadata skipping) and two in the independent tool itself (no backpressure, the metadata-skip flag byte);
  that supports the rule and also shows the oracle needs its own checking.
- **ADR 018, 019, 024 (pipelining)**: nothing observed contradicts them. The generic pipeline is safe on every
  server under the stated definition, so the open question is a policy one; ProxySQL's sequence ids are a
  concrete hazard for any scheduler that validates them.
- **ADR 034 and constitution principle 6**: three server behaviours matter: an implicit commit is visible only
  as the `IN_TRANS` flag clearing; a MariaDB bulk statement is atomic; and after a lost connection the server may
  have committed one statement more than the client saw a response for, so "may or may not have run" is a real
  state for the last in-flight statement.
- **ADR 035 (no client-side interpolation)**: every server accepts parameters only through `COM_STMT_EXECUTE`
  here; Cloudflare's page says Hyperdrive does not support protocol-level prepared statements (not testable
  here), and ProxySQL turns the MariaDB placeholder id into an error.

## Proposed decision

For the ADR author after review; nothing here is decided. "Evidence" is the ledger row or section.

| area | proposal | evidence |
| --- | --- | --- |
| packet framing, sequence ids, 16 MB splitting | shared; response sequence follows the last request packet | M-01 |
| handshake v10 parse and response layout | shared, with a profile hook for capability bits and the extended word | D-01 |
| capability constants | bits 0 to 24 shared; bits 25 up and the MariaDB word forked | D-01, D-02 |
| OK and ERR parsing, session-state tracking | shared; tracked-variable defaults are data | M-07, D-10 |
| error map | forked | D-09 |
| authentication | native and caching_sha2 scrambles shared; plugin availability and allowlists forked; sha256 MySQL; ed25519 and PARSEC MariaDB | M-02, M-Q1, D-03 |
| text protocol, multi-results | shared | M-03 |
| column definition and result header | shared base, forked extras and metadata-skip | D-02 |
| text and binary row decoding of classic types | shared | M-05, M-06 |
| JSON, VECTOR, UUID, INET, zero dates, TIME edges | forked type contract | M-06, D-06 |
| prepared lifecycle (prepare, execute, reset, close, fetch, long data) | shared | M-04, M-08 |
| bulk execute, placeholder-id prepare and execute | forked (MariaDB) | D-04 |
| ping, reset connection | shared | M-09 |
| TLS upgrade | shared; availability per server | M-10 |
| pipelining scheduler | undecided (FS-05); the protocol allows the generic form on both | M-Q2, D-05 |
| charset and collation id tables | forked | M-05 |
| CDC reader, binlog metadata | undecided (FS-11); defaults differ | M-12, M-Q4, D-08 |
| failover probes | forked | M-13, D-10 |

## Surprises

- The first trace proxy forwarded without backpressure and so absorbed 80 MB for a client that had stopped
  reading; the stall probe reported "no stall" until the proxy was fixed. Any tool between client and server in
  a stall test must propagate backpressure.
- For a command split over several packets the server's response starts at the next sequence id, not at 1.
- MySQL 9.7 and 26.10 images contain a `mysql_native_password.so` that cannot be loaded as a server plugin.
- MariaDB 11.4+ puts a random 64-hex-digit token in the info field of every login OK.
- MariaDB's `performance_schema` is empty of statement history even when switched on; the general log was the
  server-side truth there.
- MariaDB 12.3 and 13.0 default to `binlog_format=ROW`; 10.6 to 11.8 default to MIXED.

## Decisions beyond the brief

- "Shared" is counted as "used unchanged by both profiles" (see above), with the strict reading listed.
- MySQL 8.4 with `--mysql-native-password=ON` ran as an extra container (`my84-native-on`) for the "accepted
  once available" column; ProxySQL 3.0.12 was pulled for the second tier.
- Probes that change server state (`max_prepared_stmt_count`, `max_allowed_packet`, `redirect_url`, plugins
  installed with `INSTALL SONAME`) ran against throwaway containers; the facts and defaults were read before any
  such change on freshly created containers, and the pipelining matrix ran on servers that had been used by
  earlier probes.
- Handshake charset id 45 is sent by the prototype on every server; the facts record what each server maps it
  to.
- Strict sequence-id validation in the prototype can be turned into a counter by a probe, for the ProxySQL runs.
- The documentation was read by three delegated read-only agents; their reports were cross-checked against live
  results wherever a live check exists, and rows say which statements are documentation-only.

## Reproduce

Needs docker (start the daemon by hand if needed), bun and the images. From the repo root:

```bash
docker pull mysql:8.4 mysql:9.7 mysql:26.10 mariadb:10.6 mariadb:10.11 mariadb:11.4 mariadb:11.8 mariadb:12.3 mariadb:13.0
research/fs-07/scripts/run-all.sh            # fresh servers, every probe except the long pipelining matrix
research/fs-07/scripts/run-all.sh pipeline   # the same plus 5 runs of every pipelining probe on every server
bun research/fs-07/scripts/bigpacket.ts      # 16 MB splitting (changes max_allowed_packet, restores it)
bun research/fs-07/scripts/sha2tls.ts
bun research/fs-07/scripts/zerodate.ts
bun research/fs-07/scripts/redirect.ts
bun research/fs-07/scripts/summarize.ts && bun research/fs-07/scripts/tables.ts
```

The prototype is type-checked once with its own config and is not part of CI or the root tsconfig:
`bun --bun node_modules/.bin/tsc -p research/fs-07/tsconfig.json`. Nothing here is named `*.test.*`, so
`bun test` does not collect it. Stop the servers with `research/fs-07/scripts/servers.sh down`.

Files: `scripts/` (probes: facts, auth, behaviour, wire, metadata, tls, progress, pipeline, pipeline-trace, kill, binlog,
proxysql, bigpacket, sha2tls, zerodate, redirect; tools: mytrace, mask, check-boundaries, count-lines,
check-ledger, summarize, tables; `claims.json` is the appendix claim list), `results/` (JSON per server and
generated Markdown; raw traces stay in the ignored `work/`).
