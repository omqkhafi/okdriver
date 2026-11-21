#!/usr/bin/env bash
# Builds fs02/pgbouncer:<version> from the release tarball in work/src/pgbouncer/<version>/ after checking
# its sha256 against the file published next to it. Download first with:
#   curl -O https://www.pgbouncer.org/downloads/files/<v>/pgbouncer-<v>.tar.gz{,.sha256}
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
for v in "$@"; do
  d="$HERE/work/src/pgbouncer/$v"
  ( cd "$d" && sha256sum -c sha.txt )
  docker build -q -t "fs02/pgbouncer:$v" --build-arg VERSION="$v" -f "$HERE/docker/pgbouncer.Dockerfile" "$d"
done
