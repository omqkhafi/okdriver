// Execution coordinator checks on one engine. Usage: bun run scripts/coordinator.check.ts <engine>
import { writeFileSync } from "node:fs";
import { SQL } from "bun";
import { Client, DriverError, SimpleCoordinator, type EmbeddedCore, type Session, type SessionSource } from "../src/platform/index.ts";
import { openClient, type EnginePackage } from "../src/entry/compose.ts";
import { FS01, run } from "./lib/ext.ts";
import { startProxy, type Proxy } from "./lib/proxy.ts";
import { ENGINES, TARGETS, type EngineName } from "./lib/targets.ts";

const name = (process.argv[2] ?? "") as EngineName;
if (!ENGINES.includes(name)) throw new Error(`usage: coordinator.check.ts <${ENGINES.join("|")}>`);
const cfg = TARGETS[name];
interface Check { check: string; pass: boolean; detail: string }
const checks: Check[] = [];
const out = (s: string): void => console.log(s);
function check(check: string, pass: boolean, detail = ""): void {
  checks.push({ check, pass, detail });
  out(`CHECK ${check} ${pass ? "PASS" : "FAIL"} ${detail}`);
}
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const P = (n: number): string => cfg.ph(n);
const cast = (n: number, t: string): string => (name === "postgres" ? `${P(n)}::${t}` : P(n));
const CTE = "with recursive c(x) as (select 1 union all select x+1 from c where x < 400000) select count(*) as fs01_slow";
const SLOW =
  name === "postgres" ? `select pg_sleep(0.3) as fs01_slow, ${cast(1, "int8")} as n`
  : name === "mysql" || name === "mariadb" ? `select sleep(0.3) as fs01_slow, ${P(1)} as n`
  : `${CTE}, ${P(1)} as n from c`;
const RACE = `select ${cast(1, "int8")} as fs01_race`;

// A previous run may have left the server killed: start it and wait until it answers.
if (cfg.container !== undefined) {
  await run(["docker", "start", cfg.container]);
  for (let i = 0; i < 120; i++) {
    try { await cfg.readRowsProbe?.(); await cfg.setup(); break; } catch { await sleep(500); }
  }
} else await cfg.setup();

// ---- taps -----------------------------------------------------------------------------------
const coreSql: string[] = [];
let coreInFlight = 0;
let coreMax = 0;
let pkg: EnginePackage = cfg.pkg;
if (cfg.pkg.class === "embedded") {
  const open = cfg.pkg.open;
  pkg = {
    class: "embedded",
    descriptor: cfg.pkg.descriptor,
    open: (p: string): EmbeddedCore => {
      const core = open(p);
      return {
        get facts() { return core.facts; },
        get inTransaction() { return core.inTransaction; },
        prepare: (sql: string) => {
          coreSql.push(sql);
          const st = core.prepare(sql);
          return { execute: (ps) => { coreInFlight++; coreMax = Math.max(coreMax, coreInFlight); try { return st.execute(ps); } finally { coreInFlight--; } }, finalize: () => st.finalize() };
        },
        exec: (sql: string) => core.exec(sql),
        close: () => core.close(),
      };
    },
  };
} else if (cfg.pkg.class === "service") {
  const make = cfg.pkg.newCore;
  pkg = {
    class: "service",
    descriptor: cfg.pkg.descriptor,
    newCore: (t, e) => {
      const core = make(t, e);
      return {
        handshake: (s) => core.handshake(s),
        execute: async (r, s) => { coreInFlight++; coreMax = Math.max(coreMax, coreInFlight); try { return await core.execute(r, s); } finally { coreInFlight--; } },
        ...(core.openStream === undefined ? {} : { openStream: (s: AbortSignal) => core.openStream!(s) }),
        close: () => core.close(),
      };
    },
  };
}

let proxy: Proxy | undefined;
let target = cfg.target;
if (cfg.proxyKind !== "none") {
  proxy = await startProxy(cfg.target.endpoint.host, cfg.target.endpoint.port);
  target = { ...cfg.target, endpoint: { ...cfg.target.endpoint, port: proxy.port } };
}
const sentWithMarker = (marker: string): number => {
  if (proxy !== undefined) return proxy.conns.reduce((n, b) => n + (b.toString("latin1").split(marker).length - 1), 0) / (cfg.proxyKind === "http" ? 1 : 1);
  return coreSql.filter((s) => s.includes(marker)).length;
};

