# Quality Constitution

These are the binding quality rules of OKDriver. They bind every contributor and every coding
agent. `AGENTS.md` names this file as the first document to read.

Most enforcement mechanisms arrive with later roadmap tasks (boundary tests in P0-T05, CI in
P0-T07, the rest in later phases). Until a check exists, the "How it is enforced" text is the
review rule, and a reviewer rejects a change that breaks the principle.

| # | Principle | How it is enforced |
| --- | --- | --- |
| 1 | No correctness claim without independent evidence | A feature record cannot reach "done" without an evidence link from the spec-independent family in roadmap section 11 |
| 2 | No performance claim without reproducible benchmarks | Published numbers must cite a benchmark run with raw data and a reproduction command |
| 3 | No runtime compatibility claim without actual testing | Capability and support-level tables are generated from CI results |
| 4 | No unnecessary abstraction | A shared abstraction needs two engine classes using it without shims (FS-01 rule) and an ADR |
| 5 | No hidden database behaviour differences | Differences are capabilities or documented engine notes; no cross-engine emulation without an explicit opt-in |
| 6 | No unsafe automatic retries | The retry rules of roadmap section 14 are tested by fault injection; any new retry path needs an ADR |
| 7 | No secret leakage | The planted-secret test runs on every output channel in CI |
| 8 | No silent breaking changes | API surface is snapshot-tested; any change needs a changelog entry and, in 0.x, a minor version bump |
| 9 | Every feature has a Capability Contract | Generated from the feature record; missing record blocks merge |
| 10 | Every critical architectural decision has an ADR and supporting evidence | PRs touching core, scheduler, auth, TLS or contracts must link an ADR |
| 11 | All database engines have independent conformance coverage | A release gate checks each engine's own suite, traces, corpus and differential run |
| 12 | Shared code must never compromise engine-specific correctness | A platform change runs every engine's full suite; boundary tests of roadmap section 4 |
| 13 | The specification is the source of truth | Generated files are never edited by hand; CI regenerates and diffs |
| 14 | Excluded ideas are recorded, not deleted | Rejections live in the ADR log with reason and evidence |

**Amendment.** Changing a principle requires an ADR that states what evidence made the principle wrong, and a review by a human maintainer. An agent may propose an amendment and may not apply one.

**Agent rules derived from the constitution.** Read the spec and the relevant feature record before editing; change the spec before the core; never mark a gate as passed without the linked artifact; never weaken a test to make it pass; one reviewable change per pull request; state machine, scheduler, authentication and TLS changes always need human review.
