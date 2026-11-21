#!/usr/bin/env bash
# PgBouncer 1.26.0's changelog lists "Fix sending a duplicate NegotiateProtocolVersion message when no server was
# available right away (#1460)". The matrix always starts a pool with R0, so this engineers the cold-pool case:
# restart the container (no server connection, no cached welcome message), then make R1 / R3 / R5 the first-ever
# client of database s19, and print every NegotiateProtocolVersion the probe saw.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
set -a; . "$HERE/work/run.env"; set +a
cd "$HERE"
source <(sed -n '/^wait_port()/,/^}/p' scripts/lab.sh)
for spec in 1.22.1:6122 1.23.1:6123 1.26.1:6126; do
  ver=${spec%%:*}; port=${spec##*:}
  for req in R1 R3 R5; do
    docker restart "fs02-pgb$ver" >/dev/null
    wait_port "$port"
    printf 'PgBouncer %s, cold pool, first request %s: ' "$ver" "$req"
    bun scripts/probe.ts --host 127.0.0.1 --port "$port" --user fs02 --database s19 --id "pgbouncer-$ver-cold" --requests "$req" --json \
      | python3 -I -c 'import json,sys; c=json.load(sys.stdin)[0]; print(c["class"], "| negotiations:", [(n["version"], n["options"], "late" if n["late"] else "early") for n in c["negotiations"]], "|", c["classReason"][:90])'
  done
done

# second engineered condition: the backend is down (stopped), so no server is available at all
docker stop fs02-be19 >/dev/null
for spec in 1.22.1:6122 1.23.1:6123 1.26.1:6126; do
  ver=${spec%%:*}; port=${spec##*:}
  for req in R1 R3; do
    printf 'PgBouncer %s, backend stopped, request %s: ' "$ver" "$req"
    bun scripts/probe.ts --host 127.0.0.1 --port "$port" --user fs02 --database s19 --id "pgbouncer-$ver-down" --requests "$req" --timeout 5000 --json \
      | python3 -I -c 'import json,sys; c=json.load(sys.stdin)[0]; print(c["class"], "| negotiations:", [(n["version"], n["options"], "late" if n["late"] else "early") for n in c["negotiations"]], "|", c["classReason"][:120], "|", (c["error"] or {}).get("message", "")[:80])'
  done
done
docker start fs02-be19 >/dev/null
for i in $(seq 1 40); do docker exec fs02-be19 pg_isready -U fs02 -d fs02 -h 127.0.0.1 >/dev/null 2>&1 && break; sleep 1; done
