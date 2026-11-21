## Headline counts (tier A, plain TCP)

- endpoints measured: 32
- negotiate correctly: 18
- do not: 14
- cells recorded: tier A 320 (including the diagnostics D1..D3), tier B 196
- R0 reached OK-exact on 32 of 32 endpoints

| product and version | endpoints | negotiate correctly | do not |
|---|---|---|---|
| direct 14 | 1 | 1 | 0 |
| direct 15 | 1 | 1 | 0 |
| direct 16 | 1 | 1 | 0 |
| direct 17 | 1 | 1 | 0 |
| direct 18 | 1 | 1 | 0 |
| direct 19 | 1 | 1 | 0 |
| pgbouncer 1.22.1 | 4 | 0 | 4 |
| pgbouncer 1.23.1 | 4 | 4 | 0 |
| pgbouncer 1.26.1 | 4 | 4 | 0 |
| pgdog 0.1.66 | 4 | 4 | 0 |
| odyssey 1.5.2 | 4 | 0 | 4 |
| supavisor 2.10.1 | 4 | 0 | 4 |
| pgpool 4.7.3 | 2 | 0 | 2 |

## Class counts per request (tier A, all endpoints)

| class | R0 | R1 | R2 | R3 | R4 | R5 | R6 |
|---|---|---|---|---|---|---|---|
| OK-exact | 32 | 11 | 0 | 0 | 0 | 0 | 0 |
| OK-negotiated | 0 | 13 | 20 | 20 | 20 | 20 | 0 |
| Silent-accept | 0 | 0 | 4 | 0 | 8 | 4 | 4 |
| Reject-clean | 0 | 4 | 4 | 8 | 4 | 4 | 18 |
| Drop | 0 | 4 | 4 | 4 | 0 | 4 | 10 |
| endpoints | 32 | 32 | 32 | 32 | 32 | 32 | 32 |

## Tier A: endpoint x request (class per cell)

| endpoint | R0 | R1 | R2 | R3 | R4 | R5 | R6 | negotiates correctly | cancel (R1,R2,R3,R5) |
|---|---|---|---|---|---|---|---|---|---|
| pg14 | OK-exact | OK-neg | OK-neg | OK-neg | OK-neg | OK-neg | Reject | yes | n/a |
| pg15 | OK-exact | OK-neg | OK-neg | OK-neg | OK-neg | OK-neg | Reject | yes | n/a |
| pg16 | OK-exact | OK-neg | OK-neg | OK-neg | OK-neg | OK-neg | Reject | yes | n/a |
| pg17 | OK-exact | OK-neg | OK-neg | OK-neg | OK-neg | OK-neg | Reject | yes | n/a |
| pg18 | OK-exact | OK-exact | OK-neg | OK-neg | OK-neg | OK-neg | Reject | yes | cancelled |
| pg19 | OK-exact | OK-exact | OK-neg | OK-neg | OK-neg | OK-neg | Reject | yes | cancelled |
| pgbouncer-1.22.1-sess-pg17 | OK-exact | Reject | Reject | Reject | Reject | Reject | Reject | **no** | - |
| pgbouncer-1.22.1-tran-pg17 | OK-exact | Reject | Reject | Reject | Reject | Reject | Reject | **no** | - |
| pgbouncer-1.22.1-sess-pg19 | OK-exact | Reject | Reject | Reject | Reject | Reject | Reject | **no** | - |
| pgbouncer-1.22.1-tran-pg19 | OK-exact | Reject | Reject | Reject | Reject | Reject | Reject | **no** | - |
| pgbouncer-1.23.1-sess-pg17 | OK-exact | OK-neg | OK-neg | OK-neg | OK-neg | OK-neg | Reject | yes | n/a |
| pgbouncer-1.23.1-tran-pg17 | OK-exact | OK-neg | OK-neg | OK-neg | OK-neg | OK-neg | Reject | yes | n/a |
| pgbouncer-1.23.1-sess-pg19 | OK-exact | OK-neg | OK-neg | OK-neg | OK-neg | OK-neg | Reject | yes | n/a |
| pgbouncer-1.23.1-tran-pg19 | OK-exact | OK-neg | OK-neg | OK-neg | OK-neg | OK-neg | Reject | yes | n/a |
| pgbouncer-1.26.1-sess-pg17 | OK-exact | OK-neg | OK-neg | OK-neg | OK-neg | OK-neg | Reject | yes | n/a |
| pgbouncer-1.26.1-tran-pg17 | OK-exact | OK-neg | OK-neg | OK-neg | OK-neg | OK-neg | Reject | yes | n/a |
| pgbouncer-1.26.1-sess-pg19 | OK-exact | OK-neg | OK-neg | OK-neg | OK-neg | OK-neg | Reject | yes | n/a |
| pgbouncer-1.26.1-tran-pg19 | OK-exact | OK-neg | OK-neg | OK-neg | OK-neg | OK-neg | Reject | yes | n/a |
| pgdog-0.1.66-sess-pg17 | OK-exact | OK-exact | OK-neg | OK-neg | OK-neg | OK-neg | Drop | yes | cancelled |
| pgdog-0.1.66-tran-pg17 | OK-exact | OK-exact | OK-neg | OK-neg | OK-neg | OK-neg | Drop | yes | cancelled |
| pgdog-0.1.66-sess-pg19 | OK-exact | OK-exact | OK-neg | OK-neg | OK-neg | OK-neg | Drop | yes | cancelled |
| pgdog-0.1.66-tran-pg19 | OK-exact | OK-exact | OK-neg | OK-neg | OK-neg | OK-neg | Drop | yes | cancelled |
| odyssey-1.5.2-sess-pg17 | OK-exact | Drop | Drop | Drop | Silent | Drop | Drop | **no** | - |
| odyssey-1.5.2-tran-pg17 | OK-exact | Drop | Drop | Drop | Silent | Drop | Drop | **no** | - |
| odyssey-1.5.2-sess-pg19 | OK-exact | Drop | Drop | Drop | Silent | Drop | Drop | **no** | - |
| odyssey-1.5.2-tran-pg19 | OK-exact | Drop | Drop | Drop | Silent | Drop | Drop | **no** | - |
| supavisor-2.10.1-sess-pg17 | OK-exact | OK-exact | Silent | Reject | Silent | Silent | Silent | **no** | cancelled / n/a / - / cancelled |
| supavisor-2.10.1-tran-pg17 | OK-exact | OK-exact | Silent | Reject | Silent | Silent | Silent | **no** | cancelled / n/a / - / cancelled |
| supavisor-2.10.1-sess-pg19 | OK-exact | OK-exact | Silent | Reject | Silent | Silent | Silent | **no** | cancelled / n/a / - / cancelled |
| supavisor-2.10.1-tran-pg19 | OK-exact | OK-exact | Silent | Reject | Silent | Silent | Silent | **no** | cancelled / n/a / - / cancelled |
| pgpool-4.7.3-pg17 | OK-exact | OK-neg | OK-neg | OK-neg | OK-neg | OK-neg | Drop | **no** | n/a |
| pgpool-4.7.3-pg19 | OK-exact | OK-exact | OK-neg | OK-neg | OK-neg | OK-neg | Drop | **no** | cancelled |

