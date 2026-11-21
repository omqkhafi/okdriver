#### Benchmark-profile trace (20,000 requests per config, 16 backends = 2 processes x 8 connections)

| config | Parse (named / unnamed) | distinct named statements | most Parses of one name on one backend | Bind | Describe | result formats (per Bind) | param formats (per Bind) | max statements in flight on a connection | share of statements sent behind another |
|---|---|---|---|---|---|---|---|---|---|
| drizzle-node24-pg | 175 / 0 | 11 | 1 | 20000 | P 20000 | text 20000 | text 20000 | 1 | 0.00% |
| drizzle-node24-drizzle | 135 / 0 | 11 | 1 | 20000 | S 135 | mixed 20000 | text 5555, mixed 13616, binary 829 | 1 | 0.00% |
| drizzle-node24-drizzle-nopipe | 173 / 0 | 11 | 1 | 20000 | S 173 | mixed 20000 | text 5593, mixed 13606, binary 801 | 1 | 0.00% |
| drizzle-bun14-bunsql | 140 / 0 | 11 | 1 | 20000 | S 140 | mixed 20000 | text 5436, mixed 13686, binary 878 | 2 | 0.07% |
| drizzle-bun14-drizzle | 126 / 0 | 11 | 1 | 20000 | S 127 | mixed 20000 | text 5547, mixed 13617, binary 836 | 2 | 0.04% |
| kysely-node24-pg | 0 / 20000 | 0 | 0 | 20000 | P 20000 | text 20000 | text 20000 | 1 | 0.00% |
| kysely-node24-postgresjs | 192 / 0 | 192 | 1 | 20016 | S 192 | text 20016 | text 20000 | 1 | 0.00% |
| kysely-node24-drizzle | 127 / 0 | 11 | 1 | 20000 | S 127 | text 127, mixed 19873 | text 127, binary 19873 | 1 | 0.00% |

(Parse counts come from the Postgres log, the rest from the protocol trace; both columns of Parse agree with the trace.)

#### Heavier profile through the trace proxy (`--quick`, 500 to 3000 VUs; not a benchmark)

| config | max statements in flight on a connection (per connection) | share of statements sent behind another | largest Syncs in one TCP write |
|---|---|---|---|
| drizzle-node24-pg | 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 | 0.00% | 1 |
| drizzle-node24-drizzle | 56 56 50 65 63 47 56 61 64 66 63 61 67 52 56 56 | 24.71% | 66 |
| drizzle-node24-drizzle-nopipe | 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 | 0.00% | 1 |

#### Depth probe: 400 concurrent single-row lookups over a pool of 2 connections

| variant | connections used | max statements in flight per connection | largest Syncs in one TCP write | Parse | Bind |
|---|---|---|---|---|---|
| drizzle | 2 | 99, 100 | 100 | 2 | 401 |
| drizzle-depth4 | 2 | 4, 4 | 4 | 2 | 401 |
| drizzle-off | 2 | 1, 1 | 1 | 2 | 401 |
| pg | 2 | 1, 1 | 1 | 2 | 400 |
| bunsql | 2 | 200, 200 | 200 | 2 | 400 |
