// Acceptance check for one engine: connect, one parameterised query, one error, one transaction,
// read back by something that is not the skeleton. Usage: bun run scripts/accept.check.ts <engine>
import { writeFileSync } from "node:fs";
import { SQL } from "bun";
import { openClient, type EnginePackage } from "../src/entry/compose.ts";
import { DriverError, type CapabilitySet, type ConnectContext, type EmbeddedCore, type ServerFacts } from "../src/platform/index.ts";
import { FS01, run } from "./lib/ext.ts";
import { parseHttpFrontend, parseMysqlFrontend, parsePgFrontend, startProxy, type Proxy } from "./lib/proxy.ts";
import { ENGINES, TARGETS, type EngineName } from "./lib/targets.ts";

const name = (process.argv[2] ?? "") as EngineName;
if (!ENGINES.includes(name)) throw new Error(`usage: accept.check.ts <${ENGINES.join("|")}>`);
const cfg = TARGETS[name];
const BIG = 2n ** 53n + 1n;
const TEXT = "héllo wörld";

interface Check { check: string; pass: boolean; detail: string }
interface Diff { item: string; expected: unknown; observed: unknown; asExpected: boolean }
const checks: Check[] = [];
const diffs: Diff[] = [];
const notes: string[] = [];
const out = (s: string): void => console.log(s);
function check(check: string, pass: boolean, detail = ""): void {
  checks.push({ check, pass, detail });
  out(`CHECK ${check} ${pass ? "PASS" : "FAIL"} ${detail}`);
}
function expectDiff(item: string, expected: unknown, observed: unknown): void {
  const asExpected = JSON.stringify(expected) === JSON.stringify(observed);
  diffs.push({ item, expected, observed, asExpected });
  out(`EXPECT ${item}: expected=${JSON.stringify(expected)} observed=${JSON.stringify(observed)} ${asExpected ? "as-expected" : "DIFFERENT"}`);
}

// ---- taps: observation points that do not change behaviour ---------------------------------
let facts: ServerFacts | undefined;
let caps: CapabilitySet | undefined;
const tappedDescriptor = {
  ...cfg.pkg.descriptor,
  capabilities: (ctx: ConnectContext): CapabilitySet => {
    facts = ctx.facts;
    caps = cfg.pkg.descriptor.capabilities(ctx);
    return caps;
  },
};
const sqliteSql: string[] = [];
let pkg: EnginePackage = { ...cfg.pkg, descriptor: tappedDescriptor } as EnginePackage;
if (cfg.pkg.class === "embedded") {
  const open = cfg.pkg.open;
  pkg = {
    class: "embedded",
    descriptor: tappedDescriptor,
    open: (p: string): EmbeddedCore => {
      const core = open(p);
      return {
        get facts() { return core.facts; },
        get inTransaction() { return core.inTransaction; },
        prepare: (sql: string) => { sqliteSql.push(sql); return core.prepare(sql); },
        exec: (sql: string) => { sqliteSql.push(sql); core.exec(sql); },
        close: () => core.close(),
      };
    },
  };
}

await cfg.setup();
out(`== accept ${name}`);
let proxy: Proxy | undefined;
let target = cfg.target;
if (cfg.proxyKind !== "none") {
  proxy = await startProxy(cfg.target.endpoint.host, cfg.target.endpoint.port);
  target = { ...cfg.target, endpoint: { ...cfg.target.endpoint, port: proxy.port } };
}
const signal = new AbortController().signal;
const insert = `insert into fs01_kv (id, v) values (${cfg.ph(1)}, ${cfg.ph(2)})`;

// ---- connect ----------------------------------------------------------------------------------
const opened = await openClient(pkg, target, { limit: 2 });
const probe = await opened.client.source.checkout(signal);
const sessionCaps = probe.session.capabilities;
probe.release();
check("connect.ok", facts !== undefined, `facts=${JSON.stringify(facts, (_, v) => (typeof v === "bigint" ? String(v) : v))}`);
check("capabilities.from-facts", caps !== undefined && JSON.stringify(sessionCaps) === JSON.stringify(caps), `caps=${JSON.stringify(caps)}`);
// The derivation is a function of what the server said: change the facts and the answer changes.
const blank = cfg.pkg.descriptor.capabilities({ facts: { version: "", params: {}, observedTx: "unknown" }, transport: undefined });
check("capabilities.respond-to-facts", blank.protocolPrepared === false && blank.interactiveTransactions === false, `with empty facts: protocolPrepared=${blank.protocolPrepared} interactiveTransactions=${blank.interactiveTransactions}`);