## Tier B: the same matrix after SSLRequest (self-signed certificate, certificate not verified)

| endpoint | R0 | R1 | R2 | R3 | R4 | R5 | R6 | negotiates correctly | cancel (R1,R2,R3,R5) |
|---|---|---|---|---|---|---|---|---|---|
| pg17 | OK-exact | OK-neg | OK-neg | OK-neg | OK-neg | OK-neg | Reject | yes | n/a |
| pg19 | OK-exact | OK-exact | OK-neg | OK-neg | OK-neg | OK-neg | Reject | yes | cancelled |
| pgbouncer-1.22.1-sess-pg17 | OK-exact | Reject | Reject | Reject | Reject | Reject | Reject | **no** | - |
| pgbouncer-1.22.1-tran-pg17 | OK-exact | Reject | Reject | Reject | Reject | Reject | Reject | **no** | - |
| pgbouncer-1.22.1-sess-pg19 | OK-exact | Reject | Reject | Reject | Reject | Reject | Reject | **no** | - |
| pgbouncer-1.22.1-tran-pg19 | OK-exact | Reject | Reject | Reject | Reject | Reject | Reject | **no** | - |
| pgbouncer-1.23.1-sess-pg17 | OK-exact | OK-neg | OK-neg | OK-neg | OK-neg | OK-neg | Reject | yes | n/a |
| pgbouncer-1.23.1-tran-pg17 | OK-exact | OK-neg | OK-neg | OK-neg | OK-neg | OK-neg | Reject | yes | n/a |
| pgbouncer-1.23.1-sess-pg19 | OK-exact | OK-neg | OK-neg | OK-neg | OK-neg | OK-neg | Reject | yes | n/a |
| pgbouncer-1.23.1-tran-pg19 | OK-exact | OK-neg | OK-neg | OK-neg | OK-neg | OK-neg | Reject | yes | n/a |
| pgbouncer-1.26.1-sess-pg17 | OK-exact | OK-neg | OK-neg | OK-neg | OK-neg | OK-neg | Reject | yes | n/a |
| pgbouncer-1.26.1-tran-pg17 | OK-exact | OK-neg | OK-neg | OK-neg | OK-neg | OK-neg | Reject | yes | n/a |
| pgbouncer-1.26.1-sess-pg19 | OK-exact | OK-neg | OK-neg | OK-neg | OK-neg | OK-neg | Reject | yes | n/a |
| pgbouncer-1.26.1-tran-pg19 | OK-exact | OK-neg | OK-neg | OK-neg | OK-neg | OK-neg | Reject | yes | n/a |
| pgdog-0.1.66-sess-pg17 | OK-exact | OK-exact | OK-neg | OK-neg | OK-neg | OK-neg | Drop | yes | cancelled |
| pgdog-0.1.66-tran-pg17 | OK-exact | OK-exact | OK-neg | OK-neg | OK-neg | OK-neg | Drop | yes | cancelled |
| pgdog-0.1.66-sess-pg19 | OK-exact | OK-exact | OK-neg | OK-neg | OK-neg | OK-neg | Drop | yes | cancelled |
| pgdog-0.1.66-tran-pg19 | OK-exact | OK-exact | OK-neg | OK-neg | OK-neg | OK-neg | Drop | yes | cancelled |
| odyssey-1.5.2-sess-pg17 | OK-exact | Drop | Drop | Drop | Silent | Drop | Drop | **no** | - |
| odyssey-1.5.2-tran-pg17 | OK-exact | Drop | Drop | Drop | Silent | Drop | Drop | **no** | - |
| odyssey-1.5.2-sess-pg19 | OK-exact | Drop | Drop | Drop | Silent | Drop | Drop | **no** | - |
| odyssey-1.5.2-tran-pg19 | OK-exact | Drop | Drop | Drop | Silent | Drop | Drop | **no** | - |
| supavisor-2.10.1-sess-pg17 | OK-exact | OK-exact | Silent | Reject | Silent | Silent | Silent | **no** | cancelled / n/a / - / cancelled |
| supavisor-2.10.1-tran-pg17 | OK-exact | OK-exact | Silent | Reject | Silent | Silent | Silent | **no** | cancelled / n/a / - / cancelled |
| supavisor-2.10.1-sess-pg19 | OK-exact | OK-exact | Silent | Reject | Silent | Silent | Silent | **no** | cancelled / n/a / - / cancelled |
| supavisor-2.10.1-tran-pg19 | OK-exact | OK-exact | Silent | Reject | Silent | Silent | Silent | **no** | cancelled / n/a / - / cancelled |
| pgpool-4.7.3-pg17 | OK-exact | OK-neg | Bad-neg (rerun: OK-neg) | Bad-neg (rerun: OK-neg) | OK-neg | OK-neg | Drop | **no** | n/a |
| pgpool-4.7.3-pg19 | OK-exact | OK-exact | OK-neg | OK-neg | OK-neg | OK-neg | Drop | yes | cancelled |

