# Releasing

How a release of `okdriver` reaches npm. The design is ADR 043. Only a maintainer releases.
Agents never tag and never run `release.yml`.

The pipeline is `.github/workflows/release.yml`. It builds the tarball twice on two runners,
requires the two tarballs to be byte-identical, and then stages the package on npm through OIDC
with provenance. It never publishes: the package goes live only when a maintainer approves the
staged version on npm with two-factor authentication.

## One-time setup (maintainer)

1. GitHub environment `release` (repository Settings, Environments).
   - Deployment branches and tags: selected, with the tag rule `v*`.
   - The `stage` job is the only job that uses it.
2. npm trusted publisher for `okdriver` (package Settings, Trusted Publisher, GitHub Actions).
   - Organization or user: `omqkhafi`
   - Repository: `okdriver`
   - Workflow filename: `release.yml`
   - Environment name: `release`
   - Allowed actions: stage-only. Do not allow `npm publish` and do not allow dist-tag changes.
3. Package Settings, Publishing access: select "Require two-factor authentication and disallow
   tokens".

Create the trusted publisher right before the first release run. A configuration that has not
been validated by a run expires after 48 hours.

## Release

1. Bump `version` in `package.json` by PR and merge it. The tag must be `v` plus that version.
2. Tag the merge commit on `main` and push the tag:

   ```bash
   git tag vX.Y.Z <commit-on-main>
   git push origin vX.Y.Z
   ```

3. `release.yml` runs on the tag. `stage` fails unless the tag equals `v` + the packed version,
   the tag commit is an ancestor of `origin/main`, and the tarball matches the sha256 that
   `verify` printed. A version with `-` is staged with the dist-tag `next`, any other with
   `latest`.
4. Open the run's `verify` job summary and note the tarball sha256. The `sbom` artifact holds
   the SPDX SBOM.
5. Find the stage id, download the staged tarball and compare:

   ```bash
   npm stage list okdriver
   npm stage download <stage-id>
   sha256sum <downloaded-tarball>
   ```

   The sha256 must equal the one in the job summary.
6. Approve the staged package. npm asks for two-factor authentication:

   ```bash
   npm stage approve <stage-id>
   ```

   To discard it instead: `npm stage reject <stage-id>`.

## Dry run

Run `release.yml` from the Actions tab with "Run workflow" (`workflow_dispatch`). It runs
`build` and `verify`, then repacks the verified tarball as `0.0.0-dryrun.0` and runs
`npm stage publish --dry-run`. It has no `id-token` permission and stages nothing.
`0.0.0-dryrun.0` is never published.
