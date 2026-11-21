#!/usr/bin/env bash
# Run the Durable Objects SQLite probe under the repo's pinned workerd (1.20261118.1), local only.
# workerd comes from a scratch install outside the repo: WORKERD_DIR (default /tmp/rt/workerd-pkg) holds
# `bun add --exact workerd@1.20261118.1` (no install scripts).
set -euo pipefail
cd "$(dirname "$0")/.."
WORKERD_DIR="${WORKERD_DIR:-/tmp/rt/workerd-pkg}"
WORKERD="$WORKERD_DIR/node_modules/.bin/workerd"
PORT="${PORT:-8788}"
D=work/do; rm -rf "$D"; mkdir -p "$D/storage"
cp scripts/do/do-worker.mjs "$D/do-worker.mjs"
sed -e "s#@STORAGE@#$(pwd)/$D/storage#" -e "s#@PORT@#$PORT#" scripts/do/config.capnp.in > "$D/config.capnp"
"$WORKERD" --version | tee results/do/workerd-version.txt
( cd "$D" && "$WORKERD" serve config.capnp --experimental > ../logs/workerd.log 2>&1 ) &
PID=$!
trap 'pkill -P $PID 2>/dev/null; kill $PID 2>/dev/null; pkill -f "workerd serve" 2>/dev/null; true' EXIT
for i in $(seq 1 50); do curl -fsS "http://127.0.0.1:$PORT/ping" >/dev/null 2>&1 && break; sleep 0.2; done
curl -fsS "http://127.0.0.1:$PORT/probe" -o results/do/do-sqlite.json
echo "wrote results/do/do-sqlite.json ($(wc -c < results/do/do-sqlite.json) bytes)"
