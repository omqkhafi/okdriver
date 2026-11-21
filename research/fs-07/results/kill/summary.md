# Killing the connection in the middle of a pipelined batch

300 autocommit inserts were written in one write; `KILL CONNECTION` followed a few milliseconds later. Per run: responses the client received before the loss / rows the server had committed.

| server | run 1 | run 2 | run 3 | run 4 | run 5 | committed set always a prefix of the sent order |
| --- | --- | --- | --- | --- | --- | --- |
| my84 | 14/15 | 13/13 | 18/19 | 24/25 | 34/35 | yes |
| my97 | 17/18 | 18/19 | 24/25 | 30/31 | 36/37 | yes |
| my2610 | 12/13 | 20/21 | 20/21 | 26/27 | 33/34 | yes |
| ma106 | 14/14 | 45/46 | 76/77 | 89/90 | 129/130 | yes |
| ma1011 | 25/26 | 58/59 | 66/67 | 76/77 | 97/97 | yes |
| ma114 | 59/60 | 53/54 | 72/73 | 100/100 | 120/121 | yes |
| ma118 | 23/24 | 53/54 | 85/86 | 68/69 | 164/165 | yes |
| ma123 | 69/70 | 65/66 | 63/64 | 60/60 | 145/146 | yes |
| ma130 | 60/61 | 79/80 | 32/33 | 104/105 | 137/138 | yes |