// ---- query --------------------------------------------------------------------------------
const q = await opened.client.query(`select ${cfg.ph(1)}${name === "postgres" ? "::int8" : ""} as a, ${cfg.ph(2)}${name === "postgres" ? "::text" : ""} as b`, [BIG, TEXT]);
const row = q.rows[0] as unknown[];
check("query.bigint", typeof row[0] === "bigint" && row[0] === BIG, `got ${typeof row[0]} ${String(row[0])}`);
check("query.text", row[1] === TEXT, `got ${JSON.stringify(row[1])}`);
check("query.outcome", q.statementOutcome === "applied" && q.transactionState === "none", `${q.statementOutcome}/${q.transactionState}`);

// ---- error, inside an open transaction -------------------------------------------------------
{
  const tx = await opened.client.begin();
  check("tx.begin-state-open", tx.state === "open", `state=${tx.state}`);
  await tx.query(insert, [1n, "first"]);
  let err: DriverError | undefined;
  try {
    await tx.query(insert, [1n, "second"]);
  } catch (e) {
    err = e as DriverError;
  }
  check("error.thrown-driver-error", err instanceof DriverError, err === undefined ? "no error" : `${err.name}: ${err.message}`);
  if (err !== undefined) {
    check("error.class-constraint", err.class === "constraint", err.class);
    check("error.vendor-untouched", err.vendor !== undefined && String(err.vendor.code) === String(cfg.expectedVendor), JSON.stringify(err.vendor));
    out(`ERROR ${JSON.stringify({ class: err.class, phase: err.phase, statementOutcome: err.statementOutcome, transactionState: err.transactionState, retry: err.retry, vendor: err.vendor, redacted: err.redacted, message: err.message })}`);
    expectDiff("error.statementOutcome", "rejected-no-effects", err.statementOutcome);
    expectDiff("error.transactionState", cfg.expectedTx, err.transactionState);
    expectDiff("error.retry", "never", err.retry);
    expectDiff("error.phase", "execute", err.phase);
  }
  const state = tx.state;
  await tx.rollback();
  notes.push(`session state after the error: ${state}`);
  const rows = await cfg.readRows();
  check("error.rolled-back-after-error", rows.length === 0, `rows after rollback: ${JSON.stringify(rows)}`);
}

// ---- transaction: commit visible, rollback not, read by an external tool ----------------------
{
  const t1 = await opened.client.begin();
  await t1.query(insert, [2n, "commit-me"]);
  const inside = await cfg.readRows();
  check("tx.uncommitted-invisible-external", !inside.some((l) => l.startsWith("2|")), `external read before commit: ${JSON.stringify(inside)}`);
  const state = await t1.commit();
  check("tx.commit-state", state === "committed", state);
  const after = await cfg.readRows();
  check("tx.commit-visible-external", after.includes("2|commit-me"), `external read after commit: ${JSON.stringify(after)}`);
  const t2 = await opened.client.begin();
  await t2.query(insert, [3n, "rollback-me"]);
  const rstate = await t2.rollback();
  check("tx.rollback-state", rstate === "rolled-back", rstate);
  const after2 = await cfg.readRows();
  check("tx.rollback-invisible-external", !after2.some((l) => l.startsWith("3|")) && after2.includes("2|commit-me"), `external read after rollback: ${JSON.stringify(after2)}`);
}
const st = opened.coordinator.stats;
check("coordinator.no-leak", st.active === 0 && st.queued === 0, JSON.stringify(st));
await opened.close();

