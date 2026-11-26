# FS-03: which socket API on Bun?

Research only; findings, no decision. This folder holds a sans-IO PostgreSQL message core, three small socket adapters, Node servers and a
fault proxy written for the study, scripts, small result files and the claim ledger. It changes no OKDriver source, test, doc, workflow, ADR
or root file, and it makes no claim about OKDriver's speed. Spec area: none yet. Feature record: none (research). Feeds P6-T02
(`transports/bun`) and P6-T01 (Node transport, shared read buffer) and risk 11 (Bun regressions that look like driver bugs).

Question (roadmap row FS-03): "Which socket API on Bun?" Method: the same core on `Bun.connect` and on Bun's Node-compatible `net` with
`onread`; output throughput, CPU and correctness under fragmentation on release and canary. Rule: "Pick the faster one that passes the
fragmentation suite on both builds."

Base: `origin/main` at `19a0d5fad8bd6e92ba1f33e0a0793684fcc3babf`. Run date 2026-11-25 and 2026-11-26, one 4-core 2.1 GHz Xeon VM (Linux 6.18).
Everything below comes from a named script run on the committed `results/`; `scripts/run-all.sh` lists the whole run in order.

## Verdict

**Candidate N (`net` with `onread`) by the tie order; the throughput evidence does not separate N from B.** Both candidates pass the gate on
both builds. On the release build no throughput cell differs outside the noise floor, so rule.json falls to its tie order, N before B. That
order is the planner's choice (the Node transport must exist anyway), not a measured result.

- Gate (`results/verdict.json`, from `scripts/assemble.ts`): N and B pass 17 of 17 fragmentation scenarios plus the real PostgreSQL 19.0 query
  list against `psql`, and all four required capabilities, on release `1.4.5+a7733435c` and on canary `1.4.6-canary.1+0966e99d8`.
  The suite is not defective: all three planted faults fail it (below).
- Release throughput, N / B medians: W1 0.968, W2 0.980, W3-8K 0.982, W3-64K 1.001, W3-1M 1.015, W4 1.000, against noise floors of 5.0 to
  12.8 percent (the largest self-gap in the null comparison was 6.4 percent, B on W3-1M). CPU per statement and per MB and peak RSS are equal
  within a few percent.
- **The canary pick would differ.** Applying the release floors to the canary run (no null run was made on canary), B wins W1 (N / B 0.933,
  floor 5.0 percent) and nothing else moves, so B would be picked on canary alone. W1 on canary is one cell of six and its spread is wide
  (B 14,163 to 19,104, N 13,777 to 17,871 statements/s); the release W1 ratio is 0.968, inside noise.
- A real difference exists and is not about speed: **lifetime of delivered bytes**. N hands the core a view of one reused buffer that is
  overwritten by the next read (every one of the following 59 deliveries shared the ArrayBuffer and the earlier view had changed; the same on release,
  canary and Node 24). B and N-data hand fresh memory every time (0 of 59). The core here copies only partial messages, so this costs
  nothing, but a P6-T01 shared read buffer and any code that keeps a view must account for it. The planted `keep_view` fault, which fails on N,
  is the same hazard.

## Roadmap claims ledger

