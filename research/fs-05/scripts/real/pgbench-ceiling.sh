#!/usr/bin/env bash
# Independent server ceiling: pgbench inside the Postgres container (same two cores, so client and server share them: a lower bound of
# the server alone). One point lookup per transaction on kv, 8 clients, extended protocol; simple and prepared for comparison.
set -euo pipefail
cd "$(dirname "$0")/../.."
mkdir -p work
printf '\\set id random(0, 99999)\nselect v from kv where id = :id;\n' > work/lookup.sql
docker cp work/lookup.sql fs05-pg:/tmp/lookup.sql
for m in simple extended prepared; do
  for c in 8 32; do
    echo "mode=$m clients=$c $(docker exec fs05-pg pgbench -h 127.0.0.1 -p 55432 -U fs05 -n -f /tmp/lookup.sql -M $m -c $c -j 1 -T 8 fs05 2>&1 | grep -E '^tps' | head -1)"
  done
done | tee results/pgbench.txt
