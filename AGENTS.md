# AGENTS.md

OKDriver is a verifiable, high-performance SQL driver platform for TypeScript, targeting
PostgreSQL, MySQL, MariaDB and SQLite. It is under active development and not usable yet.

## Rules

- Use `bun` and `bunx` as the package manager and script runner. No npm, pnpm or yarn.
- Zero runtime dependencies.
- No install scripts: no `preinstall`, `install`, `postinstall` or `prepare`.
- License is Apache-2.0. Any adapted code keeps its attribution in `NOTICE`.
- Never commit on `main`, create tags, or publish.
- One reviewable change per PR.
- Changes to protocol state machines, scheduling, authentication or TLS always need human review.

The full rule set arrives later with `docs/QUALITY_CONSTITUTION.md`.
