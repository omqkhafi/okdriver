#!/usr/bin/env bash
# The whole study in the order it was run. Needs: bun-free host tools (node 22, npm, docker, psql, pgbench, openssl, taskset, python3), 4 cores.
# Scratch installs go to the ignored work/ folder; this is the only npm use (npm is used here only as the way to fetch the two Bun binaries and Node 24).
# Servers, the fault proxy and this script run on Node, pinned to cores 1 and 2; the client under test runs on core 0; PostgreSQL on core 3.
set -euo pipefail
cd "$(dirname "$0")/.."
unset BUN_OPTIONS NODE_OPTIONS
P="taskset -c 1,2 node"
npm i --prefix work/release bun@1.4.5 --no-audit --no-fund
npm i --prefix work/canary bun@canary --no-audit --no-fund
npm i --prefix work/node24 node@24 --no-audit --no-fund
scripts/gen-certs.sh
node scripts/builds-info.ts
node scripts/rule-toy.ts                                   # the rule on invented numbers (rule.json was committed before any measurement)
# 1 plain fragmentation suite, release and canary (N-data and Node 24 are reported only)
for b in release canary; do for a in N B N-data; do $P scripts/frag.ts $b $a; done; done
for a in N N-data; do $P scripts/frag.ts node24 $a; done
# planted faults must fail the suite
for f in keep_view drop_byte_at_edge duplicate_chunk; do FRAG_TIMEOUT_CAP_MS=15000 $P scripts/frag.ts release N+$f planted.release.N+$f.json; done
FRAG_TIMEOUT_CAP_MS=15000 $P scripts/frag.ts release B+keep_view planted-extra.release.B+keep_view.json
# 2 required and reported capabilities, lifetime probe
for b in release canary; do for a in N B N-data; do $P scripts/caps.ts $b $a; done; done
for a in N N-data; do $P scripts/caps.ts node24 $a; done
# real PostgreSQL 19.0 on core 3: correctness against psql, TLS against it, ceiling
node scripts/real.ts up
for b in release canary; do $P scripts/real.ts $b correctness --adapters N,B,N-data; done
$P scripts/real.ts node24 correctness --adapters N,N-data
# load sizes, then the servers' ceilings
$P scripts/calibrate.ts release
$P scripts/ceilings.ts
# 3 and 4: W1 to W4 on release (with the null comparison), then canary
$P scripts/perf.ts release W1,W2,W3-8K,W3-64K,W3-1M,W4 --null
$P scripts/perf.ts canary W1,W2,W3-8K,W3-64K,W3-1M,W4
# 5: W5 on real PostgreSQL
$P scripts/real.ts ceiling
$P scripts/real.ts release w5
$P scripts/real.ts canary w5
# 6: TLS throughput (node:tls server, then real PostgreSQL)
$P scripts/perf.ts release W1,W3-8K,W3-64K,W3-1M --tls
$P scripts/real.ts release w5 --tls --cells W5-S1,W5-100MB
# 7 and 8: N-data, then the Node 24 baseline
$P scripts/perf.ts release W1,W2,W3-8K,W3-64K,W3-1M,W4 --adapters N,N-data --out throughput.release.ndata
$P scripts/perf.ts node24 W1,W2,W3-8K,W3-64K,W3-1M,W4 --adapters N,N-data
node scripts/real.ts down
# reports (run from the committed results/)
node scripts/assemble.ts      # results/rule-input.json and results/verdict.json: rule.json applied
node scripts/report.ts        # results/tables.md
node scripts/build-readme.ts  # README.md from scripts/readme.template.md and results/tables.md