| claim (raw page text) | verdict | evidence |
| --- | --- | --- |
| "Bun 1.4 was rewritten from Zig to Rust" | Confirmed | bun.com/blog/bun-v1.4, verbatim: "And it rewrites Bun from Zig to Rust."; bun.com/blog/bun-in-rust, dated July 8, 2026. Both installed builds report 1.4.x. |
| "...with documented semantic regressions" | Not verifiable here | The rewrite post reportedly lists 19 known regressions, all fixed, "syntactically identical in both languages but semantically different"; I could read that only through a model summary of the page, not verbatim, so the count and wording are unconfirmed. None concerns sockets in the text I read. |
| "several `onread` bugs were fixed during 2026" | Not verifiable here, and not supported by what was found | Release notes read in full (1.3.12, 1.4.5) do not mention `onread`. The 1.4.0 notes (summary only) have one `onread` item and it is a behaviour change, not a fix: an exception thrown in an `onread` callback is now an uncaught exception. A pull request (oven-sh/bun #29762, April 2026) covers the same throw. Release notes 1.3.13, 1.3.14 and 1.4.1 to 1.4.4 were not read. This study found no onread defect on either build, which says nothing about earlier ones. |

## Method in short

- **Candidates.** B = `Bun.connect` (adapter `scripts/adapters/bun-connect.ts`, 118 lines, `binaryType: 'uint8array'`, partial writes
  re-offered on `drain`). N = `net.connect({ onread })` with one 64 KiB buffer (`scripts/adapters/node-net.ts`, 78 lines, shared with N-data
  which uses `data` events). Neither buffer size nor `binaryType` was tuned. Line counts are reported, not gating.
- **One core.** `scripts/lib/core.ts` (285 lines) is the only PostgreSQL code the candidates share: framing, SSLRequest, login with
  SCRAM-SHA-256, extended query, CopyData. Login and framing code was copied from `research/fs-06` at commit
  `5930580cd61a7bf5e03ab0f77f7c2f2320bf1d8d` (the framing decoder was rewritten for the lifetime question). `scripts/lib/driver.ts` is the
  shared glue (TLS upgrade sequence, flush, write backpressure, workloads). Nothing is imported across study folders.
- **Servers and proxy** run on Node 22.23.5, never on the Bun under test, with their own framing code (`scripts/servers/`). The fault proxy
  has its own parser and keeps a sha256 and a byte count per direction. Pinning: client on core 0, servers and proxy on cores 1 and 2,
  PostgreSQL in Docker (`postgres:19.0`, `--cpuset-cpus 3`, host network). Four cores, so W5 ran.
- **Rule.** `rule.json` was committed, with `scripts/rule.ts` and the toy test `scripts/rule-toy.ts` (results/rule-toy.txt: every clause
  flips an outcome and all of N, B, none and invalid are reachable), before any measurement. Two wording changes to the effectiveness clause
  came before the first measurement (below). `scripts/assemble.ts` applies it; the verdict carries the sha256 of `rule.json`.
- **Fragmentation suite** (`scripts/frag.ts`, 17 scenarios plus the real PostgreSQL list): a scripted stream of 2,713 messages (empty, 1 byte,
  about 16 KB, about 64 KB, over 1 MB, 8.7 MB) and two small ones, re-cut by the proxy: 1-byte chunks; every offset inside the 5-byte header
  and payload end minus 1, at and plus 1; the same around the large payloads plus their midpoints; groups of 2 to 50 messages per chunk;
  seeded random sizes with 0 to 2 ms delays; FIN and RST in a partial header, a partial payload and between messages. Oracle: the decoded
  (type, length, sha256 of payload) sequence equals the server's script, the hash of the bytes delivered equals the proxy's, exactly one
  terminal event, no data after it, no hang. Effectiveness is measured, not assumed: for scenarios with a planned cut every 2 ms, at least
  95 percent of the cuts of each class must appear as delivery boundaries at the adapter (observed 99 to 100 percent, results under
  `observedShare`). Real PostgreSQL: ten queries (NULL, empty, unicode, 3 MB, 20,000 rows, arrays, jsonb, bytea, timestamps, an error) through
  the core equal `psql` output, plain and over TLS.
- **Loads** (`scripts/calibrate.ts`, `results/loads.json`, `results/calibration.json`): W1 36,000 statements one in flight; W2 260,000
  statements at depth 100 (refilled once per received chunk); W3 256 MiB of 100-byte DataRows written by the server in 8 KB, 64 KB and 1 MB
  bursts; W4 256 MiB of CopyData in 1 MiB blocks to a reader throttled to 500 MB/s (pause and resume on the server socket). Each cell: 2
  warm-up rounds dropped, 15 measured rounds, A B A B interleaved, median. CPU is `utime + stime` from `/proc/<pid>/stat` read when the
  client says READY and when it says DONE (so start-up and login are out), peak RSS is VmHWM; ticks are 10 ms.

## Gate

| build | candidate | fragmentation scenarios | real PostgreSQL vs psql | tls_upgrade | pause_resume_bounded | write_backpressure | terminal_once |
| --- | --- | --- | --- | --- | --- | --- | --- |
| release | N | 17/17 | pass | pass | pass | pass | pass |
| release | B | 17/17 | pass | pass | pass | pass | pass |
| release | N-data | 17/17 | pass | pass | pass | pass | pass |
| canary | N | 17/17 | pass | pass | pass | pass | pass |
| canary | B | 17/17 | pass | pass | pass | pass | pass |
| canary | N-data | 17/17 | pass | pass | pass | pass | pass |

#### Scenarios

| scenario | canary.B | canary.N | canary.N-data | node24.N | node24.N-data | planted release.N+drop_byte_at_edge | planted release.N+duplicate_chunk | planted release.N+keep_view | planted-extra release.B+keep_view | release.B | release.N | release.N-data |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| plain-mix | pass | pass | pass | pass | pass | fail | fail | fail | pass | pass | pass | pass |
| bytes1-tiny | pass | pass | pass | pass | pass | pass | fail | fail | pass | pass | pass | pass |
| header-offsets-small | pass | pass | pass | pass | pass | fail | fail | fail | pass | pass | pass | pass |
| payload-edges-mix | pass | pass | pass | pass | pass | fail | fail | fail | pass | pass | pass | pass |
| grouped-small | pass | pass | pass | pass | pass | fail | fail | fail | pass | pass | pass | pass |
| grouped-mix | pass | pass | pass | pass | pass | fail | fail | fail | pass | pass | pass | pass |
| random-small-max16 | pass | pass | pass | pass | pass | fail | fail | fail | pass | pass | pass | pass |
| random-small-max7 | pass | pass | pass | pass | pass | fail | fail | fail | pass | pass | pass | pass |
| random-mix-max2048 | pass | pass | pass | pass | pass | fail | fail | fail | pass | pass | pass | pass |
| random-mix-max8192 | pass | pass | pass | pass | pass | fail | fail | fail | pass | pass | pass | pass |
| random-mix-max131072 | pass | pass | pass | pass | pass | fail | fail | fail | pass | pass | pass | pass |
| close-fin-partial-header | pass | pass | pass | pass | pass | fail | pass | fail | pass | pass | pass | pass |
| close-fin-partial-payload | pass | pass | pass | pass | pass | pass | pass | fail | pass | pass | pass | pass |
| close-fin-between-messages | pass | pass | pass | pass | pass | fail | pass | fail | pass | pass | pass | pass |
| close-rst-partial-header | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass |
| close-rst-partial-payload | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass |
| close-rst-between-messages | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass |

Real PostgreSQL 19.0 (`results/real-correctness.*.json`): the ten queries equal `psql` 16.15 output for B, N and N-data, plain and over TLS,
on release, canary and (N, N-data) Node 24; the division-by-zero error arrives as 22012 with the same message. The TLS upgrade against real
PostgreSQL succeeds with `localhost` and is refused with a wrong server name for every candidate.

The table above ends with the scenario matrix. Reading the planted columns: `keep_view` (keeps a view of the delivered bytes and hands it to the core one delivery late), `drop_byte_at_edge`
(drops the last byte of every fifth chunk) and `duplicate_chunk` (delivers every eleventh chunk twice) each fail the suite on N, so the suite is
not defective. The RST scenarios are blind to all three (the connection ends before the damage matters) and some FIN ones are blind to two;
they are in the suite for the terminal-event rule, not for byte integrity. `keep_view` fails on N only because that API reuses
its buffer: the same wrapper on B passes 17 of 17 (`planted-extra.release.B+keep_view.json`), which is the lifetime finding seen from the other side,
not a suite defect. The rule requires the planted faults to fail on N, and they do.

## Throughput

Every cell: median over 15 runs, min and max in brackets. "Noise floor" is max(5 percent, 2 x the larger self-gap of the null comparison).

| cell | unit | B median (min–max) | N median (min–max) | N / B | noise floor |
| --- | --- | --- | --- | --- | --- |
| W1 | statements/s | 15,976.9 (14,453.4–16,900.6) | 15,463.2 (13,982.1–16,641.5) | 0.968 | 5.0% |
| W2 | statements/s | 119,393.3 (105,831.7–129,606.1) | 116,978.3 (98,545.7–132,401.3) | 0.980 | 5.0% |
| W3-8K | MB/s | 451.3 (428.9–564.0) | 443.0 (400.8–493.7) | 0.982 | 5.4% |
| W3-64K | MB/s | 447.9 (395.5–556.5) | 448.6 (358.5–499.8) | 1.001 | 5.0% |
| W3-1M | MB/s | 443.9 (407.9–546.1) | 450.4 (403.5–574.8) | 1.015 | 12.8% |
| W4 | MB/s | 499.8 (499.4–500.5) | 499.7 (499.3–500.3) | 1.000 | 5.0% |

CPU seconds per unit (statement, or MB) and peak RSS, medians over runs; not gating.

| cell | B CPU · peak RSS | N CPU · peak RSS | B latency (W1) | N latency (W1) |
| --- | --- | --- | --- | --- |
| W1 | 40.0 µs/stmt · 66 MiB | 41.1 µs/stmt · 66 MiB | p50 53 µs, p99 159 µs | p50 55 µs, p99 198 µs |
| W2 | 6.5 µs/stmt · 67 MiB | 6.7 µs/stmt · 67 MiB |  |  |
| W3-8K | 2.2 ms/MB · 65 MiB | 2.2 ms/MB · 64 MiB |  |  |
| W3-64K | 2.2 ms/MB · 67 MiB | 2.2 ms/MB · 64 MiB |  |  |
| W3-1M | 2.2 ms/MB · 67 MiB | 2.1 ms/MB · 64 MiB |  |  |
| W4 | 0.2 ms/MB · 43 MiB | 0.3 ms/MB · 51 MiB |  |  |

Null comparison (candidate against itself, interleaved): relative gap between the two series' medians.

| cell | B gap | N gap |
| --- | --- | --- |
| W1 | 0.89% | 2.23% |
| W2 | 2.16% | 0.79% |
| W3-8K | 2.15% | 2.70% |
| W3-64K | 1.39% | 1.76% |
| W3-1M | 6.38% | 0.81% |
| W4 | 0.07% | 0.00% |

| cell | unit | B median (min–max) | N median (min–max) | N / B | noise floor |
| --- | --- | --- | --- | --- | --- |
| W1 | statements/s | 16,551.1 (14,163.3–19,104.5) | 15,440.6 (13,777.5–17,871.3) | 0.933 |  |
| W2 | statements/s | 108,450.0 (98,420.7–123,940.3) | 109,945.9 (97,775.0–118,990.9) | 1.014 |  |
| W3-8K | MB/s | 455.5 (384.2–590.1) | 463.9 (400.0–602.3) | 1.019 |  |
| W3-64K | MB/s | 457.8 (390.4–584.4) | 471.9 (430.4–597.0) | 1.031 |  |
| W3-1M | MB/s | 441.6 (355.8–524.3) | 441.1 (378.1–485.2) | 0.999 |  |
| W4 | MB/s | 499.9 (499.4–500.4) | 500.2 (499.3–500.4) | 1.000 |  |

CPU seconds per unit (statement, or MB) and peak RSS, medians over runs; not gating.

| cell | B CPU · peak RSS | N CPU · peak RSS | B latency (W1) | N latency (W1) |
| --- | --- | --- | --- | --- |
| W1 | 37.2 µs/stmt · 56 MiB | 40.0 µs/stmt · 58 MiB | p50 51 µs, p99 162 µs | p50 52 µs, p99 191 µs |
| W2 | 7.2 µs/stmt · 57 MiB | 7.2 µs/stmt · 58 MiB |  |  |
| W3-8K | 2.2 ms/MB · 53 MiB | 2.1 ms/MB · 53 MiB |  |  |
| W3-64K | 2.1 ms/MB · 53 MiB | 2.1 ms/MB · 53 MiB |  |  |
| W3-1M | 2.2 ms/MB · 54 MiB | 2.2 ms/MB · 53 MiB |  |  |
| W4 | 0.2 ms/MB · 31 MiB | 0.3 ms/MB · 38 MiB |  |  |

W4 is a throttled reader (500 MB/s), so both candidates sit at the throttle and only CPU and RSS can differ; the unthrottled variant was
calibrated only (see `results/calibration.json`: B 2,097 to 3,298, N 3,044 to 3,391 MB/s) and its server ceiling is not 2 x above it, so it is
not reported as a cell.

### Server ceilings against the fastest client

Rule: each server's ceiling must be at least 2 x the fastest client rate. Measured with a bare Node raw-socket client on core 0.

| rate | value |
| --- | --- |
| pipeline statements/s (depth 200) | 272,390 |
| stream MB/s (burst 8K) | 1,365 |
| stream MB/s (burst 64K) | 1,174 |
| stream MB/s (burst 1M) | 1,389 |
| copy sink MB/s (unthrottled) | 3,184 |

Fastest client medians on release: W2 119,393 statements/s (ceiling 2.3 x; the ceiling run is 272,390), W3-8K 451 MB/s (3.0 x), W3-64K
449 MB/s (2.6 x), W3-1M 450 MB/s (3.1 x), W4 throttled 500 MB/s (6.4 x). W1 is round-trip bound at about 16,000 per second against 272,390
(17 x). **Sizing change:** the first calibration used 1000-byte DataRows and put the fastest W3 client within 1.6 x of the ceiling, below the
rule's 2 x, so rows were shrunk to 100 bytes (the client becomes the limit; this makes W3 more a per-message test than a bytes test).

### Reported only: W5, real PostgreSQL 19.0

Ratios only. PostgreSQL is the limit here: its own ceiling measured with pgbench (a C client, one connection) is close to what the clients
reach in S1, and the 100 MB result through psql is slower than the clients because psql is slow, so it is no ceiling at all.

| rate | value |
| --- | --- |
| tool | pgbench (PostgreSQL) 16.15 (Ubuntu 16.15-0ubuntu0.24.04.1) |
| S1 statements/s (pgbench -M extended, one connection) | 17,030 |
| depth 100 statements/s (pgbench pipeline of 100) | 133,457 |
| 100 MB result MB/s (psql to a pipe, text, median of 3) | 267 |

| cell | unit | B median (min–max) | N median (min–max) | N / B |
| --- | --- | --- | --- | --- |
| W5-S1 | statements/s | 14,370.3 (13,026.0–15,636.3) | 13,535.7 (12,232.0–14,795.7) | 0.942 |
| W5-D100 | statements/s | 78,791.3 (65,162.0–88,646.3) | 77,461.1 (70,967.2–86,960.5) | 0.983 |
| W5-100MB | MB/s | 629.7 (517.6–847.5) | 609.2 (519.0–741.3) | 0.968 |

| cell | unit | B median (min–max) | N median (min–max) | N / B |
| --- | --- | --- | --- | --- |
| W5-S1 | statements/s | 14,324.2 (13,065.8–16,015.7) | 14,378.5 (13,115.4–15,344.8) | 1.004 |
| W5-D100 | statements/s | 80,381.7 (71,810.0–85,703.3) | 77,321.0 (65,890.1–87,529.6) | 0.962 |
| W5-100MB | MB/s | 637.7 (401.4–732.5) | 620.4 (511.0–700.7) | 0.973 |

### Reported only: TLS

TLS upgrade after SSLRequest, against a `node:tls` server (W1, W3) and real PostgreSQL (S1, 100 MB). Hostname mismatch fails on every
candidate (gate, `tls_upgrade`, and the PostgreSQL probe). Under TLS, N reads the upgraded socket through `data` events: `onread` covers
the plaintext phase only, because `tls.connect({ socket })` takes over reading.

| cell | unit | B median (min–max) | N median (min–max) | N / B | noise floor |
| --- | --- | --- | --- | --- | --- |
| W1 | statements/s | 15,167.4 (13,494.8–15,721.2) | 14,055.2 (12,900.4–15,458.8) | 0.927 |  |
| W3-8K | MB/s | 405.8 (346.8–455.7) | 399.7 (361.1–432.2) | 0.985 |  |
| W3-64K | MB/s | 411.8 (362.9–487.6) | 386.8 (295.4–470.7) | 0.939 |  |
| W3-1M | MB/s | 401.9 (350.2–481.5) | 395.4 (326.7–498.9) | 0.984 |  |

CPU seconds per unit (statement, or MB) and peak RSS, medians over runs; not gating.

| cell | B CPU · peak RSS | N CPU · peak RSS | B latency (W1) | N latency (W1) |
| --- | --- | --- | --- | --- |
| W1 | 38.9 µs/stmt · 67 MiB | 45.3 µs/stmt · 70 MiB | p50 55 µs, p99 177 µs | p50 57 µs, p99 234 µs |
| W3-8K | 2.4 ms/MB · 68 MiB | 2.5 ms/MB · 68 MiB |  |  |
| W3-64K | 2.4 ms/MB · 65 MiB | 2.5 ms/MB · 68 MiB |  |  |
| W3-1M | 2.4 ms/MB · 65 MiB | 2.5 ms/MB · 67 MiB |  |  |

| cell | unit | B median (min–max) | N median (min–max) | N / B |
| --- | --- | --- | --- | --- |
| W5-S1 | statements/s | 13,131.4 (12,371.7–14,115.3) | 12,332.7 (11,304.2–14,245.7) | 0.939 |
| W5-100MB | MB/s | 515.6 (464.7–584.6) | 477.8 (431.7–636.7) | 0.927 |

### Reported only: N-data and Node 24

N-data (`net`, default data events) against N on the same Bun release, and the N adapter on Node 24.22.3 as a baseline. N-data is
within the 5 percent floor of N on every cell, a few percent lower on W1, W2 and W3; Node 24 is lower on W2 (about 91,000 against 117,000 statements/s on this VM) and
otherwise level, which is a runtime comparison, not an adapter one.

| cell | unit | N median (min–max) | N-data median (min–max) |
| --- | --- | --- | --- |
| W1 | statements/s | 16,505.0 (14,688.5–17,328.3) | 15,889.6 (14,187.4–17,574.9) |
| W2 | statements/s | 118,471.3 (105,681.7–129,307.8) | 113,642.2 (105,288.7–130,185.9) |
| W3-8K | MB/s | 453.9 (431.3–524.3) | 443.0 (413.6–518.2) |
| W3-64K | MB/s | 460.4 (397.2–526.8) | 442.5 (391.6–554.4) |
| W3-1M | MB/s | 431.7 (389.8–504.0) | 414.8 (388.0–508.6) |
| W4 | MB/s | 499.6 (499.2–500.3) | 500.0 (496.0–500.4) |

CPU seconds per unit (statement, or MB) and peak RSS, medians over runs; not gating.

| cell | N CPU · peak RSS | N-data CPU · peak RSS | N latency (W1) | N-data latency (W1) |
| --- | --- | --- | --- | --- |
| W1 | 38.9 µs/stmt · 67 MiB | 41.4 µs/stmt · 67 MiB | p50 50 µs, p99 178 µs | p50 49 µs, p99 200 µs |
| W2 | 6.7 µs/stmt · 67 MiB | 7.0 µs/stmt · 68 MiB |  |  |
| W3-8K | 2.2 ms/MB · 64 MiB | 2.2 ms/MB · 65 MiB |  |  |
| W3-64K | 2.1 ms/MB · 64 MiB | 2.2 ms/MB · 65 MiB |  |  |
| W3-1M | 2.3 ms/MB · 65 MiB | 2.3 ms/MB · 65 MiB |  |  |
| W4 | 0.3 ms/MB · 51 MiB | 0.3 ms/MB · 51 MiB |  |  |

| cell | unit | N median (min–max) | N-data median (min–max) |
| --- | --- | --- | --- |
| W1 | statements/s | 15,798.0 (14,947.5–16,947.0) | 15,508.6 (14,251.7–16,441.6) |
| W2 | statements/s | 91,401.3 (87,176.3–96,890.5) | 91,966.6 (86,247.5–98,528.3) |
| W3-8K | MB/s | 440.6 (327.9–551.7) | 400.2 (315.7–540.8) |
| W3-64K | MB/s | 411.2 (326.8–515.2) | 394.9 (299.9–555.5) |
| W3-1M | MB/s | 458.1 (368.0–579.2) | 420.4 (309.7–558.0) |
| W4 | MB/s | 499.3 (498.3–499.9) | 499.5 (499.1–500.3) |

CPU seconds per unit (statement, or MB) and peak RSS, medians over runs; not gating.

| cell | N CPU · peak RSS | N-data CPU · peak RSS | N latency (W1) | N-data latency (W1) |
| --- | --- | --- | --- | --- |
| W1 | 40.3 µs/stmt · 93 MiB | 43.1 µs/stmt · 93 MiB | p50 54 µs, p99 224 µs | p50 54 µs, p99 281 µs |
| W2 | 9.5 µs/stmt · 100 MiB | 9.6 µs/stmt · 100 MiB |  |  |
| W3-8K | 2.2 ms/MB · 88 MiB | 2.4 ms/MB · 90 MiB |  |  |
| W3-64K | 2.4 ms/MB · 88 MiB | 2.5 ms/MB · 90 MiB |  |  |
| W3-1M | 2.1 ms/MB · 88 MiB | 2.4 ms/MB · 90 MiB |  |  |
| W4 | 0.3 ms/MB · 86 MiB | 0.3 ms/MB · 86 MiB |  |  |

## Capabilities

Required (gate): TLS upgrade of an open socket after SSLRequest; read pause and resume with bounded memory (256 MiB stream, 2 s pause: 0
bytes delivered after the 100 ms settle, RSS growth below 1 MB, all bytes and the hash intact, for every candidate and build); a write
backpressure signal on one 64 MiB write (N: `write()` returned false and `drain` came about 0.85 s later, when the server resumed; B: the
partial write was kept and `drain` came about 0.9 s later; both delivered every byte); an error or destroy surfaced exactly once (server RST,
server FIN, local destroy: one terminal event, no data after it). Raw event counts are in `results/capabilities.*.json`. Differences found in
the raw events: on RST, N sees an `error` and a `close` event (the adapter reports one terminal call), B sees only `close` with the error; on
server FIN both see `end` then `close`; on local destroy N sees `end` and `close`, B only `close`.

Reported only:

| build | candidate | direct TLS + ALPN | peer certificate bytes = server DER | nodelay | keepalive | half-close | connect timeout probe (state after 1.5 s; destroy) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| release | N | yes | yes | call accepted | keepalive timer seen in /proc/net/tcp | yes | pending; destroy: ok |
| release | B | yes | yes | call accepted | keepalive timer seen in /proc/net/tcp | yes | pending; destroy: threw: null is not an object (evaluating '(this.tlsSock ?? this.soc |
| release | N-data | yes | yes | call accepted | keepalive timer seen in /proc/net/tcp | yes | pending; destroy: ok |
| canary | N | yes | yes | call accepted | keepalive timer seen in /proc/net/tcp | yes | pending; destroy: ok |
| canary | B | yes | yes | call accepted | keepalive timer seen in /proc/net/tcp | yes | pending; destroy: threw: null is not an object (evaluating '(this.tlsSock ?? this.soc |
| canary | N-data | yes | yes | call accepted | keepalive timer seen in /proc/net/tcp | yes | pending; destroy: ok |
| node24 | N | yes | yes | call accepted | keepalive timer seen in /proc/net/tcp | yes | pending; destroy: ok |
| node24 | N-data | yes | yes | call accepted | keepalive timer seen in /proc/net/tcp | yes | pending; destroy: ok |

- ALPN: Bun accepts `ALPNProtocols` as a plain string and **silently does not offer it**; it works only as wire-format bytes
  (length-prefixed names). My first adapter passed a string and the server saw no ALPN on both builds; the adapter now builds the bytes.
- Peer certificate bytes: all candidates return the server certificate's DER and its sha256 equals the server's (SCRAM channel binding input).
- nodelay: the call is accepted by all; its effect is not observable from outside the process here, so nothing is claimed beyond that.
- keepalive: the kernel's keepalive timer (`/proc/net/tcp`, timer 02) is present on a connection of every candidate after the call.
- half-close: a client `end` followed by a server reply of 100,000 bytes is received intact by every candidate. B never reports the peer
  FIN as an `end` event on that path (only `close`).
- connect timeout: against a listener with a full accept queue, the connect stays pending for every candidate. On N, `destroy()` cancels it and
  a terminal event follows; on B there is **no socket object until open**, so a pending `Bun.connect` cannot be cancelled and the adapter's
  `destroy()` threw; a Bun transport needs its own timer and has to ignore a late open.
- TLS raw-socket callbacks (B): after `upgradeTLS` the original socket's `data` handler keeps delivering the TLS ciphertext, so a
  Bun transport must ignore it. Observed once in the first TLS probe (not a committed result); the adapter has the guard.

### Lifetime of delivered bytes

After the callback returns, is the delivered buffer reused or changed? 60 deliveries of different sizes, 4 ms apart.

| build | candidate | deliveries | consecutive deliveries on the same ArrayBuffer | views changed after a microtask | views changed before the next delivery | views changed at the end |
| --- | --- | --- | --- | --- | --- | --- |
| release | N | 60 | 59 | 0 | 59 | 59 |
| release | B | 60 | 0 | 0 | 0 | 0 |
| release | N-data | 60 | 0 | 0 | 0 | 0 |
| canary | N | 60 | 59 | 0 | 59 | 59 |
| canary | B | 60 | 0 | 0 | 0 | 0 |
| canary | N-data | 60 | 0 | 0 | 0 | 0 |
| node24 | N | 59 | 58 | 0 | 58 | 58 |
| node24 | N-data | 59 | 0 | 0 | 0 | 0 |

N (onread) reuses the one supplied buffer on every build, including Node 24: the view handed to the callback is a window on that buffer,
and the next read overwrites it before the next callback. It survives to the end of the callback only. B and N-data hand out fresh memory,
and a view stays valid. For the P6-T01 shared read buffer this means the same contract as `onread`: anything kept past the callback must be
copied, which `core.ts` does for the one case that needs it (a message split across chunks).

## Not verified here

- Verbatim text of the Bun 1.4 rewrite post's regression list; release notes 1.3.13, 1.3.14, 1.4.1 to 1.4.4.
- Any pick on more than the two Bun builds, one machine (4 cores, loopback only), one PostgreSQL version.
- The canary null comparison (none was made); the canary throughput is compared with the release floors.
- Tuning: neither `onread` buffer size nor Bun `binaryType` was swept; a different choice could move a cell.
- Windows and macOS. Unix-domain sockets. IPv6. Connections that live longer than a run.
- That W3 and W4 distinguish the APIs: W3 is client-bound by per-message work at 100-byte rows and W4 sits at the throttle.
- The effect of nodelay.
- The canary installed here is `1.4.6-canary.1+0966e99d8` although the npm `canary` tag listed `1.4.5-canary.20261125.1`; the planner's earlier
  install of the same tag gave `+25c4fca9e`. All results are for the strings in `results/builds.json`.

## Harness defects found and fixed

Each was found by this study's own checks; every committed result was produced after its fix unless stated.

1. B adapter delivered TLS ciphertext to the core after `upgradeTLS` (the raw socket's callbacks stay live); fixed with a guard.
2. The shell exported `BUN_OPTIONS=--smol`; the first smoke runs inherited it. The spawn helper now deletes `BUN_OPTIONS` and `NODE_OPTIONS`.
3. The proxy never flushed the tail of a grouped stream (group mode hung); it now flushes after 40 ms of server silence.
4. The lifetime probe's "copy" was `Buffer.slice`, which is a view, so every view looked unchanged. Found because the planted `keep_view`
   fault failed while the probe said no reuse. Fixed with a real copy; the same slip in the SSL-reply path and the `duplicate_chunk` fault
   was fixed too.
5. Ceiling script: it blocked the process hosting the servers (deadlock), its raw client had a 600 ms floor in drain mode and a 20 ms delay in
   push mode (ceilings 3 x too low). Fixed.
6. Two planted-fault loops ran at once for one batch (a stray loop survived my kill) and wrote the same files with different hang timeouts;
   the planted results were rerun alone, with a 15 s hang cap.
7. The first effectiveness criterion ("every planned cut observed") was too strict: the kernel merges 0.3 to 1 percent of 2 ms-apart segments.
   Changed, before any measurement, to 95 percent per cut class (committed separately in git, and reflected in `rule.json`).
8. `ss` is not installed; keepalive evidence uses `/proc/net/tcp`.
9. ALPN as a string for Bun (above) was an adapter defect; the B caps were rerun after the fix (see `results/capabilities.*.B.json`).
10. The ALPN probe read `alpnProtocol` after `destroy()`, where Bun no longer has it; it now reads it first (all capability runs repeated).
11. The B adapter's `destroy()` before open throws; this is reported as the API's limit, not fixed.

## Decisions beyond the brief

- Tie order N before B is the planner's choice, reported as such. Real PostgreSQL correctness counts as an 18th item of the fragmentation share.
- Thresholds written into `rule.json` before measuring: pause window 2 s, settle 100 ms, at most 1 MiB delivered after it, at most 64 MiB RSS
  growth; 64 MiB write must signal and drain after the 1 s stall; 95 percent cut observation; null spread as the relative gap of two
  interleaved series' medians.
- W3 uses 100-byte DataRows (ceiling rule); W4 throttle 500 MB/s; W1 and W2 sized to about 2.5 s; depth 100 refilled once per received chunk.
- The gate looks at the release and canary builds; N-data and Node 24 were run in full but are not in the rule.
- Canary comparison with the release floors (`canaryComparison` in `results/verdict.json`), because no canary null run exists.
- Docker started by hand (`dockerd`) in the session; PostgreSQL password is generated per run into the ignored `work/`; certificates are generated
  by `scripts/gen-certs.sh` into `work/certs`, never committed.
- npm was used only to fetch the two Bun builds and Node 24 into the ignored `work/` (scratch install, `npm i --prefix`); nothing in this folder
  has a package.json or lockfile.

## Reproduce

```sh
research/fs-03/scripts/run-all.sh     # everything, in the order it was run (long); then:
node research/fs-03/scripts/assemble.ts && node research/fs-03/scripts/report.ts && node research/fs-03/scripts/build-readme.ts
bunx tsc -p research/fs-03/tsconfig.json
```

Report scripts run from the committed `results/`. Raw per-run numbers are in `results/throughput.*.json` and `results/w5.*.json`.

## Proposed decision (for the P6-T02 ADR author; nothing is decided here)

| question | evidence | proposal |
| --- | --- | --- |
| Which socket API for `transports/bun`? | Both pass the gate on release and canary; no release cell differs outside noise; canary alone favours B in W1 only | N by the planner's tie order, or B if the ADR weighs the canary W1 result or fresh-buffer delivery more; the data does not force either |
| Read path buffer | N reuses and overwrites one buffer; B and N-data deliver fresh memory | Fix the lifetime rule in the transport contract: bytes valid only during the callback |
| TLS | N: upgrade works, reads become `data` events; B: upgrade works, raw-socket ciphertext callbacks must be ignored | Either way keep the SSLRequest then upgrade sequence in the shared driver |
| Cancel a pending connect | N can destroy; B cannot cancel `Bun.connect` | If the contract has a connect timeout, B needs a late-open guard |
| ALPN | Bun needs wire-format bytes, a string is silently ignored | Test ALPN on every Bun build in CI (risk 11) |
| Suites on both builds | The suite found no canary-specific failure on 1.4.6-canary.1 | Keep the same suites on release and canary (P6-T02) |
