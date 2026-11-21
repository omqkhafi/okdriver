// FS-08 integer-width probe. Usage: <runtime> scripts/probe-integers.mjs <binding>
// Needs results/integers/truth.json and work/int/ints.db from `python3 -I scripts/integers-truth.py`.
// For every case it reads the same cells in the binding's default mode ("number") and in its lossless
// mode ("bigint"), compares both with the independent truth, then applies the candidate rule below to the
// lossless read and checks the result against what the rule says the truth must decode to.
//
// THE RULE UNDER TEST (see README "Integer-width rule"):
//   R1  read every integer cell through the binding's lossless mode (bigint)
//   R2  take the column's declared type from statement column metadata (null for expressions)
//   R3  64-bit declared type = BIGINT, INT8 or UNSIGNED BIG INT (case-insensitive, size suffix ignored)
//   R4  integer cell in a 64-bit declared column -> bigint
//   R5  any other integer cell -> number if |v| <= 2^53-1, else DataError (never rounded)
//   R6  REAL -> number, TEXT -> string, BLOB -> bytes, NULL -> null, whatever the declared type
import fs from 'node:fs';
import path from 'node:path';
import { getAdapter } from './lib/adapters.mjs';
import { runtime, WORK, RESULTS, describeError, writeJson, BINDINGS } from './lib/rt.mjs';

const binding = process.argv[2];
if (!BINDINGS.includes(binding)) { console.error('usage: probe-integers.mjs <binding>'); process.exit(2); }
const rt = runtime();
const tag = binding.replace(/[:]/g, '-') + '__' + rt.id;
const outFile = path.join(RESULTS, 'integers', tag + '.json');
const truth = JSON.parse(fs.readFileSync(path.join(RESULTS, 'integers', 'truth.json'), 'utf8'));
const a = await getAdapter(binding);
if (!a.ok) { await writeJson(outFile, { binding, runtime: rt, loaded: false, loadError: a.error }); console.log(tag, 'does not load'); process.exit(0); }

const SAFE = 9007199254740991n;
export const is64 = (decl) => {
  if (decl == null) return false;
  const d = String(decl).toUpperCase().replace(/\(.*\)/, '').replace(/\s+/g, ' ').trim();
  return d === 'BIGINT' || d === 'INT8' || d === 'UNSIGNED BIG INT';
};
const hex = (u) => Array.from(u, (b) => b.toString(16).padStart(2, '0')).join('');
const enc = (v) => (v === null ? 'null' : typeof v === 'bigint' ? 'bigint:' + v : typeof v === 'number' ? 'number:' + (Object.is(v, -0) ? '-0' : String(v)) : typeof v === 'string' ? 'string:' + v : v instanceof Uint8Array ? 'blob:' + hex(v) : typeof v);
function applyRule(v, decl) { // R1..R6 applied to one lossless-mode cell
  if (typeof v === 'bigint') {
    if (is64(decl)) return 'bigint:' + v;
    return v >= -SAFE && v <= SAFE ? 'number:' + String(Number(v)) : 'DataError:' + v;
  }
  return enc(v);
}
function oracle(cell, decl) { // what the rule says the truth must decode to
  switch (cell.t) {
    case 'integer': { if (is64(decl)) return 'bigint:' + cell.v; const b = BigInt(cell.v); return b >= -SAFE && b <= SAFE ? 'number:' + cell.v : 'DataError:' + cell.v; }
    case 'real': return 'number:' + String(Number(cell.v));
    case 'text': return 'string:' + cell.v;
    case 'blob': return 'blob:' + cell.v;
    default: return 'null';
  }
}
function verdict(cell, e) { // raw (non-rule) read vs truth
  if (e.startsWith('ERR:')) return 'error';
  const i = e.indexOf(':'); const kind = i < 0 ? e : e.slice(0, i), val = i < 0 ? '' : e.slice(i + 1);
  switch (cell.t) {
    case 'integer':
      if (kind === 'bigint') return val === cell.v ? 'exact' : 'wrong';
      if (kind === 'number') { const n = Number(val); if (!Number.isInteger(n)) return 'wrong'; const same = BigInt(n) === BigInt(cell.v); return same ? (Number.isSafeInteger(n) ? 'exact' : 'exact-unsafe') : 'rounded'; }
      return 'wrong';
    case 'real': return kind === 'number' && Number(val) === Number(cell.v) ? 'exact' : 'wrong';
    case 'text': return kind === 'string' && val === cell.v ? 'exact' : 'wrong';
    case 'blob': return kind === 'blob' && val === cell.v ? 'exact' : 'wrong';
    default: return kind === 'null' ? 'exact' : 'wrong';
  }
}
const declsOf = (raw) => (binding === 'bun:sqlite' ? Array.from(raw.declaredTypes) : raw.columns().map((c) => c.type));
const runRows = (st, params) => { try { return { rows: st.all(...params).map((r) => Object.values(r)) }; } catch (e) { return { err: describeError(e) }; } };