// ---- server-side observation of concurrency (wire engines) ---------------------------------
async function sampler(): Promise<{ stop(): Promise<{ max: number; samples: number }> }> {
  if (cfg.pkg.class !== "wire") return { stop: async () => ({ max: -1, samples: 0 }) };
  const base = { hostname: "127.0.0.1", database: "fs01", max: 1 };
  const sql =
    name === "postgres" ? new SQL({ ...base, adapter: "postgres", port: 55432, username: "postgres" })
    : new SQL({ ...base, adapter: name === "mysql" ? "mysql" : "mariadb", port: name === "mysql" ? 53306 : 53307, username: "root" });
  const q =
    name === "postgres" ? "select count(*)::int as n from pg_stat_activity where state = 'active' and query like '%fs01_slow%' and pid <> pg_backend_pid()"
    : "select count(*) as n from information_schema.processlist where info like '%fs01_slow%' and id <> connection_id()";
  let running = true;
  let max = 0;
  let samples = 0;
  const loop = (async () => {
    while (running) {
      const r = (await sql.unsafe(q)) as { n: unknown }[];
      max = Math.max(max, Number(r[0]!.n));
      samples++;
      await sleep(4);
    }
  })();
  return { stop: async () => { running = false; await loop; await sql.close(); return { max, samples }; } };
}

// ================================================================================================
out(`== coordinator ${name}`);
const opened = await openClient(pkg, target, { limit: 2, poolMax: 8 });
const { client, coordinator } = opened;
await client.query(`select ${cast(1, "int8")} as warm`, [1n]); // connect once so that the timing below is not a connect

// ---- 1. limit 2, 8 callers in the same tick ---------------------------------------------------
{
  const s = await sampler();
  coreMax = 0;
  const t0 = performance.now();
  const calls = Array.from({ length: 8 }, (_, i) => client.query(SLOW, [BigInt(i)]));
  const settled = await Promise.allSettled(calls);
  const ms = performance.now() - t0;
  const obs = await s.stop();
  const ok = settled.filter((x) => x.status === "fulfilled").length;
  check("limit2.all-completed", ok === 8, `${ok}/8 fulfilled in ${ms.toFixed(0)} ms${ok < 8 ? ": " + settled.filter((x) => x.status === "rejected").map((x) => (x as PromiseRejectedResult).reason?.message).join("; ") : ""}`);
  check("limit2.coordinator-maxActive<=2", coordinator.stats.maxActive <= 2 && coordinator.stats.maxActive === 2, `coordinator maxActive=${coordinator.stats.maxActive}`);
  if (cfg.pkg.class === "wire") {
    check("limit2.server-observed<=2", obs.max <= 2, `server-side sessions running the statement: max ${obs.max} over ${obs.samples} samples (pool allowed 8 connections)`);
    check("limit2.server-observed-reached-2", obs.max === 2, `max observed ${obs.max}: the check is not vacuous`);
    check("limit2.waves", ms >= 1000, `8 statements of 0.3 s at limit 2 took ${ms.toFixed(0)} ms (4 waves of 300 ms expected; the check allows >= 1000 ms)`);
  } else {
    check("limit2.core-counter<=2", coreMax <= 2, `in-flight at the engine core boundary: max ${coreMax}`);
    out(`NOTE ${name}: core in-flight max ${coreMax} while coordinator maxActive ${coordinator.stats.maxActive}`);
  }
}

// ---- 2. a caller aborted while queued: class cancelled, outcome not-sent ------------------------
// Wire: two slow statements hold the two slots. Embedded and service: statements finish before the next
// caller can queue (the embedded binding is synchronous), so two open admissions, which is what two open
// transactions are, hold the slots instead.
{
  const before = sentWithMarker("fs01_race");
  let release: () => Promise<unknown>;
  if (cfg.pkg.class === "wire") {
    const s1 = client.query(SLOW, [1n]);
    const s2 = client.query(SLOW, [2n]);
    release = () => Promise.all([s1, s2]);
  } else {
    const l1 = await coordinator.admit({ kind: "transaction" }, new AbortController().signal);
    const l2 = await coordinator.admit({ kind: "transaction" }, new AbortController().signal);
    release = async () => { l1.release(); l2.release(); };
  }
  const ac = new AbortController();
  const queued = client.query(RACE, [7n], ac.signal);
  await sleep(30);
  const stBefore = coordinator.stats;
  ac.abort();
  let err: unknown;
  try { await queued; } catch (e) { err = e; }
  await release();
  const e = err as DriverError;
  check("abort-queued.queued-before-abort", stBefore.queued >= 1, `queue length at abort: ${stBefore.queued}`);
  check("abort-queued.class-cancelled", e instanceof DriverError && e.class === "cancelled", e instanceof DriverError ? e.class : String(err));
  check("abort-queued.outcome-not-sent", e instanceof DriverError && e.statementOutcome === "not-sent" && e.transactionState === "none", e instanceof DriverError ? `${e.statementOutcome}/${e.transactionState}/retry=${e.retry}` : "");
  check("abort-queued.nothing-on-the-wire", sentWithMarker("fs01_race") === before, `statements with the marker seen by the recorder: ${sentWithMarker("fs01_race") - before}`);
  check("abort-queued.stats", coordinator.stats.cancelledInQueue >= 1 && coordinator.stats.active === 0, JSON.stringify(coordinator.stats));
}

