#!/usr/bin/env bash
# Clone the harness at the pinned SHA, install, fetch Node 24, start Postgres 18.6 through the harness's
# own src/docker.ts, seed `micro`. Idempotent where it can be. Needs docker, bun, curl, git.
set -euo pipefail
. "$(dirname "$0")/env.sh"
mkdir -p "$WORK" "$RESULTS" "$WORK/bin"

if [ ! -d "$HARNESS/.git" ]; then git clone "$HARNESS_URL" "$HARNESS"; fi
git -C "$HARNESS" checkout -q "$HARNESS_SHA"

if [ ! -x "$NODE24/node" ]; then
  mkdir -p "$WORK/node24"
  curl -sSf "https://nodejs.org/dist/v$NODE24_VERSION/node-v$NODE24_VERSION-linux-x64.tar.xz" | tar -xJ -C "$WORK/node24" --strip-components=1
fi
[ -x "$LOADGEN" ] || cp -L "$(command -v bun)" "$LOADGEN"

# Named exception to the repo's package-manager rule: third-party scratch code, harness lockfile, scratch clone only.
( cd "$HARNESS" && bunx pnpm install --frozen-lockfile )
( cd "$HARNESS/bunload" && bun install --frozen-lockfile )

# Docker daemon: start it if nothing answers (cloud sandboxes have none running by default).
docker info >/dev/null 2>&1 || { (dockerd >/tmp/dockerd.log 2>&1 &); sleep 8; }
if ! docker ps --format '{{.Names}}' | grep -q '^drizzle-benchmarks-pg2$'; then
  ( cd "$HARNESS" && node ./src/docker.ts )
  ( cd "$HARNESS" && node ./src/seed.ts )   # seed.ts ends with main("micro")
fi
PGPASSWORD=postgres psql -h localhost -p $PG_PORT -U postgres -qc "ANALYZE"
