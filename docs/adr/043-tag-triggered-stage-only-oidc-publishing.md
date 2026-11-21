# 043. Tag-triggered, stage-only OIDC publishing with no tokens

## Status
Accepted

## Context
`okdriver` is one published package (ADR 030) with zero runtime dependencies and no install
scripts. The release path controls the publishing identity, so it is part of the security
posture: no long-lived token may exist, no single actor may make a version go live alone, and a
consumer must be able to check that the published bytes come from this repository.

bun is the package manager and script runner (AGENTS.md). Bun's current documentation for
`bun publish` describes token and one-time-password authentication, and states that it cannot
generate provenance statements yet. It describes neither OIDC trusted publishing nor staged
publishing. `bun publish --help` (1.4.5, the pinned version) lists neither.

## Decision
- Releases run only from `.github/workflows/release.yml`, triggered by a push of a tag `v*`.
  `workflow_dispatch` runs the dry run only and never stages.
- The workflow stages the package with `npm stage publish`, authenticated by GitHub OIDC
  through an npm trusted publisher restricted to staging and to the GitHub environment
  `release`. It never runs `npm publish`, sets no `NODE_AUTH_TOKEN` and writes no `.npmrc`
  auth. The package setting "Require two-factor authentication and disallow tokens" is on.
- A staged package goes live only when a maintainer approves it on npm with two-factor
  authentication (`npm stage approve`), after comparing the staged tarball's sha256 with the one
  printed in the `verify` job summary.
- The tarball is built twice on two separate runners with `bun pm pack`. The release continues
  only if the two tarballs are byte-identical. `stage` uploads the verified tarball, and only
  after its sha256 matches the one `verify` printed.
- `stage` requires the tag to be `v` + the packed `package.json` version and the tag commit to be
  an ancestor of `origin/main`.
- Provenance comes from npm (`--provenance`). The SPDX SBOM from `npm sbom` is kept as a
  workflow artifact only; this decision creates no GitHub Release.
- A shared check, `.github/scripts/check-pack.mjs`, requires the tarball to contain exactly
  `package.json`, `LICENSE`, `NOTICE` and `README.md`, and no `preinstall`, `install`,
  `postinstall` or `prepare` script. CI runs it too, together with a reproducibility check that
  packs twice from two copies of the checkout with different file mtimes.
- The npm CLI (exact version 11.21.3, minimum 11.15.0) is used only as the registry client
  inside `release.yml`, because bun supports neither OIDC trusted publishing nor staged
  publishing. Packing, install, typecheck and tests stay on bun. If bun gains both, this
  exception ends by a new ADR.

## Consequences
- No token exists to leak. A compromised workflow can at most stage a package that a human then
  declines to approve.
- Every release needs a maintainer to approve it on npm. That is intended.
- The tarball bytes depend on the source file modes of the checkout, which `bun pm pack`
  records. Both builds use the same checkout procedure on the same runner image, so they match.
  A checkout with a different umask would produce a different tarball.
- The tarball bytes also depend on the bun version, so the pinned `.bun-version` is part of the
  reproducibility contract.
- The release workflow pins one npm version; moving it is a reviewed change to `release.yml`.
- A trusted publisher that no run has validated expires, so it is created right before the first
  release run (docs/RELEASING.md).

## Evidence
- `bun pm pack` twice from two copies with file mtimes 2001-01-01 and 2020-06-15 gave the same
  sha256 `6df5ad90e5ef49f9b350eff514aff629f102d050b5b0fb87d0058449cf0821bc` (bun 1.4.5,
  okdriver 0.0.0, file mode 0644). The same sources with file mode 0664 give a different
  sha256, which is why the file mode is named under Consequences.
- `npm stage publish --dry-run <tarball> --tag dryrun` on npm 11.21.3 staged
  `okdriver@0.0.0-dryrun.0` in dry-run mode, with the dry-run login warning only.
- `npm sbom --sbom-format spdx` on the packed `package.json` without `devDependencies` gave an
  SPDX-2.3 document whose root package is `okdriver`.
- The negative runs of `check-pack.mjs` and the byte comparison are in the PR.
- The OIDC exchange and the real staging cannot run outside GitHub Actions and are covered by the
  first release run.

## Basis
Roadmap task P0-T09 and its security principle: zero runtime dependencies, no install scripts,
OIDC trusted publishing with tokens disabled, two-factor authentication, staged publishing,
provenance, SBOM, reproducible builds and human review of every release.
npm docs: "Trusted publishing with OIDC" and "Staged publishing for npm packages".
