#!/usr/bin/env bash
# FS-02 lab: starts and stops the Docker endpoints. Everything it writes goes under research/fs-02/work/
# (git-ignored). The throwaway password is generated once per run into work/run.env and never printed.
#
#   scripts/lab.sh init            network, password, self-signed certificate
#   scripts/lab.sh pg              direct PostgreSQL 14..19 and the two pooler backends (be17, be19)
#   scripts/lab.sh pgbouncer       PgBouncer 1.22.1, 1.23.1, 1.26.1 (images from scripts/build-pgbouncer.sh)
#   scripts/lab.sh pgdog           PgDog (ghcr.io/pgdogdev/pgdog:latest)
#   scripts/lab.sh odyssey         Odyssey (fs02/odyssey:1.5.2, built from the v1.5.2 source tag with docker/odyssey.Dockerfile)
#   scripts/lab.sh supavisor       Supavisor (supabase/supavisor:2.10.1) with its own metadata PostgreSQL and two tenants
#   scripts/lab.sh pgcat           PgCat (optional, partial: client auth is MD5 only; ghcr.io/postgresml/pgcat:latest)
#   scripts/lab.sh pgpool          pgpool-II 4.7.3 (optional; fs02/pgpool:4.7.3 built from the V4_7_3 source tag with docker/pgpool.Dockerfile)
#   scripts/lab.sh down            stop and remove every fs02-* container and the network
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$HERE/work"
NET=fs02
mkdir -p "$WORK"

cmd_init() {
  docker network inspect "$NET" >/dev/null 2>&1 || docker network create "$NET" >/dev/null
  if [ ! -f "$WORK/run.env" ]; then
    ( umask 077; printf 'FS02_PASSWORD=%s\n' "$(openssl rand -hex 16)" > "$WORK/run.env" )
  fi
  if [ ! -f "$WORK/tls/server.crt" ]; then
    mkdir -p "$WORK/tls"; chmod 755 "$WORK" "$WORK/tls"
    openssl req -x509 -newkey rsa:2048 -nodes -days 3 -subj "/CN=fs02.invalid" \
      -keyout "$WORK/tls/server.key" -out "$WORK/tls/server.crt" >/dev/null 2>&1
    chmod 644 "$WORK/tls/server.crt"
    chmod 600 "$WORK/tls/server.key"
    chown 999:999 "$WORK/tls/server.key" "$WORK/tls/server.crt" 2>/dev/null || true
    # a copy readable by the pooler containers (all run as root or are told to read this one)
    cp "$WORK/tls/server.key" "$WORK/tls/pooler.key"; chmod 644 "$WORK/tls/pooler.key"; chown root:root "$WORK/tls/pooler.key"
  fi
}

pw() { grep '^FS02_PASSWORD=' "$WORK/run.env" | cut -d= -f2-; }

start_pg() { # name major port [tls]
  local name=$1 major=$2 port=$3 tlsflag=${4:-}
  local args=(-c max_connections=100)
  local mounts=()
  if [ "$tlsflag" = tls ]; then
    args+=(-c ssl=on -c ssl_cert_file=/tls/server.crt -c ssl_key_file=/tls/server.key)
    mounts=(-v "$WORK/tls:/tls:ro")
  fi
  docker rm -f "fs02-$name" >/dev/null 2>&1 || true
  docker run -d --name "fs02-$name" --network "$NET" -p "127.0.0.1:$port:5432" \
    -e POSTGRES_USER=fs02 -e POSTGRES_DB=fs02 -e POSTGRES_PASSWORD="$(pw)" \
    "${mounts[@]}" "postgres:$major" "${args[@]}" >/dev/null
}

cmd_pg() {
  cmd_init
  start_pg pg14 14 5414
  start_pg pg15 15 5415
  start_pg pg16 16 5416
  start_pg pg17 17 5417 tls
  start_pg pg18 18 5418
  start_pg pg19 19 5419 tls
  start_pg be17 17 5517
  start_pg be19 19 5519
  for n in pg14 pg15 pg16 pg17 pg18 pg19 be17 be19; do
    for i in $(seq 1 60); do
      if docker exec "fs02-$n" pg_isready -U fs02 -d fs02 -h 127.0.0.1 >/dev/null 2>&1; then break; fi
      sleep 1
    done
    docker exec "fs02-$n" pg_isready -U fs02 -d fs02 -h 127.0.0.1 >/dev/null 2>&1 || { echo "fs02-$n did not become ready" >&2; exit 1; }
  done
  echo "direct PostgreSQL up"
}

