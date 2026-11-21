# Agent skills

- Source: `mattpocock/skills` at commit `abeeaf95660ba9e8b7c753eb38f441ca707a8823`. Installed with `skills` CLI 1.9.0 as editable copies in `.claude/skills/` (Claude Code and Cursor both read it). Lock: [skills-lock.json](../skills-lock.json).
- Installed: `tdd`, `diagnosing-bugs`, `code-review`, `prototype`, `setup-matt-pocock-skills`.
- Excluded: `to-spec`, `to-tickets`, `implement`, `implement-spec`, `grill-with-docs`, `wayfinder` (compete with the roadmap, the state file and one chat per task); `pr` (the PR template owns the PR body).
- Local deviations from upstream:
  - `.claude/skills/prototype/SKILL.md:22`: `pnpm <name>` changed to `bun run <name>`.
  - `.claude/skills/tdd/mocking.md:6`: "Databases (sometimes - prefer test DB)" changed to "Databases (not in OKDriver: tests run against real engines, never a mocked database)".
- The lock hashes for `prototype` and `tdd` are the upstream values and no longer match the edited files.
- After any `skills` CLI update, re-apply both deviations and re-run the conflict check (package manager, independent oracles, no mocks of the thing under test, no time estimates, no SQL interpolation, merging only as AGENTS.md allows, no commit on main).
- References that no longer resolve (skills named in installed files but not installed): `codebase-design`, `triage`, `to-spec`, `to-tickets`, `wayfinder`, `grill-with-docs`, `domain-modeling`, `improve-codebase-architecture`.
