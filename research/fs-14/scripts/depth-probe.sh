#!/usr/bin/env bash
# Run depth-probe.ts for each variant through the trace proxy; writes results/evidence/depth-<variant>.json.
set -euo pipefail
. "$(dirname "$0")/env.sh"
EV="$RESULTS/evidence"; mkdir -p "$EV"; export HARNESS
for v in drizzle drizzle-depth4 drizzle-off pg bunsql; do
  node "$(dirname "$0")/pgtrace.ts" 5437 $PG_PORT "$EV/depth-$v.json" & TP=$!
  sleep 1
  URL="postgres://postgres:postgres@127.0.0.1:5437/postgres"
  if [ "$v" = bunsql ]; then bun "$(dirname "$0")/depth-probe.ts" $v "$URL" 400 2 > "$EV/depth-$v.out" 2>&1
  else node "$(dirname "$0")/depth-probe.ts" $v "$URL" 400 2 > "$EV/depth-$v.out" 2>&1; fi
  kill -TERM $TP; wait $TP || true
  node -e "const t=require('$EV/depth-$v.json'); console.log('$v', 'connections', t.connections, 'maxInflight', JSON.stringify(t.maxInflightPerConnection), 'syncsPerWrite', JSON.stringify(t.syncsPerClientWrite), 'parse', t.parseTotal, 'bind', t.bindTotal)"
done