Cells whose class differs between tier A and tier B: 2
- pgpool-4.7.3-pg17 R2: A OK-negotiated -> B Bad-negotiate
- pgpool-4.7.3-pg17 R3: A OK-negotiated -> B Bad-negotiate

## Why an endpoint does not negotiate correctly (tier A)

- pgbouncer-1.22.1-sess-pg17: R1 Reject-clean; R2 Reject-clean; R3 Reject-clean; R4 Reject-clean; R5 Reject-clean
- pgbouncer-1.22.1-tran-pg17: R1 Reject-clean; R2 Reject-clean; R3 Reject-clean; R4 Reject-clean; R5 Reject-clean
- pgbouncer-1.22.1-sess-pg19: R1 Reject-clean; R2 Reject-clean; R3 Reject-clean; R4 Reject-clean; R5 Reject-clean
- pgbouncer-1.22.1-tran-pg19: R1 Reject-clean; R2 Reject-clean; R3 Reject-clean; R4 Reject-clean; R5 Reject-clean
- odyssey-1.5.2-sess-pg17: R1 Drop; R2 Drop; R3 Drop; R4 Silent-accept; R5 Drop
- odyssey-1.5.2-tran-pg17: R1 Drop; R2 Drop; R3 Drop; R4 Silent-accept; R5 Drop
- odyssey-1.5.2-sess-pg19: R1 Drop; R2 Drop; R3 Drop; R4 Silent-accept; R5 Drop
- odyssey-1.5.2-tran-pg19: R1 Drop; R2 Drop; R3 Drop; R4 Silent-accept; R5 Drop
- supavisor-2.10.1-sess-pg17: R2 Silent-accept; R3 Reject-clean; R4 Silent-accept; R5 Silent-accept
- supavisor-2.10.1-tran-pg17: R2 Silent-accept; R3 Reject-clean; R4 Silent-accept; R5 Silent-accept
- supavisor-2.10.1-sess-pg19: R2 Silent-accept; R3 Reject-clean; R4 Silent-accept; R5 Silent-accept
- supavisor-2.10.1-tran-pg19: R2 Silent-accept; R3 Reject-clean; R4 Silent-accept; R5 Silent-accept
- pgpool-4.7.3-pg17: intermittent: 9 of 120 repeated R0..R5 requests were not OK (see the repeat experiment)
- pgpool-4.7.3-pg19: intermittent: 5 of 120 repeated R0..R5 requests were not OK (see the repeat experiment)

## What R1 (3.2) and R3 (grease) end up with (tier A)

| endpoint | R1 class | R1 version in force | R1 key bytes | R3 class | R3 version in force | server_version reported |
|---|---|---|---|---|---|---|
| pg14 | OK-negotiated | 3.0 | 4 | OK-negotiated | 3.0 | 14.25 (Debian 14.25-1.pgdg13+1) |
| pg15 | OK-negotiated | 3.0 | 4 | OK-negotiated | 3.0 | 15.20 (Debian 15.20-1.pgdg13+1) |
| pg16 | OK-negotiated | 3.0 | 4 | OK-negotiated | 3.0 | 16.16 (Debian 16.16-1.pgdg13+1) |
| pg17 | OK-negotiated | 3.0 | 4 | OK-negotiated | 3.0 | 17.12 (Debian 17.12-1.pgdg13+1) |
| pg18 | OK-exact | 3.2 | 32 | OK-negotiated | 3.2 | 18.7 (Debian 18.7-1.pgdg13+5) |
| pg19 | OK-exact | 3.2 | 32 | OK-negotiated | 3.2 | 19.0 (Debian 19.0-1.pgdg13+1) |
| pgbouncer-1.22.1-sess-pg17 | Reject-clean | - | - | Reject-clean | - | 17.12 (Debian 17.12-1.pgdg13+1) |
| pgbouncer-1.22.1-tran-pg17 | Reject-clean | - | - | Reject-clean | - | 17.12 (Debian 17.12-1.pgdg13+1) |
| pgbouncer-1.22.1-sess-pg19 | Reject-clean | - | - | Reject-clean | - | 19.0 (Debian 19.0-1.pgdg13+1) |
| pgbouncer-1.22.1-tran-pg19 | Reject-clean | - | - | Reject-clean | - | 19.0 (Debian 19.0-1.pgdg13+1) |
| pgbouncer-1.23.1-sess-pg17 | OK-negotiated | 3.0 | 4 | OK-negotiated | 3.0 | 17.12 (Debian 17.12-1.pgdg13+1) |
| pgbouncer-1.23.1-tran-pg17 | OK-negotiated | 3.0 | 4 | OK-negotiated | 3.0 | 17.12 (Debian 17.12-1.pgdg13+1) |
| pgbouncer-1.23.1-sess-pg19 | OK-negotiated | 3.0 | 4 | OK-negotiated | 3.0 | 19.0 (Debian 19.0-1.pgdg13+1) |
| pgbouncer-1.23.1-tran-pg19 | OK-negotiated | 3.0 | 4 | OK-negotiated | 3.0 | 19.0 (Debian 19.0-1.pgdg13+1) |
| pgbouncer-1.26.1-sess-pg17 | OK-negotiated | 3.0 | 4 | OK-negotiated | 3.0 | 17.12 (Debian 17.12-1.pgdg13+1) |
| pgbouncer-1.26.1-tran-pg17 | OK-negotiated | 3.0 | 4 | OK-negotiated | 3.0 | 17.12 (Debian 17.12-1.pgdg13+1) |
| pgbouncer-1.26.1-sess-pg19 | OK-negotiated | 3.0 | 4 | OK-negotiated | 3.0 | 19.0 (Debian 19.0-1.pgdg13+1) |
| pgbouncer-1.26.1-tran-pg19 | OK-negotiated | 3.0 | 4 | OK-negotiated | 3.0 | 19.0 (Debian 19.0-1.pgdg13+1) |
| pgdog-0.1.66-sess-pg17 | OK-exact | 3.2 | 32 | OK-negotiated | 3.2 | 17.12 (Debian 17.12-1.pgdg13+1) |
| pgdog-0.1.66-tran-pg17 | OK-exact | 3.2 | 32 | OK-negotiated | 3.2 | 17.12 (Debian 17.12-1.pgdg13+1) |
| pgdog-0.1.66-sess-pg19 | OK-exact | 3.2 | 32 | OK-negotiated | 3.2 | 19.0 (Debian 19.0-1.pgdg13+1) |
| pgdog-0.1.66-tran-pg19 | OK-exact | 3.2 | 32 | OK-negotiated | 3.2 | 19.0 (Debian 19.0-1.pgdg13+1) |
| odyssey-1.5.2-sess-pg17 | Drop | - | - | Drop | - | 17.12 (Debian 17.12-1.pgdg13+1) |
| odyssey-1.5.2-tran-pg17 | Drop | - | - | Drop | - | 17.12 (Debian 17.12-1.pgdg13+1) |
| odyssey-1.5.2-sess-pg19 | Drop | - | - | Drop | - | 19.0 (Debian 19.0-1.pgdg13+1) |
| odyssey-1.5.2-tran-pg19 | Drop | - | - | Drop | - | 19.0 (Debian 19.0-1.pgdg13+1) |
| supavisor-2.10.1-sess-pg17 | OK-exact | 3.2 | 4 | Reject-clean | - | 17.12 (Debian 17.12-1.pgdg13+1) |
| supavisor-2.10.1-tran-pg17 | OK-exact | 3.2 | 4 | Reject-clean | - | 17.12 (Debian 17.12-1.pgdg13+1) |
| supavisor-2.10.1-sess-pg19 | OK-exact | 3.2 | 4 | Reject-clean | - | 19.0 (Debian 19.0-1.pgdg13+1) |
| supavisor-2.10.1-tran-pg19 | OK-exact | 3.2 | 4 | Reject-clean | - | 19.0 (Debian 19.0-1.pgdg13+1) |
| pgpool-4.7.3-pg17 | OK-negotiated | 3.0 | 4 | OK-negotiated | 3.0 | 17.12 (Debian 17.12-1.pgdg13+1) |
| pgpool-4.7.3-pg19 | OK-exact | 3.2 | 32 | OK-negotiated | 3.2 | 19.0 (Debian 19.0-1.pgdg13+1) |

