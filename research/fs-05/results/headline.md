Throughput, statements per second, 2048 callers (median of 5 runs). `-` = not run (sharing off, standalone: the other policies are `control` by construction).

| cell (rtt, mix, shape, sharing) | control | fixed:4 | fixed:16 | fixed:64 | rtt-aware | latency-aware | aimd |
| --- | --- | --- | --- | --- | --- | --- | --- |
| d20, m0-fast, pipeline8, off | 409 | 1.6k | 3.2k | 3.2k | 3.2k | 3.2k | 3.2k |
| loop, m0-fast, pipeline8, off | 32.1k | 43.5k | 45.3k | 43.6k | 43.4k | 42.8k | 34.0k |
| d20, m0-fast, pipeline8, on | 407 | 1.7k | 6.6k | 25.5k | 47.6k | 6.6k | 38.1k |
| loop, m0-fast, pipeline8, on | 32.8k | 43.6k | 50.4k | 44.2k | 49.2k | 48.4k | 31.6k |
| d20, m0-fast, standalone, off | 411 | - | - | - | - | 408 | - |
| d4, m0-fast, standalone, off | 1.7k | - | - | - | - | 1.7k | - |
| loop, m0-fast, standalone, off | 31.6k | - | - | - | - | 35.2k | - |
| d20, m0-fast, standalone, on | 412 | 1.7k | 6.6k | 25.5k | 47.8k | 6.6k | 39.0k |
| d4, m0-fast, standalone, on | 1.6k | 6.5k | 23.9k | 57.7k | 62.8k | 23.5k | 46.2k |
| loop, m0-fast, standalone, on | 32.2k | 46.7k | 45.5k | 48.7k | 47.2k | 46.0k | 33.4k |
| d20, m1-sleep5-1, pipeline8, on | 406 | 1.7k | 6.5k | 24.4k | 42.3k | 6.5k | 28.2k |
| loop, m1-sleep5-1, pipeline8, on | 33.2k | 44.1k | 45.1k | 47.8k | 48.7k | 45.7k | 34.1k |
| loop, m1-sleep5-1, standalone, off | 31.5k | - | - | - | - | 31.8k | - |
| d20, m1-sleep5-1, standalone, on | 407 | 1.6k | 6.0k | 21.1k | 36.9k | 6.0k | 18.6k |
| loop, m1-sleep5-1, standalone, on | 29.7k | 43.0k | 47.1k | 46.7k | 46.5k | 44.3k | 31.2k |
| loop, m2-sleep50-1, standalone, off | 12.8k | - | - | - | - | 13.0k | - |
| d20, m2-sleep50-1, standalone, on | 397 | 1.5k | 4.5k | 10.4k | 13.2k | 4.6k | 3.6k |
| loop, m2-sleep50-1, standalone, on | 13.5k | 14.3k | 14.6k | 14.5k | 14.5k | 14.5k | 13.6k |

p99.9 of fast statements in ms (median of 5 runs) at 0.5 / 0.8 of the cell's T*. `*` = every run overloaded (right-censored tail); `i` = indicative (fewer than 100,000 fast statements).

