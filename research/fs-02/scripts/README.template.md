# FS-02: is PostgreSQL protocol 3.2 negotiation safe everywhere?

Study only. Nothing here ships and no ADR is changed: the last section is a "Proposed decision" table, and the ADR is
written after review. Base: `origin/main` at `3e2fc81942f6e4006eb96361cf7fa1341131d68e`. Measured on 2026-11-21, on one
machine (client and servers on loopback), Docker 29.10.0, bun 1.4.4.

README.md is generated: `scripts/README.template.md` plus `results/tables/*.md` plus `results/images.json`, filled by
`scripts/build-readme.ts`. Every table and count below is produced by `scripts/report.ts` from `results/cells.json`,
`results/oracle-*.csv` and `results/optional/*`; the one script that regenerates all of it is `scripts/run-all.sh`.
Where a number is stated in prose it names the script and file that make it.

## Question and rule

Does a client that asks for protocol 3.2, or sends a "grease" startup, get a correct negotiation from every endpoint
OKDriver will support? Roadmap rule: 3.2 becomes the default only if every supported endpoint negotiates; otherwise it
stays opt-in (ADR 013: 3.0 default, 3.2 opt-in, "default revisited by FS-02").

## Verdict

**3.2 stays opt-in. ADR 013's decision stands.** The rule is not met, so 3.2 cannot become the default.

- Negotiate correctly in every request of the matrix (R0 to R5): direct PostgreSQL 14, 15, 16, 17, 18 and 19; PgBouncer
  1.23.1 and 1.26.1 (session and transaction pooling, in front of 17 and 19); PgDog 0.1.66 (same).
- Do **not**: PgBouncer 1.22.1 (the last release before negotiation support: it answers 3.2 and 3.9999 with
  `08P01 bad packet header` and an unknown `_pq_` option with `08P01 unsupported startup parameter`), **Odyssey 1.5.2** (closes the connection on any version other than exactly 3.0), and
  **Supavisor 2.10.1** (never negotiates: it accepts 3.9999 and unknown `_pq_` options in silence, and rejects the
  grease startup that libpq sends because that startup carries an empty option value).
- Optional, outside the roadmap list: pgpool-II 4.7.3 negotiates correctly most of the time but intermittently sends a
  corrupt `NegotiateProtocolVersion`; PgCat can only be measured in part (client auth is MD5 only).
- **Which endpoints decide the outcome:** Odyssey 1.5.2 and Supavisor 2.10.1. They are current releases of two poolers
  on the roadmap's profile list and either one alone is enough to fail the rule. PgBouncer 1.22.1 fails too but is older
  than negotiation support (changelog: 1.23.0), so it is not what decides it. Four profiles on the roadmap list could not
  be measured (see "Not verified"); they can only add blockers, never remove these two.
- Side findings that matter for the opt-in design: PgBouncer 1.23.1 and 1.26.1 negotiate every 3.2 request **down to 3.0
  even in front of PostgreSQL 19** (the opt-in buys nothing through PgBouncer up to 1.26.1); PgDog serves 3.2 itself, even
  in front of PostgreSQL 17; Supavisor accepts a 3.2 request and keeps working with 4-byte cancel keys.

{{table:headline}}

{{table:classcounts}}

## Method

- **Probe** (`scripts/probe.ts`): plain TypeScript on `node:net`, `node:tls` and `node:crypto` only, run with bun, no
  dependency, independent of `src/` and of FS-01. It builds `StartupMessage` bytes itself, reads backend messages itself
  and implements the SCRAM-SHA-256 client itself (verified first on direct PostgreSQL: the server signature in
  `AuthenticationSASLFinal` is checked on every login; the generated password is ASCII hex, so SASLprep is not
  exercised). It refuses to answer any other authentication request (md5, cleartext), so the password only ever proves
  SCRAM possession. The password comes from `FS02_PASSWORD`, is never printed or written, and is scrubbed from anything
  stored; `grep` of the committed tree for the run's password and secrets finds nothing.
