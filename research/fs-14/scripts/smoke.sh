#!/usr/bin/env bash
# Start every config, hit each route once, store the bodies, then compare across drivers.
set -euo pipefail
. "$(dirname "$0")/env.sh"; . "$(dirname "$0")/configs.sh"; . "$(dirname "$0")/lib.sh"
OUT="$RESULTS/smoke"; rm -rf "$OUT"; mkdir -p "$OUT"
ROUTES=(
  "customers?limit=50&offset=100" "customer-by-id?id=5" "search-customer?term=ve" "employees?limit=20&offset=20"
  "employee-with-recipient?id=7" "suppliers?limit=50&offset=0" "supplier-by-id?id=11" "products?limit=50&offset=50"
  "product-with-supplier?id=5" "search-product?term=ha" "orders-with-details?limit=50&offset=100"
  "order-with-details?id=77" "order-with-details-and-products?id=77"
)
for line in "${CONFIGS[@]}"; do
  name="${line%%|*}"; mkdir -p "$OUT/$name"
  start_server "$line"
  i=0
  for r in "${ROUTES[@]}"; do
    i=$((i+1))
    code=$(curl -s -o "$OUT/$name/$(printf %02d $i)-${r%%\?*}.json" -w '%{http_code}' "http://localhost:$PORT/$r")
    echo "$name $r $code"
  done
  stop_server
done | tee "$OUT/status.txt"
bun "$(dirname "$0")/smoke-compare.ts" "$OUT" | tee "$OUT/compare.txt"
