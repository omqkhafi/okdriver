#!/usr/bin/env bash
# Overhead and worker benchmarks, strictly sequential (a parallel run would corrupt every number).
#   full worker matrix: node24 + node:sqlite, bun + bun:sqlite
#   quick worker matrix (4 result sizes, 3 query times, 2 workloads): node22 + node:sqlite, node26 + node:sqlite, node24 + better-sqlite3, bun + better-sqlite3
# Run it in the background and read the log once.
set -uo pipefail
cd "$(dirname "$0")/.."
. scripts/env.sh
mkdir -p work/logs
filter() { grep -v -e '^(node:' -e 'trace-warnings' -e ExperimentalWarning; }
echo "== worker, full"; date
"$BUN"    scripts/bench-worker.mjs bun:sqlite        2>&1 | filter
"$NODE24" scripts/bench-worker.mjs node:sqlite       2>&1 | filter
echo "== worker, quick"; date
"$NODE22" scripts/bench-worker.mjs node:sqlite  --quick 2>&1 | filter
"$NODE26" scripts/bench-worker.mjs node:sqlite  --quick 2>&1 | filter
"$NODE24" scripts/bench-worker.mjs better-sqlite3 --quick 2>&1 | filter
"$BUN"    scripts/bench-worker.mjs better-sqlite3 --quick 2>&1 | filter
echo "== overhead"; date
for r in $RUNTIMES; do for b in $BINDINGS; do "$(rt_cmd $r)" scripts/bench-overhead.mjs "$b" 2>&1 | filter; done; done
echo "== worker visibility"; date
for r in $RUNTIMES; do for b in $BINDINGS; do "$(rt_cmd $r)" scripts/probe-worker-visibility.mjs "$b" 2>&1 | filter; done; done
echo "== all done"; date
