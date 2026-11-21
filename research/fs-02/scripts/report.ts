// FS-02 report: derives every table and count in the README from results/*.csv|json.
//
//   bun scripts/report.ts            writes results/summary.md and prints it
//
// Inputs: results/cells.json (matrix), results/oracle-psql.csv, results/oracle-faults.csv.
// A verdict per endpoint applies the brief's rule: it "negotiates correctly" if R0 succeeds, R1..R5 are each
// OK-exact or OK-negotiated, SELECT 1 works in each, and the BackendKeyData key length is valid for the
// version in force (3.0: exactly 4 bytes; 3.2: 4..256 bytes). Cancel outcomes are reported in their own column.
import fs from "node:fs";
import path from "node:path";

const here = path.resolve(import.meta.dir, "..");
const read = (f: string) => fs.readFileSync(path.join(here, "results", f), "utf8");

interface Cell {
  endpoint: string;
  tier: "A" | "B";
  request: string;
  requested: string;
  class: string;
  classReason: string;
  firstMessage: string;
  negotiations: Array<{ version: string; options: string[]; late: boolean }>;
  authOutcome: string;
  keyBytes: number | null;
  versionInForce: string;
  keyValid: boolean | null;
  ready: boolean;
  select1: string;
  cancel: string;
  error: { sqlstate: string; message: string } | null;
  serverVersion: string;
  rerunClass: string;
  rerunReason: string;
}
interface Endpoint {
  id: string;
  family: string;
  version: string;
  backend: string;
  mode: string;
  tls: boolean;
}
const cells: Cell[] = JSON.parse(read("cells.json"));
const endpoints: Endpoint[] = JSON.parse(fs.readFileSync(path.join(here, "endpoints.json"), "utf8"));
interface Repeat {
  endpoint: string;
  repetitions: number;
  counts: Record<string, Record<string, number>>;
  sampleReasons: Record<string, string>;
  beta3Psql?: { connections: number; outcomes: Record<string, number> };
}
const optDir = path.join(here, "results", "optional");
const repeats: Repeat[] = fs.existsSync(optDir) ? fs.readdirSync(optDir).filter((f) => f.startsWith("repeat-")).map((f) => JSON.parse(fs.readFileSync(path.join(optDir, f), "utf8")) as Repeat) : [];
const intermittent = (ep: string) => {
  const rp = repeats.find((x) => x.endpoint === ep);
  if (!rp) return null;
  let bad = 0;
  let total = 0;
  for (const [req, m] of Object.entries(rp.counts)) {
    if (req === "R6") continue;
    for (const [cls, n] of Object.entries(m)) {
      total += n;
      if (!(cls === "OK-exact" || cls === "OK-negotiated")) bad += n;
    }
  }
  return bad > 0 ? { bad, total } : null;
};
const MATRIX = ["R0", "R1", "R2", "R3", "R4", "R5", "R6"];
const DIAG = ["D1", "D2", "D3"];
const SHORT: Record<string, string> = {
  "OK-exact": "OK-exact",
  "OK-negotiated": "OK-neg",
  "Bad-negotiate": "Bad-neg",
  "Silent-accept": "Silent",
  "Reject-clean": "Reject",
  Drop: "Drop",
  Hang: "Hang",
  Other: "Other",
  Unreachable: "Unreach",
};

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (q) {
      if (c === '"' && text[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") {
      row.push(cur);
      cur = "";
    } else if (c === "\n") {
      row.push(cur);
      rows.push(row);
      row = [];
      cur = "";
    } else cur += c;
  }
  return rows.filter((r) => r.length > 1);
}

const get = (ep: string, tier: string, req: string) => cells.find((c) => c.endpoint === ep && c.tier === tier && c.request === req);
const passCell = (c: Cell | undefined) => !!c && (c.class === "OK-exact" || c.class === "OK-negotiated");

