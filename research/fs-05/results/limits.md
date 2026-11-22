Loaded round trip used (ms): {"loop":0.11380599999999674,"loopT":0.15102899999999408,"d4":4.75,"d20":19.48}

pgbench ceiling (tps, same two cores): mode=simple clients=8 tps = 38009.884880 (without initial connection time); mode=simple clients=32 tps = 33502.832351 (without initial connection time); mode=extended clients=8 tps = 33728.423884 (without initial connection time); mode=extended clients=32 tps = 29639.836839 (without initial connection time); mode=prepared clients=8 tps = 53910.811064 (without initial connection time); mode=prepared clients=32 tps = 49125.893886 (without initial connection time); 

| cell | best measured plateau | best config | connections x depth 128 / RTT | client ceiling | connection-time ceiling | binding |
| --- | --- | --- | --- | --- | --- | --- |
| d20|m0-fast|pipeline8|off | 3243 | aimd | 3277 | 74963 | n/a | connections x depth / RTT |
| d20|m0-fast|pipeline8|on | 47560 | rtt-aware | 52432 | 136444 | n/a | connections x depth / RTT |
| d20|m0-fast|standalone|off | 411 | control | 410 | 17431 | n/a | connections x depth / RTT |
| d20|m0-fast|standalone|on | 47760 | rtt-aware | 52432 | 130890 | n/a | connections x depth / RTT |
| d20|m1-sleep5-1|pipeline8|on | 42330 | rtt-aware | 52432 | 135999 | 148148 | connections x depth / RTT |
| d20|m1-sleep5-1|standalone|on | 36890 | rtt-aware | 52432 | 148876 | 148148 | none of the three: server CPU or the CPU cost of the round trip itself (pgbench on the same two cores: 34k to 54k) |
| d20|m2-sleep50-1|standalone|on | 13170 | rtt-aware | 52432 | 111173 | 15873 | connection time (sleepers) |
| d4|m0-fast|standalone|off | 1676 | control | 1667 | 23552 | n/a | connections x depth / RTT |
| d4|m0-fast|standalone|on | 62790 | rtt-aware | 213333 | 139237 | n/a | none of the three: server CPU or the CPU cost of the round trip itself (pgbench on the same two cores: 34k to 54k) |
| loop|m0-fast|pipeline8|off | 45340 | fixed:16 | 390706 | 118147 | n/a | none of the three: server CPU or the CPU cost of the round trip itself (pgbench on the same two cores: 34k to 54k) |
| loop|m0-fast|pipeline8|on | 50350 | fixed:16 | 6251297 | 103391 | n/a | none of the three: server CPU or the CPU cost of the round trip itself (pgbench on the same two cores: 34k to 54k) |
| loop|m0-fast|standalone|off | 35200 | latency-aware | 48838 | 66357 | n/a | none of the three: server CPU or the CPU cost of the round trip itself (pgbench on the same two cores: 34k to 54k) |
| loop|m0-fast|standalone|on | 48720 | fixed:64 | 6251297 | 94967 | n/a | none of the three: server CPU or the CPU cost of the round trip itself (pgbench on the same two cores: 34k to 54k) |
| loop|m1-sleep5-1|pipeline8|on | 48700 | rtt-aware | 6251297 | 105719 | 148148 | none of the three: server CPU or the CPU cost of the round trip itself (pgbench on the same two cores: 34k to 54k) |
| loop|m1-sleep5-1|standalone|off | 31830 | latency-aware | 48838 | 61843 | 148148 | none of the three: server CPU or the CPU cost of the round trip itself (pgbench on the same two cores: 34k to 54k) |
| loop|m1-sleep5-1|standalone|on | 47150 | fixed:16 | 6251297 | 89767 | 148148 | none of the three: server CPU or the CPU cost of the round trip itself (pgbench on the same two cores: 34k to 54k) |
| loop|m2-sleep50-1|standalone|off | 12980 | latency-aware | 48838 | 40437 | 15873 | connection time (sleepers) |
| loop|m2-sleep50-1|standalone|on | 14580 | fixed:16 | 6251297 | 70721 | 15873 | connection time (sleepers) |
