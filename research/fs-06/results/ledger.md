# Claim ledger

6 claims from the roadmap appendix, one row each. Verdicts: Confirmed 1, Corrected 3, Not verifiable here 2. Rendered by `scripts/check-ledger.ts` from `scripts/ledger.json`; the script fails when an appendix ID is missing, duplicated or extra.

Rule used throughout: when documentation and a live server disagree, the server wins and the disagreement is recorded in the row. Every documentation statement is marked **raw page text** (a file or web page fetched as bytes and read as text, HTML stripped by a local script) or **summarising tool**. No statement here was read through a summarising tool.

| ID | area | verdict | in one line |
| --- | --- | --- | --- |
| P-01 | one round trip | Corrected | The unnamed one-flush form took one client-side round trip and passed 5/5 on all four local poolers in every configuration; the named variants and "every pooler" do not hold. |
| P-02 | Supavisor named statements | Corrected | The two sources describe two settings of the same server: Supavisor 2.10.1 fails named statements by default and supports them with the flag on; the conservative profile stays right because the flag cannot be seen from the client. |
| P-03 | PgBouncer ParameterStatus | Confirmed | PgBouncer 1.26.1 sends pgbouncer.version, pgbouncer.pool_mode and pgbouncer.max_prepared_statements in the login ParameterStatus, in transaction and session mode. |
| P-04 | RDS Proxy pinning | Not verifiable here | No RDS Proxy URL was supplied; the AWS pages agree with the claim except that SET LOCAL inside an explicit transaction does not pin; the harness and runbook are ready. |
| P-05 | Hyperdrive named statements | Not verifiable here | Hyperdrive needs a Cloudflare account and a Worker and was not attempted; the page says what the claim says, and the harness's bytes were compared with both named libraries. |
| P-06 | P10-T02 acceptance | Corrected | 26000, 42P05 and 08P01 occur when a pooler does not track prepared statements (PgBouncer off, Supavisor default, PgDog disabled, Odyssey off) and, with tracking on, for an unnamed statement held across a Sync; passive detection exists for PgBouncer and, by name only, for Supavisor. |

## P-01 one round trip: Corrected

**Claim.** [E] "One round trip: Parse + Bind + Describe(portal) + Execute + Sync in one flush, including behind poolers. FS-06 confirms on every pooler".

**Documentation.**
- docs/adr/014-one-round-trip-execution-including-behind-poolers.md (repository file) (read as **raw page text**): "One-round-trip execution, including behind poolers"

**Measured here.** S1 (Parse, Bind, Describe(portal), Execute, Sync, one write) passed 5/5 with 1 client-side round trip (about 42 ms under the 40 ms round-trip delay) on PgBouncer 1.26.1, Supavisor 2.10.1, PgDog 0.1.66 and Odyssey 1.5.2 in all 16 configurations, including prepared-statement handling turned off and session mode; S5 (batch), S6 depth 2/10/100 (results in order) and S7/S7b (inside a transaction) also passed 5/5 everywhere. The named form is where it breaks: S2b (Bind only, after other clients ran) failed with 26000 on odyssey-off, supavisor-default, pgdog-disabled (and flakily on pgbouncer-off); a name shared by two clients gave 42P05 or a silent wrong row on pgbouncer-off, supavisor-default and pgdog-disabled. Two-flush describe-first with an unnamed statement (S3ui) failed with 26000 on every PgBouncer transaction configuration and 08P01 on Supavisor transaction mode. RDS Proxy, Neon and Hyperdrive were not run (no account), so "every pooler" cannot be confirmed.

**Evidence files.** `results/matrix.md`, `results/targets/pgbouncer-default.json`, `results/targets/supavisor-default.json`, `results/targets/odyssey-off.json`, `results/targets/pgdog-disabled.json`, `results/trace-excerpts/pgbouncer-default.S1.run1.txt`, `results/trace-excerpts/pgbouncer-default.S3ui.run1.txt`

**Corrected sentence.** Parse + Bind + Describe(portal) + Execute + Sync with the unnamed statement, in one flush, costs one client-side round trip and succeeded on PgBouncer 1.26.1, Supavisor 2.10.1, PgDog 0.1.66 and Odyssey 1.5.2 in every configuration tested (transaction mode with prepared-statement handling on and off, and session mode); named statements (a first Parse, then Bind only) are safe only where the pooler tracks prepared statements (PgBouncer default, PgDog default, Odyssey default, Supavisor with its named-statements flag), and an unnamed statement must not be held across a Sync. RDS Proxy, Neon pooled and Hyperdrive are not verified.

## P-02 Supavisor named statements: Corrected

**Claim.** [V] "Supabase documentation and the Supavisor FAQ disagree on named prepared statements in transaction mode. The `supavisor` profile is conservative until FS-06 measures it."