## Failure catalogue (distinct non-OK outcomes, tier A and B, raw texts from the server)

| product | outcome (class: raw text) | requests |
|---|---|---|
| direct 14 | Reject-clean: 0A000 unsupported frontend protocol 4.0: server supports 3.0 to 3.0 | R6 |
| direct 15 | Reject-clean: 0A000 unsupported frontend protocol 4.0: server supports 3.0 to 3.0 | R6 |
| direct 16 | Reject-clean: 0A000 unsupported frontend protocol 4.0: server supports 3.0 to 3.0 | R6 |
| direct 17 | Reject-clean: 0A000 unsupported frontend protocol 4.0: server supports 3.0 to 3.0 | R6 |
| direct 18 | Reject-clean: 0A000 unsupported frontend protocol 4.0: server supports 3.0 to 3.2 | R6 |
| direct 19 | Reject-clean: 0A000 unsupported frontend protocol 4.0: server supports 3.0 to 3.2 | R6 |
| odyssey 1.5.2 | Silent-accept: reached ReadyForQuery, unknown _pq_ option ignored with no NegotiateProtocolVersion | D1, R4 |
| odyssey 1.5.2 | Drop: connection closed before any backend message | D2, D3, R1, R2, R3, R5, R6 |
| pgbouncer 1.22.1 | Reject-clean: 08P01 unsupported startup parameter: _pq_.fs02_probe_unknown | D1, R4 |
| pgbouncer 1.22.1 | Reject-clean: 08P01 bad packet header: '000000560003270f' | D2 |
| pgbouncer 1.22.1 | Reject-clean: 08P01 bad packet header: '0000005d0003270f' | D3 |
| pgbouncer 1.22.1 | Reject-clean: 08P01 bad packet header: '0000003c00030002' | R1 |
| pgbouncer 1.22.1 | Reject-clean: 08P01 bad packet header: '0000003c0003270f' | R2 |
| pgbouncer 1.22.1 | Reject-clean: 08P01 bad packet header: '0000005c0003270f' | R3 |
| pgbouncer 1.22.1 | Reject-clean: 08P01 bad packet header: '0000005600030002' | R5 |
| pgbouncer 1.22.1 | Reject-clean: 08P01 bad packet header: '0000003c00040000' | R6 |
| pgbouncer 1.23.1 | Reject-clean: 08P01 bad packet header: '0000003c00040000' | R6 |
| pgbouncer 1.26.1 | Reject-clean: 08P01 bad packet header: '0000003c00040000' | R6 |
| pgdog 0.1.66 | Drop: connection closed before any backend message | R6 |
| pgpool 4.7.3 | Drop: connection closed before any backend message | R6 |
| pgpool 4.7.3 | Bad-negotiate: malformed message malformed(0003000010444953) | R2 |
| pgpool 4.7.3 | Bad-negotiate: malformed message malformed(000300000000000b); option list [,\x01,,,\x011C,,,\x0dSELECT 1,Z,,] differs from the unknown options sent [_pq_.test_protocol_negotiation] | R3 |
| supavisor 2.10.1 | Reject-clean: 08P01 (ESTARTUPMESSAGE) Invalid startup message: :bad_startup_payload | D1, R3 |
| supavisor 2.10.1 | Silent-accept: reached ReadyForQuery at requested 3.9999 with no NegotiateProtocolVersion | D2, D3, R2 |
| supavisor 2.10.1 | Silent-accept: reached ReadyForQuery, unknown _pq_ option ignored with no NegotiateProtocolVersion | R4, R5 |
| supavisor 2.10.1 | Silent-accept: reached ReadyForQuery at requested 4.0 with no NegotiateProtocolVersion | R6 |

