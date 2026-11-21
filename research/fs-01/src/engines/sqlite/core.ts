import { Database } from "bun:sqlite";
import type { EmbeddedCore, EmbeddedStatement, EncodedParam, RawResult, ServerFacts } from "../../platform/contracts/index.ts";

/** EmbeddedCore over bun:sqlite. safeIntegers makes every INTEGER column a bigint. */
export class BunSqliteCore implements EmbeddedCore {
  private readonly db: Database;
  readonly facts: ServerFacts;
  constructor(path: string) {
    this.db = new Database(path, { create: true, safeIntegers: true });
    this.db.exec("PRAGMA busy_timeout = 5000");
    const version = String(this.db.query("select sqlite_version()").values()[0]![0]);
    this.facts = { version, params: { binding: "bun:sqlite" }, observedTx: this.db.inTransaction ? "in-tx" : "idle" };
  }
  get inTransaction(): boolean {
    return this.db.inTransaction;
  }
  prepare(sql: string): EmbeddedStatement {
    const stmt = this.db.prepare(sql);
    return {
      execute: (params: readonly EncodedParam[]): RawResult => {
        const args = params.map((p) => p.data) as never[];
        const names = stmt.columnNames;
        if (names.length === 0) {
          const r = stmt.run(...args);
          return { columns: [], rows: [], affectedRows: Number(r.changes), tag: "run" };
        }
        const rows = stmt.values(...args) as unknown[][];
        return { columns: names.map((name) => ({ name, type: "dynamic", flags: 0 })), rows, affectedRows: rows.length, tag: "values" };
      },
      finalize: () => stmt.finalize(),
    };
  }
  exec(sql: string): void {
    this.db.exec(sql);
  }
  close(): void {
    this.db.close();
  }
}
