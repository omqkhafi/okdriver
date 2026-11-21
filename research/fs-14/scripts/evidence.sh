#!/usr/bin/env bash
# Independent evidence for the technique table: for each config, run a short load through a protocol-trace proxy
# (scripts/pgtrace.ts) while Postgres logs every statement phase, then summarise both. Not a benchmark: the proxy
# and the logging slow everything down. Run it when nothing else is using the machine.
set -euo pipefail
. "$(dirname "$0")/env.sh"; . "$(dirname "$0")/configs.sh"; . "$(dirname "$0")/lib.sh"
EV="$RESULTS/evidence"; mkdir -p "$EV"
N=${1:-20000}; TRACE_PORT=5436
# EV_FILTER: config-name glob. EV_BENCH: bench arguments (default: --requests N --no-warmup). EV_TAG: output prefix.
FILTER=${EV_FILTER:-*}; BENCH_ARGS=${EV_BENCH:---requests $N --no-warmup}; TAG=${EV_TAG:-}
PSQL=(env PGPASSWORD=postgres psql -h localhost -p $PG_PORT -U postgres -qAt)
PGLOG=${EV_PGLOG:-1}   # 0: trace only (a heavy profile makes the server log too large to read)
[ "$PGLOG" = 1 ] && "${PSQL[@]}" -c "ALTER SYSTEM SET log_min_duration_statement = 0" -c "ALTER SYSTEM SET log_line_prefix = '%p|'" -c "SELECT pg_reload_conf()" >/dev/null
trap '"${PSQL[@]}" -c "ALTER SYSTEM RESET log_min_duration_statement" -c "ALTER SYSTEM RESET log_line_prefix" -c "SELECT pg_reload_conf()" >/dev/null; pkill -f pgtrace.ts || true' EXIT
for line in "${CONFIGS[@]}"; do
  name="${line%%|*}"
  case "$name" in $FILTER) ;; *) continue;; esac
  node "$(dirname "$0")/pgtrace.ts" $TRACE_PORT $PG_PORT "$EV/$TAG$name.trace.json" & TP=$!
  sleep 1
  since=$(date -u +%Y-%m-%dT%H:%M:%S.%NZ)
  export DATABASE_URL="postgres://postgres:postgres@127.0.0.1:$TRACE_PORT/postgres"
  start_server "$line"
  ( cd "$HARNESS" && "$LOADGEN" bench/index.ts "http://localhost:$PORT" "ev-$TAG$name" $BENCH_ARGS ) > "$EV/$TAG$name.bench.txt" 2>&1 || true
  stop_server
  kill -TERM $TP; wait $TP || true
  unset DATABASE_URL
  [ "$PGLOG" = 1 ] || continue
  docker logs --since "$since" drizzle-benchmarks-pg2 2>&1 | node "$(dirname "$0")/pglog-summary.ts" > "$EV/$TAG$name.pglog.json"
  echo "$name: $(tr -d ' \n' < "$EV/$TAG$name.pglog.json" | cut -c1-200)"
done