## Re-runs of failing cells (each failing cell is re-run once, alone)

- cells re-run: 142; re-run gave a different class: 2
- pgpool-4.7.3-pg17 B R2: first Bad-negotiate, re-run OK-negotiated (negotiated to 3.0, options [])
- pgpool-4.7.3-pg17 B R3: first Bad-negotiate, re-run OK-negotiated (negotiated to 3.0, options [_pq_.test_protocol_negotiation])

## Diagnostics (outside the matrix; tier A)

| endpoint | D1 3.0 + unknown option, empty value | D2 3.9999 + unknown option, value 1 | D3 3.9999 + grease option, value 1 |
|---|---|---|---|
| pg14 | OK-neg | OK-neg | OK-neg |
| pg15 | OK-neg | OK-neg | OK-neg |
| pg16 | OK-neg | OK-neg | OK-neg |
| pg17 | OK-neg | OK-neg | OK-neg |
| pg18 | OK-neg | OK-neg | OK-neg |
| pg19 | OK-neg | OK-neg | OK-neg |
| pgbouncer-1.22.1-sess-pg17 | Reject | Reject | Reject |
| pgbouncer-1.22.1-tran-pg17 | Reject | Reject | Reject |
| pgbouncer-1.22.1-sess-pg19 | Reject | Reject | Reject |
| pgbouncer-1.22.1-tran-pg19 | Reject | Reject | Reject |
| pgbouncer-1.23.1-sess-pg17 | OK-neg | OK-neg | OK-neg |
| pgbouncer-1.23.1-tran-pg17 | OK-neg | OK-neg | OK-neg |
| pgbouncer-1.23.1-sess-pg19 | OK-neg | OK-neg | OK-neg |
| pgbouncer-1.23.1-tran-pg19 | OK-neg | OK-neg | OK-neg |
| pgbouncer-1.26.1-sess-pg17 | OK-neg | OK-neg | OK-neg |
| pgbouncer-1.26.1-tran-pg17 | OK-neg | OK-neg | OK-neg |
| pgbouncer-1.26.1-sess-pg19 | OK-neg | OK-neg | OK-neg |
| pgbouncer-1.26.1-tran-pg19 | OK-neg | OK-neg | OK-neg |
| pgdog-0.1.66-sess-pg17 | OK-neg | OK-neg | OK-neg |
| pgdog-0.1.66-tran-pg17 | OK-neg | OK-neg | OK-neg |
| pgdog-0.1.66-sess-pg19 | OK-neg | OK-neg | OK-neg |
| pgdog-0.1.66-tran-pg19 | OK-neg | OK-neg | OK-neg |
| odyssey-1.5.2-sess-pg17 | Silent | Drop | Drop |
| odyssey-1.5.2-tran-pg17 | Silent | Drop | Drop |
| odyssey-1.5.2-sess-pg19 | Silent | Drop | Drop |
| odyssey-1.5.2-tran-pg19 | Silent | Drop | Drop |
| supavisor-2.10.1-sess-pg17 | Reject | Silent | Silent |
| supavisor-2.10.1-tran-pg17 | Reject | Silent | Silent |
| supavisor-2.10.1-sess-pg19 | Reject | Silent | Silent |
| supavisor-2.10.1-tran-pg19 | Reject | Silent | Silent |
| pgpool-4.7.3-pg17 | OK-neg | OK-neg | OK-neg |
| pgpool-4.7.3-pg19 | OK-neg | OK-neg | OK-neg |

## Repeat experiment (optional pgpool-II; scripts/repeat.ts)

| endpoint | repetitions | request | class counts |
|---|---|---|---|
| pgpool-4.7.3-pg19 | 20 | R0 | OK-exact x20 |
| pgpool-4.7.3-pg19 | 20 | R1 | OK-exact x20 |
| pgpool-4.7.3-pg19 | 20 | R2 | OK-negotiated x18, Bad-negotiate x2 |
| pgpool-4.7.3-pg19 | 20 | R3 | OK-negotiated x18, Bad-negotiate x2 |
| pgpool-4.7.3-pg19 | 20 | R4 | OK-negotiated x19, Bad-negotiate x1 |
| pgpool-4.7.3-pg19 | 20 | R5 | OK-negotiated x20 |
| pgpool-4.7.3-pg19 | 20 | R6 | Drop x20 |
| pgpool-4.7.3-pg17 | 20 | R0 | OK-exact x20 |
| pgpool-4.7.3-pg17 | 20 | R1 | OK-negotiated x19, Bad-negotiate x1 |
| pgpool-4.7.3-pg17 | 20 | R2 | OK-negotiated x17, Bad-negotiate x3 |
| pgpool-4.7.3-pg17 | 20 | R3 | OK-negotiated x20 |
| pgpool-4.7.3-pg17 | 20 | R4 | OK-negotiated x18, Bad-negotiate x2 |
| pgpool-4.7.3-pg17 | 20 | R5 | OK-negotiated x17, Bad-negotiate x3 |

libpq from 19beta3 (default grease), pgpool-4.7.3-pg19: 40 connections

- 22 x connected
- 4 x port N failed: received invalid protocol negotiation message: server reported unsupported parameter name without a "_pq_." prefix ("SERROR")
- 13 x port N failed: received invalid protocol negotiation message: server reported unsupported parameter name without a "_pq_." prefix ("")
- 1 x port N failed: received invalid protocol negotiation message: server reported unsupported parameter name without a "_pq_." prefix ("tement due to user request")

- pgpool-4.7.3-pg19 sample R6 Drop: connection closed before any backend message
- pgpool-4.7.3-pg19 sample R4 Bad-negotiate: malformed message malformed(00030000ffffffff); option list [] differs from the unknown options sent [_pq_.fs02_probe_unknown]
- pgpool-4.7.3-pg19 sample R3 Bad-negotiate: malformed message malformed(000300020000000b); option list [,\x01,,,\x011C,,,\x0dSELECT 1,Z,,] differs from the unknown options sent [_pq_.test_protocol_negotiation]
- pgpool-4.7.3-pg19 sample R2 Bad-negotiate: malformed message malformed(0003000210444953)