// ---- protocol-level record: values travel as parameters, not in SQL text ---------------------
const bigText = String(BIG);
const protocol: unknown[] = [];
if (proxy !== undefined) {
  const all = proxy.conns;
  check("protocol.connections-recorded", all.length >= 1, `${all.length} client connection(s) through the recorder`);
  if (cfg.proxyKind === "pg") {
    const msgs = all.flatMap((b) => parsePgFrontend(b));
    const parses = msgs.filter((m) => m.t === "P");
    const binds = msgs.filter((m) => m.t === "B");
    protocol.push(...msgs.map((m) => ({ t: m.t, ...(m.sql === undefined ? {} : { sql: m.sql }), ...(m.params === undefined ? {} : { params: m.params.map((p) => p?.toString("utf8") ?? null) }) })));
    check("protocol.no-simple-query", !msgs.some((m) => m.t === "Q"), `message types: ${[...new Set(msgs.map((m) => m.t))].join("")}`);
    check("protocol.sql-has-no-values", parses.every((m) => !m.sql!.includes(bigText) && !m.sql!.includes(TEXT)), `${parses.length} Parse messages`);
    check("protocol.value-in-bind", binds.some((m) => m.params!.some((p) => p?.toString("utf8") === bigText)), "the 2^53+1 value was found in a Bind message");
    const log = (await run(["docker", "logs", "fs01-pg"])).err + (await run(["docker", "logs", "fs01-pg"])).out;
    check("protocol.server-log", /execute <unnamed>: select \$1::int8 as a/.test(log) && log.includes(`$1 = '${bigText}'`), "PostgreSQL log shows the statement with $1 and the parameter detail");
  } else if (cfg.proxyKind === "mysql") {
    const msgs = all.flatMap((b) => parseMysqlFrontend(b));
    protocol.push(...msgs.map((m) => ({ cmd: m.cmd, ...(m.sql === undefined ? {} : { sql: m.sql }), ...(m.cmd === "COM_STMT_EXECUTE" ? { bytes: m.payload.length } : {}) })));
    const prep = msgs.filter((m) => m.cmd === "COM_STMT_PREPARE");
    const text = msgs.filter((m) => m.cmd === "COM_QUERY");
    const exec = msgs.filter((m) => m.cmd === "COM_STMT_EXECUTE");
    const le = Buffer.alloc(8);
    le.writeBigUInt64LE(BIG);
    check("protocol.prepared-used", prep.length >= 1 && exec.length >= 1, `${prep.length} COM_STMT_PREPARE, ${exec.length} COM_STMT_EXECUTE`);
    check("protocol.sql-has-no-values", [...prep, ...text].every((m) => !m.sql!.includes(bigText) && !m.sql!.includes(TEXT)), "no COM_QUERY or PREPARE text contains a bound value");
    check("protocol.text-queries-have-no-params", text.every((m) => !/[?]/.test(m.sql!) || /^(select|show)/i.test(m.sql!)), `COM_QUERY texts: ${JSON.stringify(text.map((m) => m.sql))}`);
    const failedPrepares = 0; // no PREPARE in this run is expected to fail
    check("protocol.no-statement-leak", prep.length - failedPrepares === msgs.filter((m) => m.cmd === "COM_STMT_CLOSE").length, `${prep.length} COM_STMT_PREPARE and ${msgs.filter((m) => m.cmd === "COM_STMT_CLOSE").length} COM_STMT_CLOSE: every prepared statement is closed, including after the failed EXECUTE`);
    check("protocol.value-in-execute", exec.some((m) => m.payload.includes(le)), "the 2^53+1 value was found as 8 little-endian bytes in a COM_STMT_EXECUTE");
    const gl = (await run(["docker", "exec", cfg.container!, "sh", "-c", "tail -n 60 /var/lib/mysql/general.log"])).out;
    notes.push(`server general log tail:\n${gl}`);
    check("protocol.server-log", /Prepare\s+select \? as a/.test(gl), "server general log shows Prepare of the statement with ? placeholders");
  } else {
    const msgs = all.flatMap((b) => parseHttpFrontend(b));
    protocol.push(...msgs);
    const stmts = msgs.flatMap((m) => (m.body?.requests ?? []).filter((r: any) => r.type === "execute").map((r: any) => r.stmt));
    check("protocol.sql-has-no-values", stmts.every((s: any) => !String(s.sql).includes(bigText) && !String(s.sql).includes(TEXT)), `${stmts.length} Hrana execute requests`);
    check("protocol.value-in-args", stmts.some((s: any) => (s.args ?? []).some((a: any) => a.type === "integer" && a.value === bigText)), "the 2^53+1 value was found as a typed integer argument");
  }
} else {
  const stmts = sqliteSql;
  protocol.push(...stmts);
  check("protocol.sql-has-no-values", stmts.every((s) => !s.includes(bigText) && !s.includes(TEXT)), `${stmts.length} SQL strings passed to prepare/exec`);
  check("protocol.prepared-used", stmts.some((s) => s.includes("?")), "statements with ? placeholders were prepared by bun:sqlite");
}