- **Requests**, each on its own connection, after the same `user`, `database`, `application_name=fs02-probe` parameters:
  R0 3.0 (control); R1 3.2; R2 3.9999 (libpq's grease value); R3 libpq's own grease shape; R4 3.0 plus the unknown option
  `_pq_.fs02_probe_unknown`; R5 3.2 plus the same option; R6 major 4.0 (informational: must be a clean error).
  R3 is 3.9999 plus exactly one extra startup parameter, `_pq_.test_protocol_negotiation` with an **empty value**. That
  shape was read in `fe-protocol3.c` and `fe-connect.c` of `REL_19_BETA3` and then checked byte for byte: the startup
  packet that psql from `postgres:19beta3` sends is identical to the probe's R3 packet (`results/grease-bytes.json`,
  `scripts/grease-bytes.ts`). The brief says "its unsupported startup parameters"; libpq sends one.
- **Per connection** the probe records the first backend message type, every `NegotiateProtocolVersion` (version, listed
  options, whether it came after `AuthenticationOk`), the authentication outcome, `BackendKeyData` length, the version in
  force, then runs `SELECT 1` (simple query). When the key is longer than 4 bytes or 3.2 is in force it also starts
  `pg_sleep(10)` on the first socket and, after 1 s, sends a `CancelRequest` on a second socket with the key received
  (over TLS in tier B); the result is `cancelled` (57014), `ignored`, `closed` or `error`. Idle timeout per read: 10 s.
- **Classes** (fixed before measuring): OK-exact, OK-negotiated, Bad-negotiate, Silent-accept, Reject-clean, Drop, Hang,
  as defined in the brief. Added, not in the brief: `Other` (anything else, e.g. an authentication method the probe
  refuses or a TLS failure) and `Unreachable` (connect failed). How the brief's wording was made executable:
  - OK-negotiated needs exactly one `NegotiateProtocolVersion` before `AuthenticationOk`, a version that is 3.0 or 3.2,
    not above the requested one, an option list equal to the unknown options sent, and not "same version, no options"
    (libpq rejects that as "server negotiated but asks for no changes"). These mirror the checks in libpq's
    `pqGetNegotiateProtocolVersion3` (`REL_19_BETA3`): 3.9999, a higher version, 3.1 and a negative count are invalid.
  - R1 without negotiation is OK-exact when the key length is valid for 3.2 (4 to 256 bytes). That is all the wire shows;
    cancel is reported separately. Consequence: **R1 alone cannot tell "honours 3.2" from "ignores the minor"** (the
    fault server `silent-accept` is OK-exact on R1 too); R2 to R5 are what separate them.
  - Silent-accept for R2, R3, R6 is "reaches ReadyForQuery with no negotiation"; for R4 and R5 it is an ignored unknown
    option. A R6 success with a negotiation is not called Silent-accept.
- **Endpoint verdict** ("negotiates correctly"): R0 is OK-exact, R1 to R5 are each OK-exact or OK-negotiated, `SELECT 1`
  works in each, and the key length is valid for the version in force (3.0: exactly 4; 3.2: 4 to 256). A cancel that is
  ignored does not fail startup and is reported in its own column. R6 is informational. For the optional pgpool-II
  endpoints the verdict also uses the repeat experiment (`scripts/repeat.ts`), because a single pass hides an
  intermittent defect.