- pgpool-4.7.3-pg17 sample R5 Bad-negotiate: malformed message malformed(00030000ffffffff); option list [] differs from the unknown options sent [_pq_.fs02_probe_unknown]
- pgpool-4.7.3-pg17 sample R4 Bad-negotiate: malformed message malformed(00030000ffffffff); option list [] differs from the unknown options sent [_pq_.fs02_probe_unknown]
- pgpool-4.7.3-pg17 sample R2 Bad-negotiate: malformed message malformed(0003000010444953)
- pgpool-4.7.3-pg17 sample R1 Bad-negotiate: malformed message malformed(0003000010444953)

## Optional, partial: PgCat (client authentication is MD5 only, so no cell can reach ReadyForQuery)

| run | R0 | R1 | R2 | R3 | R4 | R5 | R6 |
|---|---|---|---|---|---|---|---|
| pgcat-latest-sess-pg17 | Other (auth request 5, refused) | Drop | Drop | Drop | Other (auth request 5, refused) | Drop | Drop |
| pgcat-latest-tran-pg19 | Other (auth request 5, refused) | Drop | Drop | Drop | Other (auth request 5, refused) | Drop | Drop |

## Cancel through a second socket (cells where the key is longer than 4 bytes or 3.2 is in force)

- cancel tests run, tiers A and B: 82; outcomes: cancelled x82
- what the second (cancel) socket saw: cancel socket closed by server (closed) x82

| endpoint (tier A) | cancel outcomes (count of cells) |
|---|---|
| pg14 | no cell needed a cancel |
| pg15 | no cell needed a cancel |
| pg16 | no cell needed a cancel |
| pg17 | no cell needed a cancel |
| pg18 | cancelled x6 |
| pg19 | cancelled x6 |
| pgbouncer-1.22.1-sess-pg17 | no cell needed a cancel |
| pgbouncer-1.22.1-tran-pg17 | no cell needed a cancel |
| pgbouncer-1.22.1-sess-pg19 | no cell needed a cancel |
| pgbouncer-1.22.1-tran-pg19 | no cell needed a cancel |
| pgbouncer-1.23.1-sess-pg17 | no cell needed a cancel |
| pgbouncer-1.23.1-tran-pg17 | no cell needed a cancel |
| pgbouncer-1.23.1-sess-pg19 | no cell needed a cancel |
| pgbouncer-1.23.1-tran-pg19 | no cell needed a cancel |
| pgbouncer-1.26.1-sess-pg17 | no cell needed a cancel |
| pgbouncer-1.26.1-tran-pg17 | no cell needed a cancel |
| pgbouncer-1.26.1-sess-pg19 | no cell needed a cancel |
| pgbouncer-1.26.1-tran-pg19 | no cell needed a cancel |
| pgdog-0.1.66-sess-pg17 | cancelled x6 |
| pgdog-0.1.66-tran-pg17 | cancelled x6 |
| pgdog-0.1.66-sess-pg19 | cancelled x6 |
| pgdog-0.1.66-tran-pg19 | cancelled x6 |
| odyssey-1.5.2-sess-pg17 | no cell needed a cancel |
| odyssey-1.5.2-tran-pg17 | no cell needed a cancel |
| odyssey-1.5.2-sess-pg19 | no cell needed a cancel |
| odyssey-1.5.2-tran-pg19 | no cell needed a cancel |
| supavisor-2.10.1-sess-pg17 | cancelled x2 |
| supavisor-2.10.1-tran-pg17 | cancelled x2 |
| supavisor-2.10.1-sess-pg19 | cancelled x2 |
| supavisor-2.10.1-tran-pg19 | cancelled x2 |
| pgpool-4.7.3-pg17 | no cell needed a cancel |
| pgpool-4.7.3-pg19 | cancelled x6 |

## Oracle 1: psql (libpq of postgres:19) against the probe's R0 and R1

