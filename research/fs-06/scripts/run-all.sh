#!/usr/bin/env bash
# Runs the study for every local pooler configuration, one at a time. Usage: scripts/run-all.sh [target-id ...]
set -u
cd "$(dirname "$0")/.."
TARGETS=("$@")
if [ ${#TARGETS[@]} -eq 0 ]; then
  TARGETS=(supavisor-default supavisor-on supavisor-session pgbouncer-default pgbouncer-on pgbouncer-off pgbouncer-session odyssey-default odyssey-on odyssey-off odyssey-session pgdog-default pgdog-extended pgdog-extended_anonymous pgdog-disabled pgdog-session)
fi
for t in "${TARGETS[@]}"; do
  echo "=== $t $(date -u +%T)"
  timeout 600 bun scripts/run-target.ts "$t" 2>&1 | tail -3
done
echo "=== done $(date -u +%T)"