wait_port() { # port: docker's port proxy accepts at once, so wait until the connection stays open (the pooler listens)
  for i in $(seq 1 60); do
    if exec 3<>/dev/tcp/127.0.0.1/$1 2>/dev/null; then
      rc=0; timeout 0.6 cat <&3 >/dev/null 2>&1 || rc=$?
      exec 3<&- 3>&-
      [ "$rc" = 124 ] && return 0
    fi
    sleep 0.5
  done
  echo "port $1 did not open" >&2; return 1
}

# One PgBouncer per version. Databases s17/s19 are session pooling, t17/t19 transaction pooling, in front of
# be17/be19. client_tls_sslmode=allow with a self-signed certificate: plain and TLS clients both accepted.
cmd_pgbouncer() {
  cmd_init
  for spec in 1.22.1:6122 1.23.1:6123 1.26.1:6126; do
    ver=${spec%%:*}; port=${spec##*:}
    d="$WORK/conf/pgb-$ver"; mkdir -p "$d"; chmod 755 "$WORK/conf" "$d"
    printf '"fs02" "%s"\n' "$(pw)" > "$d/userlist.txt"; chmod 644 "$d/userlist.txt"
    cat > "$d/pgbouncer.ini" <<INI
[databases]
s17 = host=fs02-be17 port=5432 dbname=fs02 pool_mode=session
t17 = host=fs02-be17 port=5432 dbname=fs02 pool_mode=transaction
s19 = host=fs02-be19 port=5432 dbname=fs02 pool_mode=session
t19 = host=fs02-be19 port=5432 dbname=fs02 pool_mode=transaction

[pgbouncer]
listen_addr = 0.0.0.0
listen_port = 6432
auth_type = scram-sha-256
auth_file = /etc/pgbouncer/userlist.txt
pool_mode = session
max_client_conn = 200
server_tls_sslmode = disable
client_tls_sslmode = allow
client_tls_key_file = /tls/pooler.key
client_tls_cert_file = /tls/server.crt
INI
    docker rm -f "fs02-pgb$ver" >/dev/null 2>&1 || true
    docker run -d --name "fs02-pgb$ver" --network "$NET" -p "127.0.0.1:$port:6432" \
      -v "$d:/etc/pgbouncer:ro" -v "$WORK/tls:/tls:ro" "fs02/pgbouncer:$ver" /etc/pgbouncer/pgbouncer.ini >/dev/null
    wait_port "$port"
  done
  echo "pgbouncer up"
}

# PgDog: databases s17/t17/s19/t19 (same naming as the PgBouncer instances); pooler_mode is set per user entry.
cmd_pgdog() {
  cmd_init
  d="$WORK/conf/pgdog"; mkdir -p "$d"; chmod 755 "$WORK/conf" "$d"
  {
    printf '[general]\nhost = "0.0.0.0"\nport = 6432\ntls_certificate = "/tls/server.crt"\ntls_private_key = "/tls/pooler.key"\n\n'
    for n in 17 19; do for m in s t; do
      printf '[[databases]]\nname = "%s%s"\nhost = "fs02-be%s"\nport = 5432\ndatabase_name = "fs02"\n\n' "$m" "$n" "$n"
    done; done
  } > "$d/pgdog.toml"
  {
    for n in 17 19; do for m in s t; do
      mode=session; [ "$m" = t ] && mode=transaction
      printf '[[users]]\nname = "fs02"\ndatabase = "%s%s"\npassword = "%s"\npooler_mode = "%s"\nserver_user = "fs02"\nserver_password = "%s"\n\n' "$m" "$n" "$(pw)" "$mode" "$(pw)"
    done; done
  } > "$d/users.toml"
  chmod 644 "$d"/*.toml
  docker rm -f fs02-pgdog >/dev/null 2>&1 || true
  docker run -d --name fs02-pgdog --network "$NET" -p 127.0.0.1:6200:6432 \
    -v "$d:/etc/pgdog:ro" -v "$WORK/tls:/tls:ro" ghcr.io/pgdogdev/pgdog:latest /usr/local/bin/pgdog \
    --config /etc/pgdog/pgdog.toml --users /etc/pgdog/users.toml run >/dev/null
  wait_port 6200
  echo "pgdog up"
}

# Odyssey: databases s17/t17/s19/t19; the route password is the SCRAM secret read from pg_authid.
cmd_odyssey() {
  cmd_init
  d="$WORK/conf/odyssey"; mkdir -p "$d"; chmod 755 "$WORK/conf" "$d"
  secret=$(docker exec fs02-be19 psql -U fs02 -d fs02 -Atc "select rolpassword from pg_authid where rolname='fs02'")
  {
    cat <<CONF
daemonize no
unix_socket_dir "/tmp"
unix_socket_mode "0644"
locks_dir "/tmp/odyssey"
log_to_stdout yes
log_format "%p %t %l [%i %s] (%c) %m\\n"
log_session yes
log_config yes
workers 1
listen {
	host "*"
	port 6432
	tls "allow"
	tls_cert_file "/tls/server.crt"
	tls_key_file "/tls/pooler.key"
}
CONF
    for n in 17 19; do
      printf 'storage "be%s" {\n\ttype "remote"\n\thost "fs02-be%s"\n\tport 5432\n\ttls "disable"\n}\n' "$n" "$n"
    done
    for n in 17 19; do for m in s t; do
      mode=session; [ "$m" = t ] && mode=transaction
      printf 'database "%s%s" {\n\tuser "fs02" {\n\t\tauthentication "scram-sha-256"\n\t\tpassword "%s"\n\t\tstorage "be%s"\n\t\tstorage_db "fs02"\n\t\tstorage_user "fs02"\n\t\tstorage_password "%s"\n\t\tpool "%s"\n\t\tpool_size 10\n\t}\n}\n' "$m" "$n" "$secret" "$n" "$(pw)" "$mode"
    done; done
  } > "$d/odyssey.conf"
  chmod 644 "$d/odyssey.conf"
  docker rm -f fs02-odyssey >/dev/null 2>&1 || true
  docker run -d --name fs02-odyssey --network "$NET" -p 127.0.0.1:6300:6432 \
    -v "$d:/etc/odyssey:ro" -v "$WORK/tls:/tls:ro" fs02/odyssey:1.5.2 /etc/odyssey/odyssey.conf >/dev/null
  wait_port 6300
  echo "odyssey up"
}

# Supavisor: needs a metadata database (fs02-supameta) and tenants be17/be19 (user fs02.be17 / fs02.be19,
# database fs02). Session pooling on port 6401, transaction pooling on port 6400; the API is on 4000.
cmd_supavisor() {
  cmd_init
  if ! grep -q '^SUPA_API_JWT_SECRET=' "$WORK/run.env"; then
    ( umask 077; {
      printf 'SUPA_API_JWT_SECRET=%s\n' "$(openssl rand -hex 16)"
      printf 'SUPA_METRICS_JWT_SECRET=%s\n' "$(openssl rand -hex 16)"
      printf 'SUPA_SECRET_KEY_BASE=%s\n' "$(openssl rand -hex 64)"
      printf 'SUPA_VAULT_ENC_KEY=%s\n' "$(openssl rand -hex 16)"
    } >> "$WORK/run.env" )
  fi
  set -a; . "$WORK/run.env"; set +a
  docker rm -f fs02-supameta fs02-supavisor >/dev/null 2>&1 || true
  docker run -d --name fs02-supameta --network "$NET" -e POSTGRES_PASSWORD="$FS02_PASSWORD" postgres:17 >/dev/null
  for i in $(seq 1 60); do docker exec fs02-supameta pg_isready -U postgres -h 127.0.0.1 >/dev/null 2>&1 && break; sleep 1; done
  sleep 2
  docker run -d --name fs02-supavisor --network "$NET" \
    -p 127.0.0.1:4000:4000 -p 127.0.0.1:6400:6543 -p 127.0.0.1:6401:5452 \
    -v "$WORK/tls:/tls:ro" \
    -e PORT=4000 -e PROXY_PORT_SESSION=5452 -e PROXY_PORT_TRANSACTION=6543 \
    -e DATABASE_URL="ecto://postgres:$FS02_PASSWORD@fs02-supameta:5432/postgres" \
    -e CLUSTER_POSTGRES=true -e SECRET_KEY_BASE="$SUPA_SECRET_KEY_BASE" -e VAULT_ENC_KEY="$SUPA_VAULT_ENC_KEY" \
    -e API_JWT_SECRET="$SUPA_API_JWT_SECRET" -e METRICS_JWT_SECRET="$SUPA_METRICS_JWT_SECRET" \
    -e REGION=local -e ERL_AFLAGS="-proto_dist inet_tcp" -e RLIMIT_NOFILE= \
    -e GLOBAL_DOWNSTREAM_CERT_PATH=/tls/server.crt -e GLOBAL_DOWNSTREAM_KEY_PATH=/tls/pooler.key \
    supabase/supavisor:2.10.1 sh -c "/app/bin/migrate && /app/bin/server" >/dev/null
  wait_port 4000
  sleep 3
  bun "$HERE/scripts/supavisor-tenants.ts"
  wait_port 6400; wait_port 6401
  echo "supavisor up"
}

# PgCat (optional): client authentication is MD5 only, so the probe cannot finish a handshake; the run records
# only how PgCat answers the startup packet. Pools s17/t17/s19/t19.
cmd_pgcat() {
  cmd_init
  d="$WORK/conf/pgcat"; mkdir -p "$d"; chmod 755 "$WORK/conf" "$d"
  {
    printf '[general]\nhost = "0.0.0.0"\nport = 6432\nadmin_username = "fs02admin"\nadmin_password = "%s"\nenable_prometheus_exporter = false\n\n' "$(pw)"
    for n in 17 19; do for m in s t; do
      mode=session; [ "$m" = t ] && mode=transaction
      printf '[pools.%s%s]\npool_mode = "%s"\n[pools.%s%s.users.0]\nusername = "fs02"\npassword = "%s"\npool_size = 5\n[pools.%s%s.shards.0]\nservers = [["fs02-be%s", 5432, "primary"]]\ndatabase = "fs02"\n\n' "$m" "$n" "$mode" "$m" "$n" "$(pw)" "$m" "$n" "$n"
    done; done
  } > "$d/pgcat.toml"
  chmod 644 "$d/pgcat.toml"
  docker rm -f fs02-pgcat >/dev/null 2>&1 || true
  docker run -d --name fs02-pgcat --network "$NET" -p 127.0.0.1:6500:6432 -v "$d:/etc/pgcat:ro" \
    ghcr.io/postgresml/pgcat:latest pgcat /etc/pgcat/pgcat.toml >/dev/null
  wait_port 6500
  echo "pgcat up"
}

# pgpool-II (optional): raw mode, one instance per backend (pgpool17 on 6601, pgpool19 on 6602), database fs02.
# Connection caching is its only pooling; client authentication is SCRAM through pool_hba.conf and pool_passwd.
cmd_pgpool() {
  cmd_init
  for n in 17 19; do
    d="$WORK/conf/pgpool$n"; mkdir -p "$d"; chmod 755 "$WORK/conf" "$d"
    cat > "$d/pgpool.conf" <<CONF
listen_addresses = '*'
port = 9999
backend_clustering_mode = 'raw'
backend_hostname0 = 'fs02-be$n'
backend_port0 = 5432
backend_weight0 = 1
num_init_children = 8
max_pool = 4
connection_cache = on
enable_pool_hba = on
pool_passwd = '/etc/pgpool/pool_passwd'
pid_file_name = '/tmp/pgpool.pid'
socket_dir = '/tmp'
pcp_socket_dir = '/tmp'
health_check_period = 0
sr_check_period = 0
load_balance_mode = off
ssl = on
ssl_key = '/tls/pooler.key'
ssl_cert = '/tls/server.crt'
CONF
    printf 'host all all 0.0.0.0/0 scram-sha-256\nlocal all all trust\n' > "$d/pool_hba.conf"
    printf 'fs02:TEXT%s\n' "$(pw)" > "$d/pool_passwd"
    chmod 644 "$d"/*
    docker rm -f "fs02-pgpool$n" >/dev/null 2>&1 || true
    docker run -d --name "fs02-pgpool$n" --network "$NET" -p "127.0.0.1:$((n==17?6601:6602)):9999" \
      -v "$d:/etc/pgpool:ro" -v "$WORK/tls:/tls:ro" fs02/pgpool:4.7.3 -n -f /etc/pgpool/pgpool.conf -a /etc/pgpool/pool_hba.conf >/dev/null
  done
  wait_port 6601; wait_port 6602
  echo "pgpool up"
}

cmd_down() {
  docker ps -aq --filter "name=^fs02-" | xargs -r docker rm -f >/dev/null
  docker network rm "$NET" >/dev/null 2>&1 || true
  echo "all fs02-* containers removed"
}

case "${1:-}" in
  init) cmd_init ;;
  pg) cmd_pg ;;
  pgbouncer) cmd_pgbouncer ;;
  pgdog) cmd_pgdog ;;
  odyssey) cmd_odyssey ;;
  supavisor) cmd_supavisor ;;
  pgcat) cmd_pgcat ;;
  pgpool) cmd_pgpool ;;
  down) cmd_down ;;
  *) sed -n '2,17p' "$0"; exit 2 ;;
esac