| cell | rate at 0.5 / 0.8 | control | fixed:4 | fixed:16 | fixed:64 | rtt-aware | latency-aware | aimd |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| d20, m0-fast, pipeline8, off (i) | 1621 / 2594 | 4.8k* / 4.5k* | 137 / 1.5k | 31.6 / 37.1 | 29.0 / 37.3 | 31.3 / 36.2 | 28.3 / 38.1 | 28.2 / 38.0 |
| loop, m0-fast, pipeline8, off | 22671 / 36274 | 9.8 / 435 | 5.0 / 10.0 | 5.5 / 14.8 | 5.0 / 20.8 | 5.7 / 50.1 | 5.9 / 26.0 | 8.1 / 170 |
| d20, m0-fast, pipeline8, on | 23779 / 38047 | 7.3k* / 5.7k* | 7.3k* / 5.7k* | 6.0k* / 5.5k* | 30.6 / 1.8k | 34.2 / 37.2 | 6.0k* / 5.6k* | 592 / 1.0k |
| loop, m0-fast, pipeline8, on | 25174 / 40279 | 29.0 / 326 | 7.3 / 32.1 | 7.4 / 29.6 | 6.1 / 25.2 | 7.8 / 26.9 | 6.8 / 25.1 | 10.9 / 235 |
| d20, m0-fast, standalone, off (i) | 205 / 329 | 34.3 / 48.5 | - | - | - | - | 30.3 / 48.7 | - |
| d4, m0-fast, standalone, off (i) | 838 / 1341 | 8.9 / 12.9 | - | - | - | - | 9.3 / 13.1 | - |
| loop, m0-fast, standalone, off | 17598 / 28156 | 9.4 / 19.3 | - | - | - | - | 6.2 / 21.1 | - |
| d20, m0-fast, standalone, on | 23881 / 38209 | 7.3k* / 5.7k* | 7.3k* / 5.7k* | 6.0k* / 5.6k* | 27.2 / 1.9k | 32.3 / 44.8 | 6.1k* / 5.6k* | 587 / 1.0k |
| d4, m0-fast, standalone, on | 31397 / 50235 | 6.3k* / 5.1k* | 6.0k* / 5.1k* | 1.5k / 3.5k* | 15.3 / 106 | 14.4 / 150 | 1.5k / 3.4k* | 20.9 / 1.1k |
| loop, m0-fast, standalone, on | 24361 / 38977 | 13.8 / 184 | 7.0 / 26.2 | 5.9 / 21.8 | 6.5 / 18.0 | 12.2 / 27.1 | 16.5 / 24.6 | 24.4 / 791 |
| d20, m1-sleep5-1, pipeline8, on | 21163 / 33861 | 7.9k* / 6.1k* | 7.9k* / 6.1k* | 6.2k* / 5.7k* | 34.2 / 1.6k | 35.6 / 43.8 | 6.2k* / 5.7k* | 548 / 1.2k |
| loop, m1-sleep5-1, pipeline8, on | 24351 / 38961 | 11.9 / 430 | 11.3 / 27.1 | 12.8 / 28.5 | 12.4 / 28.2 | 12.0 / 23.6 | 13.5 / 42.2 | 12.5 / 659 |
| loop, m1-sleep5-1, standalone, off | 15917 / 25467 | 7.8 / 25.0 | - | - | - | - | 7.3 / 48.8 | - |
| d20, m1-sleep5-1, standalone, on | 18444 / 29511 | 8.6k* / 6.5k* | 8.6k* / 6.5k* | 6.6k* / 5.9k* | 38.9 / 1.0k | 42.2 / 39.2 | 6.6k* / 5.9k* | 619 / 971 |
| loop, m1-sleep5-1, standalone, on | 23576 / 37722 | 11.3 / 1.2k | 9.9 / 38.6 | 10.9 / 69.5 | 11.3 / 27.8 | 9.6 / 29.7 | 12.8 / 22.4 | 10.2 / 756 |
| loop, m2-sleep50-1, standalone, off | 6488 / 10381 | 25.6 / 69.5 | - | - | - | - | 26.0 / 68.5 | - |
| d20, m2-sleep50-1, standalone, on | 6586 / 10538 | 18.6k* / 12.9k* | 15.4k* / 12.0k* | 5.3k* / 7.9k* | 164 / 365 | 175 / 250 | 6.0k* / 7.8k* | 8.9k* / 9.1k* |
| loop, m2-sleep50-1, standalone, on | 7288 / 11661 | 29.7 / 104 | 55.3 / 95.9 | 90.0 / 127 | 89.1 / 175 | 53.4 / 94.6 | 102 / 132 | 31.1 / 96.2 |
