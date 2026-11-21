### Reproduced, per config: median (min–max) of 3 runs, at the 600-VU step

| config | rps | p95 ms | p99 ms | server µs/req | Postgres µs/req | rest µs/req | total µs/req | server CPU % | Postgres CPU % | other CPU % (load gen) | idle CPU % |
|---|---|---|---|---|---|---|---|---|---|---|---|
| drizzle-bun14-bunsql | 3189 (3189–3190) | 1.3 (1.2–1.4) | 2.4 (2.4–2.6) | 137 (131–141) | 144 (140–150) | 134 (128–137) | 414 (399–428) | 44 (42–45) | 46 (45–47) | 27 (26–27) | 279 (276–283) |
| drizzle-bun14-drizzle | 3190 (3187–3191) | 1.3 (1.1–1.5) | 2.5 (2.5–2.8) | 139 (134–149) | 137 (126–142) | 130 (122–136) | 399 (390–426) | 44 (42–48) | 44 (40–46) | 25 (24–27) | 283 (273–288) |
| drizzle-node24-drizzle | 3188 (3186–3189) | 1.3 (1.1–1.6) | 2.5 (2.3–3.0) | 161 (140–181) | 138 (123–153) | 138 (111–145) | 438 (374–480) | 52 (45–58) | 44 (39–49) | 28 (23–28) | 272 (260–289) |
| drizzle-node24-drizzle-nopipe | 3185 (3179–3188) | 1.8 (1.3–2.3) | 3.1 (2.4–4.6) | 225 (167–226) | 177 (147–178) | 158 (134–173) | 561 (448–576) | 71 (53–71) | 56 (47–56) | 32 (26–37) | 234 (228–269) |
| drizzle-node24-pg | 3186 (3182–3186) | 1.7 (1.6–2.1) | 3.0 (3.0–3.8) | 177 (172–227) | 141 (135–169) | 125 (125–155) | 442 (432–550) | 56 (55–71) | 45 (43–53) | 25 (24–30) | 269 (239–273) |
| kysely-node24-drizzle | 3187 (3186–3189) | 1.8 (1.7–2.0) | 3.8 (3.3–3.8) | 196 (195–204) | 148 (147–152) | 142 (139–143) | 485 (481–499) | 63 (62–65) | 47 (47–48) | 28 (28–29) | 256 (252–257) |
| kysely-node24-pg | 3181 (3179–3184) | 2.3 (2.2–2.7) | 4.2 (3.7–5.1) | 192 (191–231) | 287 (285–326) | 137 (134–157) | 615 (612–714) | 61 (61–73) | 91 (90–104) | 27 (27–32) | 216 (184–216) |
| kysely-node24-postgresjs | 3181 (3180–3184) | 2.3 (1.8–2.4) | 4.4 (3.0–5.0) | 252 (244–310) | 172 (172–190) | 146 (146–171) | 569 (562–671) | 80 (77–99) | 55 (54–61) | 29 (28–33) | 232 (199–234) |

### Published (orm.drizzle.team/benchmarks data, 2026-11-20), same step logic

| config | peak rps (at VUs) | at 600 VUs: rps | p95 ms | p99 ms | machine CPU µs/req (all 4 cores) |
|---|---|---|---|---|---|
| drizzle-node24-pg | 13852 (3300) | 3175 | 3.7 | 8.8 | 666 |
| drizzle-node24-drizzle | 21651 (4800) | 3179 | 2.8 | 6.9 | 654 |
| drizzle-bun14-bunsql | 22571 (4500) | 3180 | 2.2 | 6.2 | 639 |
| drizzle-bun14-drizzle | 22533 (4500) | 3180 | 2.9 | 6.6 | 677 |

### Ratios A / B at 600 VUs (reproduced = ratio of medians; published where a series exists; flag = more than 25% apart)

| A / B | rps | p95 | p99 | server µs/req | total µs/req (ours) vs machine µs/req (published) | flag |
|---|---|---|---|---|---|---|
| drizzle-node24-drizzle / drizzle-node24-pg | 1.00 | 0.76 | 0.83 | 0.91 | 0.99 (published: rps 1.00, p95 0.76, p99 0.78, CPU 0.98) | within 25% |
| drizzle-bun14-drizzle / drizzle-bun14-bunsql | 1.00 | 1.00 | 1.04 | 1.01 | 0.96 (published: rps 1.00, p95 1.28, p99 1.08, CPU 1.06) | within 25% |
| drizzle-node24-drizzle-nopipe / drizzle-node24-pg | 1.00 | 1.06 | 1.03 | 1.27 | 1.27 | no published series |
| drizzle-node24-drizzle / drizzle-node24-drizzle-nopipe | 1.00 | 0.72 | 0.81 | 0.72 | 0.78 | no published series |
| kysely-node24-drizzle / kysely-node24-pg | 1.00 | 0.78 | 0.90 | 1.02 | 0.79 | no published series |
| kysely-node24-postgresjs / kysely-node24-pg | 1.00 | 1.00 | 1.05 | 1.31 | 0.93 | no published series |
| kysely-node24-drizzle / kysely-node24-postgresjs | 1.00 | 0.78 | 0.86 | 0.78 | 0.85 | no published series |

Published peak-rps ratios (not reproducible with the 100,000-request profile, which ends before saturation): node24 drizzle/pg 1.56, bun14 drizzle/bunsql 1.00.
