# Simulated cells (summary)

For every cell and load point: the config with the best median, and every config within noise of it (median no worse than the best config's worst run). Throughput at 2048 callers; p99.9 of fast statements at 0.5 and 0.8 of T*. `fixed:*` abbreviates the fixed depths within noise. Exploratory unless results/validation.json says passes.

| cell | load | T* or rate | best | within noise |
| --- | --- | --- | --- | --- |
| d20|m0-fast|pipeline8|off | closed2048 | 3188 | rtt-aware | rtt-aware, latency-aware, aimd, fixed:{8,16,32,64,128} |
| d20|m0-fast|pipeline8|off | open0.5 | 1594 | aimd | rtt-aware, latency-aware, aimd, fixed:{8,16,32,64,128} |
| d20|m0-fast|pipeline8|off | open0.8 | 2550 | aimd | rtt-aware, latency-aware, aimd, fixed:{8,16,32,64,128} |
| d20|m0-fast|pipeline8|on | closed2048 | 49480 | rtt-aware | rtt-aware, fixed:{128} |
| d20|m0-fast|pipeline8|on | open0.5 | 24741 | fixed:128 | fixed:{128} |
| d20|m0-fast|pipeline8|on | open0.8 | 39586 | fixed:128 | fixed:{128} |
| d20|m0-fast|standalone|off | closed2048 | 400 | control | control, rtt-aware, latency-aware, aimd, fixed:{2,4,8,16,32,64,128} |
| d20|m0-fast|standalone|off | open0.5 | 200 | control | control, rtt-aware, latency-aware, aimd, fixed:{2,4,8,16,32,64,128} |
| d20|m0-fast|standalone|off | open0.8 | 320 | control | control, rtt-aware, latency-aware, aimd, fixed:{2,4,8,16,32,64,128} |
| d20|m0-fast|standalone|on | closed2048 | 48030 | rtt-aware | rtt-aware |
| d20|m0-fast|standalone|on | open0.5 | 24017 | fixed:128 | fixed:{64,128} |
| d20|m0-fast|standalone|on | open0.8 | 38426 | fixed:128 | fixed:{128} |
| d20|m1-sleep5-1|pipeline8|off | closed2048 | 3116 | fixed:8 | rtt-aware, latency-aware, aimd, fixed:{8,16,32,64,128} |
| d20|m1-sleep5-1|pipeline8|off | open0.5 | 1558 | rtt-aware | rtt-aware |
| d20|m1-sleep5-1|pipeline8|off | open0.8 | 2493 | rtt-aware | rtt-aware, latency-aware, aimd, fixed:{8,16,32,64,128} |
| d20|m1-sleep5-1|pipeline8|on | closed2048 | 43930 | rtt-aware | rtt-aware, fixed:{128} |
| d20|m1-sleep5-1|pipeline8|on | open0.5 | 21963 | fixed:128 | fixed:{128} |
| d20|m1-sleep5-1|pipeline8|on | open0.8 | 35140 | fixed:128 | rtt-aware, fixed:{128} |
| d20|m1-sleep5-1|standalone|off | closed2048 | 400 | control | control, rtt-aware, latency-aware, aimd, fixed:{2,4,8,16,32,64,128} |
| d20|m1-sleep5-1|standalone|off | open0.5 | 200 | control | control, rtt-aware, latency-aware, aimd, fixed:{2,4,8,16,32,64,128} |
| d20|m1-sleep5-1|standalone|off | open0.8 | 320 | control | control, rtt-aware, latency-aware, aimd, fixed:{2,4,8,16,32,64,128} |
| d20|m1-sleep5-1|standalone|on | closed2048 | 43410 | rtt-aware | rtt-aware |
| d20|m1-sleep5-1|standalone|on | open0.5 | 21705 | fixed:64 | rtt-aware, fixed:{64,128} |
| d20|m1-sleep5-1|standalone|on | open0.8 | 34728 | fixed:128 | rtt-aware, fixed:{128} |
| d20|m2-sleep50-1|pipeline8|off | closed2048 | 2645 | fixed:8 | rtt-aware, latency-aware, fixed:{8,16,32,64,128} |
| d20|m2-sleep50-1|pipeline8|off | open0.5 | 1322 | fixed:8 | rtt-aware, latency-aware, fixed:{8,16,32,64,128} |
| d20|m2-sleep50-1|pipeline8|off | open0.8 | 2116 | rtt-aware | rtt-aware, latency-aware, fixed:{8,16,32,64,128} |
| d20|m2-sleep50-1|pipeline8|on | closed2048 | 13280 | rtt-aware | rtt-aware, fixed:{128} |
| d20|m2-sleep50-1|pipeline8|on | open0.5 | 6642 | fixed:64 | fixed:{64,128} |
| d20|m2-sleep50-1|pipeline8|on | open0.8 | 10627 | fixed:128 | fixed:{128} |
| d20|m2-sleep50-1|standalone|off | closed2048 | 391 | control | control, rtt-aware, latency-aware, aimd, fixed:{2,4,8,16,32,64,128} |
| d20|m2-sleep50-1|standalone|off | open0.5 | 195 | control | control, rtt-aware, latency-aware, aimd, fixed:{2,4,8,16,32,64,128} |
| d20|m2-sleep50-1|standalone|off | open0.8 | 312 | control | control, rtt-aware, latency-aware, aimd, fixed:{2,4,8,16,32,64,128} |
| d20|m2-sleep50-1|standalone|on | closed2048 | 13310 | rtt-aware | rtt-aware, fixed:{128} |
| d20|m2-sleep50-1|standalone|on | open0.5 | 6654 | rtt-aware | rtt-aware, fixed:{32,64,128} |
| d20|m2-sleep50-1|standalone|on | open0.8 | 10646 | fixed:128 | rtt-aware, fixed:{64,128} |
| d20|m3-sleep5-10|pipeline8|off | closed2048 | 2591 | rtt-aware | rtt-aware, latency-aware, aimd, fixed:{8,16,32,64,128} |
| d20|m3-sleep5-10|pipeline8|off | open0.5 | 1295 | aimd | rtt-aware, latency-aware, aimd, fixed:{8,16,32,64,128} |
| d20|m3-sleep5-10|pipeline8|off | open0.8 | 2072 | fixed:8 | rtt-aware, latency-aware, aimd, fixed:{8,16,32,64,128} |
| d20|m3-sleep5-10|pipeline8|on | closed2048 | 13720 | fixed:128 | rtt-aware, fixed:{128} |
| d20|m3-sleep5-10|pipeline8|on | open0.5 | 6861 | fixed:64 | fixed:{32,64,128} |
| d20|m3-sleep5-10|pipeline8|on | open0.8 | 10978 | fixed:128 | fixed:{64,128} |
| d20|m3-sleep5-10|standalone|off | closed2048 | 392 | control | control, rtt-aware, latency-aware, aimd, fixed:{2,4,8,16,32,64,128} |
| d20|m3-sleep5-10|standalone|off | open0.5 | 196 | control | control, rtt-aware, latency-aware, aimd, fixed:{2,4,8,16,32,64,128} |
| d20|m3-sleep5-10|standalone|off | open0.8 | 313 | latency-aware | control, rtt-aware, latency-aware, aimd, fixed:{2,4,8,16,32,64,128} |
| d20|m3-sleep5-10|standalone|on | closed2048 | 13750 | fixed:128 | fixed:{128} |
| d20|m3-sleep5-10|standalone|on | open0.5 | 6874 | fixed:32 | fixed:{32,64,128} |
| d20|m3-sleep5-10|standalone|on | open0.8 | 10998 | fixed:64 | fixed:{64,128} |
| d20|m4-sleep50-10|pipeline8|off | closed2048 | 1048 | fixed:8 | latency-aware, fixed:{8,16,32,64,128} |
| d20|m4-sleep50-10|pipeline8|off | open0.5 | 524 | fixed:8 | latency-aware, fixed:{8,16,32,64,128} |
| d20|m4-sleep50-10|pipeline8|off | open0.8 | 838 | fixed:8 | latency-aware, fixed:{8,16,32,64,128} |
| d20|m4-sleep50-10|pipeline8|on | closed2048 | 1606 | rtt-aware | rtt-aware, fixed:{32,64,128} |
| d20|m4-sleep50-10|pipeline8|on | open0.5 | 803 | fixed:32 | fixed:{8,16,32,64,128} |
| d20|m4-sleep50-10|pipeline8|on | open0.8 | 1284 | fixed:64 | fixed:{32,64,128} |
| d20|m4-sleep50-10|standalone|off | closed2048 | 321 | control | control, rtt-aware, latency-aware, aimd, fixed:{2,4,8,16,32,64,128} |
| d20|m4-sleep50-10|standalone|off | open0.5 | 161 | control | control, rtt-aware, latency-aware, aimd, fixed:{2,4,8,16,32,64,128} |
| d20|m4-sleep50-10|standalone|off | open0.8 | 257 | control | control, rtt-aware, latency-aware, aimd, fixed:{2,4,8,16,32,64,128} |
| d20|m4-sleep50-10|standalone|on | closed2048 | 1524 | fixed:128 | fixed:{32,64,128} |
| d20|m4-sleep50-10|standalone|on | open0.5 | 762 | fixed:16 | fixed:{8,16,32,64,128} |
| d20|m4-sleep50-10|standalone|on | open0.8 | 1219 | fixed:32 | latency-aware, fixed:{16,32,64,128} |
| d20|m5-cpu5-1|pipeline8|off | closed2048 | 2478 | fixed:8 | rtt-aware, latency-aware, aimd, fixed:{8,16,32,64,128} |
| d20|m5-cpu5-1|pipeline8|off | open0.5 | 1239 | rtt-aware | rtt-aware, latency-aware, aimd, fixed:{8,16,32,64,128} |
| d20|m5-cpu5-1|pipeline8|off | open0.8 | 1982 | fixed:8 | latency-aware, fixed:{8,16,32,64,128} |
| d20|m5-cpu5-1|pipeline8|on | closed2048 | 4238 | rtt-aware | rtt-aware, latency-aware, fixed:{16,32,64,128} |
| d20|m5-cpu5-1|pipeline8|on | open0.5 | 2119 | fixed:8 | latency-aware, aimd, fixed:{8,16,32,64,128} |
| d20|m5-cpu5-1|pipeline8|on | open0.8 | 3390 | fixed:16 | rtt-aware, latency-aware, fixed:{16,32,64,128} |
| d20|m5-cpu5-1|standalone|off | closed2048 | 391 | control | control, rtt-aware, latency-aware, aimd, fixed:{2,4,8,16,32,64,128} |
| d20|m5-cpu5-1|standalone|off | open0.5 | 195 | control | control, rtt-aware, latency-aware, aimd, fixed:{2,4,8,16,32,64,128} |
| d20|m5-cpu5-1|standalone|off | open0.8 | 312 | control | control, rtt-aware, latency-aware, aimd, fixed:{2,4,8,16,32,64,128} |
| d20|m5-cpu5-1|standalone|on | closed2048 | 4185 | fixed:32 | rtt-aware, latency-aware, fixed:{16,32,128} |
| d20|m5-cpu5-1|standalone|on | open0.5 | 2092 | aimd | rtt-aware, aimd, fixed:{32,64,128} |
| d20|m5-cpu5-1|standalone|on | open0.8 | 3348 | fixed:16 | fixed:{16,32} |
| d20|m6-cpu50-1|pipeline8|off | closed2048 | 2478 | fixed:8 | rtt-aware, latency-aware, aimd, fixed:{8,16,32,64,128} |
| d20|m6-cpu50-1|pipeline8|off | open0.5 | 1239 | rtt-aware | rtt-aware, latency-aware, aimd, fixed:{8,16,32,64,128} |
| d20|m6-cpu50-1|pipeline8|off | open0.8 | 1982 | fixed:8 | latency-aware, fixed:{8,16,32,64,128} |
| d20|m6-cpu50-1|pipeline8|on | closed2048 | 4238 | rtt-aware | rtt-aware, latency-aware, fixed:{16,32,64,128} |
| d20|m6-cpu50-1|pipeline8|on | open0.5 | 2119 | fixed:8 | latency-aware, aimd, fixed:{8,16,32,64,128} |
| d20|m6-cpu50-1|pipeline8|on | open0.8 | 3390 | fixed:16 | rtt-aware, latency-aware, fixed:{16,32,64,128} |
| d20|m6-cpu50-1|standalone|off | closed2048 | 391 | control | control, rtt-aware, latency-aware, aimd, fixed:{2,4,8,16,32,64,128} |
| d20|m6-cpu50-1|standalone|off | open0.5 | 195 | control | control, rtt-aware, latency-aware, aimd, fixed:{2,4,8,16,32,64,128} |
| d20|m6-cpu50-1|standalone|off | open0.8 | 312 | control | control, rtt-aware, latency-aware, aimd, fixed:{2,4,8,16,32,64,128} |
| d20|m6-cpu50-1|standalone|on | closed2048 | 4185 | fixed:32 | rtt-aware, latency-aware, fixed:{16,32,128} |
| d20|m6-cpu50-1|standalone|on | open0.5 | 2092 | aimd | rtt-aware, aimd, fixed:{32,64,128} |
| d20|m6-cpu50-1|standalone|on | open0.8 | 3348 | fixed:16 | fixed:{16,32} |
| d4|m0-fast|pipeline8|off | closed2048 | 10610 | fixed:8 | rtt-aware, latency-aware, aimd, fixed:{8,16,32,64,128} |
| d4|m0-fast|pipeline8|off | open0.5 | 5306 | aimd | rtt-aware, latency-aware, aimd, fixed:{8,16,32,64,128} |
| d4|m0-fast|pipeline8|off | open0.8 | 8490 | rtt-aware | rtt-aware, latency-aware, aimd, fixed:{8,16,32,64,128} |
| d4|m0-fast|pipeline8|on | closed2048 | 55140 | fixed:128 | rtt-aware, fixed:{128} |
| d4|m0-fast|pipeline8|on | open0.5 | 27569 | aimd | aimd |
| d4|m0-fast|pipeline8|on | open0.8 | 44111 | aimd | aimd |
| d4|m0-fast|standalone|off | closed2048 | 1333 | control | control, rtt-aware, latency-aware, aimd, fixed:{2,4,8,16,32,64,128} |
| d4|m0-fast|standalone|off | open0.5 | 666 | control | control, rtt-aware, latency-aware, aimd, fixed:{2,4,8,16,32,64,128} |
| d4|m0-fast|standalone|off | open0.8 | 1066 | control | control, rtt-aware, latency-aware, aimd, fixed:{2,4,8,16,32,64,128} |
| d4|m0-fast|standalone|on | closed2048 | 50950 | rtt-aware | rtt-aware |
| d4|m0-fast|standalone|on | open0.5 | 25473 | aimd | aimd, fixed:{32,64,128} |
| d4|m0-fast|standalone|on | open0.8 | 40756 | aimd | rtt-aware, aimd, fixed:{32,64,128} |
| d4|m1-sleep5-1|pipeline8|off | closed2048 | 9941 | fixed:8 | latency-aware, fixed:{8,16,32,64,128} |
| d4|m1-sleep5-1|pipeline8|off | open0.5 | 4971 | fixed:8 | rtt-aware, latency-aware, aimd, fixed:{8,16,32,64,128} |
| d4|m1-sleep5-1|pipeline8|off | open0.8 | 7953 | aimd | rtt-aware, latency-aware, aimd, fixed:{8,16,32,64,128} |
| d4|m1-sleep5-1|pipeline8|on | closed2048 | 54990 | rtt-aware | rtt-aware |
| d4|m1-sleep5-1|pipeline8|on | open0.5 | 27495 | fixed:32 | fixed:{32,64,128} |
| d4|m1-sleep5-1|pipeline8|on | open0.8 | 43992 | fixed:64 | fixed:{64,128} |
| d4|m1-sleep5-1|standalone|off | closed2048 | 1324 | control | control, rtt-aware, latency-aware, aimd, fixed:{2,4,8,16,32,64,128} |
| d4|m1-sleep5-1|standalone|off | open0.5 | 662 | control | control, rtt-aware, latency-aware, aimd, fixed:{2,4,8,16,32,64,128} |
| d4|m1-sleep5-1|standalone|off | open0.8 | 1059 | control | control, rtt-aware, latency-aware, aimd, fixed:{2,4,8,16,32,64,128} |
| d4|m1-sleep5-1|standalone|on | closed2048 | 51300 | rtt-aware | rtt-aware |
| d4|m1-sleep5-1|standalone|on | open0.5 | 25650 | fixed:32 | fixed:{32,64,128} |
| d4|m1-sleep5-1|standalone|on | open0.8 | 41040 | rtt-aware | rtt-aware, fixed:{64,128} |
| d4|m2-sleep50-1|pipeline8|off | closed2048 | 6416 | fixed:8 | latency-aware, fixed:{8,16,32,64,128} |
| d4|m2-sleep50-1|pipeline8|off | open0.5 | 3208 | fixed:8 | latency-aware, fixed:{8,16,32,64,128} |
| d4|m2-sleep50-1|pipeline8|off | open0.8 | 5133 | fixed:8 | latency-aware, fixed:{8,16,32,64,128} |
| d4|m2-sleep50-1|pipeline8|on | closed2048 | 14950 | rtt-aware | rtt-aware, fixed:{128} |
| d4|m2-sleep50-1|pipeline8|on | open0.5 | 7473 | fixed:32 | latency-aware, fixed:{16,32,64,128} |
| d4|m2-sleep50-1|pipeline8|on | open0.8 | 11956 | fixed:64 | fixed:{64,128} |
| d4|m2-sleep50-1|standalone|off | closed2048 | 1249 | control | control, rtt-aware, latency-aware, aimd, fixed:{2,4,8,16,32,64,128} |
| d4|m2-sleep50-1|standalone|off | open0.5 | 625 | control | control, rtt-aware, latency-aware, aimd, fixed:{2,4,8,16,32,64,128} |
| d4|m2-sleep50-1|standalone|off | open0.8 | 999 | control | control, rtt-aware, latency-aware, aimd, fixed:{2,4,8,16,32,64,128} |
| d4|m2-sleep50-1|standalone|on | closed2048 | 14970 | fixed:128 | fixed:{128} |
| d4|m2-sleep50-1|standalone|on | open0.5 | 7487 | fixed:32 | latency-aware, fixed:{16,32,64,128} |
| d4|m2-sleep50-1|standalone|on | open0.8 | 11978 | fixed:64 | fixed:{64,128} |
| d4|m3-sleep5-10|pipeline8|off | closed2048 | 6244 | fixed:8 | rtt-aware, latency-aware, fixed:{8,16,32,64,128} |
| d4|m3-sleep5-10|pipeline8|off | open0.5 | 3122 | fixed:8 | rtt-aware, latency-aware, fixed:{8,16,32,64,128} |
| d4|m3-sleep5-10|pipeline8|off | open0.8 | 4995 | fixed:8 | latency-aware, fixed:{8,16,32,64,128} |
| d4|m3-sleep5-10|pipeline8|on | closed2048 | 13680 | rtt-aware | rtt-aware, fixed:{64,128} |
| d4|m3-sleep5-10|pipeline8|on | open0.5 | 6840 | fixed:16 | fixed:{16,32,64,128} |
| d4|m3-sleep5-10|pipeline8|on | open0.8 | 10944 | fixed:64 | fixed:{32,64,128} |
| d4|m3-sleep5-10|standalone|off | closed2048 | 1233 | control | control, rtt-aware, latency-aware, aimd, fixed:{2,4,8,16,32,64,128} |
| d4|m3-sleep5-10|standalone|off | open0.5 | 616 | control | control, rtt-aware, latency-aware, aimd, fixed:{2,4,8,16,32,64,128} |
| d4|m3-sleep5-10|standalone|off | open0.8 | 986 | control | control, rtt-aware, latency-aware, aimd, fixed:{2,4,8,16,32,64,128} |
| d4|m3-sleep5-10|standalone|on | closed2048 | 13840 | fixed:128 | rtt-aware, fixed:{32,64,128} |
| d4|m3-sleep5-10|standalone|on | open0.5 | 6922 | fixed:16 | fixed:{16,32,64,128} |
| d4|m3-sleep5-10|standalone|on | open0.8 | 11075 | fixed:32 | fixed:{32,64,128} |
| d4|m4-sleep50-10|pipeline8|off | closed2048 | 1383 | fixed:8 | latency-aware, fixed:{8,16,32,64,128} |
| d4|m4-sleep50-10|pipeline8|off | open0.5 | 691 | fixed:8 | latency-aware, fixed:{8,16,32,64,128} |
| d4|m4-sleep50-10|pipeline8|off | open0.8 | 1106 | fixed:8 | latency-aware, fixed:{8,16,32,64,128} |
| d4|m4-sleep50-10|pipeline8|on | closed2048 | 1567 | fixed:32 | rtt-aware, latency-aware, fixed:{16,32,64,128} |
| d4|m4-sleep50-10|pipeline8|on | open0.5 | 783 | fixed:4 | fixed:{4} |
| d4|m4-sleep50-10|pipeline8|on | open0.8 | 1253 | fixed:16 | fixed:{8,16,32,64,128} |
| d4|m4-sleep50-10|standalone|off | closed2048 | 737 | control | control, rtt-aware, latency-aware, aimd, fixed:{2,4,8,16,32,64,128} |
| d4|m4-sleep50-10|standalone|off | open0.5 | 368 | control | control, rtt-aware, latency-aware, aimd, fixed:{2,4,8,16,32,64,128} |
| d4|m4-sleep50-10|standalone|off | open0.8 | 589 | control | control, rtt-aware, latency-aware, aimd, fixed:{2,4,8,16,32,64,128} |
| d4|m4-sleep50-10|standalone|on | closed2048 | 1599 | fixed:64 | latency-aware, fixed:{16,32,64,128} |
| d4|m4-sleep50-10|standalone|on | open0.5 | 799 | fixed:2 | fixed:{2} |
| d4|m4-sleep50-10|standalone|on | open0.8 | 1279 | fixed:8 | fixed:{8} |
| d4|m5-cpu5-1|pipeline8|off | closed2048 | 3896 | fixed:8 | latency-aware, aimd, fixed:{8,16,32,64,128} |
| d4|m5-cpu5-1|pipeline8|off | open0.5 | 1948 | rtt-aware | rtt-aware, latency-aware, aimd, fixed:{4,8,16,32,64,128} |
| d4|m5-cpu5-1|pipeline8|off | open0.8 | 3117 | fixed:8 | rtt-aware, latency-aware, aimd, fixed:{4,8,16,32,64,128} |
| d4|m5-cpu5-1|pipeline8|on | closed2048 | 4176 | fixed:32 | rtt-aware, latency-aware, aimd, fixed:{8,16,32,64,128} |
| d4|m5-cpu5-1|pipeline8|on | open0.5 | 2088 | fixed:4 | fixed:{4} |
| d4|m5-cpu5-1|pipeline8|on | open0.8 | 3340 | aimd | rtt-aware, latency-aware, aimd, fixed:{8,16,32} |
| d4|m5-cpu5-1|standalone|off | closed2048 | 1227 | control | control, rtt-aware, latency-aware, aimd, fixed:{2,4,8,16,32,64,128} |
| d4|m5-cpu5-1|standalone|off | open0.5 | 614 | control | control, rtt-aware, latency-aware, aimd, fixed:{2,4,8,16,32,64,128} |
| d4|m5-cpu5-1|standalone|off | open0.8 | 982 | control | control, rtt-aware, latency-aware, aimd, fixed:{2,4,8,16,32,64,128} |
| d4|m5-cpu5-1|standalone|on | closed2048 | 3994 | fixed:128 | rtt-aware, latency-aware, aimd, fixed:{4,8,16,32,64,128} |
| d4|m5-cpu5-1|standalone|on | open0.5 | 1997 | fixed:2 | rtt-aware, latency-aware, aimd, fixed:{2,4,8,16,32,64,128} |
| d4|m5-cpu5-1|standalone|on | open0.8 | 3195 | fixed:4 | rtt-aware, latency-aware, aimd, fixed:{4,8,16,32,64,128} |
| d4|m6-cpu50-1|pipeline8|off | closed2048 | 3896 | fixed:8 | latency-aware, aimd, fixed:{8,16,32,64,128} |
| d4|m6-cpu50-1|pipeline8|off | open0.5 | 1948 | rtt-aware | rtt-aware, latency-aware, aimd, fixed:{4,8,16,32,64,128} |
| d4|m6-cpu50-1|pipeline8|off | open0.8 | 3117 | fixed:8 | rtt-aware, latency-aware, aimd, fixed:{4,8,16,32,64,128} |
| d4|m6-cpu50-1|pipeline8|on | closed2048 | 4176 | fixed:32 | rtt-aware, latency-aware, aimd, fixed:{8,16,32,64,128} |
| d4|m6-cpu50-1|pipeline8|on | open0.5 | 2088 | fixed:4 | fixed:{4} |
| d4|m6-cpu50-1|pipeline8|on | open0.8 | 3340 | aimd | rtt-aware, latency-aware, aimd, fixed:{8,16,32} |
| d4|m6-cpu50-1|standalone|off | closed2048 | 1227 | control | control, rtt-aware, latency-aware, aimd, fixed:{2,4,8,16,32,64,128} |
| d4|m6-cpu50-1|standalone|off | open0.5 | 614 | control | control, rtt-aware, latency-aware, aimd, fixed:{2,4,8,16,32,64,128} |
| d4|m6-cpu50-1|standalone|off | open0.8 | 982 | control | control, rtt-aware, latency-aware, aimd, fixed:{2,4,8,16,32,64,128} |
| d4|m6-cpu50-1|standalone|on | closed2048 | 3994 | fixed:128 | rtt-aware, latency-aware, aimd, fixed:{4,8,16,32,64,128} |
| d4|m6-cpu50-1|standalone|on | open0.5 | 1997 | fixed:2 | rtt-aware, latency-aware, aimd, fixed:{2,4,8,16,32,64,128} |
| d4|m6-cpu50-1|standalone|on | open0.8 | 3195 | fixed:4 | rtt-aware, latency-aware, aimd, fixed:{4,8,16,32,64,128} |
| loop|m0-fast|pipeline8|off | closed2048 | 68030 | fixed:8 | latency-aware, fixed:{8,16,32,64,128} |
| loop|m0-fast|pipeline8|off | open0.5 | 34017 | fixed:8 | latency-aware, fixed:{8,16,32,64,128} |
| loop|m0-fast|pipeline8|off | open0.8 | 54426 | fixed:8 | latency-aware, fixed:{8,16,32,64,128} |
| loop|m0-fast|pipeline8|on | closed2048 | 55220 | rtt-aware | rtt-aware |
| loop|m0-fast|pipeline8|on | open0.5 | 27609 | fixed:16 | latency-aware, fixed:{8,16,32,64,128} |
| loop|m0-fast|pipeline8|on | open0.8 | 44174 | fixed:32 | latency-aware, fixed:{16,32,64,128} |
| loop|m0-fast|standalone|off | closed2048 | 32390 | control | control, rtt-aware, latency-aware, aimd, fixed:{2,4,8,16,32,64,128} |
| loop|m0-fast|standalone|off | open0.5 | 16195 | control | control, rtt-aware, latency-aware, aimd, fixed:{2,4,8,16,32,64,128} |
| loop|m0-fast|standalone|off | open0.8 | 25912 | control | control, rtt-aware, latency-aware, aimd, fixed:{2,4,8,16,32,64,128} |
| loop|m0-fast|standalone|on | closed2048 | 50930 | rtt-aware | rtt-aware |
| loop|m0-fast|standalone|on | open0.5 | 25463 | control | control, aimd |
| loop|m0-fast|standalone|on | open0.8 | 40741 | rtt-aware | rtt-aware, fixed:{8,32,64,128} |
| loop|m1-sleep5-1|pipeline8|off | closed2048 | 59520 | fixed:8 | latency-aware, fixed:{8,16,32,64,128} |
| loop|m1-sleep5-1|pipeline8|off | open0.5 | 29760 | fixed:8 | latency-aware, fixed:{4,8,16,32,64,128} |
| loop|m1-sleep5-1|pipeline8|off | open0.8 | 47616 | fixed:8 | latency-aware, fixed:{8,16,32,64,128} |
| loop|m1-sleep5-1|pipeline8|on | closed2048 | 55160 | rtt-aware | rtt-aware |
| loop|m1-sleep5-1|pipeline8|on | open0.5 | 27578 | fixed:2 | control, rtt-aware, aimd, fixed:{2,4,8,16,32,64,128} |
| loop|m1-sleep5-1|pipeline8|on | open0.8 | 44124 | fixed:64 | fixed:{32,64,128} |
| loop|m1-sleep5-1|standalone|off | closed2048 | 31920 | control | control, rtt-aware, latency-aware, aimd, fixed:{2,4,8,16,32,64,128} |
| loop|m1-sleep5-1|standalone|off | open0.5 | 15958 | control | control, rtt-aware, latency-aware, aimd, fixed:{2,4,8,16,32,64,128} |
| loop|m1-sleep5-1|standalone|off | open0.8 | 25533 | control | control, rtt-aware, latency-aware, aimd, fixed:{2,4,8,16,32,64,128} |
| loop|m1-sleep5-1|standalone|on | closed2048 | 51160 | rtt-aware | rtt-aware |
| loop|m1-sleep5-1|standalone|on | open0.5 | 25579 | control | control |
| loop|m1-sleep5-1|standalone|on | open0.8 | 40926 | rtt-aware | rtt-aware, fixed:{8} |
| loop|m2-sleep50-1|pipeline8|off | closed2048 | 14480 | aimd | rtt-aware, latency-aware, aimd, fixed:{2,4,8,16,32,64,128} |
| loop|m2-sleep50-1|pipeline8|off | open0.5 | 7240 | fixed:2 | control, rtt-aware, latency-aware, aimd, fixed:{2,4,8,16,32,64,128} |
| loop|m2-sleep50-1|pipeline8|off | open0.8 | 11584 | rtt-aware | rtt-aware, latency-aware, aimd, fixed:{2,4,8,16,32,64,128} |
| loop|m2-sleep50-1|pipeline8|on | closed2048 | 15130 | fixed:64 | rtt-aware, latency-aware, aimd, fixed:{4,8,16,32,64,128} |
| loop|m2-sleep50-1|pipeline8|on | open0.5 | 7566 | control | control |
| loop|m2-sleep50-1|pipeline8|on | open0.8 | 12105 | fixed:4 | aimd, fixed:{2,4,8} |
| loop|m2-sleep50-1|standalone|off | closed2048 | 12310 | control | control, rtt-aware, latency-aware, aimd, fixed:{2,4,8,16,32,64,128} |
| loop|m2-sleep50-1|standalone|off | open0.5 | 6157 | control | control, rtt-aware, latency-aware, aimd, fixed:{2,4,8,16,32,64,128} |
| loop|m2-sleep50-1|standalone|off | open0.8 | 9850 | control | control, rtt-aware, latency-aware, aimd, fixed:{2,4,8,16,32,64,128} |
| loop|m2-sleep50-1|standalone|on | closed2048 | 15820 | fixed:32 | rtt-aware, latency-aware, fixed:{2,4,8,16,32,64,128} |
| loop|m2-sleep50-1|standalone|on | open0.5 | 7908 | control | control |
| loop|m2-sleep50-1|standalone|on | open0.8 | 12653 | fixed:2 | aimd, fixed:{2,4,8} |
| loop|m3-sleep5-10|pipeline8|off | closed2048 | 13140 | fixed:8 | latency-aware, fixed:{4,8,16,32,64,128} |
| loop|m3-sleep5-10|pipeline8|off | open0.5 | 6568 | fixed:8 | latency-aware, fixed:{8,16,32,64,128} |
| loop|m3-sleep5-10|pipeline8|off | open0.8 | 10509 | fixed:4 | rtt-aware, latency-aware, aimd, fixed:{2,4,8,16,32,64,128} |
| loop|m3-sleep5-10|pipeline8|on | closed2048 | 13880 | fixed:32 | rtt-aware, latency-aware, fixed:{4,8,16,32,64,128} |
| loop|m3-sleep5-10|pipeline8|on | open0.5 | 6939 | fixed:2 | rtt-aware, fixed:{2} |
| loop|m3-sleep5-10|pipeline8|on | open0.8 | 11103 | rtt-aware | rtt-aware, aimd, fixed:{2,4,8,16,32,64,128} |
| loop|m3-sleep5-10|standalone|off | closed2048 | 12050 | control | control, rtt-aware, latency-aware, aimd, fixed:{2,4,8,16,32,64,128} |
| loop|m3-sleep5-10|standalone|off | open0.5 | 6024 | control | control, rtt-aware, latency-aware, aimd, fixed:{2,4,8,16,32,64,128} |
| loop|m3-sleep5-10|standalone|off | open0.8 | 9638 | control | control, rtt-aware, latency-aware, aimd, fixed:{2,4,8,16,32,64,128} |
| loop|m3-sleep5-10|standalone|on | closed2048 | 14120 | fixed:32 | rtt-aware, latency-aware, fixed:{4,8,16,32,64,128} |
| loop|m3-sleep5-10|standalone|on | open0.5 | 7061 | control | control |
| loop|m3-sleep5-10|standalone|on | open0.8 | 11297 | rtt-aware | rtt-aware |
| loop|m4-sleep50-10|pipeline8|off | closed2048 | 1546 | fixed:2 | control, rtt-aware, latency-aware, aimd, fixed:{2,4,8,16,32,64,128} |
| loop|m4-sleep50-10|pipeline8|off | open0.5 | 773 | fixed:4 | latency-aware, aimd, fixed:{4,8,16,32,64,128} |
| loop|m4-sleep50-10|pipeline8|off | open0.8 | 1236 | fixed:4 | control, rtt-aware, latency-aware, aimd, fixed:{2,4,8,16,32,64,128} |
| loop|m4-sleep50-10|pipeline8|on | closed2048 | 1559 | fixed:128 | control, rtt-aware, latency-aware, aimd, fixed:{2,4,8,16,32,64,128} |
| loop|m4-sleep50-10|pipeline8|on | open0.5 | 780 | control | control |
| loop|m4-sleep50-10|pipeline8|on | open0.8 | 1247 | control | control, rtt-aware, aimd, fixed:{2,4,8} |
| loop|m4-sleep50-10|standalone|off | closed2048 | 1563 | control | control, rtt-aware, latency-aware, aimd, fixed:{2,4,8,16,32,64,128} |
| loop|m4-sleep50-10|standalone|off | open0.5 | 782 | control | control, rtt-aware, latency-aware, aimd, fixed:{2,4,8,16,32,64,128} |
| loop|m4-sleep50-10|standalone|off | open0.8 | 1250 | control | control, rtt-aware, latency-aware, aimd, fixed:{2,4,8,16,32,64,128} |
| loop|m4-sleep50-10|standalone|on | closed2048 | 1604 | fixed:16 | control, latency-aware, aimd, fixed:{16,32,64} |
| loop|m4-sleep50-10|standalone|on | open0.5 | 802 | control | control |
| loop|m4-sleep50-10|standalone|on | open0.8 | 1283 | control | control, rtt-aware, fixed:{2} |
| loop|m5-cpu5-1|pipeline8|off | closed2048 | 3954 | rtt-aware | control, rtt-aware, latency-aware, aimd, fixed:{2,4,8,16,32,64,128} |
| loop|m5-cpu5-1|pipeline8|off | open0.5 | 1977 | fixed:4 | control, rtt-aware, latency-aware, aimd, fixed:{2,4,8,16,32,64,128} |
| loop|m5-cpu5-1|pipeline8|off | open0.8 | 3163 | fixed:8 | control, latency-aware, aimd, fixed:{2,8,16,32,64,128} |
| loop|m5-cpu5-1|pipeline8|on | closed2048 | 4282 | fixed:128 | control, rtt-aware, latency-aware, aimd, fixed:{2,4,8,16,32,64,128} |
| loop|m5-cpu5-1|pipeline8|on | open0.5 | 2141 | fixed:4 | control, rtt-aware, aimd, fixed:{4,8,16,32,64,128} |
| loop|m5-cpu5-1|pipeline8|on | open0.8 | 3426 | fixed:2 | control, aimd, fixed:{2,16} |
| loop|m5-cpu5-1|standalone|off | closed2048 | 3857 | control | control, rtt-aware, latency-aware, aimd, fixed:{2,4,8,16,32,64,128} |
| loop|m5-cpu5-1|standalone|off | open0.5 | 1928 | control | control, rtt-aware, latency-aware, aimd, fixed:{2,4,8,16,32,64,128} |
| loop|m5-cpu5-1|standalone|off | open0.8 | 3085 | control | control, rtt-aware, latency-aware, aimd, fixed:{2,4,8,16,32,64,128} |
| loop|m5-cpu5-1|standalone|on | closed2048 | 4340 | fixed:16 | control, rtt-aware, latency-aware, aimd, fixed:{2,4,8,16,32,64,128} |
| loop|m5-cpu5-1|standalone|on | open0.5 | 2170 | control | control |
| loop|m5-cpu5-1|standalone|on | open0.8 | 3472 | fixed:4 | control, rtt-aware, latency-aware, aimd, fixed:{2,4,8,16,32} |
| loop|m6-cpu50-1|pipeline8|off | closed2048 | 3954 | rtt-aware | control, rtt-aware, latency-aware, aimd, fixed:{2,4,8,16,32,64,128} |
| loop|m6-cpu50-1|pipeline8|off | open0.5 | 1977 | fixed:4 | control, rtt-aware, latency-aware, aimd, fixed:{2,4,8,16,32,64,128} |
| loop|m6-cpu50-1|pipeline8|off | open0.8 | 3163 | fixed:8 | control, latency-aware, aimd, fixed:{2,8,16,32,64,128} |
| loop|m6-cpu50-1|pipeline8|on | closed2048 | 4282 | fixed:128 | control, rtt-aware, latency-aware, aimd, fixed:{2,4,8,16,32,64,128} |
| loop|m6-cpu50-1|pipeline8|on | open0.5 | 2141 | fixed:4 | control, rtt-aware, aimd, fixed:{4,8,16,32,64,128} |
| loop|m6-cpu50-1|pipeline8|on | open0.8 | 3426 | fixed:2 | control, aimd, fixed:{2,16} |
| loop|m6-cpu50-1|standalone|off | closed2048 | 3857 | control | control, rtt-aware, latency-aware, aimd, fixed:{2,4,8,16,32,64,128} |
| loop|m6-cpu50-1|standalone|off | open0.5 | 1928 | control | control, rtt-aware, latency-aware, aimd, fixed:{2,4,8,16,32,64,128} |
| loop|m6-cpu50-1|standalone|off | open0.8 | 3085 | control | control, rtt-aware, latency-aware, aimd, fixed:{2,4,8,16,32,64,128} |
| loop|m6-cpu50-1|standalone|on | closed2048 | 4340 | fixed:16 | control, rtt-aware, latency-aware, aimd, fixed:{2,4,8,16,32,64,128} |
| loop|m6-cpu50-1|standalone|on | open0.5 | 2170 | control | control |
| loop|m6-cpu50-1|standalone|on | open0.8 | 3472 | fixed:4 | control, rtt-aware, latency-aware, aimd, fixed:{2,4,8,16,32} |
| ms1|m0-fast|pipeline8|off | closed2048 | 45200 | fixed:8 | rtt-aware, latency-aware, fixed:{8,16,32,64,128} |
| ms1|m0-fast|pipeline8|off | open0.5 | 22599 | fixed:8 | rtt-aware, latency-aware, aimd, fixed:{8,16,32,64,128} |
| ms1|m0-fast|pipeline8|off | open0.8 | 36159 | aimd | rtt-aware, latency-aware, aimd, fixed:{8,16,32,64,128} |
| ms1|m0-fast|pipeline8|on | closed2048 | 55190 | rtt-aware | rtt-aware |
| ms1|m0-fast|pipeline8|on | open0.5 | 27596 | fixed:16 | rtt-aware, latency-aware, aimd, fixed:{8,16,32,64,128} |
| ms1|m0-fast|pipeline8|on | open0.8 | 44154 | fixed:32 | fixed:{32,64,128} |
| ms1|m0-fast|standalone|off | closed2048 | 7460 | control | control, rtt-aware, latency-aware, aimd, fixed:{2,4,8,16,32,64,128} |
| ms1|m0-fast|standalone|off | open0.5 | 3730 | control | control, rtt-aware, latency-aware, aimd, fixed:{2,4,8,16,32,64,128} |
| ms1|m0-fast|standalone|off | open0.8 | 5968 | control | control, rtt-aware, latency-aware, aimd, fixed:{2,4,8,16,32,64,128} |
| ms1|m0-fast|standalone|on | closed2048 | 50940 | rtt-aware | rtt-aware |
| ms1|m0-fast|standalone|on | open0.5 | 25468 | fixed:16 | rtt-aware, latency-aware, aimd, fixed:{8,16,32,64,128} |
| ms1|m0-fast|standalone|on | open0.8 | 40749 | aimd | rtt-aware, latency-aware, aimd, fixed:{16,32,64,128} |
| ms1|m1-sleep5-1|pipeline8|off | closed2048 | 34840 | fixed:8 | latency-aware, fixed:{8,16,32,64,128} |
| ms1|m1-sleep5-1|pipeline8|off | open0.5 | 17422 | fixed:8 | rtt-aware, latency-aware, fixed:{8,16,32,64,128} |
| ms1|m1-sleep5-1|pipeline8|off | open0.8 | 27876 | fixed:8 | latency-aware, fixed:{8,16,32,64,128} |
| ms1|m1-sleep5-1|pipeline8|on | closed2048 | 55110 | rtt-aware | rtt-aware |
| ms1|m1-sleep5-1|pipeline8|on | open0.5 | 27556 | fixed:8 | rtt-aware, latency-aware, aimd, fixed:{8,16,32,64,128} |
| ms1|m1-sleep5-1|pipeline8|on | open0.8 | 44090 | fixed:16 | fixed:{16} |
| ms1|m1-sleep5-1|standalone|off | closed2048 | 7115 | control | control, rtt-aware, latency-aware, aimd, fixed:{2,4,8,16,32,64,128} |
| ms1|m1-sleep5-1|standalone|off | open0.5 | 3558 | control | control, rtt-aware, latency-aware, aimd, fixed:{2,4,8,16,32,64,128} |
| ms1|m1-sleep5-1|standalone|off | open0.8 | 5692 | control | control, rtt-aware, latency-aware, aimd, fixed:{2,4,8,16,32,64,128} |
| ms1|m1-sleep5-1|standalone|on | closed2048 | 51160 | rtt-aware | rtt-aware |
| ms1|m1-sleep5-1|standalone|on | open0.5 | 25580 | fixed:8 | rtt-aware, fixed:{8,16,32,64,128} |
| ms1|m1-sleep5-1|standalone|on | open0.8 | 40927 | fixed:64 | latency-aware, fixed:{16,64,128} |
| ms1|m2-sleep50-1|pipeline8|off | closed2048 | 11730 | aimd | latency-aware, aimd, fixed:{8,16,32,64,128} |
| ms1|m2-sleep50-1|pipeline8|off | open0.5 | 5865 | fixed:8 | latency-aware, fixed:{4,8,16,32,64,128} |
| ms1|m2-sleep50-1|pipeline8|off | open0.8 | 9383 | aimd | latency-aware, aimd, fixed:{8,16,32,64,128} |
| ms1|m2-sleep50-1|pipeline8|on | closed2048 | 15250 | rtt-aware | rtt-aware, latency-aware, fixed:{16,32,64,128} |
| ms1|m2-sleep50-1|pipeline8|on | open0.5 | 7623 | fixed:64 | aimd, fixed:{4,8,16,32,64,128} |
| ms1|m2-sleep50-1|pipeline8|on | open0.8 | 12196 | latency-aware | latency-aware, fixed:{16,32} |
| ms1|m2-sleep50-1|standalone|off | closed2048 | 5145 | control | control, rtt-aware, latency-aware, aimd, fixed:{2,4,8,16,32,64,128} |
| ms1|m2-sleep50-1|standalone|off | open0.5 | 2572 | control | control, rtt-aware, latency-aware, aimd, fixed:{2,4,8,16,32,64,128} |
| ms1|m2-sleep50-1|standalone|off | open0.8 | 4116 | control | control, rtt-aware, latency-aware, aimd, fixed:{2,4,8,16,32,64,128} |
| ms1|m2-sleep50-1|standalone|on | closed2048 | 15300 | rtt-aware | rtt-aware |
| ms1|m2-sleep50-1|standalone|on | open0.5 | 7648 | fixed:4 | fixed:{4} |
| ms1|m2-sleep50-1|standalone|on | open0.8 | 12236 | fixed:16 | latency-aware, aimd, fixed:{16,32} |
| ms1|m3-sleep5-10|pipeline8|off | closed2048 | 10940 | fixed:8 | latency-aware, fixed:{8,16,32,64,128} |
| ms1|m3-sleep5-10|pipeline8|off | open0.5 | 5472 | fixed:8 | latency-aware, fixed:{8,16,32,64,128} |
| ms1|m3-sleep5-10|pipeline8|off | open0.8 | 8754 | fixed:8 | latency-aware, fixed:{8,16,32,64,128} |
| ms1|m3-sleep5-10|pipeline8|on | closed2048 | 13740 | fixed:128 | fixed:{64,128} |
| ms1|m3-sleep5-10|pipeline8|on | open0.5 | 6868 | fixed:8 | fixed:{8,16,32,64,128} |
| ms1|m3-sleep5-10|pipeline8|on | open0.8 | 10988 | fixed:16 | latency-aware, fixed:{16,64,128} |
| ms1|m3-sleep5-10|standalone|off | closed2048 | 4969 | control | control, rtt-aware, latency-aware, aimd, fixed:{2,4,8,16,32,64,128} |
| ms1|m3-sleep5-10|standalone|off | open0.5 | 2485 | control | control, rtt-aware, latency-aware, aimd, fixed:{2,4,8,16,32,64,128} |
| ms1|m3-sleep5-10|standalone|off | open0.8 | 3975 | control | control, rtt-aware, latency-aware, aimd, fixed:{2,4,8,16,32,64,128} |
| ms1|m3-sleep5-10|standalone|on | closed2048 | 13920 | fixed:128 | fixed:{128} |
| ms1|m3-sleep5-10|standalone|on | open0.5 | 6959 | rtt-aware | rtt-aware, fixed:{4} |
| ms1|m3-sleep5-10|standalone|on | open0.8 | 11134 | fixed:8 | fixed:{8} |
| ms1|m4-sleep50-10|pipeline8|off | closed2048 | 1533 | fixed:8 | latency-aware, fixed:{4,8,16,32,64,128} |
| ms1|m4-sleep50-10|pipeline8|off | open0.5 | 767 | fixed:8 | latency-aware, fixed:{2,4,8,16,32,64,128} |
| ms1|m4-sleep50-10|pipeline8|off | open0.8 | 1226 | fixed:4 | latency-aware, fixed:{4,8,16,32,64,128} |
| ms1|m4-sleep50-10|pipeline8|on | closed2048 | 1562 | fixed:64 | rtt-aware, latency-aware, fixed:{4,8,16,32,64,128} |
| ms1|m4-sleep50-10|pipeline8|on | open0.5 | 781 | fixed:2 | rtt-aware, fixed:{2,4} |
| ms1|m4-sleep50-10|pipeline8|on | open0.8 | 1250 | fixed:2 | rtt-aware, latency-aware, aimd, fixed:{2,4,8,16,32,64,128} |
| ms1|m4-sleep50-10|standalone|off | closed2048 | 1333 | control | control, rtt-aware, latency-aware, aimd, fixed:{2,4,8,16,32,64,128} |
| ms1|m4-sleep50-10|standalone|off | open0.5 | 667 | control | control, rtt-aware, latency-aware, aimd, fixed:{2,4,8,16,32,64,128} |
| ms1|m4-sleep50-10|standalone|off | open0.8 | 1066 | control | control, rtt-aware, latency-aware, aimd, fixed:{2,4,8,16,32,64,128} |
| ms1|m4-sleep50-10|standalone|on | closed2048 | 1584 | rtt-aware | rtt-aware, latency-aware, aimd, fixed:{2,4,8,16,32,64,128} |
| ms1|m4-sleep50-10|standalone|on | open0.5 | 792 | control | control |
| ms1|m4-sleep50-10|standalone|on | open0.8 | 1267 | rtt-aware | rtt-aware, aimd, fixed:{4} |
| ms1|m5-cpu5-1|pipeline8|off | closed2048 | 3956 | fixed:2 | rtt-aware, latency-aware, aimd, fixed:{2,4,8,16,32,64,128} |
| ms1|m5-cpu5-1|pipeline8|off | open0.5 | 1978 | fixed:2 | control, rtt-aware, aimd, fixed:{2,4} |
| ms1|m5-cpu5-1|pipeline8|off | open0.8 | 3165 | fixed:2 | control, rtt-aware, latency-aware, aimd, fixed:{2,4,8,16,32,64,128} |
| ms1|m5-cpu5-1|pipeline8|on | closed2048 | 4129 | fixed:64 | rtt-aware, latency-aware, aimd, fixed:{2,4,8,16,32,64,128} |
| ms1|m5-cpu5-1|pipeline8|on | open0.5 | 2064 | rtt-aware | control, rtt-aware, latency-aware, fixed:{2,4,8,16,64,128} |
| ms1|m5-cpu5-1|pipeline8|on | open0.8 | 3303 | control | control, rtt-aware, latency-aware, aimd, fixed:{2,4,8,16} |
| ms1|m5-cpu5-1|standalone|off | closed2048 | 3683 | control | control, rtt-aware, latency-aware, aimd, fixed:{2,4,8,16,32,64,128} |
| ms1|m5-cpu5-1|standalone|off | open0.5 | 1841 | control | control, rtt-aware, latency-aware, aimd, fixed:{2,4,8,16,32,64,128} |
| ms1|m5-cpu5-1|standalone|off | open0.8 | 2946 | control | control, rtt-aware, latency-aware, aimd, fixed:{2,4,8,16,32,64,128} |
| ms1|m5-cpu5-1|standalone|on | closed2048 | 4104 | fixed:16 | control, rtt-aware, latency-aware, aimd, fixed:{2,4,16,32,64,128} |
| ms1|m5-cpu5-1|standalone|on | open0.5 | 2052 | control | control, fixed:{2} |
| ms1|m5-cpu5-1|standalone|on | open0.8 | 3283 | fixed:2 | control, aimd, fixed:{2,4} |
| ms1|m6-cpu50-1|pipeline8|off | closed2048 | 3956 | fixed:2 | rtt-aware, latency-aware, aimd, fixed:{2,4,8,16,32,64,128} |
| ms1|m6-cpu50-1|pipeline8|off | open0.5 | 1978 | fixed:2 | control, rtt-aware, aimd, fixed:{2,4} |
| ms1|m6-cpu50-1|pipeline8|off | open0.8 | 3165 | fixed:2 | control, rtt-aware, latency-aware, aimd, fixed:{2,4,8,16,32,64,128} |
| ms1|m6-cpu50-1|pipeline8|on | closed2048 | 4129 | fixed:64 | rtt-aware, latency-aware, aimd, fixed:{2,4,8,16,32,64,128} |
| ms1|m6-cpu50-1|pipeline8|on | open0.5 | 2064 | rtt-aware | control, rtt-aware, latency-aware, fixed:{2,4,8,16,64,128} |
| ms1|m6-cpu50-1|pipeline8|on | open0.8 | 3303 | control | control, rtt-aware, latency-aware, aimd, fixed:{2,4,8,16} |
| ms1|m6-cpu50-1|standalone|off | closed2048 | 3683 | control | control, rtt-aware, latency-aware, aimd, fixed:{2,4,8,16,32,64,128} |
| ms1|m6-cpu50-1|standalone|off | open0.5 | 1841 | control | control, rtt-aware, latency-aware, aimd, fixed:{2,4,8,16,32,64,128} |
| ms1|m6-cpu50-1|standalone|off | open0.8 | 2946 | control | control, rtt-aware, latency-aware, aimd, fixed:{2,4,8,16,32,64,128} |
| ms1|m6-cpu50-1|standalone|on | closed2048 | 4104 | fixed:16 | control, rtt-aware, latency-aware, aimd, fixed:{2,4,16,32,64,128} |
| ms1|m6-cpu50-1|standalone|on | open0.5 | 2052 | control | control, fixed:{2} |
| ms1|m6-cpu50-1|standalone|on | open0.8 | 3283 | fixed:2 | control, aimd, fixed:{2,4} |
