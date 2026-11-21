# PgBouncer 1.26.1 built from the upstream release tarball (tag pgbouncer_1_26_1, commit f03e9bf263d7ccd5d1d152a61811bf3258dd6b87).
# Build context: research/fs-06/work/build (holds the tarball and the session CA bundle needed for apt over the agent proxy).
# The man pages need python and pandoc, so only the binary is built and installed.
# Build: docker build --network host -f scripts/docker/pgbouncer.Dockerfile -t fs06/pgbouncer:1.26.1 work/build
FROM debian:trixie-slim
COPY ca.crt /ca.crt
RUN sed -i 's|http://deb.debian.org|https://deb.debian.org|g' /etc/apt/sources.list.d/debian.sources \
 && printf 'Acquire::https::Proxy "http://127.0.0.1:46263";\nAcquire::https::CaInfo "/ca.crt";\n' > /etc/apt/apt.conf.d/99proxy \
 && apt-get update && apt-get install -y --no-install-recommends gcc libc6-dev make libevent-dev libssl-dev pkg-config libc-ares-dev ca-certificates \
 && rm -f /etc/apt/apt.conf.d/99proxy
COPY pgbouncer-1.26.1.tar.gz /src.tgz
RUN mkdir /src && tar xzf /src.tgz -C /src --strip-components=1 && cd /src \
 && ./configure --prefix=/opt/pgbouncer --with-cares >/dev/null && make -j4 pgbouncer >/dev/null && install -D pgbouncer /opt/pgbouncer/bin/pgbouncer \
 && /opt/pgbouncer/bin/pgbouncer --version
EXPOSE 6432
ENTRYPOINT ["/opt/pgbouncer/bin/pgbouncer"]
