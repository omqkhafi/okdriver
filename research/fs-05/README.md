# FS-05: which pipeline scheduler?

Research only. This folder holds a deterministic simulator, a real-server load generator with a byte-forwarding trace proxy, the policy files both run,
scripts, small result files and a verdict script. It changes no OKDriver source, test, doc, ADR, `AGENTS.md` or root file. Spec area: none yet.
Feature record: none (research). This study gives evidence for ADR 018 (open question) and P8-T02. It decides nothing: no ADR number is reserved, and ADR 019 and ADR 024
are not touched.

Question (roadmap row FS-05): which pipeline scheduler? Method: fixed depth, RTT-aware depth, latency-aware cross-connection, AIMD. Output: throughput and p99.9 under mixed
fast/slow load in a simulator and on real servers. Note: the default is the simplest policy within noise of the best; the others ship behind options only if they win somewhere.

Base: `origin/main` at `5930580cd61a7bf5e03ab0f77f7c2f2320bf1d8d`. Run dates 2026-11-21 and 2026-11-22.

## Two terms (defined here; this study does not say which one ADR 019 forbids)

- **Within-caller pipelining**: one caller's explicit `pipeline([...])` goes down one connection back to back (a window of at most the policy's depth cap is on the wire at a time; the rest of that caller's pipeline stays together on that connection).
- **Cross-caller sharing**: statements of unrelated callers share one connection's pipeline.

