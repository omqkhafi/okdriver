#!/usr/bin/env bash
# Runtime locations. Override RT_DIR to point at a directory holding the unpacked runtimes:
#   $RT_DIR/n22, n24, n26   Node.js release tarballs (nodejs.org, SHASUMS256 checked) unpacked with --strip-components=1
#   $RT_DIR/bun/bun         Bun at the version in the repo's .bun-version
# scripts/setup-runtimes.sh creates this layout.
RT_DIR="${RT_DIR:-/tmp/rt/fs08}"
export NODE22="$RT_DIR/n22/bin/node" NODE24="$RT_DIR/n24/bin/node" NODE26="$RT_DIR/n26/bin/node" BUN="$RT_DIR/bun/bun"
# runtime id -> command
rt_cmd() { case "$1" in node22) echo "$NODE22";; node24) echo "$NODE24";; node26) echo "$NODE26";; bun) echo "$BUN";; esac; }
export -f rt_cmd 2>/dev/null || true
RUNTIMES="node22 node24 node26 bun"
BINDINGS="bun:sqlite node:sqlite better-sqlite3"