// ---- 3. abort racing admission, many interleavings --------------------------------------------
{
  const raceSource: SessionSource = opened.client.source;
  const raceClient = new Client(cfg.pkg.descriptor, raceSource, new SimpleCoordinator(1));
  const base = sentWithMarker("fs01_race");
  let ok = 0, cancelled = 0, abortedSent = 0, other = 0, bad = 0;
  const variants = ["sync", "after-holder", "microtask1", "microtask3", "immediate", "timeout0", "timeout1", "timeout3"] as const;
  const N = 40;
  for (const v of variants) {
    for (let i = 0; i < N; i++) {
      const ac = new AbortController();
      const holder = raceClient.query(`select ${cast(1, "int8")} as holder`, [1n]);
      const waiter = raceClient.query(RACE, [BigInt(i)], ac.signal);
      switch (v) {
        case "sync": ac.abort(); break;
        case "after-holder": void holder.finally(() => ac.abort()); break;
        case "microtask1": queueMicrotask(() => ac.abort()); break;
        case "microtask3": queueMicrotask(() => queueMicrotask(() => queueMicrotask(() => ac.abort()))); break;
        case "immediate": setImmediate(() => ac.abort()); break;
        case "timeout0": setTimeout(() => ac.abort(), 0); break;
        case "timeout1": setTimeout(() => ac.abort(), 1); break;
        case "timeout3": setTimeout(() => ac.abort(), 3); break;
      }
      const [, r] = await Promise.allSettled([holder, waiter]);
      if (r.status === "fulfilled") ok++;
      else if (r.reason instanceof DriverError && r.reason.class === "cancelled" && r.reason.statementOutcome === "not-sent") cancelled++;
      else if (r.reason instanceof DriverError && r.reason.class === "cancelled" && r.reason.statementOutcome === "unknown") abortedSent++;
      else if (r.reason instanceof DriverError && (r.reason.class === "connection")) other++;
      else bad++;
    }
  }
  const st = raceClient.coordinator.stats;
  const sent = sentWithMarker("fs01_race") - base;
  check("race.no-hang-no-bad-outcome", bad === 0 && other === 0, `${variants.length * N} races: ${ok} completed, ${cancelled} cancelled/not-sent, ${abortedSent} cancelled/unknown (abort after the request was sent), ${bad} other outcomes`);
  check("race.no-leaked-lease", st.active === 0 && st.queued === 0, JSON.stringify(st));
  check("race.not-sent-means-not-sent", sent === ok + abortedSent, `statements with the marker that reached the recorder: ${sent}; completed: ${ok}; aborted after send: ${abortedSent}; cancelled/not-sent: ${cancelled}`);
}

// ---- 4. queue timeout ------------------------------------------------------------------------------
{
  const c = new SimpleCoordinator(1);
  const l = await c.admit({ kind: "query" }, new AbortController().signal);
  let err: unknown;
  try { await c.admit({ kind: "query", queueTimeoutMs: 40 }, new AbortController().signal); } catch (e) { err = e; }
  l.release();
  const e = err as DriverError;
  check("queue-timeout.class-timeout-not-sent", e instanceof DriverError && e.class === "timeout" && e.statementOutcome === "not-sent", e instanceof DriverError ? `${e.class}/${e.statementOutcome}` : String(err));
}
await opened.close();

