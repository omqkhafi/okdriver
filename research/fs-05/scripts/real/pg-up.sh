#!/usr/bin/env bash
# Starts the PostgreSQL 19.0 container (digest from research/fs-06/README.md) on host loopback port 55432, pinned to cores 2 and 3.
# Throwaway credentials, a container that exists only during the run. Core map: 0 load generator, 1 delay proxy, 2-3 Postgres.
set -euo pipefail
IMAGE=postgres@sha256:bb6e70add742cd868fb62cb3b2f67d1dd2bdd2b65a521e778420748753687c60
docker rm -f fs05-pg >/dev/null 2>&1 || true
docker run -d --name fs05-pg --network host --cpuset-cpus 2,3 -e POSTGRES_USER=fs05 -e POSTGRES_PASSWORD=fs05pw -e POSTGRES_DB=fs05 \
  $IMAGE -c port=55432 -c listen_addresses=127.0.0.1 -c max_connections=100 -c shared_buffers=512MB -c jit=off -c fsync=off \
  -c autovacuum=off -c log_min_messages=warning >/dev/null
for i in $(seq 1 60); do
  if docker exec fs05-pg pg_isready -h 127.0.0.1 -p 55432 -U fs05 >/dev/null 2>&1; then break; fi
  sleep 1
done
docker exec fs05-pg psql -h 127.0.0.1 -p 55432 -U fs05 -d fs05 -qAt -c "select version()" 
docker exec fs05-pg psql -h 127.0.0.1 -p 55432 -U fs05 -d fs05 -q -c "create table if not exists kv(id int primary key, v int not null); insert into kv select g, g*3+1 from generate_series(0,99999) g on conflict do nothing; analyze kv;"
docker exec fs05-pg psql -h 127.0.0.1 -p 55432 -U fs05 -d fs05 -qAt -c "select count(*) from kv"
