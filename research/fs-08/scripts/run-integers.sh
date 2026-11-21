#!/usr/bin/env bash
# Build the independent truth with Python's sqlite3, then run the integer probe for every binding on every runtime.
set -uo pipefail
cd "$(dirname "$0")/.."
. scripts/env.sh
python3 -I scripts/integers-truth.py
for r in $RUNTIMES; do for b in $BINDINGS; do "$(rt_cmd $r)" scripts/probe-integers.mjs "$b" 2>&1 | grep -v -e '^(node:' -e 'trace-warnings'; done; done
