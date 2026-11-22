#!/usr/bin/env bash
# Regenerates every result from scratch. Needs bun, Docker (the daemon may need `dockerd` started by hand), 4 vCPUs and network access to Docker Hub.
# Core map: 0 load generator, 1 delay proxy, 2-3 Postgres. Raw data goes to the ignored work/. The real runs are resumable: a run whose line is already in
# work/raw/*.jsonl is skipped. Run from research/fs-05.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p work/logs results
bun scripts/simplest.ts                                   # 1. "simplest", decided before any measurement -> results/simplest.json
scripts/real/pg-up.sh                                     # 2. PostgreSQL 19.0 by digest, cores 2-3, table kv
taskset -c 0 bun scripts/real/selfcheck.ts                # 3. instrument self-checks (encoder bytes, statement kinds, planted defect)
taskset -c 0 bun scripts/real/rtt-probe.ts                #    round trips -> results/rtt.json
taskset -c 0 bun scripts/real/rtt-loaded.ts               #    loaded round trips
taskset -c 0 bun scripts/real/measure-service.ts          #    service times -> results/service.json
taskset -c 0 bun scripts/real/main.ts p1                  # 4. calibration cells (fast-only, loopback and 20 ms, sharing on and off)
bun scripts/sim/calibrate.ts 1 90                         # 5. simulator fit on those cells (attempts 1-5 are recorded in results/calibration.json)
bun scripts/sim/predict.ts                                #    predictions for the held-out cells, before their real data are read
taskset -c 0 bun scripts/real/scenarios.ts correct        # 6. correctness gate, stuck connection, kill
taskset -c 0 bun scripts/real/scenarios.ts stuck
taskset -c 0 bun scripts/real/scenarios.ts kill
taskset -c 0 bun scripts/real/main.ts p2                  # 7. held-out real cells (the run in this PR stopped before the 10% share cells)
bun scripts/real/aggregate.ts                             # 8. results/real-matrix.json
taskset -c 0 bun scripts/real/sharing.ts                  #    sharing off against on at the same rates
scripts/real/pgbench-ceiling.sh                           #    independent server ceiling
bun scripts/sim/validate.ts                               # 9. simulator against the held-out real cells -> results/validation.json
for i in 0 1 2 3; do taskset -c $i bun scripts/sim/run-sim.ts $i 4 & done; wait   # 10. full simulated matrix
bun scripts/sim/merge.ts                                  #    -> results/sim-matrix.json.gz
bun scripts/verdict.ts                                    # 11. rules.json applied -> results/verdict.{json,md}
bun scripts/report.ts && bun scripts/evidence.ts && bun scripts/limits.ts && bun scripts/sharing-cost.ts
bunx tsc -p tsconfig.json --noEmit                        # 12. typecheck this folder once
