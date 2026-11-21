# Odyssey built from a source checkout of a release tag (no official image exists). Based on the
# project's own docker/quickstart/Dockerfile: same build steps, no entrypoint script.
FROM debian:trixie-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends build-essential cmake make git libssl-dev libpam0g-dev libldap-dev ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /odyssey
COPY . ./
RUN make clean && make build_release

FROM debian:trixie-slim
RUN apt-get update && apt-get install -y --no-install-recommends libssl3 libldap-dev libpam0g tini ca-certificates && rm -rf /var/lib/apt/lists/* \
    && groupadd -g 1001 odyssey && useradd -u 1001 -g odyssey -s /sbin/nologin -M odyssey && mkdir -p /etc/odyssey /var/log/odyssey && chown odyssey:odyssey /var/log/odyssey
COPY --from=build /odyssey/build/sources/odyssey /usr/local/bin/odyssey
USER odyssey
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/odyssey"]