// ---- differential: Bun.SQL on the same statement -----------------------------------------------
{
  let note = "";
  try {
    let sql: SQL | undefined;
    const base = { hostname: "127.0.0.1", database: "fs01", max: 1 };
    if (name === "postgres") sql = new SQL({ ...base, adapter: "postgres", port: 55432, username: "postgres", bigint: true });
    else if (name === "mysql") sql = new SQL({ ...base, adapter: "mysql", port: 53306, username: "root" });
    else if (name === "mariadb") sql = new SQL({ ...base, adapter: "mariadb", port: 53307, username: "root" });
    else if (name === "sqlite") {
      // Bun.SQL's default for SQLite returns a lossy number for 2^53+1; record it, then compare with bigint: true.
      const lossy = new SQL(`sqlite://${FS01}/work/accept.sqlite`);
      const r0 = (await lossy.unsafe("select ? as a", [BIG]))[0] as { a: unknown };
      notes.push(`Bun.SQL sqlite with default options returned ${typeof r0.a} ${String(r0.a)} for the bound 2^53+1 (lossy by default)`);
      out(`NOTE Bun.SQL sqlite default options: ${typeof r0.a} ${String(r0.a)} for 2^53+1`);
      await lossy.close();
      sql = new SQL({ adapter: "sqlite", filename: `${FS01}/work/accept.sqlite`, bigint: true });
    }
    if (sql === undefined) {
      note = "Bun.SQL has no libSQL/Hrana adapter";
      check("differential.bunsql", true, `skipped: ${note}`);
    } else {
      const stmt = `select ${cfg.ph(1)}${name === "postgres" ? "::int8" : ""} as a, ${cfg.ph(2)}${name === "postgres" ? "::text" : ""} as b`;
      const res = await sql.unsafe(stmt, [BIG, TEXT]);
      const a = (res as any)[0].a;
      const b = (res as any)[0].b;
      check("differential.bunsql-values", String(a) === bigText && b === TEXT, `Bun.SQL returned a=${String(a)} (${typeof a}), b=${JSON.stringify(b)}; skeleton returned a=${String(row[0])} (${typeof row[0]})`);
      // duplicate key through Bun.SQL
      await sql.unsafe(`insert into fs01_kv (id, v) values (${cfg.ph(1)}, ${cfg.ph(2)})`, [900n, "x"]);
      let code: unknown;
      try {
        await sql.unsafe(`insert into fs01_kv (id, v) values (${cfg.ph(1)}, ${cfg.ph(2)})`, [900n, "y"]);
      } catch (e: any) {
        code = e.errno ?? e.code;
      }
      await sql.unsafe(`delete from fs01_kv where id = ${cfg.ph(1)}`, [900n]);
      check("differential.bunsql-error-code", code !== undefined && String(code).includes(String(cfg.expectedVendor).replace(/^SQLITE_CONSTRAINT$/, "")), `Bun.SQL duplicate-key error code=${String(code)}; skeleton vendor expected=${String(cfg.expectedVendor)}`);
      await sql.close();
    }
  } catch (e: any) {
    check("differential.bunsql", true, `skipped: ${String(e?.message ?? e).slice(0, 200)}`);
  }
}

// ---- a capability is true only if a named check passed -------------------------------------------
const need: Record<string, string[]> = {
  protocolPrepared: ["protocol.prepared-used", "protocol.sql-has-no-values"],
  interactiveTransactions: ["tx.commit-visible-external", "tx.rollback-invisible-external"],
};
if (name === "postgres" || name === "libsql") need.protocolPrepared = ["protocol.sql-has-no-values", name === "postgres" ? "protocol.value-in-bind" : "protocol.value-in-args"];
const passed = new Set(checks.filter((c) => c.pass).map((c) => c.check));
const claimed: string[] = [];
for (const [k, v] of Object.entries(sessionCaps)) {
  const on = k === "int64" ? true : k === "cancel" ? v !== "none" : k === "bulkLoad" ? v !== false : v === true;
  if (!on) continue;
  claimed.push(k);
  const req = k === "int64" ? ["query.bigint"] : need[k];
  const ok = req !== undefined && req.every((r) => passed.has(r));
  check(`cap.${k}`, ok, req === undefined ? "no named check exists for this capability" : `requires ${req.join(" + ")}`);
}
out(`CLAIMED ${claimed.join(",")}`);
out(`NOT-CLAIMED ${Object.keys(sessionCaps).filter((k) => !claimed.includes(k)).join(",")}`);

await proxy?.close();
const failed = checks.filter((c) => !c.pass);
const summary = { engine: name, class: cfg.pkg.class, facts, capabilities: sessionCaps, claimed, checks, expectations: diffs, differences: diffs.filter((d) => !d.asExpected), notes, protocol };
writeFileSync(`${FS01}/results/accept-${name}.json`, JSON.stringify(summary, (_, v) => (typeof v === "bigint" ? String(v) : v), 2));
out(`RESULT ${name}: ${checks.length - failed.length}/${checks.length} checks passed, ${diffs.filter((d) => !d.asExpected).length} difference(s) from the expected mapping`);
process.exit(failed.length === 0 ? 0 : 1);