- **Re-runs**: every failing cell is re-run once, alone (`scripts/matrix.ts`), and both outcomes are kept.
- **Tier B**: the same matrix after `SSLRequest`, TLS 1.3 with a self-signed certificate and **no certificate
  verification** (the probe's default; `--verify-tls` turns it on and refuses the lab certificate, as it should). Every
  pooler was given TLS with one config change (certificate and key, mode `allow` or optional), so one instance serves
  both tiers; plain-TCP cells (tier A) go to the same instance without TLS.
- **Lab** (`scripts/lab.sh`, Docker): direct PostgreSQL 14 to 19 (`postgres:<major>` official images; TLS on 17 and 19),
  two separate backends `be17` and `be19` (no TLS) behind every pooler, SCRAM-SHA-256 everywhere with a throwaway user
  `fs02` and a password generated per run (kept only under the ignored `work/`). Pooler setups:
  PgBouncer: one container per version, databases `s17`, `t17`, `s19`, `t19` with `pool_mode` set per database;
  PgDog: same database names, `pooler_mode` per user entry;
  Odyssey: same database names, `pool` per rule;
  Supavisor: its own metadata PostgreSQL, tenants `be17` and `be19` created through its API, session mode on one proxy
  port and transaction mode on the other (the mode follows the port per its documentation; that was not independently
  verified here).

## Endpoints, versions and digests

Images are resolved from the tag at pull time; digests of official images are the tag's manifest-list digest. Locally
built images list the source they were built from. `scripts/record-images.ts` writes `results/images.json`.

{{images}}

- PostgreSQL: newest minor of each major on Docker Hub on 2026-11-21 (`postgres:19` is 19.0). Newest tag rule was applied
  to every image. `postgres:19beta3` is used only as an oracle client.
- PgBouncer: no official image. Built from the release tarballs (sha256 checked against the `.sha256` published next to
  each, `scripts/build-pgbouncer.sh`, `docker/pgbouncer.Dockerfile`). 1.22.1 is the last 1.22.x, 1.23.1 the newest 1.23.x
  (the repository also has a tag `pgbouncer_1_23_1-fixed`; the release tarball was used), 1.26.1 the newest release
  (2026-10-14).
- Odyssey: no official image. Built from the source tag `v1.5.2` (2026-09-13) with `docker/odyssey.Dockerfile`, which
  follows the project's own quickstart Dockerfile. The brief names 1.5.1 as newest; a non-prerelease tag 1.5.2 exists, so
  it was used and 1.5.1 was not measured.
- PgDog: `ghcr.io/pgdogdev/pgdog:latest`; its image label says `v0.1.66`, the newest semver tag.
- Supavisor: `supabase/supavisor:2.10.1`, the newest stable tag.
- Optional: pgpool-II built from the source tag `V4_7_3` (the newest `pgpool/pgpool` image on Docker Hub is 4.4.3 from
  2023, which is not a current release); PgCat `ghcr.io/postgresml/pgcat:latest`, whose image was built in 2024.

## Results

### Tier A: endpoint x request

Cell values: OK-neg is OK-negotiated, Silent is Silent-accept, Reject is Reject-clean, Bad-neg is Bad-negotiate. A cell
marked "rerun" differed on its single re-run. The cancel column covers R1, R2, R3 and R5 (`n/a` = no cancel needed,
`-` = the cell did not get that far).

{{table:tierA}}

The two pgpool-II rows are marked "no" although their single pass is clean: the verdict also uses the repeat experiment
below (see the "why" list).

### Tier B: the same matrix after SSLRequest (self-signed certificate, not verified)

Tier B covers direct 17 and 19 and every pooler endpoint (every pooler took TLS with one config change). Direct 14, 15, 16
and 18 were not given certificates, so they are tier A only; not done is not a failure.

{{table:tierB}}

### Why an endpoint is marked "no" (tier A)

{{table:why}}

### What a 3.2 request and the grease request end up with (tier A)

{{table:r1r3}}

### Cancel through a second socket

{{table:cancel}}

### Diagnostics (outside the matrix)

D1 to D3 isolate why a cell failed. They are in `cells.json` and `matrix.csv` with request ids `D1` to `D3` and are not part
of any verdict. D1 is the R4 shape with an empty option value; D2 and D3 are the grease version with a non-empty option
value.

{{table:diag}}

Reading it: Supavisor rejects R3 **because the option value is empty** (D1 fails the same way on a plain 3.0 startup),
not because of the `_pq_.` name; with a non-empty value (D2, D3) it accepts 3.9999 in silence. libpq's real grease
startup has the empty value.

## Failure catalogue (raw texts)

{{table:catalogue}}

`08P01 bad packet header: '0000003c00030002'` is PgBouncer 1.22.1 reading the first 8 bytes of the startup packet (length
0x3c, version 3.2). `0A000 unsupported frontend protocol 4.0: server supports 3.0 to 3.0` is PostgreSQL 14 to 17.

{{table:rerun}}

## Optional endpoints and extra experiments

### pgpool-II 4.7.3 (not on the roadmap list): intermittent corrupt NegotiateProtocolVersion

In the single matrix pass pgpool-II looks fine, but repeating the requests shows that its `NegotiateProtocolVersion`
sometimes carries a garbage option count and option names. `scripts/repeat.ts` ran each request 20 times against each
instance, and 40 connections with libpq from `postgres:19beta3` (default grease):

{{table:repeat}}

The garbage is not random noise in the probe: libpq itself rejects the same messages ("server reported unsupported
parameter name without a `_pq_.` prefix"), and the strings are fragments of other traffic on that process (`SELECT 1`,
`tement due to user request` from a cancelled query, `SERROR`). That looks like a stale buffer. This study did not
investigate further and makes no security claim; it is a defect worth reporting upstream. Both instances (in front of 17
and 19) show it. R6 (major 4.0) is a Drop, with pgpool logging `invalid major no: 4 in startup packet`.

### PgCat (not on the roadmap list): partial

PgCat authenticates clients with MD5 only (its README says "Clients can connect using MD5 authentication"), and the
brief requires SCRAM-SHA-256 on every endpoint, so no PgCat cell can reach ReadyForQuery. How it answers the startup
packet was still recorded (it is not in the endpoint tables). psql agrees: `max_protocol_version=3.2` fails with "server
closed the connection unexpectedly", 3.0 connects.

{{table:pgcat}}

### PgBouncer: duplicate NegotiateProtocolVersion on a cold pool

The PgBouncer 1.26.0 changelog lists "Fix sending a duplicate NegotiateProtocolVersion message when no server was
available right away (#1460)". `scripts/pgbouncer-cold.sh` tried two ways to reach that: a restarted container with
R1, R3 or R5 as the very first client of a pool, and a stopped backend. **Not reproduced**: 1.23.1 and 1.26.1 sent exactly one
message in every case (`results/optional/pgbouncer-cold.txt`). That does not show 1.23.1 to 1.25.x are free of the bug;
1.24.x and 1.25.x were not measured.

## Independent evidence

The probe is the instrument, so it was checked against four independent things.

### Oracle 1: libpq (psql 19.0) against R0 and R1

`psql` from the `postgres:19` image (libpq 19.0) with `max_protocol_version` 3.0, 3.2 and `latest` against every endpoint
in both tiers (`scripts/oracle-psql.ts`, one long-lived client container with host networking). psql's `\conninfo`
reports the protocol version libpq believes is in force. Its connected-or-not outcome agrees with the probe's R0 and R1
for every endpoint, and the version in force agrees wherever both connected; see the counts and any DISAGREEMENT lines
below (a count, not a claim: they are generated).

{{table:oracle1}}

Interpretation notes: `latest` is 3.2 in libpq 19.0, so it equals the 3.2 column. For Supavisor, psql reports
"connected 3.2" even though the pooler never negotiated: libpq believes 3.2 because nothing told it otherwise, which is
the Silent-accept hazard in practice.

### Oracle 1b: libpq from 19beta3, which sends the grease startup by default

`postgres:19beta3` is the last image whose libpq still greases by default (the code is in `REL_19_BETA3` and gone from
`REL_19_0`). Its default connect is R3 produced by the real implementation, compared with the probe's R3:

{{table:oracle1b}}

The probe's R3 packet is byte-identical to libpq's (`results/grease-bytes.json`).

### Oracle 2: fault servers (not endpoints)

`scripts/fault-servers.ts` has servers that misbehave on purpose; `scripts/oracle-faults.ts` runs the probe against them
in-process and checks that each yields its own class on the decisive request. They prove the classes can occur and stay
out of every endpoint table. The brief asks for four; a fifth (`hang`) was added so Hang is proven too.

{{table:oracle2}}

`silent-accept` is OK-exact on R1 and Silent-accept on R2 to R6, the collision described under Method.

### Documentation and source (each statement says how it was read)

All pages were fetched with `curl` and read as raw page text (HTML tags stripped by a script, no summarising tool); sha256
of each fetched file is in `results/docs-sha256.txt`. Documentation never overrides a measurement.

| source | read as raw text | statement used | vs measurement |
|---|---|---|---|
| PostgreSQL 19 docs, protocol overview, 54.1.4 and 54.1.5 | yes | latest protocol is 3.2; "libpq still uses protocol version 3.0 by default"; 3.2 supported by PostgreSQL 18 and later; 3.9999 reserved for grease, servers "should simply compare it ... and downgrade via a NegotiateProtocolVersion message"; 3.1 skipped because "old versions of the popular pgbouncer application had a bug in the protocol negotiation"; unknown `_pq_.` options are rejected through `NegotiateProtocolVersion`; `_pq_.test_protocol_negotiation` reserved for greasing | agrees: 18 and 19 serve 3.2, 14 to 17 negotiate to 3.0, psql 19.0 with no setting connects at 3.0 |
| PostgreSQL 18 docs, same page | yes | 3.2 "PostgreSQL 18 and later"; **no** 3.9999 row and no `_pq_.test_protocol_negotiation` row in the 18 page | agrees; PostgreSQL 18.7 negotiates grease exactly like 19.0 although its page does not mention it |
| PostgreSQL 18 and 19 docs, message formats: `NegotiateProtocolVersion`, `BackendKeyData`, `CancelRequest` | yes (both versions; the three blocks are identical between 18 and 19) | `NegotiateProtocolVersion` carries the newest minor and the unrecognised option names; key length 4 to 256 bytes, "The PostgreSQL server only sends keys up to 32 bytes", middleware "encouraged to not use all of the bytes"; before 3.2 the key was always 4 bytes | agrees: servers send 32 bytes at 3.2; PgDog 32; Supavisor 4 |
| PostgreSQL 18 and 19 docs, message flow (startup, 54.2.8 cancel) | yes (the `NegotiateProtocolVersion` entries in both; cancel section of 19) | after `NegotiateProtocolVersion` "authentication will continue using the version indicated"; cancel is a new connection, "no direct reply is made", the server closes it | agrees: every cancel socket was closed by the server without a reply (counts in the cancel block). **Difference to note:** the flow page lists `NegotiateProtocolVersion` among messages that can still arrive after `AuthenticationOk`, while the brief's class rule calls that "late" and bad. No endpoint sent one late, so no cell depends on it |
| PgBouncer changelog (pgbouncer.org) | yes | 1.23.0 "Add support for negotiating the postgres protocol version with the client (#1007)"; 1.26.0 duplicate-message fix (#1460) and a `_pq_.` memory-leak fix (#1540); no entry mentions protocol 3.2 | agrees: 1.22.1 rejects, 1.23.1 and 1.26.1 negotiate (to 3.0). The #1460 duplicate was not reproduced |
| PgBouncer config and usage pages | fetched; searched for protocol and negotiation, nothing found; usage page not read in full | none | no claim |
| PgDog docs (general, users) | yes, the settings used | `pooler_mode` per user, TLS settings, `auth_type` default scram | docs are silent on protocol versions; behaviour is measured only |
| Odyssey docs and source at tag v1.5.2 | yes, `docs/` and `sources/include/kiwi/be_read.h` | the startup parser accepts only `PG_PROTOCOL_LATEST`, defined as 3.0, and returns an error for any other version; a cancel request is read as two 32-bit values | agrees with the Drop on 3.2, 3.9999 and 4.0. Source reading only for the 4-byte cancel key (not measurable, 3.2 never gets in) |
| Supavisor docs (tenants, users, pool modes, env) | yes | tenant and user fields, `mode_type`, env variables for TLS | docs are silent on protocol versions |
| PgCat README | yes (line on client authentication) | "Clients can connect using MD5 authentication" | agrees (auth request 5 seen) |
| libpq sources at `REL_19_BETA3`, `REL_19_0`, `REL_18_0` (`fe-connect.c`, `fe-protocol3.c`, `pqcomm.h`) and the 19.0 backend (`backend_startup.c`) | yes (raw files) | libpq 19.0 defaults `max_pversion` to 3.0 unless `min_protocol_version` is above 3.0; grease sending code (default 3.9999 and the option `_pq_.test_protocol_negotiation`) is in the beta tags and absent from 19.0, which keeps only the constant and the check that rejects a server claiming 3.9999; the 19.0 server sends one `NegotiateProtocolVersion` when the minor is above its latest or when it saw unknown `_pq_.` options, and rejects another major with `0A000` | agrees: this confirms the roadmap note ("PostgreSQL 19.0 still starts libpq at 3.0; grease is not sent in the final release") |

## Probe and instrument notes (defects and limits found)

- **Lab readiness bug (fixed, no committed result affected).** `wait_port` accepted Docker's published-port listener,
  which opens before the pooler does, so the very first requests after a container start were dropped (seen once on
  pgpool-II as four Drops in a row). It now waits until the connection stays open. All committed runs were made against
  instances that had been up before the first request.
- **R1 cannot separate honouring from ignoring** (see Method and Oracle 2). Supavisor is OK-exact on R1 for that reason;
  it fails on R2 to R5.
- **One probe/oracle disagreement**: the Oracle 1b block lists a DISAGREEMENT line for pgpool-II in front of 17, tier B,
  R3. The probe and libpq made separate connections some time apart; pgpool-II corrupts a fraction of its negotiation
  messages (repeat experiment), so one of the two hit a corrupt one. In the run committed here the probe saw the corrupt
  message (its single re-run, shown in the re-run table, was clean) and libpq connected; in an earlier run of the same
  script the direction was reversed. The probe was not wrong in either case. Oracle 1 (libpq 19.0, R0 and R1) has no
  disagreement. Any other DISAGREEMENT line that appears after a re-run would be unexplained and has to be reported as
  such.
- The probe gained `--servername` (SNI, defaulting to the host name when it is not an IP) and `--verify-tls` after the
  first matrix pass; the whole run was repeated afterwards with the final code (`scripts/run-all.sh`), so every committed
  number is from the final probe.
- SCRAM: client-first uses an empty user name like libpq; channel binding is not used (`SCRAM-SHA-256`, not `-PLUS`).
- Startup packets carry `application_name=fs02-probe`, so packet lengths differ from psql's by that parameter only.
- Everything is loopback on one machine: nothing here says anything about latency, MTU or network faults.

## Not verified here

No accounts were looked for. The probe takes `--host --port --user --database`, reads the password from an environment
variable and never writes it, so the owner can run it and append rows. For an endpoint that needs TLS and SNI (all four
below do) add `--tls`; add `--verify-tls` to verify the certificate chain.

```
FS02_PASSWORD='<password or token>' bun research/fs-02/scripts/probe.ts \
  --host <host> --port <port> --user <user> --database <db> --id <label> --tls --servername <sni-host> \
  --csv research/fs-02/results/extra.csv --raw-dir research/fs-02/results/raw
```

| profile | status | note for whoever runs it |
|---|---|---|
| RDS Proxy | Not verified here | needs an AWS account and a proxy; TLS required |
| Cloudflare Hyperdrive | Not verified here | needs a Cloudflare account; reachable from Workers, a raw TCP probe needs a local-connection setup |
| Neon pooled (PgBouncer) | Not verified here | needs the pooled host name and SNI; this probe speaks raw TCP only |
| Neon over WebSocket and over HTTP | Not verified here | the probe does not implement those transports; it would need a shim |
| Aurora DSQL | Not verified here | the password is an IAM token passed through the environment variable; TLS required |

Also not done, and not claimed:

- PgCat is measured only up to the authentication request (MD5); PgBouncer 1.24.x and 1.25.x; Odyssey 1.5.1 and 1.6.0-rc1;
  other pgpool-II versions; PgDog and Supavisor versions other than the ones listed.
- Supavisor session and transaction modes were chosen by proxy port; the mode actually applied was not independently
  checked. Only the startup phase and `SELECT 1` and the cancel were exercised in each mode, not transaction semantics.
- TLS: certificate verification, direct TLS (`sslnegotiation=direct`, ALPN) and client certificates. Authentication:
  everything except SCRAM-SHA-256.
- CockroachDB, YugabyteDB, AlloyDB, Timescale, PGlite and other pgwire implementations from the compatibility list.

## Observations against ADRs (findings, not decisions)

- **ADR 013 (3.0 default, 3.2 opt-in).** Consistent with every measurement. Its basis "[V] PostgreSQL 19" holds: libpq
  19.0 defaults to 3.0 (source and a psql default connect against 19.0 show 3.0). Its open question ("default revisited
  by FS-02") can be closed as "stays opt-in" with this study. The roadmap row's note about grease is correct for 19.0.
- **ADR 014 (one round trip, including behind poolers; per-pooler sequence open, FS-06).** The protocol version in
  force is decided by the pooler hop, not by the backend: PgBouncer negotiates to 3.0 in front of PostgreSQL 19, PgDog
  and pgpool-II serve 3.2 in front of PostgreSQL 17 (`r1r3` table). Capability profiles for poolers (FS-06) should key
  on the negotiated version and the `BackendKeyData` the pooler hands out (4 bytes from PgBouncer, Odyssey and
  Supavisor, 32 from PgDog and pgpool-II), not on the backend's `server_version`. Nothing measured contradicts the ADR.
- **ADR 019 (no connection multiplexing).** No observation: nothing here exercised multiplexing. Cancel through transaction
  pooling worked on PgDog and Supavisor at 3.2.

## Proposed decision

For the ADR that follows this review; none of this is applied.

| # | Item | Proposed decision | Evidence |
|---|---|---|---|
| 1 | ADR 013, default protocol version | Keep 3.0 as the default; 3.2 stays opt-in. Close the "revisited by FS-02" question with this result. | Rule not met: Odyssey 1.5.2 and Supavisor 2.10.1 do not meet the R1 to R5 requirement (tier A and B); PgBouncer 1.22.1 and pgpool-II 4.7.3 do not either |
| 2 | ADR 013, what would reopen it | Re-run `scripts/run-all.sh` with newer releases and with the four unverified profiles added; 3.2 can become the default only when every supported endpoint is OK-exact or OK-negotiated on R1 to R5 with a valid key length | Tables above |
| 3 | ADR 013, opt-in behaviour | When a 3.2 request ends in Drop, Reject-clean or Hang during startup, fail with an error that names the endpoint and the requested version; do not retry at 3.0 on its own (libpq does not either: psql 3.2 fails against Odyssey and PgBouncer 1.22.1 with the errors in the catalogue) | Oracle 1 |
| 4 | ADR 013, validating `NegotiateProtocolVersion` | Accept exactly one, before the end of authentication, with version 3.0 or 3.2, not above the requested one, not "same version and no options", and an option list that is a subset of what was sent; otherwise close with a protocol error | libpq `REL_19_BETA3` checks; the pgpool-II corruption is caught by these rules |
| 5 | ADR 013, key lengths | Read the `BackendKeyData` length from the message at any version in force (4 to 256 at 3.2); do not assume 32 at 3.2 (Supavisor sends 4, PgDog and PostgreSQL 32) and do not assume 4 at 3.0 | `r1r3` table |
| 6 | ADR 013, `_pq_.` options | Do not rely on a `_pq_.` extension being active unless the endpoint is on a known-good list: Odyssey and Supavisor accept and ignore it with no message (Silent-accept on R4 for both, on R5 for Supavisor; Odyssey drops R5 because it asks for 3.2) | Tier A table, R4 and R5 |
| 7 | P5-T04, grease startup | The grease test must send exactly libpq's shape (3.9999 plus `_pq_.test_protocol_negotiation` with an empty value) and also the diagnostics D1 to D3, because the empty value alone is what Supavisor rejects | `results/grease-bytes.json`, diagnostics table |
| 8 | P5-T04, endpoints the grease test must cover as passing | Direct PostgreSQL 14 to 19 (OK-negotiated to 3.0 for 14 to 17 and to 3.2 for 18 and 19); PgBouncer 1.23.1 and 1.26.1 in session and transaction mode (OK-negotiated to 3.0, in front of 17 and 19); PgDog 0.1.66 in both modes (OK-negotiated to 3.2); each also over TLS (tier B showed no class difference) | Tier A and B tables |
| 9 | P5-T04, endpoints the test must cover as expected-failure with the recorded class | PgBouncer 1.22.1 (Reject-clean, `08P01`), Odyssey 1.5.2 (Drop), Supavisor 2.10.1 (Silent-accept on R2, R4, R5 and Reject-clean on R3), pgpool-II 4.7.3 (intermittent Bad-negotiate). A recorded class that changes is a signal to re-evaluate that profile | Failure catalogue, repeat experiment |
| 10 | P5-T04, "FS-02 endpoints all connect" | True at 3.0: every measured endpoint reaches ReadyForQuery on R0. At 3.2 only the passing group in row 8 connects with a correct negotiation. State the acceptance per protocol version | R0 count in the headline table |
| 11 | P5-T04, unverified profiles | RDS Proxy, Cloudflare Hyperdrive, Neon (pooled, WebSocket, HTTP) and Aurora DSQL get profile rows only after the owner runs the probe; until then their 3.2 capability is "unknown", not assumed | Not verified |
| 12 | Cancel | The cancel path needs its own test per profile at 3.2: every endpoint that reached 3.2 here cancelled correctly, but only the probe's simple-query case was tried | Cancel table |

## Decisions made beyond the brief

1. Odyssey: newest stable tag `v1.5.2` used instead of the 1.5.1 the brief names; 1.5.1 not measured.
2. Every pooler was measured in front of both PostgreSQL 17 and 19, including PgBouncer (the brief names that pairing only
   for PgDog, Odyssey and Supavisor): 4 PgBouncer endpoints per version.
3. Session and transaction modes are separate database names (PgBouncer, PgDog, Odyssey) or separate proxy ports
   (Supavisor); poolers run with TLS optional so one instance serves both tiers.
4. Two backends (`be17`, `be19`) separate from the direct `pg17` and `pg19`, so TLS settings on the direct instances do not
   change what the poolers see.
5. Classes added: `Other` and `Unreachable`. Diagnostics D1 to D3 added outside the matrix. A fifth fault server (`hang`).
6. How the brief's classes were made executable (Method): version must be 3.0 or 3.2 and not above the requested one;
   "same version, no options" is Bad-negotiate; "late" means after `AuthenticationOk`; R1 without negotiation is OK-exact
   on a valid key length.
7. Extra oracles: psql from `postgres:19beta3` (real grease, Oracle 1b) and a byte-for-byte comparison of its startup packet
   with R3 (`grease-bytes`).
8. Optional endpoints: pgpool-II built from the source tag `V4_7_3` (Docker Hub image is from 2023); PgCat measured only up to
   the MD5 auth request, kept out of the tables; a repeat experiment (`scripts/repeat.ts`) added because pgpool-II is
   intermittent; the pgpool-II verdict uses it.
9. The probe refuses MD5 and cleartext authentication requests (it never sends anything derived from the password except a
   SCRAM proof) and has `--servername` and `--verify-tls`.
10. The Docker daemon was started by hand (`dockerd`), as the FS-07 README already notes for this environment.
11. Sources for libpq and the 19.0 backend were fetched as raw files from `raw.githubusercontent.com` at release tags;
    Odyssey, pgpool-II and the PgBouncer repository tags through `git`; documentation pages through `curl`. PgBouncer
    build stage installs `python3` and `pandoc` (the 1.26.1 tarball builds its man pages).
12. Committed size: all raw transcripts are kept (each is at most 4096 bytes per direction as hex); `cells.json` is compact and
    `results/tables/` is git-ignored through the nested `.gitignore` because it is derived from `cells.json`.

## Reproduce

Needs Docker (start the daemon by hand if needed) and bun. From the repository root:

```
docker pull postgres:14 postgres:15 postgres:16 postgres:17 postgres:18 postgres:19 postgres:19beta3 \
  supabase/supavisor:2.10.1 ghcr.io/pgdogdev/pgdog:latest ghcr.io/postgresml/pgcat:latest
# PgBouncer tarballs into research/fs-02/work/src/pgbouncer/<v>/ (pgbouncer-<v>.tar.gz and sha.txt = the .sha256 file),
# git clones of yandex/odyssey (tag v1.5.2) and pgpool/pgpool2 (tag V4_7_3) into research/fs-02/work/src/
research/fs-02/scripts/build-pgbouncer.sh 1.22.1 1.23.1 1.26.1
docker build -t fs02/odyssey:1.5.2 -f research/fs-02/docker/odyssey.Dockerfile research/fs-02/work/src/odyssey-1.5.2
docker build -t fs02/pgpool:4.7.3 -f research/fs-02/docker/pgpool.Dockerfile research/fs-02/work/src/pgpool2-4.7.3
cd research/fs-02
for s in pg pgbouncer pgdog odyssey supavisor pgcat pgpool; do scripts/lab.sh $s; done
scripts/run-all.sh          # regenerates results/ and README.md
scripts/lab.sh down         # stops and removes every fs02-* container and the network
../../node_modules/.bin/tsc -p tsconfig.json   # typecheck of the scripts
```

## Files

- `scripts/probe.ts` the probe; `scripts/matrix.ts` runs it over `endpoints.json`; `scripts/repeat.ts` repetition.
- `scripts/oracle-psql.ts` oracle 1 and 1b; `scripts/fault-servers.ts` and `scripts/oracle-faults.ts` oracle 2;
  `scripts/grease-bytes.ts` byte comparison.
- `scripts/lab.sh`, `scripts/build-pgbouncer.sh`, `scripts/supavisor-tenants.ts`, `scripts/pgbouncer-cold.sh`,
  `scripts/record-images.ts`, `scripts/report.ts`, `scripts/build-readme.ts`, `scripts/run-all.sh`, `docker/`.
- `results/matrix.csv` one row per endpoint, tier and request (diagnostics D1 to D3 included); `results/cells.json` the same
  with every recorded field; `results/raw/` hex of the application-layer bytes per cell, at most 4096 bytes per direction;
  `results/summary.md` every table; `results/oracle-*.csv`; `results/optional/`; `results/images.json`;
  `results/docs-sha256.txt`.
