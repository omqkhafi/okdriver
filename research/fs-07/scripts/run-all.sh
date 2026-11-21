#!/bin/bash
# Reproduce the study from the repo root. Needs docker (daemon running), bun, and the images pulled (see README).
# usage: research/fs-07/scripts/run-all.sh [pipeline]   (pipeline adds the 5-run pipelining matrix, which takes a long time)
set -u
cd "$(dirname "$0")/.."
mkdir -p work
[ -d work/node_modules/mysql2 ] || (cd work && echo '{"name":"fs07-work","private":true}' > package.json && bun add mysql2 mariadb)
scripts/servers.sh down; scripts/servers.sh up; sleep 70
scripts/servers.sh status
for step in facts auth behaviour wire metadata tls progress kill pipeline-trace sha2tls zerodate redirect bigpacket; do
  echo "== $step"; bun scripts/$step.ts 2>&1 | tail -12
done
bun scripts/summarize.ts; bun scripts/check-boundaries.ts > /dev/null && echo "boundaries ok"
bun scripts/count-lines.ts | tail -20
echo "== binlog"; bun scripts/binlog.ts 2>&1 | tail -12
echo "== proxysql"; bun scripts/proxysql.ts 2>&1 | tail -5
if [ "${1:-}" = pipeline ]; then echo "== pipeline"; bun scripts/pipeline.ts 2>&1 | tail -150; fi
bun --bun ../../node_modules/.bin/tsc -p tsconfig.json && echo "typecheck ok"
bun scripts/check-ledger.ts && bun scripts/tables.ts
