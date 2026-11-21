#!/usr/bin/env bash
# Start or stop the four FS-01 servers. Usage: servers.sh up|down|status [name...]
# Names: pg mysql mariadb sqld. Loopback ports: 55432 53306 53307 58080.
# Images are pinned by digest in results/environment.json; the tags are the ones pulled.
set -euo pipefail
PG_IMAGE=${PG_IMAGE:-postgres:17}
MYSQL_IMAGE=${MYSQL_IMAGE:-mysql:8.4}
MARIADB_IMAGE=${MARIADB_IMAGE:-mariadb:11.8}
SQLD_IMAGE=${SQLD_IMAGE:-ghcr.io/tursodatabase/libsql-server:latest}
cmd=${1:-status}; shift || true
names=${*:-pg mysql mariadb sqld}
up() {
  case "$1" in
    pg) docker run -d --name fs01-pg --cpuset-cpus 2,3 -p 127.0.0.1:55432:5432 \
          -e POSTGRES_HOST_AUTH_METHOD=trust -e POSTGRES_DB=fs01 "$PG_IMAGE" \
          -c log_statement=all -c log_min_duration_statement=-1 -c max_connections=200 -c fsync=off >/dev/null ;;
    mysql) docker run -d --name fs01-mysql -p 127.0.0.1:53306:3306 \
          -e MYSQL_ALLOW_EMPTY_PASSWORD=1 -e MYSQL_DATABASE=fs01 "$MYSQL_IMAGE" \
          --general-log=1 --general-log-file=/var/lib/mysql/general.log >/dev/null ;;
    mariadb) docker run -d --name fs01-mariadb -p 127.0.0.1:53307:3306 \
          -e MARIADB_ALLOW_EMPTY_ROOT_PASSWORD=1 -e MARIADB_DATABASE=fs01 "$MARIADB_IMAGE" \
          --general-log=1 --general-log-file=/var/lib/mysql/general.log >/dev/null ;;
    sqld) docker run -d --name fs01-sqld -p 127.0.0.1:58080:8080 "$SQLD_IMAGE" >/dev/null ;;
  esac
}
for n in $names; do
  case $cmd in
    up) docker rm -f "fs01-$n" >/dev/null 2>&1 || true; up "$n" ;;
    down) docker rm -f -v "fs01-$n" >/dev/null 2>&1 || true ;;
    status) docker ps --filter "name=fs01-$n" --format '{{.Names}} {{.Status}}' ;;
    stop) docker stop "fs01-$n" >/dev/null ;;
    start) docker start "fs01-$n" >/dev/null ;;
  esac
done
