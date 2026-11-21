#!/usr/bin/env bash
# Download the newest release of Node 22, 24 and 26 from nodejs.org (SHASUMS256 checked) and the Bun release
# named in the repo's .bun-version (GitHub release SHASUMS256 checked) into $RT_DIR (default /tmp/rt/fs08).
# Versions used for the recorded results: see results/versions.json.
set -euo pipefail
RT_DIR="${RT_DIR:-/tmp/rt/fs08}"; mkdir -p "$RT_DIR"; cd "$RT_DIR"
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
curl -fsS -o index.json https://nodejs.org/dist/index.json
for m in 22 24 26; do
  v=$(node -e 'const j=JSON.parse(require("fs").readFileSync("index.json","utf8"));console.log(j.find(x=>x.version.startsWith("v"+process.argv[1]+".")).version)' "$m")
  f="node-$v-linux-x64.tar.xz"
  [ -f "$f" ] || curl -fsS -o "$f" "https://nodejs.org/dist/$v/$f"
  curl -fsS -o "SHASUMS256-$v.txt" "https://nodejs.org/dist/$v/SHASUMS256.txt"
  grep " $f\$" "SHASUMS256-$v.txt" | sha256sum -c -
  mkdir -p "n$m" && tar -xJf "$f" -C "n$m" --strip-components=1
done
# two older 22.x releases, only to observe when node:sqlite first loads without a flag (scripts/node-sqlite-stability.mjs)
for v in 22.12.0 22.13.0; do
  f="node-v$v-linux-x64.tar.xz"
  [ -f "$f" ] || curl -fsS -o "$f" "https://nodejs.org/dist/v$v/$f"
  curl -fsS -o "SHASUMS256-v$v.txt" "https://nodejs.org/dist/v$v/SHASUMS256.txt"
  grep " $f\$" "SHASUMS256-v$v.txt" | sha256sum -c -
  mkdir -p "n$v" && tar -xJf "$f" -C "n$v" --strip-components=1
done
bv=$(cat "$ROOT/.bun-version" | tr -d '[:space:]')
[ -f "bun-$bv.zip" ] || curl -fsSL -o "bun-$bv.zip" "https://github.com/oven-sh/bun/releases/download/bun-v$bv/bun-linux-x64.zip"
curl -fsSL -o bun-SHASUMS256.txt "https://github.com/oven-sh/bun/releases/download/bun-v$bv/SHASUMS256.txt"
grep ' bun-linux-x64.zip$' bun-SHASUMS256.txt | sed "s/bun-linux-x64.zip/bun-$bv.zip/" | sha256sum -c -
mkdir -p bun_x && unzip -q -o "bun-$bv.zip" -d bun_x && rm -rf bun && mv bun_x/bun-linux-x64 bun && rmdir bun_x
"$RT_DIR/bun/bun" -v; for m in 22 24 26; do "$RT_DIR/n$m/bin/node" -v; done
