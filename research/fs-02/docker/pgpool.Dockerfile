# pgpool-II built from a source checkout of a release tag (the newest pgpool/pgpool image on Docker Hub is 4.4.3
# from 2023). Debian's libpq-dev is used for the client library.
FROM debian:bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends build-essential libpq-dev libssl-dev libpam0g-dev flex bison autoconf automake libtool make ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY . .
RUN autoreconf -fi >/dev/null 2>&1 && ./configure --prefix=/opt/pgpool --with-openssl --with-pam >/dev/null && make -j"$(nproc)" >/dev/null && make install >/dev/null

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends libpq5 libssl3 libpam0g ca-certificates && rm -rf /var/lib/apt/lists/* && useradd --system --create-home pgpool && mkdir -p /var/run/pgpool /var/log/pgpool && chown pgpool /var/run/pgpool /var/log/pgpool
COPY --from=build /opt/pgpool /opt/pgpool
USER pgpool
ENTRYPOINT ["/opt/pgpool/bin/pgpool"]