const dbPath = path.join(WORK, 'int', 'ints.db');
const hN = a.open(dbPath, { readonly: true, intMode: 'number' });
const hB = a.open(dbPath, { readonly: true, intMode: 'bigint' });

const cases = [];
const summary = { negativeControl: { alwaysNumber: 0, alwaysBigint: 0, note: 'cells where a deliberately wrong rule disagrees with the oracle; must be > 0 or the check proves nothing' }, cells: 0, ruleHolds: 0, ruleFails: 0, declAsserted: 0, declMismatch: 0, number: {}, bigint: {} };
const bump = (o, k) => { o[k] = (o[k] || 0) + 1; };
const failures = [];
for (const c of truth.cases) {
  let stN, stB, declObs = null, declErr = null;
  try { stN = hN.prepare(c.sql); stB = hB.prepare(c.sql); declObs = declsOf(stB.raw); } catch (e) { declErr = describeError(e); }
  const rec = { id: c.id, group: c.group, decl: declObs, declExpected: c.expectDecl, declMatch: c.expectDecl && declObs ? JSON.stringify(c.expectDecl) === JSON.stringify(declObs) : null, rows: [] };
  if (declErr) rec.prepareError = declErr;
  if (rec.declMatch !== null) { summary.declAsserted++; if (!rec.declMatch) summary.declMismatch++; }
  c.paramSets.forEach((params, pi) => {
    const t = c.rows[pi];
    const row = { p: params.join(','), number: null, bigint: null, ok: null };
    if (!Array.isArray(t)) { // SQLite itself raises; every binding must raise too, in both modes
      row.sqliteError = t.sqliteError;
      const rn = stN ? runRows(stN, params) : { err: declErr }, rb = stB ? runRows(stB, params) : { err: declErr };
      row.number = rn.err ? 'ERR:' + (rn.err.code ?? rn.err.message) : 'no error';
      row.bigint = rb.err ? 'ERR:' + (rb.err.code ?? rb.err.message) : 'no error';
      row.ok = !!rn.err && !!rb.err && String(rn.err.message).includes(t.sqliteError) && String(rb.err.message).includes(t.sqliteError);
      row.errMessage = rb.err ? rb.err.message : null;
      summary.cells++; row.ok ? summary.ruleHolds++ : summary.ruleFails++;
      bump(summary.number, row.ok ? 'sqlite-error-raised' : 'sqlite-error-not-raised'); bump(summary.bigint, row.ok ? 'sqlite-error-raised' : 'sqlite-error-not-raised');
      rec.rows.push(row); if (!row.ok) failures.push({ id: c.id, p: row.p, row });
      return;
    }
    // the truth itself lives in results/integers/truth.json (same case id and parameter index)
    const rn = stN ? runRows(stN, params) : { err: declErr }, rb = stB ? runRows(stB, params) : { err: declErr };
    row.number = rn.err ? 'ERR:' + (rn.err.code ?? rn.err.message) : rn.rows.map((r) => r.map(enc));
    row.bigint = rb.err ? 'ERR:' + (rb.err.code ?? rb.err.message) : rb.rows.map((r) => r.map(enc));
    const decl = (i) => (c.expectDecl ? c.expectDecl[i] : declObs ? declObs[i] : null);
    if (rb.err || !rb.rows || rb.rows.length !== t.length) { row.ok = false; row.rule = 'no lossless read'; summary.ruleFails++; summary.cells++; failures.push({ id: c.id, p: row.p, row }); rec.rows.push(row); return; }
    const ruleOut = rb.rows.map((r) => r.map((v, i) => applyRule(v, declObs ? declObs[i] : null)));
    const oracleOut = t.map((r) => r.map((cell, i) => oracle(cell, decl(i))));
    row.rule = ruleOut; row.oracle = oracleOut;
    row.ok = JSON.stringify(ruleOut) === JSON.stringify(oracleOut) && (declObs ? true : false);
    if (row.ok) { delete row.rule; delete row.oracle; }
    rb.rows.forEach((r, ri) => r.forEach((v, ci) => {
      const o = oracleOut[ri][ci];
      if (typeof v === 'bigint') { if ('number:' + String(Number(v)) !== o) summary.negativeControl.alwaysNumber++; if ('bigint:' + v !== o) summary.negativeControl.alwaysBigint++; }
    }));
    // when the declared type is asserted, the rule must also use the asserted type
    t.forEach((r, ri) => r.forEach((cell, ci) => {
      summary.cells++;
      if (typeof row.number === 'string') bump(summary.number, 'error'); else bump(summary.number, verdict(cell, row.number[ri][ci]));
      bump(summary.bigint, verdict(cell, row.bigint[ri][ci]));
    }));
    row.ok ? summary.ruleHolds++ : summary.ruleFails++;
    if (!row.ok) failures.push({ id: c.id, p: row.p, row });
    // keep only what is needed to read the table: drop duplicated agreement for non-interesting rows
    rec.rows.push(row);
  });
  cases.push(rec);
}
hN.close(); hB.close();