| endpoint | tier | psql 3.0 | probe R0 | psql 3.2 | probe R1 | psql latest | probe R1 version in force |
|---|---|---|---|---|---|---|---|
| pg14 | A | connected 3.0 | connected 3.0 | connected 3.0 | connected 3.0 | connected 3.0 | 3.0 |
| pg15 | A | connected 3.0 | connected 3.0 | connected 3.0 | connected 3.0 | connected 3.0 | 3.0 |
| pg16 | A | connected 3.0 | connected 3.0 | connected 3.0 | connected 3.0 | connected 3.0 | 3.0 |
| pg17 | A | connected 3.0 | connected 3.0 | connected 3.0 | connected 3.0 | connected 3.0 | 3.0 |
| pg18 | A | connected 3.0 | connected 3.0 | connected 3.2 | connected 3.2 | connected 3.2 | 3.2 |
| pg19 | A | connected 3.0 | connected 3.0 | connected 3.2 | connected 3.2 | connected 3.2 | 3.2 |
| pgbouncer-1.22.1-sess-pg17 | A | connected 3.0 | connected 3.0 | failed | Reject-clean | failed | - |
| pgbouncer-1.22.1-tran-pg17 | A | connected 3.0 | connected 3.0 | failed | Reject-clean | failed | - |
| pgbouncer-1.22.1-sess-pg19 | A | connected 3.0 | connected 3.0 | failed | Reject-clean | failed | - |
| pgbouncer-1.22.1-tran-pg19 | A | connected 3.0 | connected 3.0 | failed | Reject-clean | failed | - |
| pgbouncer-1.23.1-sess-pg17 | A | connected 3.0 | connected 3.0 | connected 3.0 | connected 3.0 | connected 3.0 | 3.0 |
| pgbouncer-1.23.1-tran-pg17 | A | connected 3.0 | connected 3.0 | connected 3.0 | connected 3.0 | connected 3.0 | 3.0 |
| pgbouncer-1.23.1-sess-pg19 | A | connected 3.0 | connected 3.0 | connected 3.0 | connected 3.0 | connected 3.0 | 3.0 |
| pgbouncer-1.23.1-tran-pg19 | A | connected 3.0 | connected 3.0 | connected 3.0 | connected 3.0 | connected 3.0 | 3.0 |
| pgbouncer-1.26.1-sess-pg17 | A | connected 3.0 | connected 3.0 | connected 3.0 | connected 3.0 | connected 3.0 | 3.0 |
| pgbouncer-1.26.1-tran-pg17 | A | connected 3.0 | connected 3.0 | connected 3.0 | connected 3.0 | connected 3.0 | 3.0 |
| pgbouncer-1.26.1-sess-pg19 | A | connected 3.0 | connected 3.0 | connected 3.0 | connected 3.0 | connected 3.0 | 3.0 |
| pgbouncer-1.26.1-tran-pg19 | A | connected 3.0 | connected 3.0 | connected 3.0 | connected 3.0 | connected 3.0 | 3.0 |
| pgdog-0.1.66-sess-pg17 | A | connected 3.0 | connected 3.0 | connected 3.2 | connected 3.2 | connected 3.2 | 3.2 |
| pgdog-0.1.66-tran-pg17 | A | connected 3.0 | connected 3.0 | connected 3.2 | connected 3.2 | connected 3.2 | 3.2 |
| pgdog-0.1.66-sess-pg19 | A | connected 3.0 | connected 3.0 | connected 3.2 | connected 3.2 | connected 3.2 | 3.2 |
| pgdog-0.1.66-tran-pg19 | A | connected 3.0 | connected 3.0 | connected 3.2 | connected 3.2 | connected 3.2 | 3.2 |
| odyssey-1.5.2-sess-pg17 | A | connected 3.0 | connected 3.0 | failed | Drop | failed | - |
| odyssey-1.5.2-tran-pg17 | A | connected 3.0 | connected 3.0 | failed | Drop | failed | - |
| odyssey-1.5.2-sess-pg19 | A | connected 3.0 | connected 3.0 | failed | Drop | failed | - |
| odyssey-1.5.2-tran-pg19 | A | connected 3.0 | connected 3.0 | failed | Drop | failed | - |
| supavisor-2.10.1-sess-pg17 | A | connected 3.0 | connected 3.0 | connected 3.2 | connected 3.2 | connected 3.2 | 3.2 |
| supavisor-2.10.1-tran-pg17 | A | connected 3.0 | connected 3.0 | connected 3.2 | connected 3.2 | connected 3.2 | 3.2 |
| supavisor-2.10.1-sess-pg19 | A | connected 3.0 | connected 3.0 | connected 3.2 | connected 3.2 | connected 3.2 | 3.2 |
| supavisor-2.10.1-tran-pg19 | A | connected 3.0 | connected 3.0 | connected 3.2 | connected 3.2 | connected 3.2 | 3.2 |
| pgpool-4.7.3-pg17 | A | connected 3.0 | connected 3.0 | connected 3.0 | connected 3.0 | connected 3.0 | 3.0 |
| pgpool-4.7.3-pg19 | A | connected 3.0 | connected 3.0 | connected 3.2 | connected 3.2 | connected 3.2 | 3.2 |
| pg17 | B | connected 3.0 | connected 3.0 | connected 3.0 | connected 3.0 | connected 3.0 | 3.0 |
| pg19 | B | connected 3.0 | connected 3.0 | connected 3.2 | connected 3.2 | connected 3.2 | 3.2 |
| pgbouncer-1.22.1-sess-pg17 | B | connected 3.0 | connected 3.0 | failed | Reject-clean | failed | - |
| pgbouncer-1.22.1-tran-pg17 | B | connected 3.0 | connected 3.0 | failed | Reject-clean | failed | - |
| pgbouncer-1.22.1-sess-pg19 | B | connected 3.0 | connected 3.0 | failed | Reject-clean | failed | - |
| pgbouncer-1.22.1-tran-pg19 | B | connected 3.0 | connected 3.0 | failed | Reject-clean | failed | - |
| pgbouncer-1.23.1-sess-pg17 | B | connected 3.0 | connected 3.0 | connected 3.0 | connected 3.0 | connected 3.0 | 3.0 |
| pgbouncer-1.23.1-tran-pg17 | B | connected 3.0 | connected 3.0 | connected 3.0 | connected 3.0 | connected 3.0 | 3.0 |
| pgbouncer-1.23.1-sess-pg19 | B | connected 3.0 | connected 3.0 | connected 3.0 | connected 3.0 | connected 3.0 | 3.0 |
| pgbouncer-1.23.1-tran-pg19 | B | connected 3.0 | connected 3.0 | connected 3.0 | connected 3.0 | connected 3.0 | 3.0 |
| pgbouncer-1.26.1-sess-pg17 | B | connected 3.0 | connected 3.0 | connected 3.0 | connected 3.0 | connected 3.0 | 3.0 |
| pgbouncer-1.26.1-tran-pg17 | B | connected 3.0 | connected 3.0 | connected 3.0 | connected 3.0 | connected 3.0 | 3.0 |
| pgbouncer-1.26.1-sess-pg19 | B | connected 3.0 | connected 3.0 | connected 3.0 | connected 3.0 | connected 3.0 | 3.0 |
| pgbouncer-1.26.1-tran-pg19 | B | connected 3.0 | connected 3.0 | connected 3.0 | connected 3.0 | connected 3.0 | 3.0 |
| pgdog-0.1.66-sess-pg17 | B | connected 3.0 | connected 3.0 | connected 3.2 | connected 3.2 | connected 3.2 | 3.2 |
| pgdog-0.1.66-tran-pg17 | B | connected 3.0 | connected 3.0 | connected 3.2 | connected 3.2 | connected 3.2 | 3.2 |
| pgdog-0.1.66-sess-pg19 | B | connected 3.0 | connected 3.0 | connected 3.2 | connected 3.2 | connected 3.2 | 3.2 |
| pgdog-0.1.66-tran-pg19 | B | connected 3.0 | connected 3.0 | connected 3.2 | connected 3.2 | connected 3.2 | 3.2 |
| odyssey-1.5.2-sess-pg17 | B | connected 3.0 | connected 3.0 | failed | Drop | failed | - |
| odyssey-1.5.2-tran-pg17 | B | connected 3.0 | connected 3.0 | failed | Drop | failed | - |
| odyssey-1.5.2-sess-pg19 | B | connected 3.0 | connected 3.0 | failed | Drop | failed | - |
| odyssey-1.5.2-tran-pg19 | B | connected 3.0 | connected 3.0 | failed | Drop | failed | - |
| supavisor-2.10.1-sess-pg17 | B | connected 3.0 | connected 3.0 | connected 3.2 | connected 3.2 | connected 3.2 | 3.2 |
| supavisor-2.10.1-tran-pg17 | B | connected 3.0 | connected 3.0 | connected 3.2 | connected 3.2 | connected 3.2 | 3.2 |
| supavisor-2.10.1-sess-pg19 | B | connected 3.0 | connected 3.0 | connected 3.2 | connected 3.2 | connected 3.2 | 3.2 |
| supavisor-2.10.1-tran-pg19 | B | connected 3.0 | connected 3.0 | connected 3.2 | connected 3.2 | connected 3.2 | 3.2 |
| pgpool-4.7.3-pg17 | B | connected 3.0 | connected 3.0 | connected 3.0 | connected 3.0 | connected 3.0 | 3.0 |
| pgpool-4.7.3-pg19 | B | connected 3.0 | connected 3.0 | connected 3.2 | connected 3.2 | connected 3.2 | 3.2 |

