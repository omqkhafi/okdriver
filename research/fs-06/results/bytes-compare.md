# Bytes: harness vs `pg` vs `postgres` (postgres.js)

Statement `SELECT $1::int AS n`, parameter 7, captured by the client-side proxy against Postgres directly (no pooler, no delay). Each row is one TCP flush from the client; letters are frontend message types (P Parse, B Bind, D Describe, E Execute, S Sync, Q Query, X Terminate, C Close).

## harness named

| flush | messages | detail |
| --- | --- | --- |
| 1 | P B D(P) E S | Parse name=`fs06_bytes` sql=`SELECT $1::int AS n` |
| 2 | X |  |

## harness unnamed

| flush | messages | detail |
| --- | --- | --- |
| 1 | P B D(P) E S | Parse name=`` sql=`SELECT $1::int AS n` |
| 2 | X |  |

## pg named

| flush | messages | detail |
| --- | --- | --- |
| 1 | P B D(P) E S | Parse name=`fs06_bytes` sql=`SELECT $1::int AS n` |
| 2 | X |  |

Byte-identical to the harness: P yes, B no, D yes, E yes, S yes; same frame order: true.

## pg unnamed

| flush | messages | detail |
| --- | --- | --- |
| 1 | P B D(P) E S | Parse name=`` sql=`SELECT $1::int AS n` |
| 2 | X |  |

Byte-identical to the harness: P yes, B no, D yes, E yes, S yes; same frame order: true.

## postgres.js named

| flush | messages | detail |
| --- | --- | --- |
| 1 | P D(S) B E S | Parse name=`end17g1q1` sql=`SELECT $1::int AS n` |
| 2 | X |  |

Byte-identical to the harness: P no, B no, D no, E yes, S yes; same frame order: false.

## postgres.js unnamed

| flush | messages | detail |
| --- | --- | --- |
| 1 | P D(S) B E S | Parse name=`` sql=`SELECT $1::int AS n` |
| 2 | X |  |

Byte-identical to the harness: P no, B yes, D no, E yes, S yes; same frame order: false.

