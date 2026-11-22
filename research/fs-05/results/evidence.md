## In-flight depth: byte trace against the policy's own counter

Largest depth seen over all traced runs (proxy: Syncs forwarded minus ReadyForQuery delivered, per connection; policy: the pool's in-flight count at each write).

| config | traced runs | max depth, trace | max depth, policy counter |
| --- | --- | --- | --- |
| aimd | 125 | 128 | 128 |
| control | 170 | 1 | 1 |
| fixed:16 | 125 | 16 | 16 |
| fixed:4 | 125 | 4 | 4 |
| fixed:64 | 125 | 64 | 64 |
| latency-aware | 170 | 16 | 16 |
| rtt-aware | 125 | 128 | 128 |

Syncs minus ReadyForQuery at the end of closed-loop traced runs (statements still on the wire when the connections were closed): median -41, max -2 over 400 runs.

## Correctness gate (1% of fast statements divide by zero)

56 runs (7 configs x sharing on/off x standalone/pipeline8 x loopback/20 ms), 1551610 statements completed in the windows, 18148 errors received as 22012. Runs with any defect (wrong result, unexpected error, wrong error, mismatch, misorder): **0**.


## Stuck connection (advisory lock holds one backend for 3 s; arrivals continue)

Fast statements by scheduled time: before = 1 s to 3 s, during = 3 s to 6 s, after = 6 s to 9 s. Medians over 3 runs. `victims` = fast statements slower than 100 ms. `stuck conn syncs` = statements sent to the blocked connection while it was blocked, against the mean of the other connections. `after share` = the same connection after the release, against the others.

| path | sharing | config | p99.9 before | p99.9 during | p99.9 after | victims | stuck conn syncs / others | after share | in flight on stuck conn at release |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| loopT | on | control | 7.7 | 6.5 | 4.4 | 0 | 1 / 2995 | 2749 / 2622 | 1 |
| loopT | on | fixed:4 | 3.6 | 6.3 | 4.2 | 3 | 3 / 2994 | 3691 / 2536 | 4 |
| loopT | on | fixed:16 | 4.0 | 4.9 | 5.9 | 5 | 5 / 2994 | 2271 / 2679 | 6 |
| loopT | on | fixed:64 | 4.6 | 5.0 | 3.6 | 4 | 4 / 2994 | 2273 / 2711 | 5 |
| loopT | on | rtt-aware | 4.8 | 4.3 | 9.2 | 3 | 3 / 2994 | 1945 / 2728 | 4 |
| loopT | on | latency-aware | 3.5 | 4.8 | 3.4 | 15 | 15 / 2992 | 0 / 2966 | 16 |
| loopT | on | aimd | 3.6 | 5.7 | 5.1 | 0 | 0 / 2995 | 2654 / 2653 | 1 |
| loopT | off | control | 3.8 | 5.3 | 4.1 | 0 | 1 / 2994 | 3090 / 2580 | 1 |
| loopT | off | fixed:4 | 4.0 | 4.5 | 3.4 | 0 | 1 / 2994 | 2917 / 2602 | 1 |
| loopT | off | fixed:16 | 4.3 | 3.5 | 4.4 | 0 | 1 / 2994 | 3133 / 2584 | 1 |
| loopT | off | fixed:64 | 6.2 | 7.4 | 4.8 | 0 | 0 / 2995 | 2421 / 2664 | 1 |
| loopT | off | rtt-aware | 3.7 | 3.7 | 4.0 | 0 | 1 / 2994 | 2869 / 2593 | 1 |
| loopT | off | latency-aware | 4.2 | 3.7 | 4.0 | 0 | 1 / 2994 | 2982 / 2594 | 1 |
| loopT | off | aimd | 3.5 | 3.4 | 4.0 | 0 | 1 / 2995 | 2410 / 2661 | 1 |
| d20 | on | control | 10367.3 | n/a | n/a | 0 | n/a / n/a | n/a / n/a | n/a |
| d20 | on | fixed:4 | 2415.9 | 4806.5 | 5350.8 | 10906 | 508 / 550 | 1253 / 1099 | 4 |
| d20 | on | fixed:16 | 23.2 | 2919.9 | 22.6 | 11 | 11 / 1109 | 1143 / 990 | 12 |
| d20 | on | fixed:64 | 24.9 | 2922.6 | 24.5 | 11 | 11 / 1110 | 1128 / 981 | 12 |
| d20 | on | rtt-aware | 23.1 | 2916.0 | 37.2 | 10 | 10 / 1110 | 1097 / 990 | 11 |
| d20 | on | latency-aware | 22.2 | 2978.0 | 22.9 | 15 | 15 / 1109 | 0 / 1127 | 16 |
| d20 | on | aimd | 22.8 | 2978.7 | 22.5 | 11 | 11 / 1110 | 1159 / 981 | 12 |
| d20 | off | control | 28.2 | 31.6 | 27.8 | 0 | 0 / 56 | 87 / 48 | 1 |
| d20 | off | fixed:4 | 28.7 | 31.7 | 26.7 | 0 | 0 / 56 | 83 / 48 | 1 |
| d20 | off | fixed:16 | 27.7 | 31.1 | 26.9 | 0 | 0 / 56 | 83 / 49 | 1 |
| d20 | off | fixed:64 | 27.1 | 31.3 | 27.5 | 0 | 0 / 56 | 85 / 48 | 1 |
| d20 | off | rtt-aware | 26.8 | 30.7 | 26.9 | 0 | 0 / 56 | 66 / 48 | 1 |
| d20 | off | latency-aware | 27.7 | 32.0 | 29.0 | 0 | 0 / 56 | 7 / 54 | 1 |
| d20 | off | aimd | 27.6 | 31.1 | 27.3 | 0 | 0 / 56 | 83 / 48 | 1 |

## Connection killed mid-run (pg_terminate_backend, no automatic retry)

`lost, pool` = statements the pool had written and not completed when it learned the connection was closed. `lost, trace` = Syncs the proxy forwarded for that connection minus ReadyForQuery it delivered, at the end of the run (independent of the pool; a response that was already on its way back when the backend died counts as delivered). `at close, proxy` = the same difference at the moment the server side closed, which also counts responses still in the delay line. `not sent` = statements of a caller's pipeline assigned to the connection but not yet written. Statements waiting in the pool queue are unassigned and go to other connections.

| path | shape | sharing | config | in flight before kill | lost, pool | lost, trace | at close, proxy | not sent |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| d20 | pipeline8 | off | aimd | 0 | 0 | 0 | 0 | 0 |
| d20 | pipeline8 | off | control | 0 | 0 | 0 | 0 | 0 |
| d20 | pipeline8 | off | fixed:16 | 0 | 0 | 0 | 0 | 0 |
| d20 | pipeline8 | off | fixed:4 | 0 | 0 | 0 | 0 | 0 |
| d20 | pipeline8 | off | fixed:64 | 0 | 0 | 0 | 0 | 0 |
| d20 | pipeline8 | off | latency-aware | 0 | 0 | 0 | 0 | 0 |
| d20 | pipeline8 | off | rtt-aware | 0 | 0 | 0 | 0 | 0 |
| d20 | pipeline8 | on | aimd | 8 | 8 | 8 | 8 | 0 |
| d20 | pipeline8 | on | control | 1 | 1 | 1 | 1 | 6 |
| d20 | pipeline8 | on | fixed:16 | 8 | 8 | 8 | 8 | 0 |
| d20 | pipeline8 | on | fixed:4 | 4 | 4 | 4 | 4 | 0 |
| d20 | pipeline8 | on | fixed:64 | 8 | 8 | 8 | 8 | 0 |
| d20 | pipeline8 | on | latency-aware | 8 | 8 | 8 | 8 | 0 |
| d20 | pipeline8 | on | rtt-aware | 8 | 0 | 0 | 8 | 0 |
| d20 | standalone | on | aimd | 8 | 8 | 8 | 4 | 0 |
| d20 | standalone | on | control | 1 | 1 | 1 | 1 | 0 |
| d20 | standalone | on | fixed:16 | 7 | 7 | 7 | 7 | 0 |
| d20 | standalone | on | fixed:4 | 4 | 4 | 4 | 4 | 0 |
| d20 | standalone | on | fixed:64 | 7 | 8 | 8 | 8 | 0 |
| d20 | standalone | on | latency-aware | 7 | 8 | 8 | 7 | 0 |
| d20 | standalone | on | rtt-aware | 8 | 8 | 8 | 8 | 0 |
| loopT | pipeline8 | off | aimd | 0 | 2 | 2 | 2 | 6 |
| loopT | pipeline8 | off | control | 1 | 1 | 1 | 1 | 6 |
| loopT | pipeline8 | off | fixed:16 | 0 | 8 | 8 | 0 | 0 |
| loopT | pipeline8 | off | fixed:4 | 0 | 4 | 4 | 4 | 4 |
| loopT | pipeline8 | off | fixed:64 | 0 | 8 | 8 | 8 | 0 |
| loopT | pipeline8 | off | latency-aware | 0 | 0 | 0 | 0 | 0 |
| loopT | pipeline8 | off | rtt-aware | 0 | 5 | 5 | 0 | 3 |
| loopT | pipeline8 | on | aimd | 1 | 1 | 1 | 1 | 6 |
| loopT | pipeline8 | on | control | 0 | 1 | 1 | 1 | 7 |
| loopT | pipeline8 | on | fixed:16 | 0 | 8 | 8 | 8 | 0 |
| loopT | pipeline8 | on | fixed:4 | 0 | 4 | 4 | 4 | 4 |
| loopT | pipeline8 | on | fixed:64 | 0 | 8 | 8 | 8 | 0 |
| loopT | pipeline8 | on | latency-aware | 0 | 0 | 0 | 0 | 0 |
| loopT | pipeline8 | on | rtt-aware | 0 | 5 | 5 | 4 | 3 |
| loopT | standalone | on | aimd | 1 | 1 | 1 | 1 | 0 |
| loopT | standalone | on | control | 1 | 1 | 1 | 1 | 0 |
| loopT | standalone | on | fixed:16 | 1 | 2 | 2 | 2 | 0 |
| loopT | standalone | on | fixed:4 | 1 | 3 | 3 | 1 | 0 |
| loopT | standalone | on | fixed:64 | 1 | 2 | 2 | 2 | 0 |
| loopT | standalone | on | latency-aware | 1 | 4 | 4 | 2 | 0 |
| loopT | standalone | on | rtt-aware | 1 | 2 | 2 | 2 | 0 |