function verdict(ep: string, tier: "A" | "B"): { ok: boolean; why: string[] } {
  const why: string[] = [];
  const r0 = get(ep, tier, "R0");
  if (!r0 || !passCell(r0) || r0.class !== "OK-exact") why.push(`R0 ${r0?.class ?? "missing"}`);
  for (const r of ["R0", "R1", "R2", "R3", "R4", "R5"]) {
    const c = get(ep, tier, r);
    if (!c) {
      why.push(`${r} missing`);
      continue;
    }
    if (r !== "R0" && !passCell(c)) why.push(`${r} ${c.class}`);
    if (passCell(c) && c.select1 !== "ok") why.push(`${r} SELECT 1 ${c.select1}`);
    if (passCell(c) && c.keyValid !== true) why.push(`${r} key ${c.keyBytes ?? "none"} bytes invalid for ${c.versionInForce}`);
  }
  const im = intermittent(ep);
  if (tier === "A" && im) why.push(`intermittent: ${im.bad} of ${im.total} repeated R0..R5 requests were not OK (see the repeat experiment)`);
  return { ok: why.length === 0, why };
}

const blocks = new Map<string, string[]>();
let out: string[] = [];
const sec = (name: string, heading: string) => {
  out = [];
  blocks.set(name, out);
  out.push(heading);
};
const p = (s = "") => out.push(s);
const eps = endpoints.filter((e) => cells.some((c) => c.endpoint === e.id));
const tierEps = (t: "A" | "B") => eps.filter((e) => cells.some((c) => c.endpoint === e.id && c.tier === t));

function matrixTable(tier: "A" | "B") {
  const list = tierEps(tier);
  p(`| endpoint | ${MATRIX.map((r) => r).join(" | ")} | negotiates correctly | cancel (R1,R2,R3,R5) |`);
  p(`|---|${MATRIX.map(() => "---").join("|")}|---|---|`);
  for (const e of list) {
    const cols = MATRIX.map((r) => {
      const c = get(e.id, tier, r);
      if (!c) return "-";
      const base = SHORT[c.class] ?? c.class;
      const flaky = c.rerunClass && c.rerunClass !== c.class ? ` (rerun: ${SHORT[c.rerunClass] ?? c.rerunClass})` : "";
      return base + flaky;
    });
    const v = verdict(e.id, tier);
    const cancels = ["R1", "R2", "R3", "R5"].map((r) => get(e.id, tier, r)?.cancel ?? "-").map((x) => (x === "not-applicable" ? "n/a" : x === "not-run" || x.startsWith("skipped") ? "-" : x));
    const uniq = [...new Set(cancels)];
    p(`| ${e.id} | ${cols.join(" | ")} | ${v.ok ? "yes" : "**no**"} | ${uniq.length === 1 ? uniq[0] : cancels.join(" / ")} |`);
  }
}

// ---- headline counts -----------------------------------------------------------------------------
const A = tierEps("A");
const verdicts = new Map(A.map((e) => [e.id, verdict(e.id, "A")]));
const passing = A.filter((e) => verdicts.get(e.id)!.ok);
const failing = A.filter((e) => !verdicts.get(e.id)!.ok);
sec("headline", "## Headline counts (tier A, plain TCP)");
p();
p(`- endpoints measured: ${A.length}`);
p(`- negotiate correctly: ${passing.length}`);
p(`- do not: ${failing.length}`);
p(`- cells recorded: tier A ${cells.filter((c) => c.tier === "A").length} (including the diagnostics D1..D3), tier B ${cells.filter((c) => c.tier === "B").length}`);
p(`- R0 reached OK-exact on ${A.filter((e) => get(e.id, "A", "R0")?.class === "OK-exact" && get(e.id, "A", "R0")?.select1 === "ok").length} of ${A.length} endpoints`);
const fam = (e: Endpoint) => `${e.family} ${e.version}`;
const groups = new Map<string, { pass: number; fail: number }>();
for (const e of A) {
  const g = groups.get(fam(e)) ?? { pass: 0, fail: 0 };
  if (verdicts.get(e.id)!.ok) g.pass++;
  else g.fail++;
  groups.set(fam(e), g);
}
p();
p("| product and version | endpoints | negotiate correctly | do not |");
p("|---|---|---|---|");
for (const [k, g] of groups) p(`| ${k} | ${g.pass + g.fail} | ${g.pass} | ${g.fail} |`);
p();

