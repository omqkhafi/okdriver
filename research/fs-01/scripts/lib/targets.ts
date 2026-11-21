// Per-engine facts the scripts need: how to set up and read through something that is not the
// skeleton, and which SQL placeholder the engine uses. Not part of src/.
import { mkdirSync, rmSync } from "node:fs";
import { FS01, must, run } from "./ext.ts";
import type { EnginePackage, Target } from "../../src/entry/compose.ts";
import { libsqlPackage, libsqlTarget, mariadbPackage, mariadbTarget, mysqlPackage, mysqlTarget, postgresPackage, postgresTarget, sqlitePackage } from "../../src/entry/packages.ts";

export type EngineName = "postgres" | "mysql" | "mariadb" | "sqlite" | "libsql";
export const ENGINES: EngineName[] = ["postgres", "mysql", "mariadb", "sqlite", "libsql"];
export const SQLITE_FILE = `${FS01}/work/accept.sqlite`;

export interface TargetConfig {
  name: EngineName;
  pkg: EnginePackage;
  target: Target;
  ph: (n: number) => string;
  proxyKind: "pg" | "mysql" | "http" | "none";
  container: string | undefined;
  /** Create an empty fs01_kv table with a primary key, using an external tool. */
  setup(): Promise<void>;
  /** Rows as "id|v" lines, read by an external tool on a new connection. */
  readRows(): Promise<string[]>;
  /** Execute one statement with an external tool. */
  externalExec(sql: string): Promise<string>;
  readRowsProbe?: () => Promise<unknown>;
  expectedTx: "failed-open" | "open";
  expectedVendor: string | number;
}

const lines = (s: string): string[] => s.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
const pg = (sql: string): Promise<string> => must(["docker", "exec", "fs01-pg", "psql", "-U", "postgres", "-d", "fs01", "-v", "ON_ERROR_STOP=1", "-At", "-c", sql]);
const my = (c: string, bin: string, sql: string): Promise<string> => must(["docker", "exec", c, bin, "-uroot", "-N", "-B", "fs01", "-e", sql]);
const py = (sql: string): Promise<string> =>
  must(["python3", "-I", "-c", "import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); c.isolation_level=None; cur=c.execute(sys.argv[2]); print('\\n'.join('|'.join(str(x) for x in r) for r in cur.fetchall()))", SQLITE_FILE, sql]);
async function hrana(sql: string): Promise<string> {
  const body = JSON.stringify({ requests: [{ type: "execute", stmt: { sql, want_rows: true } }, { type: "close" }] });
  const out = await must(["curl", "-s", "-X", "POST", "http://127.0.0.1:58080/v3/pipeline", "-H", "content-type: application/json", "--data", body]);
  const j = JSON.parse(out);
  const r = j.results[0];
  if (r.type === "error") throw new Error(`hrana: ${r.error.message}`);
  return r.response.result.rows.map((row: { value?: string }[]) => row.map((c) => c.value ?? "NULL").join("|")).join("\n");
}

export const TARGETS: Record<EngineName, TargetConfig> = {
  postgres: {
    name: "postgres", pkg: postgresPackage, target: postgresTarget, ph: (n) => `$${n}`, proxyKind: "pg", container: "fs01-pg",
    async setup() { await pg("drop table if exists fs01_kv; create table fs01_kv (id bigint primary key, v text)"); },
    async readRows() { return lines(await pg("select id || '|' || v from fs01_kv order by id")); },
    externalExec: pg, expectedTx: "failed-open", expectedVendor: "23505",
  },
  mysql: {
    name: "mysql", pkg: mysqlPackage, target: mysqlTarget, ph: () => "?", proxyKind: "mysql", container: "fs01-mysql",
    async setup() { await my("fs01-mysql", "mysql", "drop table if exists fs01_kv; create table fs01_kv (id bigint primary key, v text) engine=InnoDB"); },
    async readRows() { return lines((await my("fs01-mysql", "mysql", "select concat(id,'|',v) from fs01_kv order by id"))); },
    externalExec: (s) => my("fs01-mysql", "mysql", s), expectedTx: "open", expectedVendor: 1062,
  },
  mariadb: {
    name: "mariadb", pkg: mariadbPackage, target: mariadbTarget, ph: () => "?", proxyKind: "mysql", container: "fs01-mariadb",
    async setup() { await my("fs01-mariadb", "mariadb", "drop table if exists fs01_kv; create table fs01_kv (id bigint primary key, v text) engine=InnoDB"); },
    async readRows() { return lines(await my("fs01-mariadb", "mariadb", "select concat(id,'|',v) from fs01_kv order by id")); },
    externalExec: (s) => my("fs01-mariadb", "mariadb", s), expectedTx: "open", expectedVendor: 1062,
  },
  sqlite: {
    name: "sqlite", pkg: sqlitePackage, target: { endpoint: { host: "", port: 0 }, path: SQLITE_FILE, user: "", database: "" }, ph: () => "?", proxyKind: "none", container: undefined,
    async setup() {
      mkdirSync(`${FS01}/work`, { recursive: true });
      for (const s of ["", "-journal", "-wal", "-shm"]) rmSync(SQLITE_FILE + s, { force: true });
      await py("create table fs01_kv (id integer primary key, v text)");
    },
    async readRows() { return lines(await py("select id || '|' || v from fs01_kv order by id")); },
    externalExec: py, expectedTx: "open", expectedVendor: 1555,
  },
  libsql: {
    name: "libsql", pkg: libsqlPackage, target: libsqlTarget, ph: () => "?", proxyKind: "http", container: "fs01-sqld",
    async setup() { await hrana("drop table if exists fs01_kv"); await hrana("create table fs01_kv (id integer primary key, v text)"); },
    async readRows() { return lines(await hrana("select id || '|' || v from fs01_kv order by id")); },
    externalExec: hrana, expectedTx: "open", expectedVendor: "SQLITE_CONSTRAINT",
  },
};
void run;
