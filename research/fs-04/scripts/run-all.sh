#!/usr/bin/env bash
# Full local run: servers, every probe in control and Worker mode (fresh workerd per run), blocked destinations, environment, capability table, ledger.
# Needs docker (start `dockerd` first if the daemon is not running) and /etc/hosts entries for the test names (see results/environment.json).
set -euo pipefail
cd "$(dirname "$0")/.."
getent hosts pg.fs04.test >/dev/null || echo "127.0.0.1 pg.fs04.test wrong.fs04.test selfsigned.fs04.test expired.fs04.test my.fs04.test" >> /etc/hosts
bun scripts/lib/certs.ts >/dev/null
bun scripts/lib/servers.ts up pg17-tls pg17-plain pg17-selfsigned pg17-expired pg17-clientcert pg19-tls pg19-plain my84 ma118
echo "waiting for the servers"; sleep 40
rm -rf results/probes results/blocked.json results/capabilities.* results/environment.json
bun scripts/run.ts --mode both --fresh
bun scripts/blocked.ts > /dev/null
bun scripts/environment.ts
bun scripts/production.ts            # without FS04_WORKER_URL this writes results/production/NOT-VERIFIED.json
bun scripts/capabilities.ts
bun scripts/check-ledger.ts