sec("classcounts", "## Class counts per request (tier A, all endpoints)");
p();
{
  const classes = ["OK-exact", "OK-negotiated", "Bad-negotiate", "Silent-accept", "Reject-clean", "Drop", "Hang", "Other", "Unreachable"];
  p(`| class | ${MATRIX.join(" | ")} |`);
  p(`|---|${MATRIX.map(() => "---").join("|")}|`);
  for (const k of classes) {
    const row = MATRIX.map((r) => A.filter((e) => get(e.id, "A", r)?.class === k).length);
    if (row.some((x) => x > 0)) p(`| ${k} | ${row.join(" | ")} |`);
  }
  p(`| endpoints | ${MATRIX.map(() => A.length).join(" | ")} |`);
}
p();

sec("tierA", "## Tier A: endpoint x request (class per cell)");
p();
matrixTable("A");
p();
const B = tierEps("B");
if (B.length) {
  sec("tierB", "## Tier B: the same matrix after SSLRequest (self-signed certificate, certificate not verified)");
  p();
  matrixTable("B");
  p();
  const diffs: string[] = [];
  for (const e of B) for (const r of MATRIX) {
    const a = get(e.id, "A", r);
    const b = get(e.id, "B", r);
    if (a && b && a.class !== b.class) diffs.push(`${e.id} ${r}: A ${a.class} -> B ${b.class}`);
  }
  p(`Cells whose class differs between tier A and tier B: ${diffs.length}${diffs.length ? "" : "."}`);
  for (const d of diffs) p(`- ${d}`);
  p();
}

// ---- verdict reasons -----------------------------------------------------------------------------
sec("why", "## Why an endpoint does not negotiate correctly (tier A)");
p();
for (const e of failing) p(`- ${e.id}: ${verdicts.get(e.id)!.why.join("; ")}`);
p();

// ---- what a 3.2 request ends up at -----------------------------------------------------------------
sec("r1r3", "## What R1 (3.2) and R3 (grease) end up with (tier A)");
p();
p("| endpoint | R1 class | R1 version in force | R1 key bytes | R3 class | R3 version in force | server_version reported |");
p("|---|---|---|---|---|---|---|");
for (const e of A) {
  const r1 = get(e.id, "A", "R1");
  const r3 = get(e.id, "A", "R3");
  p(`| ${e.id} | ${r1?.class ?? "-"} | ${r1?.versionInForce || "-"} | ${r1?.keyBytes ?? "-"} | ${r3?.class ?? "-"} | ${r3?.versionInForce || "-"} | ${get(e.id, "A", "R0")?.serverVersion ?? ""} |`);
}
p();

// ---- failure catalogue ---------------------------------------------------------------------------
sec("catalogue", "## Failure catalogue (distinct non-OK outcomes, tier A and B, raw texts from the server)");
p();
const seen = new Map<string, Set<string>>();
for (const c of cells) {
  if (passCell(c)) continue;
  const ep = endpoints.find((e) => e.id === c.endpoint);
  const text = (c.error ? `${c.class}: ${c.error.sqlstate} ${c.error.message}` : `${c.class}: ${c.classReason}`).replace(/[\u0000-\u001f]/g, (ch) => `\\x${ch.charCodeAt(0).toString(16).padStart(2, "0")}`);
  const k = `${text}\u241f${ep?.family} ${ep?.version}`;
  const g = seen.get(k) ?? new Set();
  g.add(c.request);
  seen.set(k, g);
}
p("| product | outcome (class: raw text) | requests |");
p("|---|---|---|");
for (const [k, g] of [...seen].sort((a, b) => a[0].split("\u241f")[1]!.localeCompare(b[0].split("\u241f")[1]!))) {
  const [text, prod] = k.split("\u241f");
  p(`| ${prod} | ${text!.replace(/\|/g, "\\|")} | ${[...g].sort().join(", ")} |`);
}
p();

// ---- flaky -------------------------------------------------------------------------------------
const flaky = cells.filter((c) => c.rerunClass && c.rerunClass !== c.class);
sec("rerun", "## Re-runs of failing cells (each failing cell is re-run once, alone)");
p();
const rerun = cells.filter((c) => c.rerunClass);
p(`- cells re-run: ${rerun.length}; re-run gave a different class: ${flaky.length}`);
for (const c of flaky) p(`- ${c.endpoint} ${c.tier} ${c.request}: first ${c.class}, re-run ${c.rerunClass} (${c.rerunReason})`);
p();