- connected-or-not agreements between the probe (R0, R1) and psql (3.0, 3.2): 120 of 120
- version-in-force agreements for R1 where both connected: 44 of 44

psql error texts (port number and packet-header hex normalised):

- `psql: error: connection to server at "127.0.0.1", port N failed: FATAL: bad packet header: '<hex>'` x16 (pgbouncer-1.22.1)
- `psql: error: connection to server at "127.0.0.1", port N failed: server closed the connection unexpectedly This probably means the server terminated abnormally before or while processing the request.` x8 (odyssey-1.5.2)
- `psql: error: connection to server at "127.0.0.1", port N failed: SSL error: unexpected eof while reading` x8 (odyssey-1.5.2)

## Oracle 1b: psql from postgres:19beta3 (libpq that sends the grease startup by default) against the probe's R3

| endpoint (tier A) | psql 19beta3, default grease | probe R3 |
|---|---|---|
| pg14 | connected 3.0 | connected 3.0 |
| pg15 | connected 3.0 | connected 3.0 |
| pg16 | connected 3.0 | connected 3.0 |
| pg17 | connected 3.0 | connected 3.0 |
| pg18 | connected 3.2 | connected 3.2 |
| pg19 | connected 3.2 | connected 3.2 |
| pgbouncer-1.22.1-sess-pg17 | failed | Reject-clean |
| pgbouncer-1.22.1-tran-pg17 | failed | Reject-clean |
| pgbouncer-1.22.1-sess-pg19 | failed | Reject-clean |
| pgbouncer-1.22.1-tran-pg19 | failed | Reject-clean |
| pgbouncer-1.23.1-sess-pg17 | connected 3.0 | connected 3.0 |
| pgbouncer-1.23.1-tran-pg17 | connected 3.0 | connected 3.0 |
| pgbouncer-1.23.1-sess-pg19 | connected 3.0 | connected 3.0 |
| pgbouncer-1.23.1-tran-pg19 | connected 3.0 | connected 3.0 |
| pgbouncer-1.26.1-sess-pg17 | connected 3.0 | connected 3.0 |
| pgbouncer-1.26.1-tran-pg17 | connected 3.0 | connected 3.0 |
| pgbouncer-1.26.1-sess-pg19 | connected 3.0 | connected 3.0 |
| pgbouncer-1.26.1-tran-pg19 | connected 3.0 | connected 3.0 |
| pgdog-0.1.66-sess-pg17 | connected 3.2 | connected 3.2 |
| pgdog-0.1.66-tran-pg17 | connected 3.2 | connected 3.2 |
| pgdog-0.1.66-sess-pg19 | connected 3.2 | connected 3.2 |
| pgdog-0.1.66-tran-pg19 | connected 3.2 | connected 3.2 |
| odyssey-1.5.2-sess-pg17 | failed | Drop |
| odyssey-1.5.2-tran-pg17 | failed | Drop |
| odyssey-1.5.2-sess-pg19 | failed | Drop |
| odyssey-1.5.2-tran-pg19 | failed | Drop |
| supavisor-2.10.1-sess-pg17 | failed | Reject-clean |
| supavisor-2.10.1-tran-pg17 | failed | Reject-clean |
| supavisor-2.10.1-sess-pg19 | failed | Reject-clean |
| supavisor-2.10.1-tran-pg19 | failed | Reject-clean |
| pgpool-4.7.3-pg17 | connected 3.0 | connected 3.0 |
| pgpool-4.7.3-pg19 | connected 3.2 | connected 3.2 |

- connected-or-not agreements between 19beta3 psql (default) and the probe's R3, tiers A and B: 59 of 60
- DISAGREEMENT: pgpool-4.7.3-pg17 B: probe R3 Bad-negotiate, beta3 psql connected
- version-in-force agreements where both connected: 35 of 35

## Oracle 2: fault servers (not endpoints)

| fault server | R0 | R1 | R2 | R3 | R4 | R5 | R6 |
|---|---|---|---|---|---|---|---|
| fault:close-on-minor | OK-exact | Drop | Drop | Drop | Silent | Drop | Silent |
| fault:error-response | OK-exact | Reject | Reject | Reject | Silent | Reject | Reject |
| fault:silent-accept | OK-exact | OK-exact | Silent | Silent | Silent | Silent | Silent |
| fault:bad-negotiate | OK-exact | Bad-neg | Bad-neg | Bad-neg | Silent | Bad-neg | Bad-neg |
| fault:hang | Hang | Hang | Hang | Hang | Hang | Hang | Hang |