// ---- 5. slow first connect --------------------------------------------------------------------------
if (cfg.container !== undefined) {
  const c = cfg.container;
  await run(["docker", "kill", c]);
  const o2 = await openClient(pkg, target, { limit: 2, poolMax: 8, connectTimeoutMs: 60_000 });
  const t0 = performance.now();
  const callsSettled = Promise.allSettled(Array.from({ length: 8 }, (_, i) => o2.client.query(`select ${cast(1, "int8")} as slowconnect`, [BigInt(i)])));
  await sleep(2000);
  const settledEarly = o2.coordinator.stats;
  const started = run(["docker", "start", c]);
  const res = await callsSettled;
  await started;
  const ms = performance.now() - t0;
  const ok = res.filter((r) => r.status === "fulfilled").length;
  check("slow-connect.queue-held-while-down", settledEarly.active === 2 && settledEarly.queued === 6, `2 s after submission with the server down: active=${settledEarly.active} queued=${settledEarly.queued}`);
  check("slow-connect.all-complete-after-server-up", ok === 8, `${ok}/8 fulfilled after ${ms.toFixed(0)} ms${ok < 8 ? ": " + res.filter((r) => r.status === "rejected").map((r) => (r as PromiseRejectedResult).reason?.message).join("; ") : ""}`);
  check("slow-connect.no-leak", o2.coordinator.stats.active === 0 && o2.coordinator.stats.queued === 0 && o2.coordinator.stats.maxActive <= 2, JSON.stringify(o2.coordinator.stats));
  await o2.close();
  // the server never comes up: bounded failures, and the queue is not wedged afterwards
  await run(["docker", "kill", c]);
  const o3 = await openClient(pkg, target, { limit: 2, poolMax: 8, connectTimeoutMs: 400 });
  const t1 = performance.now();
  const dead = await Promise.allSettled(Array.from({ length: 6 }, (_, i) => o3.client.query(`select ${cast(1, "int8")} as dead`, [BigInt(i)])));
  const ms2 = performance.now() - t1;
  const classes = dead.map((r) => (r.status === "rejected" ? (r.reason as DriverError).class : "ok"));
  check("slow-connect.never-up-bounded-connection-errors", classes.every((x) => x === "connection") && ms2 < 6000, `6 callers, server down, connect timeout 400 ms: classes=${[...new Set(classes)].join(",")} after ${ms2.toFixed(0)} ms`);
  check("slow-connect.never-up-no-leak", o3.coordinator.stats.active === 0 && o3.coordinator.stats.queued === 0, JSON.stringify(o3.coordinator.stats));
  await run(["docker", "start", c]);
  // wait for the server to accept again, then prove the same client still works
  let after = "not tried";
  for (let i = 0; i < 100; i++) {
    try {
      await o3.client.query(`select ${cast(1, "int8")} as recovered`, [1n]);
      after = `recovered after ${i} retries`;
      break;
    } catch { await sleep(250); }
  }
  check("slow-connect.same-client-recovers", after.startsWith("recovered"), after);
  await o3.close();
} else {
  // embedded: the first statements are blocked by a lock held by another process for 2 s
  const holder = Bun.spawn(["python3", "-I", "-c", "import sqlite3,sys,time; c=sqlite3.connect(sys.argv[1]); c.isolation_level=None; c.execute('begin exclusive'); print('locked', flush=True); time.sleep(2); c.execute('commit')", cfg.target.path!], { stdout: "pipe", stderr: "pipe" });
  const reader = holder.stdout.getReader();
  const first = new TextDecoder().decode((await reader.read()).value ?? new Uint8Array());
  check("slow-connect.lock-held-by-other-process", first.startsWith("locked"), first.trim() || (await new Response(holder.stderr).text()).trim());
  let lagMax = 0;
  let last = performance.now();
  const ticker = setInterval(() => { const n = performance.now(); lagMax = Math.max(lagMax, n - last - 10); last = n; }, 10);
  const tOpen = performance.now();
  const o2 = await openClient(pkg, cfg.target, { limit: 2 }); // the synchronous open (schema read) waits for the lock
  const openMs = performance.now() - tOpen;
  await sleep(30); // let the ticker observe the stall
  clearInterval(ticker);
  check("slow-connect.connect-blocked-by-lock", openMs >= 1500, `connect took ${openMs.toFixed(0)} ms while another process held the lock for 2 s`);
  check("slow-connect.event-loop-stalled", lagMax >= 1500, `timer lag observed: ${lagMax.toFixed(0)} ms: no timer, abort or other caller could run meanwhile`);
  const res = await Promise.allSettled(Array.from({ length: 8 }, () => o2.client.query("select count(*) as n from fs01_kv")));
  const ok = res.filter((r) => r.status === "fulfilled").length;
  await holder.exited;
  check("slow-connect.all-complete-after-lock-released", ok === 8, `${ok}/8 fulfilled`);
  check("slow-connect.no-leak", o2.coordinator.stats.active === 0 && o2.coordinator.stats.queued === 0, JSON.stringify(o2.coordinator.stats));
  out(`NOTE sqlite: the open blocked the event loop for ~${lagMax.toFixed(0)} ms; queueing behind a slow embedded connect cannot be observed because nothing else runs`);
  await o2.close();
}
await proxy?.close();
const failed = checks.filter((c) => !c.pass);
writeFileSync(`${FS01}/results/coordinator-${name}.json`, JSON.stringify({ engine: name, checks }, null, 2));
out(`RESULT ${name}: ${checks.length - failed.length}/${checks.length} coordinator checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