// ---- diagnostics -------------------------------------------------------------------------------
const diagCells = cells.filter((c) => DIAG.includes(c.request));
if (diagCells.length) {
  sec("diag", "## Diagnostics (outside the matrix; tier A)");
  p();
  p("| endpoint | D1 3.0 + unknown option, empty value | D2 3.9999 + unknown option, value 1 | D3 3.9999 + grease option, value 1 |");
  p("|---|---|---|---|");
  for (const e of A) p(`| ${e.id} | ${DIAG.map((d) => SHORT[get(e.id, "A", d)?.class ?? ""] ?? "-").join(" | ")} |`);
  p();
}

// ---- repeat experiment and optional partial results ------------------------------------------
if (repeats.length) {
  sec("repeat", "## Repeat experiment (optional pgpool-II; scripts/repeat.ts)");
  p();
  p("| endpoint | repetitions | request | class counts |");
  p("|---|---|---|---|");
  for (const rp of repeats) for (const [req, m] of Object.entries(rp.counts)) p(`| ${rp.endpoint} | ${rp.repetitions} | ${req} | ${Object.entries(m).map(([k, v]) => `${k} x${v}`).join(", ")} |`);
  p();
  for (const rp of repeats) {
    if (rp.beta3Psql) {
      p(`libpq from 19beta3 (default grease), ${rp.endpoint}: ${rp.beta3Psql.connections} connections`);
      p();
      for (const [k, v] of Object.entries(rp.beta3Psql.outcomes)) p(`- ${v} x ${k.replace(/^psql: error: connection to server at "127.0.0.1", /, "")}`);
      p();
    }
    for (const [k, v] of Object.entries(rp.sampleReasons)) p(`- ${rp.endpoint} sample ${k}: ${v.replace(/[\u0000-\u001f]/g, (c) => `\\x${c.charCodeAt(0).toString(16).padStart(2, "0")}`)}`);
    p();
  }
}
const pgcatFiles = fs.existsSync(optDir) ? fs.readdirSync(optDir).filter((f) => f.startsWith("pgcat-")) : [];
if (pgcatFiles.length) {
  sec("pgcat", "## Optional, partial: PgCat (client authentication is MD5 only, so no cell can reach ReadyForQuery)");
  p();
  p("| run | R0 | R1 | R2 | R3 | R4 | R5 | R6 |");
  p("|---|---|---|---|---|---|---|---|");
  for (const f of pgcatFiles) {
    const cs = JSON.parse(fs.readFileSync(path.join(optDir, f), "utf8")) as Array<{ endpoint: string; request: string; class: string; classReason: string }>;
    p(`| ${cs[0]?.endpoint} | ${MATRIX.map((r) => { const c = cs.find((x) => x.request === r); return c ? `${SHORT[c.class]}${c.class === "Other" ? " (" + c.classReason.replace(/server requested auth method (\d+).*/, "auth request $1, refused") + ")" : ""}` : "-"; }).join(" | ")} |`);
  }
  p();
}

// ---- cancel ----------------------------------------------------------------------------------
sec("cancel", "## Cancel through a second socket (cells where the key is longer than 4 bytes or 3.2 is in force)");
p();
const cancelCounts = new Map<string, Map<string, number>>();
for (const c of cells.filter((x) => x.tier === "A" && x.cancel !== "not-applicable" && x.cancel !== "not-run" && x.cancel !== "skipped (SELECT 1 failed)")) {
  const m = cancelCounts.get(c.endpoint) ?? new Map();
  m.set(c.cancel, (m.get(c.cancel) ?? 0) + 1);
  cancelCounts.set(c.endpoint, m);
}
{
  const ran = cells.filter((c) => ["cancelled", "ignored", "hang"].includes(c.cancel) || c.cancel.startsWith("closed") || c.cancel.startsWith("error"));
  const outcome = new Map<string, number>();
  for (const c of ran) outcome.set(c.cancel, (outcome.get(c.cancel) ?? 0) + 1);
  const sock = new Map<string, number>();
  for (const c of ran) {
    const k = ((c as unknown as { cancelDetail: string }).cancelDetail ?? "").split(";")[0] ?? "";
    sock.set(k, (sock.get(k) ?? 0) + 1);
  }
  p(`- cancel tests run, tiers A and B: ${ran.length}; outcomes: ${[...outcome].map(([k, v]) => `${k} x${v}`).join(", ")}`);
  p(`- what the second (cancel) socket saw: ${[...sock].map(([k, v]) => `${k} x${v}`).join(", ")}`);
  p();
}
p("| endpoint (tier A) | cancel outcomes (count of cells) |");
p("|---|---|");
for (const e of A) {
  const m = cancelCounts.get(e.id);
  p(`| ${e.id} | ${m ? [...m].map(([k, v]) => `${k} x${v}`).join(", ") : "no cell needed a cancel"} |`);
}
p();

