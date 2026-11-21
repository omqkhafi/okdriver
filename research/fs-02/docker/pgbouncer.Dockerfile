# PgBouncer built from the release tarball (no official image exists). The tarball is verified against
# the .sha256 file published next to it before the build (see scripts/build-pgbouncer.sh).
FROM debian:bookworm-slim AS build
ARG VERSION
RUN apt-get update && apt-get install -y --no-install-recommends build-essential pkg-config python3 pandoc libevent-dev libssl-dev libc-ares-dev ca-certificates && rm -rf /var/lib/apt/lists/*
COPY pgbouncer-${VERSION}.tar.gz /src/
RUN cd /src && tar xzf pgbouncer-${VERSION}.tar.gz && cd pgbouncer-${VERSION} && ./configure --prefix=/opt/pgbouncer --with-cares >/dev/null && make -j"$(nproc)" >/dev/null && make install >/dev/null

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends libevent-2.1-7 libssl3 libc-ares2 ca-certificates && rm -rf /var/lib/apt/lists/* && useradd --system --no-create-home pgbouncer
COPY --from=build /opt/pgbouncer /opt/pgbouncer
USER pgbouncer
ENTRYPOINT ["/opt/pgbouncer/bin/pgbouncer"]
