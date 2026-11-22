| path | statements/s at saturation, off (control) | on (best config) | on / off | rate | p99.9 ms, sharing off (control) | p99.9 ms, sharing on: control | fixed:16 | rtt-aware | note |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| loop | 31640 | 48720 (fixed:64) | 1.54 | 17598 | 9.4 (4.4-40.8) | 14.8 (5.9-40.2) | 6.5 (4.4-8.1) | 6.8 (5.1-15.4) |  |
| loop | 31640 | 48720 (fixed:64) | 1.54 | 28156 | 19.3 (9.4-48.8) | 16.8 (12.5-27.3) | 7.7 (5.2-17.7) | 15.8 (7.0-46.2) |  |
| d4 | 1676 | 62790 (rtt-aware) | 37.46 | 838 | 8.9 (7.8-20.7) | 10.9 (9.6-22.4) | 9.9 (7.8-15.3) | 9.6 (8.5-59.6) | indicative (fewer than 100,000 fast statements) |
| d4 | 1676 | 62790 (rtt-aware) | 37.46 | 1341 | 12.9 (11.6-16.1) | 15.2 (13.3-19.9) | 9.1 (8.3-12.7) | 10.9 (7.1-19.3) | indicative (fewer than 100,000 fast statements) |
| d20 | 411 | 47760 (rtt-aware) | 116.29 | 205 | 34.3 (29.1-75.5) | 30.9 (29.6-40.5) | 28.6 (24.0-43.9) | 35.3 (23.8-44.2) | indicative (fewer than 100,000 fast statements) |
| d20 | 411 | 47760 (rtt-aware) | 116.29 | 329 | 48.5 (45.5-80.9) | 49.9 (45.2-51.9) | 24.2 (23.4-44.3) | 24.0 (23.4-25.5) | indicative (fewer than 100,000 fast statements) |