// ---- oracle 1 ------------------------------------------------------------------------------------
if (fs.existsSync(path.join(here, "results", "oracle-psql.csv"))) {
  const rows = parseCsv(read("oracle-psql.csv")).slice(1);
  sec("oracle1", "## Oracle 1: psql (libpq of postgres:19) against the probe's R0 and R1");
  p();
  const ps = (ep: string, tier: string, mpv: string) => rows.find((r) => r[0] === ep && r[1] === tier && r[2] === mpv);
  let agree = 0;
  let total = 0;
  const dis: string[] = [];
  p("| endpoint | tier | psql 3.0 | probe R0 | psql 3.2 | probe R1 | psql latest | probe R1 version in force |");
  p("|---|---|---|---|---|---|---|---|");
  for (const tier of ["A", "B"] as const) {
    for (const e of tierEps(tier)) {
      const a30 = ps(e.id, tier, "3.0");
      const a32 = ps(e.id, tier, "3.2");
      const al = ps(e.id, tier, "latest");
      if (!a30 || !a32 || !al) continue;
      const r0 = get(e.id, tier, "R0")!;
      const r1 = get(e.id, tier, "R1")!;
      const probe0 = passCell(r0) && r0.select1 === "ok";
      const probe1 = passCell(r1) && r1.select1 === "ok";
      const ps0 = a30[3] === "connected";
      const ps1 = a32[3] === "connected";
      total += 2;
      if (probe0 === ps0) agree++;
      else dis.push(`${e.id} ${tier} R0: probe ${probe0 ? "connected" : r0.class}, psql 3.0 ${a30[3]}`);
      if (probe1 === ps1) agree++;
      else dis.push(`${e.id} ${tier} R1: probe ${probe1 ? "connected" : r1.class}, psql 3.2 ${a32[3]}`);
      const fmt = (r: string[]) => (r[3] === "connected" ? `connected ${r[4]}` : "failed");
      p(`| ${e.id} | ${tier} | ${fmt(a30)} | ${probe0 ? "connected " + r0.versionInForce : r0.class} | ${fmt(a32)} | ${probe1 ? "connected " + r1.versionInForce : r1.class} | ${fmt(al)} | ${r1.versionInForce || "-"} |`);
    }
  }
  p();
  p(`- connected-or-not agreements between the probe (R0, R1) and psql (3.0, 3.2): ${agree} of ${total}`);
  for (const d of dis) p(`- DISAGREEMENT: ${d}`);
  // protocol-version agreement (psql reports the version libpq believes is in force)
  const vdis: string[] = [];
  let vtotal = 0;
  for (const tier of ["A", "B"] as const) for (const e of tierEps(tier)) {
    const a32 = ps(e.id, tier, "3.2");
    const r1 = get(e.id, tier, "R1");
    if (!a32 || !r1 || a32[3] !== "connected" || !passCell(r1)) continue;
    vtotal++;
    if (a32[4] !== r1.versionInForce) vdis.push(`${e.id} ${tier}: psql reports ${a32[4]}, probe R1 says ${r1.versionInForce}`);
  }
  p(`- version-in-force agreements for R1 where both connected: ${vtotal - vdis.length} of ${vtotal}`);
  for (const d of vdis) p(`- VERSION DIFFERENCE: ${d}`);
  p();
  const errs = new Map<string, string[]>();
  for (const r of rows) if (r[3] === "failed") {
    const k = r[6]!.replace(/port \d+/, "port N").replace(/'[0-9a-f]+'/, "'<hex>'");
    errs.set(k, [...(errs.get(k) ?? []), `${r[0]} ${r[1]} ${r[2]}`]);
  }
  p("psql error texts (port number and packet-header hex normalised):");
  p();
  for (const [k, v] of errs) p(`- \`${k.slice(0, 260)}\` x${v.length} (${[...new Set(v.map((x) => x.split(" ")[0]!.replace(/-(sess|tran)-pg\d+$/, "")))].join(", ")})`);
  p();
}

