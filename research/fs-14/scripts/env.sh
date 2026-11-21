# Shared settings for the FS-14 reproduction scripts. Source this file; do not run it.
FS14="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$FS14/work"
HARNESS="$WORK/drizzle-benchmarks"
HARNESS_URL="https://github.com/drizzle-team/drizzle-benchmarks"
HARNESS_SHA="6e669c7"
NODE24_VERSION="24.22.2"
NODE24="$WORK/node24/bin"
LOADGEN="$WORK/bin/loadgen"   # a copy of the same bun binary under another name, see README
RESULTS="$FS14/results"
PG_PORT=5435                  # the harness default in src/docker.ts and .env
WORKERS=2                     # matrix setting: 2 processes ...
POOL_MAX=8                    # ... x 8 connections
REQUESTS=100000
COOLDOWN=${COOLDOWN:-15}
export PATH="$NODE24:$PATH"