**Documentation.**
- supabase.com/docs/guides/database/connecting-to-postgres, fetched with curl on 2026-11-21, HTML stripped by a local script (read as **raw page text**): "The shared pooler doesn't support prepared statements in transaction mode. To avoid errors, turn them off in your connection library."
- supavisor v2.10.1 docs/faq.md (repository checkout at the release tag) (read as **raw page text**): "It supports prepared statements in session mode. In transaction mode, named prepared statements are supported when the `named_prepared_statements` feature flag is enabled, either globally with the `NAMED_PREPARED_STATEMENTS_ENABLED` environment variable or per tenant via `feature_flags`."
- supavisor v2.10.1 docs/configuration/env.md (read as **raw page text**): "`NAMED_PREPARED_STATEMENTS_ENABLED` | Enable named prepared statements feature (true, false, 1, 0) | `false`"
- supavisor v2.10.1 config/runtime.exs (read as **raw page text**): ""named_prepared_statements" => Supavisor.Helpers.get_env_bool("NAMED_PREPARED_STATEMENTS_ENABLED", false)"

**Measured here.** supavisor-default (flag unset): S2b failed with 26000 in 1 of 5 runs here (2 of 5 and 4 of 5 in two earlier complete passes: the count depends on which backend the next transaction lands on), the named pinning probe failed 516 of 800 transactions with 26000, a name shared by two clients gave 42P05 (S4a-B 0/5) and a silent wrong row (S4b-B 5/5 wrong, S4c 30/30 wrong), reference clients pg 60/160 (42P05) and postgres.js 103/160 (26000, 42P05). supavisor-on (NAMED_PREPARED_STATEMENTS_ENABLED=true): S2, S2b, S3, S4a to S4c all passed, named probe 800/800, pg and postgres.js 160/160; Supavisor rewrote the statement names (`sv_...`) and added Parse itself when a server connection lacked the statement. So the Supabase page matches the default and the FAQ matches the flag. Whether the shared pooler runs with the flag is not something this study could observe.

**Evidence files.** `results/targets/supavisor-default.json`, `results/targets/supavisor-on.json`, `results/targets/supavisor-session.json`, `results/trace-excerpts/supavisor-default.S4c.run1.txt`, `results/trace-excerpts/supavisor-default.S2b.run4.txt`, `results/trace-excerpts/supavisor-on.S2.run1.txt`

**Corrected sentence.** Supavisor 2.10.1 does not support named prepared statements in transaction mode by default (26000, 42P05, and a silent wrong row when two clients use the same name); with NAMED_PREPARED_STATEMENTS_ENABLED=true (or the tenant feature flag) they work, except that an unnamed statement still cannot be held across a Sync (08P01). The documentation sources describe different settings, so they do not contradict each other; the client cannot see the flag (login reports only application_name=Supavisor), so a `supavisor` profile has to stay conservative unless the user says the flag is on.

## P-03 PgBouncer ParameterStatus: Confirmed

**Claim.** [V] "PgBouncer 1.26 reports `pgbouncer.*` values through ParameterStatus at login, which allows pooler detection without an extra query."

**Documentation.**
- pgbouncer 1.26.1 NEWS.md (repository checkout at tag pgbouncer_1_26_1), entry for 1.26.0 (read as **raw page text**): "Send PgBouncer specific `ParameterStatus` messages to clients on login: `pgbouncer.version`, `pgbouncer.pool_mode` and `pgbouncer.max_prepared_statements`."
- pgbouncer 1.26.1 src/proto.c, welcome_client() (read as **raw page text**): "pktbuf_write_ParameterStatus(msg, "pgbouncer.max_prepared_statements", max_prepared_statements); pktbuf_write_ParameterStatus(msg, "pgbouncer.pool_mode", cf_get_lookup(&pool_mode_lookup));"

**Measured here.** All four PgBouncer configurations sent pgbouncer.version=1.26.1, pgbouncer.max_prepared_statements (200 by default and when set to 200, 0 when set to 0) and pgbouncer.pool_mode (transaction, or session), 18 parameters against 15 from direct Postgres, in the first login of the study. The source also skips them for the admin console. Of the other three poolers only Supavisor names itself, by replacing application_name with the value `Supavisor`; PgDog and Odyssey send nothing that names them (Odyssey omits in_hot_standby and orders the list differently, a weak fingerprint, not a name). The reported max_prepared_statements=200 under default settings also settles that the documented default (200) is the effective one and the sample pgbouncer.ini comment (`;max_prepared_statements = 0`) is stale.

**Evidence files.** `results/matrix.md`, `results/targets/pgbouncer-default.json`, `results/targets/pgbouncer-off.json`, `results/targets/pgbouncer-session.json`, `results/targets/supavisor-default.json`

## P-04 RDS Proxy pinning: Not verifiable here

**Claim.** [V] "RDS Proxy pins a session on any `SET` and on query text above 16 KB, and has no session pinning filters for PostgreSQL." (hosted: Not verifiable here unless a URL is supplied)

