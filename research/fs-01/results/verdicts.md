| Contract | Verdict | Platform branch hits | Engines using | Classes using without a shim | Structural fit | Overhead on its rung | Why not Adopt |
|---|---|---|---|---|---|---|---|
| Engine descriptor + capability model | **Engine-owned** | 0 | postgres, mysql, mariadb, sqlite, libsql | wire, embedded (2) | fits | 5-full: inconclusive (direct spread above 15%) | shim in class service; overhead: 5-full: inconclusive (direct spread above 15%) |
| WireCore | **Engine-owned** | 3 | postgres, mysql, mariadb | wire (1) | does not fit | 2-wirecore: inconclusive (direct spread above 15%) | 3 branch hit(s) by the counting rule; used by 1 engine class(es) without a shim (wire); two needed; overhead: 2-wirecore: inconclusive (direct spread above 15%) |
| EmbeddedCore | **Engine-owned** | 3 | sqlite | embedded (1) | does not fit | no PostgreSQL rung (not on that hot path) | 3 branch hit(s) by the counting rule; used by 1 engine class(es) without a shim (embedded); two needed |
| ServiceCore | **Engine-owned** | 2 | libsql | service (1) | does not fit | no PostgreSQL rung (not on that hot path) | 2 branch hit(s) by the counting rule; used by 1 engine class(es) without a shim (service); two needed |
| ExecutionCoordinator | **Engine-owned** | 0 | postgres, mysql, mariadb, sqlite, libsql | wire, embedded, service (3) | fits | 4-coord-pool: inconclusive (direct spread above 15%) | overhead: 4-coord-pool: inconclusive (direct spread above 15%) |
| ConnectionPool | **Engine-owned** | 0 | postgres, mysql, mariadb | wire (1) | does not fit | 4-coord-pool: inconclusive (direct spread above 15%) | used by 1 engine class(es) without a shim (wire); two needed; overhead: 4-coord-pool: inconclusive (direct spread above 15%) |
| Transport | **Engine-owned** | 1 | postgres, mysql, mariadb, libsql | wire (1) | does not fit | 3-transport: inconclusive (direct spread above 15%) | 1 branch hit(s) by the counting rule; used by 1 engine class(es) without a shim (wire); two needed; shim in class service; overhead: 3-transport: inconclusive (direct spread above 15%) |
| Error taxonomy + ErrorMapper | **Engine-owned** | 0 | postgres, mysql, mariadb, sqlite, libsql | wire, embedded, service (3) | fits | 5-full: inconclusive (direct spread above 15%) | overhead: 5-full: inconclusive (direct spread above 15%) |
| CodecRegistry | **Engine-owned** | 0 | postgres, mysql, mariadb, sqlite, libsql | wire, service (2) | fits | 5-full: inconclusive (direct spread above 15%) | shim in class embedded; overhead: 5-full: inconclusive (direct spread above 15%) |

Added by this study (not in the row's list, same rule):

| Contract | Verdict | Platform branch hits | Engines using | Classes using without a shim | Structural fit | Overhead on its rung | Why not Adopt |
|---|---|---|---|---|---|---|---|
| Session (added in this study) | **Engine-owned** | 0 | postgres, mysql, mariadb, sqlite, libsql | wire, embedded, service (3) | fits | 5-full: inconclusive (direct spread above 15%) | overhead: 5-full: inconclusive (direct spread above 15%) |

Entry composition (not platform code, reported apart): 1 class switch(es): entry/compose.ts:55.