Every result is reported for **sharing off** and **sharing on**. With sharing off a connection serves one caller at a time (a standalone statement or one caller's pipeline of 8 holds it until its last statement has returned); with sharing on a connection is eligible whenever it holds no unsent
rest of a pipeline and has fewer than `cap` statements on the wire. Transactions and cursors take a connection exclusively and are out of scope. Each independent statement ends with its own Sync, an error fails only that statement, and every
statement uses the unnamed form `Parse Bind Describe(portal) Execute Sync` (FS-06: it works behind every pooler that was run).

## Policies, defined before measuring

All five are files in `scripts/policy/` that take a clock and a view of connection state (`scripts/policy/types.ts`); nothing in them names an engine. The pool that runs them (`scripts/core/pool.ts`, shared by the simulator and the real client) keeps a FIFO queue of units
(a standalone statement or a caller's pipeline), binds a unit to a connection as late as possible (only when some connection has room under its cap), keeps each connection's statements in a FIFO, and calls `policy.onComplete` for every result.
Constants are in each file's `CONSTANTS` export.

| policy | cap (statements on the wire per connection) | placement | constants |
| --- | --- | --- | --- |
| `control` | 1 | least in flight | none |
| `fixed:D` | D | least in flight | `D` (one value for every connection). Real grid 4, 16, 64; simulator grid 2, 4, 8, 16, 32, 64, 128 |
| `rtt-aware` | `ceil(rtt / svc) + 1`, at most `DMAX`; `INIT` until both are measured. `rtt` is the minimum latency over the last `WINDOW` statements written to an idle connection, `svc` the EWMA of the gap between consecutive completions when a statement queued behind another | least in flight | `ALPHA` 0.05, `DMAX` 128, `INIT` 2, `WINDOW` 64 |
| `latency-aware` | `CAP` | lowest expected completion = peak-EWMA latency of the connection times (in flight + 1); the estimate jumps up to a slower observation, falls by `ALPHA` per faster one, and halves every `HALF_LIFE` ms without observations; a never-observed connection costs 0 | `CAP` 16, `ALPHA` 0.2, `HALF_LIFE` 1000 |
| `aimd` | per connection, `floor(cap_c)`: +`ADD`/`cap_c` per completion while latency is within `THRESH` x the connection's minimum latency, x`MULT` when it is not (at most once per window: only a statement written after the previous cut can cause the next) | least in flight | `INIT` 2, `MAX` 128, `ADD` 1, `MULT` 0.5, `THRESH` 2 |

Ties in placement go to the lower connection index. **"Simplest" was decided by script before any measurement** (`scripts/simplest.ts`, `results/simplest.json`): fewer tunable constants first, then fewer policy code lines (blank lines and comments excluded), then the order of the brief.
Result: `control` (0 constants, 12 lines) < `fixed` (1, 15) < `latency-aware` (3, 27) < `rtt-aware` (4, 27) < `aimd` (5, 22). Note that this puts latency-aware before rtt-aware, which is not the order of the brief; the script decides.

## Decision rule (`rules.json`, frozen before measuring; `scripts/verdict.ts` reads it)

Metrics per cell: throughput (closed loop, 2048 callers), p99.9 of fast statements and p99 of slow statements (open loop, latency from the scheduled send time), client CPU per statement.
Noise is the range of 5 runs. A candidate is within noise of the best when its median is no worse than the best candidate's worst run on every metric of the unit. A policy wins somewhere when, in at least one valid unit, its worst run beats the best run of the simplest within-noise policy of
that unit by 10% or more on a metric. The default is the simplest candidate within noise of the best in every required unit; if none exists the verdict names the unit and the margin. The fixed policy is judged at one depth D*: the D that is within noise of the per-unit reference in the most required
units (the per-unit best D is reported as an oracle bound, never a candidate). The correctness gate comes first. Units that are indicative (fewer than 100,000 fast statements), client-bound (median client CPU utilisation at or above 0.92) or proxy-bound stay out. The rule is evaluated separately for sharing off and sharing on.

## Findings in short

Findings, not decisions. "Real" means Postgres 19.0 on this box; "sim" is the simulator, **exploratory** (finding 9). Throughput is statements per second with 2048 callers; p99.9 is of fast statements in ms, at 0.5 and 0.8 of the cell's saturation throughput T*.

1. **The frozen rule yields no default policy, in either sharing mode, on the real data.** Sharing on: 35 valid units; `control` is outside noise in 35, `fixed:64` (the D* of the real grid) in 26, `latency-aware` in 31, `aimd` in 34 and `rtt-aware` in 11. Sharing off: 13 valid units (the others are indicative); `fixed:16` is outside noise in 2, the rest in 5. The margins and the failing units are in `results/verdict.md`.
   The closest candidate with sharing on is `rtt-aware`: it never loses on throughput, and 10 of its 11 failing units fail on client CPU per statement at loopback (its policy code runs a 64-slot minimum on every completion; the margins are small). Two units fail on p99.9 and slow p99 with sleeping statements (`d20|m1`, `loop|m2`; the second is also one of the CPU units).
2. **Depth buys throughput where round trip times rate is large; at loopback the first few statements of depth buy most of it.** Loopback, sharing on: control 32.2k, depth 4 to 64 from 45.6k to 48.7k (+41% to +51%); the pgbench ceiling on the same two cores is 34k to 54k (`results/pgbench.txt`), so loopback ends at the server. At 4.75 ms: control 1.6k, fixed:4 6.5k, fixed:16 24.0k, fixed:64 57.7k, rtt-aware 62.8k. At 19.5 ms: control 412, fixed:4 1.7k, fixed:16 6.6k, fixed:64 25.5k, aimd 39.0k, rtt-aware 47.8k. Depth x connections / RTT predicts the first four 20 ms values to within 3% (`results/limits.md`).
3. **A fixed depth that is too small is an overload, not a tail effect.** At 20 ms, 50% of T* is 23.9k statements/s: control, fixed:4, fixed:16 and latency-aware (cap 16) could not carry it (all runs overloaded, p99.9 of 6 to 7 s measured against the cutoff, right-censored), fixed:64 carried it (p99.9 27 ms) but not 80% (1.9 s), rtt-aware carried both (32 and 45 ms), aimd neither (0.6 s and 1.0 s: its cap was still growing). The trace shows rtt-aware and aimd reaching depth 128 (their own ceiling); the other policies stopped at their cap, exactly (`results/evidence.md`).
4. **Deeper pipelines hurt the tail when some statements are slow.** Loopback, 1% of statements sleep 50 ms, sharing on, p99.9 at 0.5 of T*: control 30, aimd 31, fixed:4 55, rtt-aware 53, fixed:64 89, fixed:16 90, latency-aware 102. A statement queued behind a sleeper waits for it, and shallower caps queue fewer. At 20 ms the same cell needs depth to carry the load (finding 3) and the order reverses. The secondary reading of "wins somewhere" (below) finds `control` and `aimd` ahead of `rtt-aware` in that one unit, by 1.4x to 1.6x.
5. **Sharing off costs saturation, not tail at a rate it can carry.** Standalone fast statements, 8 connections: sharing off saturates at 31.6k (loopback), 1.7k (4.75 ms) and 411 (19.5 ms); sharing on at 48.7k, 62.8k and 47.8k: 1.5x, 37x, 116x. At the same arrival rate below the sharing-off saturation, the p99.9 values overlap (loopback 17.6k/s: off 9.4, on control 14.8, fixed:16 6.5, rtt-aware 6.8); the delayed-path rows are indicative (`results/sharing-cost.md`). Within-caller pipelining alone (sharing off, pipeline of 8) recovers eight statements per round trip: 3.2k at 19.5 ms against 411 for standalone statements, and 42.8k to 45.3k at loopback (depth 4 or more) against 32.2k. Fewer connections than roundtrip x rate is what sharing off cannot fix; by Little's law 19.5 ms x 47.8k/s is about 930 statements in flight, which is 930 exclusive connections without sharing.
6. **Stuck connection** (an advisory lock holds one backend for 3 s, arrivals continue at 8,000 statements/s at loopback and 3,000/s at 20 ms, 150/s with sharing off at 20 ms; `results/evidence.md`): with least-in-flight placement the blocked connection receives only the statements that were already on their way (victims, which wait the full 3 s: loopback 0 to 5, 20 ms 10 to 11) and is used normally right after the release. **`latency-aware` herds**: it kept placing statements on the blocked connection until its cap (16 in flight at the release, 15 victims against 0 to 5 at loopback and 10 to 11 at 20 ms for the others) because a connection with no completions keeps a low estimate; and it **starves the recovered connection**: 0 statements in the 3 s after the release against about 1,000 on each other connection at 20 ms and 2.5k to 3k at loopback, because the peak estimate (3 s) decays with a 1 s half-life. Both are consequences of its constants (`CAP` 16, `HALF_LIFE` 1000), not proven general. `aimd` had 0 victims at loopback (its cap collapsed to 1) and 11 at 20 ms. Sharing off: no victims for any policy (one caller is blocked, the others use other connections). At 20 ms the stuck runs for `control` and `fixed:4` are overloaded at the chosen rate (3000/s) and say nothing about stuck connections.
7. **Connection killed mid-run** (`pg_terminate_backend`, no retry): the statements lost are those on the wire, at most the cap, and the trace agrees with the pool (`lost, trace` equals `lost, pool` in every row; the proxy's count at the moment the server side closed differs where responses were still in its delay line). With a caller's pipeline of 8 and a small cap, the rest of the pipeline never left: `control` lost 1 on the wire and 6 never sent; `fixed:16` lost the 8 that were on the wire and 0 unsent. The pool queue is unassigned (late binding), so no statement waits on a dead connection except the unsent rest of a caller's pipeline. This is the number for ADR 034 and principle 6: the cap bounds the set of statements whose outcome is unknown, and an unsent statement is known not to have run.
8. **Correctness gate**: 56 runs (7 configs x sharing on/off x standalone and pipeline of 8 x loopback and 20 ms), 1.55 million statements, 18,148 injected errors delivered as 22012 to the statement that raised them: 0 results to the wrong caller, 0 reordered results, 0 statements failed by another's error. Every statement of every run carries a unique id that the result must echo, so the same check ran in all 2,140 runs (1,868 matrix, 182 scenario, 90 sharing). A planted fault in the instrument is caught (`scripts/real/selfcheck.ts`).
9. **The simulator is exploratory.** It was calibrated on the fast-only loopback and 20 ms cells (5 fits; rms log error 0.076 on the last) and then checked against the 14 held-out real cells: 63 of 83 config-cells within 15% of the real median throughput, 2 inverted pairs among throughput-separated policies and 2 among p99.9-separated ones. The criterion failed after the three recalibrations the rule allows, so by rule it is exploratory and kept out of the verdict. Its misses: loopback pipelines of 8 (simulated 1.2x to 1.6x too fast), the 4.75 ms path (about 0.8x) and one AIMD cell at 20 ms (1.7x).
10. **Field report behind ADR 018: not found.** One search round (two queries) found no report of a regression in a latency-aware scheduler of a Postgres driver; the results were summaries, not raw pages. Nothing was tested for it. What was tested is the generic failure modes of a latency-aware placement (finding 6).
11. **Poolers were not run in this study** (cut first by the brief's order; see "Not verified"). FS-06 is the only evidence behind poolers.

## Matrix actually run

Pool of 8 connections everywhere. Real cells (sharing on and off for each): fast-only standalone at loopback and 19.5 ms (calibration set, closed loop at 4, 32, 256, 2048 callers and open loop at 0.5, 0.8, 0.95 of T* with sharing on; sharing off at 0.5 and 0.8 at 19.5 ms), then held out from the calibration: pipeline of 8 fast-only (loopback, 19.5 ms), 1% sleeping 50 ms (loopback, 19.5 ms), 1% sleeping 5 ms (loopback, 19.5 ms, and pipeline of 8), fast-only standalone at the 4.75 ms path.
Configs: `control`, `fixed:4`, `fixed:16`, `fixed:64`, `rtt-aware`, `latency-aware`, `aimd`; with sharing off and standalone statements only `control` and `latency-aware` were run, because the other five policies place by least in flight and the cap never binds (one statement per exclusive connection), so they are `control` by construction; `scripts/verdict.ts` gives them control's row and marks it `alias`. 5 runs per point; 1,865 matrix runs in 373 rows (plus 3 partial runs of the stopped 10% cell, dropped), 182 scenario runs, 90 sharing runs.
Cut, in the brief's order: PgBouncer and every other pooler, CPU-bound slow statements (real), the 10% slow share (real: its cells were started and stopped, `m3` is not in the matrix), the 95% rate outside the calibration cells, extra D values. Never cut: correctness gate, loopback and 20 ms direct cells, the stuck-connection scenario.
Simulator (exploratory): 4 paths (loopback, an ideal 1 ms, 4.75 ms, 19.5 ms) x 7 mixes (fast only; 1% and 10% sleeping 5 and 50 ms; 1% CPU-bound 5 and 50 ms) x standalone and pipeline of 8 x sharing on and off x 11 configs (control, fixed 2 to 128, rtt-aware, latency-aware, aimd), 5 seeds, closed loop at 32 and 2048, open loop at 0.5 and 0.8 of T*: 4,928 rows in `results/sim-matrix.json.gz`.

## Where each shape ends (the FS-14 lesson)

Worked out before choosing the load, and checked against the data. A shape's throughput ends at the lowest of these ceilings (statements per second):
- **Depth x connections / round trip**: 8 connections x D / RTT. At 19.5 ms and D = 4, 16, 64, 128 this is 1.6k, 6.6k, 26k, 52k; the measured plateaus are 1.7k, 6.6k, 25.5k and 47.8k (rtt-aware reached 128). With sharing off it is 8 / RTT (411 at 19.5 ms) times the pipeline length.
- **Server CPU**: the two Postgres cores. pgbench on the same two cores (it competes with the backends) gives 38k simple, 34k extended, 54k prepared (`results/pgbench.txt`); the loopback plateau of 48.7k to 50.3k sits inside that range and is where the load generator is at 50% utilisation, so loopback cells end at the server and none was client-bound.
- **Client CPU**: 1e6 / client CPU per statement, 10.5 to 16 us at loopback, so 62k to 95k; never the binding one on this box. The load generator's median utilisation was at most 0.75 in any row and the proxy's at most 0.12, so no unit was marked client-bound or proxy-bound.
- **Connection time of sleepers**: connections / (slow share x sleep time): 15.9k for 1% sleeping 50 ms (the plateau is 13.2k to 14.6k), 148k for 1% sleeping 5 ms (not binding). The 10% share at 50 ms would end at 1.6k statements/s, which is why the real runs for it would need a pool larger than 8 to reach 100,000 fast statements in a run.
`results/limits.md` has the table per cell. Closed-loop callers run from 4 (below the pool size) to 2048 (twice 8 x 128); open-loop rates are fractions of each cell's own measured T*.
Real open-loop cells reach 100,000 fast statements per run only where T* is high enough: the sharing-off cells at 4.75 ms and 19.5 ms (T* 1.7k and 411) are **indicative** (fewer than 100,000, runs of 8,000 and 3,000 fast statements) and stay out of the rule; so does the sharing-off 20 ms pipeline of 8 cell with its 3.2k.

## Method

- **Pool core** (`scripts/core/pool.ts`): one scheduler for both instruments. It owns the queue, the per-connection FIFO of statements on the wire, the window, late binding and the sharing switch; the policy files answer `cap` and `pick`. Results are matched to statements by position (ReadyForQuery order) and by the unique id in each statement.
- **Real client** (`scripts/real/`): login uses the FS-06 client; the writer puts `Parse Bind Describe(portal) Execute Sync` for many statements into one `write` (the encoder is checked byte for byte against the FS-06 wire encoder in `selfcheck.ts`), the parser reads each ReadyForQuery as one result. Bun only, no dependency. Statement kinds: fast point lookup (`select $1::int8 as uid, v from kv where id = $2` over 100,000 rows), timed (`pg_sleep` of 5 and 50 ms), CPU-bound (`generate_series` count, sized to 5 and 50 ms), blocker (`pg_advisory_lock`), failing (`1 / 0`).
- **Copied from FS-06** (`scripts/real/lib/wire.ts`, `client.ts`, `scram.ts`; source commit `5930580cd61a7bf5e03ab0f77f7c2f2320bf1d8d`, the base of this PR, path `research/fs-06/scripts/lib/`): not imported across study folders. FS-06's recording proxy was not copied; `delayproxy.ts` is new and shares no code with the client.
- **Trace proxy** (`scripts/real/delayproxy.ts`): a byte-forwarding proxy with its own frame counter. It adds a one-way delay and counts, per connection, Syncs forwarded minus ReadyForQuery delivered, which is the in-flight depth the client sees, plus a histogram of the depth at each Sync. All delayed cells run through it; loopback cells run direct, and the scenarios at loopback run through the same proxy with delay 0 (`loopT`), so their depth comes from a trace. Postgres runs in a container with `--network host`, pinned to cores 2 and 3; the load generator on core 0, the proxy on core 1.
- **Round trip** (`results/rtt.json`): Bun's timer cannot do sub-millisecond delays (asked 0.5 ms, got 1.34 ms mean, from the brief), so the proxy's one-way delay was tuned until the measured round trip was near the target and the measured values are what is reported: idle median 0.114 ms direct, 0.151 ms through the proxy with no delay, 5.08 ms and 19.40 ms for the two delayed paths; with 8 connections at depth 1 under load 4.75 ms and 19.48 ms. **The 1 ms point is simulator-only**: `tc`, `ip` and the `sch_netem` module are not available in this kernel (`CONFIG_NET_SCH_NETEM` is not set). The "4 ms" point is 4.75 ms, the floor of what the timer allows above its resolution.
- **Closed loop**: N callers each issue the next unit when the last one returns; warm-up 1 s, measure 3 s. **Open loop**: Poisson arrivals at a fixed rate, 1 s warm-up, then arrivals for as long as it takes to schedule 103,000 fast statements; latency is taken from the scheduled send time, so a late tick does not hide the tail; arrivals are handled on a timer tick of about 1 ms (a Bun limit), which adds up to 1 ms to every latency equally. After the last arrival the run waits 3 s; statements still outstanding then are counted with their age (right-censored, run marked overloaded).
- **Client CPU per statement**: CPU seconds of the load generator process (user plus system) over completed statements in the window; utilisation is the same CPU over wall time.
- **Simulator** (`scripts/sim/`): discrete-event, seeded, virtual clock, running the same pool core and policy files. Server: one serial backend per connection; CPU work of busy backends shares 2 cores (processor sharing); timed statements hold their backend without CPU; a log-normal CPU spread and a rare extra delay taken from the depth-1 latency tail; a wake-up cost for a backend that was idle when a batch arrived. Client: one thread that serialises issuing, writing and reading with fitted per-unit, per-statement, per-write and per-read costs. Network: fixed one-way delay, delivery on a timer grid for the proxied paths. Service times are measured (`results/service.json`); nine parameters are fitted (`results/calibration.json`).
- **Simulator validation** (`rules.json`, `scripts/sim/validate.ts`): calibrate on the fast-only loopback and 20 ms cells, predict the others, criterion fixed first: simulated median throughput within 15% of the real run, and no inversion of a policy pair that is separated in the real runs (worst run of one better than the best run of the other), checked on throughput and, at the real arrival rates, on p99.9. Fit 1 and 2 were made before any held-out cell was read; the blind predictions are `results/sim-predictions-blind.json` and their check on the five held-out cells then available is `results/validation-attempt2.json` (it failed). The three recalibrations after that failure are fits 3, 4 and 5; they were motivated by seeing the held-out results, so predictions after fit 2 are not blind. Fit 4 followed a simulator bug (below). Fit 5 changed the server's wake-up cost to apply only to an idle backend.

## Instrument defects found and fixed

1. **Closed-loop window counted warm-up** (real runner): found in a smoke test by comparing with Little's law (control at 20 ms gave 542/s, the proxy counted 408/s); the window now starts only after warm-up.
2. **Open-loop drain not recorded** (real runner and simulator): completions after the last arrival were dropped from the latency sample, which removes exactly the tail. Fixed before any open-loop run was kept.
3. **Simulator wake-up bug**: a client wake-up scheduled for a later item suppressed the wake-up for an earlier response, so connections idled until the next arrival tick; `control` looked overloaded at 5000/s. Found when a held-out cell showed it; fixed and the simulator refitted (fit 4).
4. **Simulator wake-up cost charged per arriving batch** instead of per idle backend, which made pipelines of 8 look much cheaper than they are (fit 5).
5. **Validation compared runs of different length** (the simulator ran 40,000 fast statements, the real runs 103,000); fixed.
6. **"Not run" rows in the verdict**: sharing off with standalone statements ran two configs; the verdict gives the others control's row (alias) instead of dropping them.
7. **The frozen "wins somewhere" rule is vacuous as written.** It compares a policy's worst run with the best run of the simplest within-noise policy of the same unit, but within noise means the median of that policy is no worse than the best's worst run, so the best's worst run cannot beat its best run by 10%. The rule is reported as frozen (0 wins everywhere) and a second, labelled reading is added: the same comparison against one baseline for the whole evaluation, the default or, when there is none, the candidate outside noise in the fewest units. This is analysis beyond the rule, not a replacement.
8. **Kill scenario**: the proxy's count at the moment the server side closed includes responses still in its delay line; the table therefore reports the end-of-run difference between Syncs and ReadyForQuery as the independent count.
9. Limits that remain: the timer grid of about 1 ms in open loop; the proxy's rounding makes the delayed round trip load-dependent by a few percent; the 20 ms stuck runs for `control` and `fixed:4` are overloaded at the chosen rate; arrival and service randomness in the real runs is not seeded in the server; no real run was client-bound but the load generator was at 0.5 to 0.75 utilisation, so a faster client would not move the loopback plateau, which is the server's.

## Results

All real numbers are in `results/real-matrix.json` (one row per cell, config and load point; `results/real-summary.md` has every cell with ranges, client CPU and flags). The two tables below are made by `scripts/headline.ts`. Cell names: `rtt, mix, shape, sharing`; rtt `loop` is 0.11 ms, `d4` 4.75 ms, `d20` 19.5 ms; mixes `m0-fast`, `m1-sleep5-1` (1% of statements sleep 5 ms), `m2-sleep50-1` (1% sleep 50 ms).

Throughput, statements per second, 2048 callers (median of 5 runs). `-` = not run (sharing off, standalone: the other policies are `control` by construction).

| cell (rtt, mix, shape, sharing) | control | fixed:4 | fixed:16 | fixed:64 | rtt-aware | latency-aware | aimd |
| --- | --- | --- | --- | --- | --- | --- | --- |
| d20, m0-fast, pipeline8, off | 409 | 1.6k | 3.2k | 3.2k | 3.2k | 3.2k | 3.2k |
| loop, m0-fast, pipeline8, off | 32.1k | 43.5k | 45.3k | 43.6k | 43.4k | 42.8k | 34.0k |
| d20, m0-fast, pipeline8, on | 407 | 1.7k | 6.6k | 25.5k | 47.6k | 6.6k | 38.1k |
| loop, m0-fast, pipeline8, on | 32.8k | 43.6k | 50.4k | 44.2k | 49.2k | 48.4k | 31.6k |
| d20, m0-fast, standalone, off | 411 | - | - | - | - | 408 | - |
| d4, m0-fast, standalone, off | 1.7k | - | - | - | - | 1.7k | - |
| loop, m0-fast, standalone, off | 31.6k | - | - | - | - | 35.2k | - |
| d20, m0-fast, standalone, on | 412 | 1.7k | 6.6k | 25.5k | 47.8k | 6.6k | 39.0k |
| d4, m0-fast, standalone, on | 1.6k | 6.5k | 23.9k | 57.7k | 62.8k | 23.5k | 46.2k |
| loop, m0-fast, standalone, on | 32.2k | 46.7k | 45.5k | 48.7k | 47.2k | 46.0k | 33.4k |
| d20, m1-sleep5-1, pipeline8, on | 406 | 1.7k | 6.5k | 24.4k | 42.3k | 6.5k | 28.2k |
| loop, m1-sleep5-1, pipeline8, on | 33.2k | 44.1k | 45.1k | 47.8k | 48.7k | 45.7k | 34.1k |
| loop, m1-sleep5-1, standalone, off | 31.5k | - | - | - | - | 31.8k | - |
| d20, m1-sleep5-1, standalone, on | 407 | 1.6k | 6.0k | 21.1k | 36.9k | 6.0k | 18.6k |
| loop, m1-sleep5-1, standalone, on | 29.7k | 43.0k | 47.1k | 46.7k | 46.5k | 44.3k | 31.2k |
| loop, m2-sleep50-1, standalone, off | 12.8k | - | - | - | - | 13.0k | - |
| d20, m2-sleep50-1, standalone, on | 397 | 1.5k | 4.5k | 10.4k | 13.2k | 4.6k | 3.6k |
| loop, m2-sleep50-1, standalone, on | 13.5k | 14.3k | 14.6k | 14.5k | 14.5k | 14.5k | 13.6k |

p99.9 of fast statements in ms (median of 5 runs) at 0.5 / 0.8 of the cell's T*. `*` = every run overloaded (right-censored tail); `i` = indicative (fewer than 100,000 fast statements).

| cell | rate at 0.5 / 0.8 | control | fixed:4 | fixed:16 | fixed:64 | rtt-aware | latency-aware | aimd |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| d20, m0-fast, pipeline8, off (i) | 1621 / 2594 | 4.8k* / 4.5k* | 137 / 1.5k | 31.6 / 37.1 | 29.0 / 37.3 | 31.3 / 36.2 | 28.3 / 38.1 | 28.2 / 38.0 |
| loop, m0-fast, pipeline8, off | 22671 / 36274 | 9.8 / 435 | 5.0 / 10.0 | 5.5 / 14.8 | 5.0 / 20.8 | 5.7 / 50.1 | 5.9 / 26.0 | 8.1 / 170 |
| d20, m0-fast, pipeline8, on | 23779 / 38047 | 7.3k* / 5.7k* | 7.3k* / 5.7k* | 6.0k* / 5.5k* | 30.6 / 1.8k | 34.2 / 37.2 | 6.0k* / 5.6k* | 592 / 1.0k |
| loop, m0-fast, pipeline8, on | 25174 / 40279 | 29.0 / 326 | 7.3 / 32.1 | 7.4 / 29.6 | 6.1 / 25.2 | 7.8 / 26.9 | 6.8 / 25.1 | 10.9 / 235 |
| d20, m0-fast, standalone, off (i) | 205 / 329 | 34.3 / 48.5 | - | - | - | - | 30.3 / 48.7 | - |
| d4, m0-fast, standalone, off (i) | 838 / 1341 | 8.9 / 12.9 | - | - | - | - | 9.3 / 13.1 | - |
| loop, m0-fast, standalone, off | 17598 / 28156 | 9.4 / 19.3 | - | - | - | - | 6.2 / 21.1 | - |
| d20, m0-fast, standalone, on | 23881 / 38209 | 7.3k* / 5.7k* | 7.3k* / 5.7k* | 6.0k* / 5.6k* | 27.2 / 1.9k | 32.3 / 44.8 | 6.1k* / 5.6k* | 587 / 1.0k |
| d4, m0-fast, standalone, on | 31397 / 50235 | 6.3k* / 5.1k* | 6.0k* / 5.1k* | 1.5k / 3.5k* | 15.3 / 106 | 14.4 / 150 | 1.5k / 3.4k* | 20.9 / 1.1k |
| loop, m0-fast, standalone, on | 24361 / 38977 | 13.8 / 184 | 7.0 / 26.2 | 5.9 / 21.8 | 6.5 / 18.0 | 12.2 / 27.1 | 16.5 / 24.6 | 24.4 / 791 |
| d20, m1-sleep5-1, pipeline8, on | 21163 / 33861 | 7.9k* / 6.1k* | 7.9k* / 6.1k* | 6.2k* / 5.7k* | 34.2 / 1.6k | 35.6 / 43.8 | 6.2k* / 5.7k* | 548 / 1.2k |
| loop, m1-sleep5-1, pipeline8, on | 24351 / 38961 | 11.9 / 430 | 11.3 / 27.1 | 12.8 / 28.5 | 12.4 / 28.2 | 12.0 / 23.6 | 13.5 / 42.2 | 12.5 / 659 |
| loop, m1-sleep5-1, standalone, off | 15917 / 25467 | 7.8 / 25.0 | - | - | - | - | 7.3 / 48.8 | - |
| d20, m1-sleep5-1, standalone, on | 18444 / 29511 | 8.6k* / 6.5k* | 8.6k* / 6.5k* | 6.6k* / 5.9k* | 38.9 / 1.0k | 42.2 / 39.2 | 6.6k* / 5.9k* | 619 / 971 |
| loop, m1-sleep5-1, standalone, on | 23576 / 37722 | 11.3 / 1.2k | 9.9 / 38.6 | 10.9 / 69.5 | 11.3 / 27.8 | 9.6 / 29.7 | 12.8 / 22.4 | 10.2 / 756 |
| loop, m2-sleep50-1, standalone, off | 6488 / 10381 | 25.6 / 69.5 | - | - | - | - | 26.0 / 68.5 | - |
| d20, m2-sleep50-1, standalone, on | 6586 / 10538 | 18.6k* / 12.9k* | 15.4k* / 12.0k* | 5.3k* / 7.9k* | 164 / 365 | 175 / 250 | 6.0k* / 7.8k* | 8.9k* / 9.1k* |
| loop, m2-sleep50-1, standalone, on | 7288 / 11661 | 29.7 / 104 | 55.3 / 95.9 | 90.0 / 127 | 89.1 / 175 | 53.4 / 94.6 | 102 / 132 | 31.1 / 96.2 |

Other result files: `results/verdict.md` (the rule applied, real and simulated, sharing off and on), `results/evidence.md` (depth trace against counters, correctness, stuck connection, kill), `results/limits.md` (where each shape ends), `results/sharing-cost.md`, `results/sim-summary.md` (every simulated cell, exploratory), `results/validation*.json`, `results/calibration.json` (all five fits).

### Simulated matrix (exploratory, outside the rule)

The same rule run on the simulated rows, for what it is worth: sharing on, 140 valid units (34 client-bound in the model, excluded): D* = `fixed:128`, no default (control outside noise in 136 units, fixed:128 in 102, rtt-aware in 101, aimd 134, latency-aware 132). Sharing off, 160 valid units: D* = `fixed:8` (all depths 8 to 64 tie), no default (fixed:8 outside noise in 3 units, latency-aware 3, control 78, rtt-aware 61, aimd 65; the last two differ from the real run because the simulator ran them with a cap that binds in pipelines of 8). At the simulated 1 ms path, sharing on, fast-only standalone: saturation 50.9k (rtt-aware); sharing off 7.5k (8 connections / 1.07 ms), in line with the other paths. These do not change the real verdict.

## Documentation and source read

| source | what for | raw? |
| --- | --- | --- |
| `docs/QUALITY_CONSTITUTION.md` (principles 2, 6, 10) | rules this study follows | raw (repository file) |
| `docs/adr/018`, `019`, `024`, `034` | the decisions this study feeds; none is changed | raw (repository files) |
| `research/fs-06/README.md`, `research/fs-06/scripts/lib/*.ts`, `scripts/docker/pgbouncer.Dockerfile` | PostgreSQL image digest, pooler facts (depth 2/10/100 pass behind four poolers, unnamed statements), the client code copied | raw (repository files) |
| `research/fs-14/README.md` | Drizzle's sharing and auto depth, the shape lesson | raw (repository file) |
| `AGENTS.md`, `.github/pull_request_template.md` | repository rules, PR fields | raw |
| the roadmap row and the Bun timer measurement (0.5 ms asked, 1.34 ms mean) | the question and the RTT constraint | the brief's text, not a file; the timer values were taken from it, then re-measured only indirectly (`results/rtt.json`) |
| web search for a field report of a latency-aware scheduler regression (ADR 018's basis) | one round, two queries | **no**: result lists and summaries only; nothing was found, nothing is cited |
| `postgres` 19.0 image | the server | `docker.io/library/postgres@sha256:bb6e70add742cd868fb62cb3b2f67d1dd2bdd2b65a521e778420748753687c60` (the digest in the FS-06 README); `SELECT version()` printed `PostgreSQL 19.0 (Debian 19.0-1.pgdg13+1)` |

## Not verified

| what | why | exact command to extend it |
| --- | --- | --- |
| PgBouncer 1.26.1 (transaction mode, small server pool) | cut first by the brief's order | build FS-06's image (`research/fs-06/scripts/docker/pgbouncer.Dockerfile`), run Postgres on another port inside a Docker network, run PgBouncer with `-p 127.0.0.1:55432:6432`, then `taskset -c 0 bun scripts/real/main.ts p2` unchanged: the harness and the proxy both connect to port 55432 |
| PgDog, Odyssey, Supavisor | optional, only after the required work | same, with FS-06's configurations (`research/fs-06/scripts/poolers.ts`) |
| Safe depth ceilings behind poolers and whether a policy makes a pooler misbehave | no pooler was run; FS-06 shows depth 100 with a Sync per statement works behind PgBouncer, Supavisor, PgDog and Odyssey (1 round trip on the pooler link for PgBouncer and Supavisor, 100 for PgDog, 300 for Odyssey) | the PgBouncer row, with `fixed:128` and `rtt-aware` cells |
| Reference points: `drizzle-orm@1.0.0-rc.6` (`drizzle-orm/postgres`), node-postgres, postgres.js on the mixed cells | optional; no black-box harness was written | `mkdir -p work/ref && cd work/ref && bun add drizzle-orm@1.0.0-rc.6 pg postgres`, then drive each with the mixes of `scripts/core/workload.ts` through the same proxy |
| 10% slow share, CPU-bound slow statements, 95% rate and extra D values on real servers | cut by the brief's order; the 10% cells were started and stopped | `taskset -c 0 bun scripts/real/main.ts p2 m3-sleep5-10`; CPU-bound mixes (`m5` to `m8`) need entries in `scripts/real/plans.ts`; a pool larger than 8 is needed for 10% of 50 ms to reach 100,000 fast statements |
| The 1 ms point on a real path | no `tc`, `ip` or `sch_netem` here | on a kernel with netem: `tc qdisc add dev lo root netem delay 0.5ms`, then run `loop` cells |
| Delayed sharing-off cells with 100,000 fast statements | T* is 411 to 1.7k statements/s with 8 connections, so 100,000 fast statements at half of T* take 100,000 / (0.5 x T*) seconds per run; the rows are indicative | `taskset -c 0 bun scripts/real/main.ts p1 d20` with `fastTarget` removed in `scripts/real/plans.ts` |
| Stuck-connection run at 20 ms for `control` and `fixed:4` | offered rate above their capacity | rerun `scripts/real/scenarios.ts stuck` with `rateOf` set to 300 for the delayed path |
| Kill scenario at saturation (loss against the cap) | the runs were at about half load, so the loss equals the load at the moment, not the cap | closed loop with 2048 callers and `scenario: 'kill'` |
| A field report of a latency-aware scheduler regression | not found (finding 10) | read the issue trackers of the drivers named in ADR 019's basis, then reproduce what regressed |
| The simulator as evidence | failed its criterion after three recalibrations | model per-write server cost and per-statement client cost separately, which standalone calibration cells cannot identify: add pipeline-of-8 cells to the calibration set |

## Proposed decision

Findings only; no ADR here and no ADR number reserved. "Required" means the valid real units.

| for | what the evidence says | evidence |
| --- | --- | --- |
| ADR 018 default policy | The frozen rule names none: no candidate is within noise in every required unit, with sharing on or off. With sharing on the nearest is `rtt-aware` (11 of 35 units, mostly client CPU per statement); a fixed depth is outside noise in 26 of 35 units at D = 64 because 8 x 64 / 19.5 ms cannot carry 80% of the saturation reached at depth 128. With sharing off, 13 valid units (all loopback): `fixed:16` is outside noise in 2 (loopback standalone, where it is `control` and `latency-aware`'s placement is about 3% better on throughput), `control` in 5 (the pipeline-of-8 cell by about 20% throughput), `latency-aware`, `rtt-aware` and `aimd` in 5 each (mostly client CPU) | `results/verdict.md` |
| depth bound | The cap has to exceed round trip x arrival rate / connections: 8 x 64 carried 25.5k/s at 19.5 ms, 8 x 128 carried 47.8k/s. A single D from 4 to 64 is within noise of the others at loopback; no D is right at every RTT | `results/headline.md`, `results/limits.md`, trace in `results/evidence.md` |
| options and where they win | `rtt-aware`: the only candidate that carries 0.5 and 0.8 of T* at 19.5 ms and 4.75 ms without overload and with a p99.9 of 14 to 45 ms; it loses on client CPU per statement at loopback by small margins. `control` (depth 1) and `aimd`: ahead of `rtt-aware` on p99.9 and slow p99 only where long statements are common and the round trip is small (loopback, 1% sleeping 50 ms, secondary reading); they lose elsewhere by 2x to 100x. `latency-aware` (as defined here): no unit where it wins; herds onto a stuck connection up to its cap and starves it after the release. `fixed:D`: wins nowhere against `rtt-aware` | `results/verdict.md` (secondary reading), `results/evidence.md` |
| whether sharing is needed | Sharing off saturates at 31.6k, 1.7k and 411 statements/s (loopback, 4.75 ms, 19.5 ms) against 48.7k, 62.8k and 47.8k with sharing on: 1.5x, 37x, 116x with 8 connections. At a rate sharing off can carry, the tails overlap. Within-caller pipelining recovers at most the pipeline length (8x at 19.5 ms). Without sharing the same throughput needs round trip x rate exclusive connections (about 930 at 19.5 ms and 47.8k/s) | `results/sharing-cost.md`, `results/headline.md` |
| ADR 034 / principle 6 | The cap bounds the statements whose outcome is unknown after a connection dies (lost count = in flight at that moment, at most the cap, confirmed by trace); statements waiting in the pool or unsent in a caller's pipeline are known not to have run. A small cap also leaves the rest of a pipeline unsent (control: 1 on the wire, 6 unsent) | `results/evidence.md`, kill table |
| pooler ceilings | not measured here; FS-06's depth 100 passes behind four poolers; pooler-link cost grows with depth for PgDog (100) and Odyssey (300) | Not verified |

## Decisions beyond the brief

1. **Pool of 8 connections**, late binding (a unit waits in the pool queue until a connection has room), and the exact meaning of sharing off (one caller at a time per connection) and of the window inside a caller's pipeline. The brief did not fix the pool.
2. **Policy constants** (`CAP` 16, `ALPHA` 0.2, `HALF_LIFE` 1000 for latency-aware; `ALPHA` 0.05, `DMAX` 128, `INIT` 2, `WINDOW` 64 for rtt-aware; `INIT` 2, `MAX` 128, `ADD` 1, `MULT` 0.5, `THRESH` 2 for aimd) were chosen once, before measuring, and never tuned. The latency-aware findings depend on them, in particular `HALF_LIFE`.
3. Latency-aware is a peak-EWMA with time decay (the form used by load balancers), not a literal "mean latency".
4. **D* selection**, the 5-run noise definition applied to the fixed grid, and the rule applied separately for sharing off and on (in `rules.json`).
5. **Real D grid 4, 16, 64; simulator grid 2 to 128.** The real grid has no 128, which is where the 20 ms plateau is; this is the extra-D cut.
6. **Overloaded open-loop runs stay in the rule**, with right-censored latencies, and count towards the 100,000-statement minimum by statements observed (completed plus censored). Reading "completed" strictly would drop every unit where a policy cannot carry the rate, which is where policies differ.
7. **Indicative is decided per cell**, as the brief words it: any open-loop run of the cell with fewer than 100,000 fast statements puts the whole cell (closed-loop unit included) out of the rule.
8. **Sharing off, standalone statements: `control` and `latency-aware` only**; the others are aliased to `control` in the verdict (defect 6).
9. **The rule's "wins somewhere" is vacuous as frozen** (defect 7); the literal result and a secondary reading are both reported.
10. **No client-bound or proxy-bound flag fired** (thresholds 0.92 in `rules.json`; maxima 0.75 and 0.12), so the unit filter was not exercised.
11. **Round trip points**: 4.75 ms stands for "about 4 ms" (the timer floor), 19.5 ms for "about 20 ms", loopback measured direct 0.11 ms; the 1 ms point exists only in the simulator.
12. **Postgres in a container on the host network**, pinned to cores 2 and 3, `fsync=off`, `jit=off`, `shared_buffers=512MB`, `max_connections=100`; the kv table has 100,000 rows. Throwaway credentials (`fs05` / `fs05pw`), a container that exists only during the run.
13. **Stuck and kill runs at fixed rates** (8,000/s at loopback, 3,000/s at 20 ms with sharing on, 150/s with sharing off at 20 ms), three runs for stuck, one for kill and correctness; loopback scenarios through the zero-delay proxy.
14. **The 10% share cells were started and stopped**; their partial rows (3 runs of one config) are not aggregated.
15. **Simulator parameter structure** (processor sharing on 2 cores, one client thread, a rare extra delay, an idle-wake cost) and the use of the loaded round trip for the delayed paths.
16. **Five fits and three recalibrations** are all kept (`results/calibration.json`, `results/validation-attempt*.json`); the predictions after fit 2 are not blind.
17. **PgBouncer, other poolers and reference clients not run** (cut order); no time was spent on them.
18. The simulator's 95% rate and the real 95% rate outside the calibration cells were cut, as was the simulated 10% CPU-bound share (m7, m8).

## Reproduce

Needs bun, Docker (the daemon may need `dockerd` started by hand), 4 vCPUs and `taskset`. From the repository root:

```bash
cd research/fs-05
./run-all.sh                      # everything below, in order; real runs resume from work/raw/*.jsonl
scripts/real/pg-up.sh             # PostgreSQL 19.0 by digest on 127.0.0.1:55432, cores 2-3
taskset -c 0 bun scripts/real/selfcheck.ts      # instrument self-checks
taskset -c 0 bun scripts/real/main.ts p1        # calibration cells; then p2 for the held-out cells
bun scripts/real/aggregate.ts && bun scripts/verdict.ts      # results/real-matrix.json, results/verdict.md
bunx tsc -p research/fs-05/tsconfig.json --noEmit            # from the repository root: typechecks this folder once, outside every src project
```

## Files

- `rules.json` the frozen rule; `results/simplest.json` the simplicity order (made before any measurement).
- `scripts/policy/` the five policies and `types.ts`; `scripts/core/` the pool, workload, PRNG, statistics; `scripts/sim/` simulator, calibration, prediction, validation, matrix; `scripts/real/` load generator, proxy, scenarios, plans, probes, `lib/` (copied FS-06 client); `scripts/verdict.ts`, `report.ts`, `evidence.ts`, `limits.ts`, `headline.ts`, `sharing-cost.ts`, `simplest.ts`.
- `results/` small result files only (under 1 MB): `real-matrix.json`, `sim-matrix.json.gz`, `verdict.*`, `evidence.*`, `headline.md`, `limits.md`, `sharing-cost.md`, `real-summary.md`, `sim-summary.md`, `calibration.json`, `validation*.json`, `sim-predictions*.json`, `rtt.json`, `service.json`, `pgbench.txt`.
- `.gitignore` here ignores `work/` (raw per-run lines, logs, the Postgres data, scratch) and `*.log`.
