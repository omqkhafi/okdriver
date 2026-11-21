#!/usr/bin/env bash
# Three rounds over all configs (round-robin, so drift hits every config alike). Each run starts a fresh
# server, runs the bench (10 s unrecorded warm-up, then 100,000 requests), stops the server, cools down.
# Usage: run.sh [rounds] [config-name-glob]
set -euo pipefail
. "$(dirname "$0")/env.sh"; . "$(dirname "$0")/configs.sh"; . "$(dirname "$0")/lib.sh"
ROUNDS=${1:-3}; FILTER=${2:-*}
mkdir -p "$RESULTS/runs" "$HARNESS/results"
for round in $(seq 1 "$ROUNDS"); do
  for line in "${CONFIGS[@]}"; do
    name="${line%%|*}"
    # shellcheck disable=SC2254
    case "$name" in $FILTER) ;; *) continue;; esac
    run="$name-r$round"
    echo "=== $run $(date -u +%H:%M:%S)"
    start_server "$line"
    # --procs is the bench's own flag for what the matrix runner calls --cpu: CPU per process group from /stats/procs.
    ( cd "$HARNESS" && "$LOADGEN" bench/index.ts "http://localhost:$PORT" "$run" --requests "$REQUESTS" --procs ) > "$RESULTS/runs/$run.txt" 2>&1 || echo "run $run failed" >&2
    stop_server
    tail -8 "$RESULTS/runs/$run.txt" | grep -E "requests|latency|failed" || true
    sleep "$COOLDOWN"
  done
done