// ---- oracle 1b: libpq from 19beta3, which greases by default ----------------------------------
if (fs.existsSync(path.join(here, "results", "oracle-psql-beta3.csv"))) {
  const rows = parseCsv(read("oracle-psql-beta3.csv")).slice(1);
  sec("oracle1b", "## Oracle 1b: psql from postgres:19beta3 (libpq that sends the grease startup by default) against the probe's R3");
  p();
  let agree = 0;
  let total = 0;
  const dis: string[] = [];
  const vdis: string[] = [];
  let vtotal = 0;
  const detail: string[] = [];
  for (const r of rows) {
    const [ep, tier, , outcome, version] = r as [string, "A" | "B", string, string, string];
    const r3 = get(ep, tier, "R3");
    if (!r3) continue;
    const probeOk = passCell(r3) && r3.select1 === "ok";
    total++;
    if (probeOk === (outcome === "connected")) agree++;
    else dis.push(`${ep} ${tier}: probe R3 ${r3.class}, beta3 psql ${outcome}`);
    if (outcome === "connected" && probeOk) {
      vtotal++;
      if (version !== r3.versionInForce) vdis.push(`${ep} ${tier}: beta3 psql ${version}, probe R3 ${r3.versionInForce}`);
    }
    if (tier === "A") detail.push(`| ${ep} | ${outcome === "connected" ? "connected " + version : "failed"} | ${probeOk ? "connected " + r3.versionInForce : r3.class} |`);
  }
  p("| endpoint (tier A) | psql 19beta3, default grease | probe R3 |");
  p("|---|---|---|");
  for (const d of detail) p(d);
  p();
  p(`- connected-or-not agreements between 19beta3 psql (default) and the probe's R3, tiers A and B: ${agree} of ${total}`);
  for (const d of dis) p(`- DISAGREEMENT: ${d}`);
  p(`- version-in-force agreements where both connected: ${vtotal - vdis.length} of ${vtotal}`);
  for (const d of vdis) p(`- VERSION DIFFERENCE: ${d}`);
  p();
}

// ---- oracle 2 ------------------------------------------------------------------------------------
if (fs.existsSync(path.join(here, "results", "oracle-faults.csv"))) {
  const rows = parseCsv(read("oracle-faults.csv")).slice(1);
  sec("oracle2", "## Oracle 2: fault servers (not endpoints)");
  p();
  const names = [...new Set(rows.map((r) => r[0]!))];
  p(`| fault server | ${MATRIX.join(" | ")} |`);
  p(`|---|${MATRIX.map(() => "---").join("|")}|`);
  for (const n of names) p(`| ${n} | ${MATRIX.map((r) => SHORT[rows.find((x) => x[0] === n && x[2] === r)?.[4] ?? ""] ?? "-").join(" | ")} |`);
  p();
}

const order = ["headline", "classcounts", "tierA", "tierB", "why", "r1r3", "catalogue", "rerun", "diag", "repeat", "pgcat", "cancel", "oracle1", "oracle1b", "oracle2"];
const text = order.filter((k) => blocks.has(k)).map((k) => blocks.get(k)!.join("\n")).join("\n") + "\n";
fs.writeFileSync(path.join(here, "results", "summary.md"), text);
fs.mkdirSync(path.join(here, "results", "tables"), { recursive: true });
for (const [k, v] of blocks) fs.writeFileSync(path.join(here, "results", "tables", `${k}.md`), v.join("\n") + "\n");
console.log(text);