// ---------- bind side (both integer modes: Bun's out-of-range BigInt behaviour depends on the mode) ----------
const bindRows = [];
const bindVals = [['number', 3], ['number', 2147483648], ['number', 2 ** 40], ['number', 2 ** 53 - 1], ['number', 2 ** 53], ['number', 1.5], ['number', -0],
  ['bigint', 3n], ['bigint', 9007199254740993n], ['bigint', 9223372036854775807n], ['bigint', -9223372036854775808n], ['bigint', 9223372036854775808n], ['bigint', -9223372036854775809n], ['bigint', 18446744073709551616n], ['bigint', 18446744073709551621n]];
for (const mode of ['number', 'bigint']) {
  const hb = a.open(':memory:', { intMode: mode });
  for (const [kind, v] of bindVals) {
    try {
      const r = hb.prepare('SELECT typeof(?) AS t, CAST(? AS TEXT) AS s').get(v, v);
      bindRows.push({ mode, kind, value: String(v), sqlType: r.t, sqlText: r.s, textEqualsInput: r.s === String(v) });
    } catch (e) { bindRows.push({ mode, kind, value: String(v), error: describeError(e) }); }
  }
  hb.close();
}

const out = { binding, runtime: rt, loaded: true, sqlite_version: (() => { const h = a.open(':memory:'); const v = Object.values(h.prepare('SELECT sqlite_version()').get())[0]; h.close(); return v; })(), truthReader: truth.reader, truthSqliteVersion: truth.sqlite_version, summary, failures: failures.slice(0, 40), bind: bindRows, cases };
await writeJson(outFile, out, { compact: true });
console.log(tag, 'rule holds', summary.ruleHolds, 'fails', summary.ruleFails, '| decl asserted', summary.declAsserted, 'mismatch', summary.declMismatch, '| number-mode', JSON.stringify(summary.number), '| bigint-mode', JSON.stringify(summary.bigint));
