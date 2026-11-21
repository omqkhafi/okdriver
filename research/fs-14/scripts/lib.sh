# Server start/stop helpers. Source after env.sh and configs.sh.
start_server() { # "<config line>" -> sets PORT
  local line="$1" name rt file extra exe
  IFS='|' read -r name rt file PORT extra <<<"$line"
  if [ "$rt" = node ]; then exe="$NODE24/node"; else exe="$(command -v bun)"; fi
  ( cd "$HARNESS" && exec env WORKERS=$WORKERS POOL_MAX=$POOL_MAX $extra "$exe" "$file" ) > "$RESULTS/server-$name.log" 2>&1 &
  for _ in $(seq 1 100); do
    curl -sf "http://localhost:$PORT/stats" >/dev/null 2>&1 && return 0
    sleep 0.2
  done
  echo "server $name did not come up; see $RESULTS/server-$name.log" >&2
  return 1
}
stop_server() {
  pkill -f "src/(drizzle|kysely)-server-" || true
  for _ in $(seq 1 50); do pgrep -f "src/(drizzle|kysely)-server-" >/dev/null || return 0; sleep 0.2; done
  pkill -9 -f "src/(drizzle|kysely)-server-" || true
}
