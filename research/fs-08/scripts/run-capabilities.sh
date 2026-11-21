#!/usr/bin/env bash
# Run the capability probe for every binding on every runtime.
set -uo pipefail
cd "$(dirname "$0")/.."
. scripts/env.sh
./scripts/build-ext.sh >/dev/null
for r in $RUNTIMES; do for b in $BINDINGS; do "$(rt_cmd $r)" scripts/probe-capabilities.mjs "$b" 2>&1 | grep -v -e '^(node:' -e 'trace-warnings'; done; done
