#!/usr/bin/env bash
# Compile the loadable-extension fixture into work/ext/okfs08.so. Headers come from the SQLite source
# that better-sqlite3 ships; the fixture itself is scripts/fixtures/ext.c.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p work/ext
gcc -shared -fPIC -I node_modules/better-sqlite3/deps/sqlite3 scripts/fixtures/ext.c -o work/ext/okfs08.so
ls -la work/ext/okfs08.so
