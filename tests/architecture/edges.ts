// Allowed project-to-project edges for `src/`.
//
// Copied from the reference list in ADR 042 (docs/adr/042-repository-layout.md),
// which encodes roadmap section 4:
//   - `platform` references nothing.
//   - `transports`, `engines/postgres`, `engines/mysql-family`, `engines/sqlite`, `verify`,
//     `compile` and `adapters` reference `platform`.
//   - `engines/mysql` and `engines/mariadb` reference `engines/mysql-family` and `platform`.
//   - Engines never reference each other.
//
// Keys and values are project folders relative to `src/`. A project may always import
// from itself. `src/*/tsconfig.json` `references` must equal this table (edges.test.ts).
export const ALLOWED_EDGES = {
  platform: [],
  transports: ["platform"],
  "engines/postgres": ["platform"],
  "engines/mysql-family": ["platform"],
  "engines/mysql": ["engines/mysql-family", "platform"],
  "engines/mariadb": ["engines/mysql-family", "platform"],
  "engines/sqlite": ["platform"],
  verify: ["platform"],
  compile: ["platform"],
  adapters: ["platform"],
} as const satisfies Record<string, readonly string[]>;

export type ProjectId = keyof typeof ALLOWED_EDGES;

// External (non-relative) specifiers a project may import, matched exactly. This includes
// `node:` and `bun:` specifiers. Empty everywhere: a project imports nothing external yet.
export const EXTERNAL_ALLOWLIST = {
  platform: [],
  transports: [],
  "engines/postgres": [],
  "engines/mysql-family": [],
  "engines/mysql": [],
  "engines/mariadb": [],
  "engines/sqlite": [],
  verify: [],
  compile: [],
  adapters: [],
} as const satisfies Record<ProjectId, readonly string[]>;

export interface Policy {
  edges: Readonly<Record<string, readonly string[]>>;
  externals: Readonly<Record<string, readonly string[]>>;
}

export const DEFAULT_POLICY: Policy = {
  edges: ALLOWED_EDGES,
  externals: EXTERNAL_ALLOWLIST,
};