**Documentation.**
- docs.aws.amazon.com/AmazonRDS/latest/UserGuide/rds-proxy-pinning.html, fetched with curl on 2026-11-21, HTML stripped by a local script (read as **raw page text**): "However, for PostgreSQL setting a variable leads to session pinning."
- the same page, section "Conditions that cause pinning for RDS for PostgreSQL" (read as **raw page text**): "Using SET commands. RDS Proxy does not pin connections when you use SET LOCAL inside an explicit transaction block (between BEGIN and COMMIT). This exemption does not apply to set_config(name, value, true), which does cause pinning."
- the same page, section "Conditions that cause pinning for all engine families" (read as **raw page text**): "Any statement with a text size greater than 16 KB causes the proxy to pin the session."
- docs.aws.amazon.com/AmazonRDS/latest/UserGuide/rds-proxy.html (limitations), fetched the same way (read as **raw page text**): "RDS Proxy doesn't support session pinning filters for PostgreSQL."

**Measured here.** FS06_RDSPROXY_URL was not set, so `results/hosted/rdsproxy.json` records "Not verified here". `scripts/hosted.ts` includes a pinning check for exactly this claim (a client's backend PIDs over 20 transactions after SET, and with a statement text above 16 KB, against a control) and `results/hosted-runbook.md` has the commands. Documentation only: the claim says "any SET", the page exempts SET LOCAL inside an explicit transaction block.

**Evidence files.** `results/hosted/rdsproxy.json`, `results/hosted-runbook.md`

## P-05 Hyperdrive named statements: Not verifiable here

**Claim.** [V] "Cloudflare documents Hyperdrive as supporting named prepared statements as implemented by postgres.js and node-postgres. OKDriver must reproduce a compatible message sequence and test it live." (Not verifiable here)

**Documentation.**
- developers.cloudflare.com/hyperdrive/concepts/connection-pooling/, fetched with curl on 2026-11-21, HTML stripped by a local script (read as **raw page text**): "Hyperdrive supports named prepared statements as implemented in the postgres.js and node-postgres drivers. Named prepared statements in other drivers may have worse performance or may not be supported."

**Measured here.** Not attempted: no account, and a Worker would be needed (see `results/hosted-runbook.md`). What was measured locally for the "compatible message sequence" half: for one named statement the harness and node-postgres send the same five messages in one flush (Parse, Describe, Execute and Sync byte for byte identical; Bind differs only in that `pg` writes explicit text format codes); postgres.js sends Parse, Describe(statement), Bind, Execute, Sync in one flush with an OID in Parse and generated statement names. Both libraries ran 160/160 through every local configuration with prepared-statement handling on, so a pooler that tracks statements accepts both sequences.

**Evidence files.** `results/bytes-compare.md`, `results/bytes-compare.json`, `results/hosted-runbook.md`

## P-06 P10-T02 acceptance: Corrected

**Claim.** P10-T02 acceptance: "No 26000 or 42P05 errors across the conformance run through each pooler; passive detection where the pooler reports itself". Record which pooler and configuration produce them.

**Documentation.**
- roadmap appendix (task text in the study brief) (read as **raw page text**): "No 26000 or 42P05 errors across the conformance run through each pooler; passive detection where the pooler reports itself"

**Measured here.** SQLSTATEs seen, by configuration. 26000: odyssey-off (65 sequence-level hits across S2b, S3 variants, S4b and S4c, plus 760 in the named probe), pgbouncer-off, supavisor-default, pgdog-disabled (named statements), and pgbouncer-default, pgbouncer-on, pgbouncer-off (`unnamed prepared statement does not exist`, S3ui). 42P05: pgbouncer-off and supavisor-default (S4a-B, reference client pg). 08P01 (`bind message supplies 1 parameters, but prepared statement "" requires 0`, a different statement's parameter count): supavisor-default and supavisor-on (S3ui). Silent wrong rows: pgbouncer-off, supavisor-default, pgdog-disabled. No error and no wrong row in any session-mode configuration. No named-statement error and no wrong row in the default configurations of PgBouncer, PgDog and Odyssey, nor in pgbouncer-on, odyssey-on, pgdog-extended, pgdog-extended_anonymous and supavisor-on; the only errors there are the unnamed-across-Sync ones above (PgBouncer, Supavisor). Passive detection: PgBouncer reports itself (P-03); Supavisor by application_name=Supavisor only; PgDog and Odyssey do not report themselves.

**Evidence files.** `results/matrix.md`, `results/targets/pgbouncer-off.json`, `results/targets/supavisor-default.json`, `results/targets/pgdog-disabled.json`, `results/targets/odyssey-off.json`, `results/targets/pgbouncer-default.json`, `results/targets/supavisor-on.json`

**Corrected sentence.** The acceptance cannot hold for every pooler in every configuration: named statements produce 26000/42P05 (and silent wrong rows) when prepared-statement tracking is off, which is Supavisor's default and an explicit choice on PgBouncer, PgDog and Odyssey, and an unnamed statement held across a Sync produces 26000 behind PgBouncer and 08P01 behind Supavisor even with tracking on. The conformance run should therefore only use named statements after detecting a tracking pooler, never hold an unnamed statement across a Sync, and treat PgDog and Odyssey as undetectable from the login.
