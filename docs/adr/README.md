# Architecture Decision Records

ADRs 001–041 were copied from roadmap section 19 in P0-T04. The roadmap is not part of this repository. The next ADR is 045. Name files `NNN-short-title.md`.

## Index

| ADR | Title | Status |
| --- | --- | --- |
| [001](001-four-engines-in-scope-before-1-0.md) | Four engines in scope before 1.0 | Accepted |
| [002](002-long-0-x-line-1-0-is-production-excellence.md) | Long 0.x line, 1.0 is production excellence | Accepted |
| [003](003-shared-platform-designed-for-four-engines-up-front.md) | Shared platform designed for four engines up front | Accepted |
| [004](004-mariadb-is-an-independent-engine.md) | MariaDB is an independent engine | Accepted |
| [005](005-three-engine-classes-wire-embedded-service.md) | Three engine classes: wire, embedded, service | Accepted |
| [006](006-independent-oracles-are-mandatory.md) | Independent oracles are mandatory | Accepted |
| [007](007-replication-and-cdc-are-pre-1-0.md) | Replication and CDC are pre-1.0 | Accepted |
| [008](008-former-v1-x-items-enter-pre-1-0-scope.md) | Former v1.x items enter pre-1.0 scope | Accepted |
| [009](009-maturity-labels-per-cell-during-0-x.md) | Maturity labels per cell during 0.x | Accepted |
| [010](010-scope-change-process.md) | Scope-change process | Accepted |
| [011](011-sans-io-protocol-cores-thin-transports.md) | Sans-IO protocol cores, thin transports | Accepted |
| [012](012-executable-spec-generates-the-core-artifacts.md) | Executable spec generates the core artifacts | Accepted |
| [013](013-postgresql-protocol-3-0-default-3-2-opt-in.md) | PostgreSQL protocol 3.0 default, 3.2 opt-in | Accepted |
| [014](014-one-round-trip-execution-including-behind-poolers.md) | One-round-trip execution, including behind poolers | Accepted |
| [015](015-server-decides-parameter-types.md) | Server decides parameter types | Accepted |
| [016](016-binary-results-only-for-a-fixed-oid-list.md) | Binary results only for a fixed OID list | Accepted |
| [017](017-default-row-is-a-plain-object.md) | Default row is a plain object | Accepted |
| [018](018-simple-pipeline-scheduler-by-default.md) | Simple pipeline scheduler by default | Accepted |
| [019](019-no-connection-multiplexing.md) | No connection multiplexing | Rejected |
| [020](020-no-native-or-wasm-core-requirement.md) | No native or WASM core requirement | Rejected |
| [021](021-no-server-companion-proxy-or-extension.md) | No server companion, proxy or extension | Rejected |
| [022](022-no-quic-or-webtransport-transport.md) | No QUIC or WebTransport transport | Rejected |
| [023](023-no-implicit-transaction-context-by-default.md) | No implicit transaction context by default | Rejected |
| [024](024-no-auto-batching-across-a-tick-by-default.md) | No auto-batching across a tick by default | Rejected |
| [025](025-deno-is-not-a-tested-target.md) | Deno is not a tested target | Accepted |
| [026](026-compiler-does-not-depend-on-the-typescript-compiler-api.md) | Compiler does not depend on the TypeScript compiler API | Accepted |
| [027](027-dynamic-credential-providers-are-core.md) | Dynamic credential providers are core | Accepted |
| [028](028-conformance-suite-under-neutral-governance.md) | Conformance Suite under neutral governance | Open |
| [029](029-minimum-node-js-version.md) | Minimum Node.js version | Accepted |
| [030](030-one-unscoped-package-okdriver.md) | One unscoped package, okdriver | Accepted |
| [031](031-fs-01-runs-on-provisional-contracts.md) | FS-01 runs on provisional contracts | Accepted |
| [032](032-service-integration-contract-and-separate-execution-coordinator.md) | Service integration contract and separate execution coordinator | Accepted |
| [033](033-four-categories-with-separate-completeness-criteria.md) | Four categories with separate completeness criteria | Accepted |
| [034](034-two-level-outcomes.md) | Two-level outcomes | Accepted |
| [035](035-no-client-side-parameter-interpolation-by-default.md) | No client-side parameter interpolation by default | Accepted |
| [036](036-feature-records-separate-target-expected-and-verified-capability.md) | Feature records separate target, expected and verified capability | Accepted |
| [037](037-change-stream-contract-with-typed-per-engine-positions.md) | Change-stream contract with typed per-engine positions | Accepted |
| [038](038-evidence-registry.md) | Evidence Registry | Accepted |
| [039](039-scope-admission-rules-and-0-9-feature-freeze.md) | Scope admission rules and 0.9 feature freeze | Accepted |
| [040](040-longest-dependency-chain-replaces-critical-path.md) | Longest dependency chain replaces critical path | Accepted |
| [041](041-apache-2-0-license-with-notice.md) | Apache-2.0 license with NOTICE | Accepted |
| [042](042-repository-layout.md) | Repository layout: plain folders under `src/` with TypeScript project references | Accepted |
| [043](043-tag-triggered-stage-only-oidc-publishing.md) | Tag-triggered, stage-only OIDC publishing with no tokens | Accepted |
| [044](044-fs-01-contract-verdicts.md) | FS-01 contract verdicts: no contract is adopted yet | Accepted |

## Template

```md
# NNN. Title

## Status
Proposed | Accepted | Open | Rejected | Superseded by NNN

## Open question
Optional. The question that stays unsettled although the decision is.

## Context
Optional. What problem or force makes this decision necessary?

## Decision
What we decided, stated plainly.

## Consequences
Optional. What becomes easier, harder or different as a result.

## Evidence
Optional. Benchmarks, tests, specs or prior art that support the decision.

## Basis
Optional. The source the decision rests on.
```

Status values:

- Proposed: waits for the owner's confirmation.
- Accepted: settled; reopened only by a new ADR.
- Open: not decided yet; where the file names a study or task, that one decides it.
- Rejected: the idea is excluded and kept on record (constitution principle 14).
- Superseded by NNN: replaced by the ADR with that number.

ADRs 001–041 were copied from the roadmap. They carry only Status, Decision, Basis and, where it applies, Open question. Their Status section also keeps the roadmap's own status text on a `Roadmap status:` line. An Accepted ADR with an Open question means the decision is settled and the named question is not.
