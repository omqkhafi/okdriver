## Builds

| id | runtime | `--version` | `--revision` |
| --- | --- | --- | --- |
| release | bun | `1.4.5` | `1.4.5+a7733435c` |
| canary | bun | `1.4.6` | `1.4.6-canary.1+0966e99d8` |
| node22 | node | `v22.23.5` |  |
| node24 | node | `v24.22.3` |  |

## Throughput canary (fakepg)

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

## Throughput node24 (fakepg)

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

## Throughput release (fakepg)

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

## Throughput release.ndata (fakepg)

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

## Throughput release.tls (fakepg-tls)

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

## w5.canary

| cell | unit | B median (min–max) | N median (min–max) | N / B |
| --- | --- | --- | --- | --- |
| W5-S1 | statements/s | 14,324.2 (13,065.8–16,015.7) | 14,378.5 (13,115.4–15,344.8) | 1.004 |
| W5-D100 | statements/s | 80,381.7 (71,810.0–85,703.3) | 77,321.0 (65,890.1–87,529.6) | 0.962 |
| W5-100MB | MB/s | 637.7 (401.4–732.5) | 620.4 (511.0–700.7) | 0.973 |

## w5.release

| cell | unit | B median (min–max) | N median (min–max) | N / B |
| --- | --- | --- | --- | --- |
| W5-S1 | statements/s | 14,370.3 (13,026.0–15,636.3) | 13,535.7 (12,232.0–14,795.7) | 0.942 |
| W5-D100 | statements/s | 78,791.3 (65,162.0–88,646.3) | 77,461.1 (70,967.2–86,960.5) | 0.983 |
| W5-100MB | MB/s | 629.7 (517.6–847.5) | 609.2 (519.0–741.3) | 0.968 |

## w5.release.tls

| cell | unit | B median (min–max) | N median (min–max) | N / B |
| --- | --- | --- | --- | --- |
| W5-S1 | statements/s | 13,131.4 (12,371.7–14,115.3) | 12,332.7 (11,304.2–14,245.7) | 0.939 |
| W5-100MB | MB/s | 515.6 (464.7–584.6) | 477.8 (431.7–636.7) | 0.927 |

## Gate

| build | candidate | fragmentation scenarios | real PostgreSQL vs psql | tls_upgrade | pause_resume_bounded | write_backpressure | terminal_once |
| --- | --- | --- | --- | --- | --- | --- | --- |
| release | N | 17/17 | pass | pass | pass | pass | pass |
| release | B | 17/17 | pass | pass | pass | pass | pass |
| release | N-data | 17/17 | pass | pass | pass | pass | pass |
| canary | N | 17/17 | pass | pass | pass | pass | pass |
| canary | B | 17/17 | pass | pass | pass | pass | pass |
| canary | N-data | 17/17 | pass | pass | pass | pass | pass |

### Scenarios

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

## Capabilities reported only

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

## Lifetime of delivered bytes

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

## PostgreSQL 19.0 own ceiling (pgbench and psql, core 0)

| rate | value |
| --- | --- |
| tool | pgbench (PostgreSQL) 16.15 (Ubuntu 16.15-0ubuntu0.24.04.1) |
| S1 statements/s (pgbench -M extended, one connection) | 17,030 |
| depth 100 statements/s (pgbench pipeline of 100) | 133,457 |
| 100 MB result MB/s (psql to a pipe, text, median of 3) | 267 |

## Server ceilings (raw Node client)

| rate | value |
| --- | --- |
| pipeline statements/s (depth 200) | 272,390 |
| stream MB/s (burst 8K) | 1,365 |
| stream MB/s (burst 64K) | 1,174 |
| stream MB/s (burst 1M) | 1,389 |
| copy sink MB/s (unthrottled) | 3,184 |

## Verdict (scripts/assemble.ts applying rule.json)

```json
{
 "valid": true,
 "pick": "N",
 "basis": "neither faster (mixed or within noise): tie order N before B",
 "pool": [
  "N",
  "B"
 ],
 "pickIfOnly": {
  "release": "N",
  "canary": "N"
 },
 "ruleSha256": "992c0ab0c913aff2b951aa255ff2f0645e2e95c25cf54336e4455dfa70d46169"
}
```
