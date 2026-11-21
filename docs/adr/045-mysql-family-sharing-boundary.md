# 045. MySQL and MariaDB share one family library; forks are limited to negotiation, naming and MariaDB-only forms

## Status
Accepted

Decided on 2026-11-22 under the owner's delegation, from FS-07 (`research/fs-07/`). A new ADR can change it.

## Context
ADR 004 makes MariaDB an independent engine and ADR 042 gives MySQL and MariaDB a shared `engines/mysql-family`
folder. The roadmap's rule for FS-07 is that code is shared only where bytes and behaviour are identical across the
version matrix. FS-07 built one prototype wire library against nine servers (MySQL 8.4.13, 9.7.4, 26.10.0; MariaDB
10.6.28, 10.11.19, 11.4.13, 11.8.9, 12.3.3, 13.0.2) and checked 31 working-knowledge claims of the roadmap's sections 7
and 8 against documentation and live servers.

## Decision
1. **Shared in `engines/mysql-family`:** packet framing, sequence ids and 16 MB splitting (the response sequence follows
   the last request packet); handshake v10 parsing and response layout; capability bits 0 to 24; OK and ERR parsing and
   session-state tracking; the text protocol and multi-results; text and binary decoding of the classic types; the
   prepared-statement lifecycle (prepare, execute, reset, close, fetch, long data); ping and reset connection; TLS
   upgrade; the native and `caching_sha2` scramble functions.
2. **Forked into the profiles `engines/mysql` and `engines/mariadb`** (a profile is data and small functions the family
   core calls): capability bits above 24 and MariaDB's extended capability word; column-definition extras and the
   metadata-skip flag; the error map (error numbers above 3000); which authentication plugins a server offers and which
   the client allows (sha256 for MySQL; ed25519 and PARSEC for MariaDB); the type contract for JSON, VECTOR, UUID,
   INET, zero dates and TIME edges; MariaDB's bulk execute and prepare-and-execute with statement id `0xFFFFFFFF`;
   charset and collation tables; failover probes; server defaults (collation, `sql_mode`, `local_infile`, binlog format).
3. **The sharing test** is "used unchanged by both profiles on every server in the matrix". A scramble function lives in
   the family as a pure function; whether a profile enables its plugin is profile data.
4. **Optional result-set metadata is off.** MySQL's `resultset_metadata=NONE` keeps skipping column definitions after
   `ALTER TABLE ... ADD COLUMN`, so a cached `SELECT *` decodes one column too few (MariaDB re-sends them). Enabling it
   needs a new ADR.
5. **The client does not advertise local-infile** unless the caller opts in. `local_infile` is ON by default on MariaDB.
6. **Pipelining:** only the generic form (commands written back to back, replies read in order) is used across both
   profiles. The MariaDB-only forms are profile-only. A client that writes must keep reading, because a client that
   stops reading stalls the server until `net_write_timeout`. The scheduling policy stays with FS-05 and ADR 018.
7. **The ledger is the record.** Where `research/fs-07/results/ledger.md` and the roadmap's sections 7 and 8 differ, the
   ledger wins. This ADR does not edit the roadmap.
8. **No supported-version decision is made here.** The matrix above is the one studied. A supported matrix is a
   separate ADR, as ADR 029 is for Node.

## Consequences
- The prototype's split was 789 shared lines, 38 MySQL-only, 127 MariaDB-only and 12 dispatcher (82.7% shared); FS-01's
  skeleton had 710 shared lines with forks of 5 and 7 lines. Under the strict reading of "shared" the `caching_sha2`
  scramble (MariaDB 11.4+ only), the native scramble (absent on MySQL 9.7 and 26.10) and the RSA branch are not shared;
  decision 3 keeps their code in the family and their availability in the profile.
- ProxySQL 3.0.12 queues pipelined commands in order but does not renumber response sequence ids and breaks both
  MariaDB-only forms, so a client that validates sequence ids aborts mid-pipeline. The pooler profiles (FS-06) decide
  what to do.
- After a kill in mid-pipeline the committed rows were a prefix, and the server was one statement ahead of the client's
  responses in 40 of 45 runs and never behind: the last in-flight statement really "may or may not have run" (ADR 034).
- CDC readers and binlog metadata are not decided here (FS-11); defaults differ (MariaDB 12.3 and 13.0 default to ROW;
  10.6 to 11.8 to MIXED).
- Parameters on this family go only through `COM_STMT_EXECUTE`, consistent with ADR 035.

## Evidence
- `research/fs-07/README.md`, `results/ledger.md` (31 claims: 9 Confirmed, 19 Corrected, 3 Not verifiable here) and the
  scripts `check-ledger`, `check-boundaries` and `count-lines`.
- Examples of corrected claims: `MARIADB_CLIENT_EXTENDED_TYPE_INFO` does not exist; MariaDB 11.4+ has a
  `caching_sha2_password` server plugin (TLS only) and 11.8+ has PARSEC, neither loaded by default; MySQL 9.7 and 26.10
  have no server-side native password; MariaDB 10.6 and 10.11 stock images have no automatic TLS certificate.
- The generic pipelining case behaved the same on all nine servers, 5 of 5 runs each.
- Not verified: Hyperdrive, RDS Proxy, PlanetScale, Vitess, TiDB, SingleStore, Aurora, GSSAPI, PAM, IAM,
  `COM_BINLOG_DUMP_GTID`, compression, client certificates, MaxScale, Galera. The documentation verdicts rest on a
  summarising fetch tool and read-only agent reports; the live-server results are the study's own runs.

## Basis
FS-07 findings; ADR 004, 018, 034, 035, 042; the roadmap's FS-07 decision rule.
