#!/usr/bin/env bash
# Summarise the runs in work/drizzle-benchmarks/results with the harness's own peaks.ts and cpu-split.ts, then
# turn them into results/summary.csv (one row per run) and results/tables.md (medians, spread, published ratios).
set -euo pipefail
SCRIPTS="$(cd "$(dirname "$0")" && pwd)"; . "$SCRIPTS/env.sh"
cd "$HARNESS"
bun scripts/peaks.ts results/*-r?.parquet > "$RESULTS/peaks.md"
: > "$RESULTS/cpu-split.txt"
for f in results/*-r?.parquet; do bun scripts/cpu-split.ts "$f" >> "$RESULTS/cpu-split.txt"; done
PUB="$WORK/published/published-series.json"
if [ ! -f "$PUB" ]; then
  mkdir -p "$WORK/published"
  curl -sSf -o "$WORK/published/page.html" https://orm.drizzle.team/benchmarks
  asset=$(grep -o '/_astro/MdxBenchmark\.[A-Za-z0-9_-]*\.js' "$WORK/published/page.html" | head -1)
  curl -sSf -o "$WORK/published/mdx.js" "https://orm.drizzle.team$asset"
  node "$SCRIPTS/extract-published.mjs" "$WORK/published/mdx.js" "$PUB" > /dev/null
fi
bun "$SCRIPTS/summarize.ts" "$RESULTS" "$PUB"
