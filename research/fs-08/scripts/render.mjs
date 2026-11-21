// FS-08 renderer: turns results/**/*.json into markdown tables. Nothing in these tables is typed by hand.
//   node scripts/render.mjs         writes results/tables.md and replaces every <!-- GEN:name --> block in README.md
import fs from 'node:fs';
import path from 'node:path';
import { RESULTS, ROOT } from './lib/rt.mjs';

const rd = (f) => { try { return JSON.parse(fs.readFileSync(path.join(RESULTS, f), 'utf8')); } catch { return null; } };
const ls = (d) => { try { return fs.readdirSync(path.join(RESULTS, d)).filter((f) => f.endsWith('.json')).sort(); } catch { return []; } };
const RUNTIMES = ['node22', 'node24', 'node26', 'bun'];
const BINDINGS = ['bun:sqlite', 'node:sqlite', 'better-sqlite3'];
const tagOf = (b, r) => b.replace(/[:]/g, '-') + '__' + r;
const REF = { 'bun:sqlite': 'bun', 'node:sqlite': 'node24', 'better-sqlite3': 'node24' };
const md = (rows) => rows.map((r) => '| ' + r.join(' | ') + ' |').join('\n');
const table = (head, rows) => md([head, head.map(() => '---'), ...rows]);
const esc = (s) => String(s).replace(/\|/g, '\\|');

const caps = {}; for (const b of BINDINGS) for (const r of RUNTIMES) { const j = rd(`capabilities/${tagOf(b, r)}.json`); if (j) caps[tagOf(b, r)] = j; }
const C = (b, r = REF[b]) => caps[tagOf(b, r)];
const gen = {};

// ---------- 1. binding x runtime matrix ----------
gen.matrix = (() => {
  const rows = BINDINGS.map((b) => [b, ...RUNTIMES.map((r) => { const j = caps[tagOf(b, r)]; if (!j) return 'no result'; if (!j.loaded) return `does not load (${j.loadError.code ?? j.loadError.message.slice(0, 40)})`; const w = j.meta.warnings.length ? '; warns: ' + j.meta.warnings.map((x) => x.split(':')[0]).join(',') : '; no warning'; return `loads; SQLite ${j.meta.sqlite_version}${w}`; })]);
  return table(['binding', ...RUNTIMES], rows);
})();

// ---------- 2. status matrix (every capability row) ----------
const AREAS = [['open', 'Open modes and pragmas'], ['pragma', 'Open modes and pragmas'], ['wal', 'WAL and checkpoint'], ['busy', 'busy_timeout and BEGIN IMMEDIATE'], ['errors', 'Error classification'], ['tx', 'Transactions and savepoints'], ['stmt', 'Statement lifecycle and close'], ['iter', 'Iteration and early termination'], ['fn', 'Custom functions, aggregates, collations'], ['ext', 'Extension loading'], ['backup', 'Backup'], ['change', 'Change capture'], ['meta', 'Declared-type and column metadata']];
const areaOf = (id) => AREAS.find(([p]) => id.startsWith(p + '.'))?.[1] ?? 'other';
const ids = [...new Set(Object.values(caps).flatMap((j) => (j.loaded ? Object.keys(j.caps) : [])))];
function statusCell(b, id) {
  const by = {};
  for (const r of RUNTIMES) { const j = caps[tagOf(b, r)]; if (!j || !j.loaded) continue; const s = j.caps[id]?.status ?? 'missing'; (by[s] ||= []).push(r); }
  const keys = Object.keys(by); if (!keys.length) return 'does not load on any runtime in this matrix';
  if (keys.length === 1) return keys[0];
  return keys.map((k) => `${k} (${by[k].join(', ')})`).join('; ');
}
gen.status = table(['area', 'capability row', ...BINDINGS], ids.map((id) => [areaOf(id), id, ...BINDINGS.map((b) => statusCell(b, id))]).sort((x, y) => (AREAS.findIndex(([, n]) => n === x[0]) - AREAS.findIndex(([, n]) => n === y[0])) || x[1].localeCompare(y[1])));

// ---------- 3. observed values per area (reference runtime per binding) ----------
const d = (b, id) => C(b)?.caps[id];
const code = (e) => (e ? (e.code ?? e.errcode ?? e.errno) + (e.errcode !== undefined && e.code === 'ERR_SQLITE_ERROR' ? ` errcode=${e.errcode}` : e.errno !== undefined ? ` errno=${e.errno}` : '') : 'none');
const KEY = [
  ['Open', 'read-only handle: write rejected with', (b) => code(d(b, 'open.readonly_rejects_write')?.detail?.error)],
  ['Open', 'must-exist-style open option', (b) => d(b, 'open.must_exist_option')?.status + (d(b, 'open.must_exist_option')?.status === 'works' ? ' (missing file: ' + code(d(b, 'open.must_exist_option').detail.error) + ')' : '')],
  ['Open', 'file: URI filenames', (b) => (d(b, 'open.uri_filename')?.status === 'absent' ? 'not interpreted' : 'honoured (mode=ro enforced)')],
  ['Pragmas', 'defaults on a fresh file handle: foreign_keys / busy_timeout / cache_size', (b) => { const x = d(b, 'pragma.defaults_on_fresh_file_handle')?.detail; return x ? `${x.foreign_keys} / ${x.busy_timeout} / ${x.cache_size}` : 'n/a'; }],
  ['Pragmas', 'busy timeout as a constructor option', (b) => (d(b, 'pragma.busy_timeout_constructor_option')?.status === 'absent' ? 'absent (PRAGMA busy_timeout)' : 'works')],
  ['WAL', 'journal_mode=WAL via PRAGMA', (b) => d(b, 'pragma.set_via_sql_and_read_back')?.detail?.journal_mode],
  ['WAL', 'reader sees a commit / keeps its snapshot inside BEGIN', (b) => { const x = d(b, 'wal.reader_sees_commit_and_snapshot')?.detail; return x ? `${x.before}->${x.after_commit_seen} / ${x.snapshot_start}->${x.snapshot_after_writer_commit}` : 'n/a'; }],
  ['WAL', 'wal_checkpoint(TRUNCATE) row', (b) => { const x = d(b, 'wal.checkpoint_control')?.detail; return x ? `busy=${x.truncate.busy} log=${x.truncate.log} checkpointed=${x.truncate.checkpointed}` : 'n/a'; }],
  ['Busy', 'BEGIN IMMEDIATE against a held write lock: timeout 0 / 300 ms', (b) => { const x = d(b, 'busy.immediate_blocks_second_writer')?.detail; return x ? `${x.timeout_0.elapsedMs} ms ${code(x.timeout_0.error)} / ${x.timeout_300.elapsedMs} ms` : 'n/a'; }],
  ['Busy', 'wait never ends before the timeout (50/200/600 ms rows)', (b) => { const x = d(b, 'busy.timeout_bounds_wait')?.detail; return x ? (x.rows.every((r) => !r.returnedBeforeTimeout && r.errored) ? 'yes: ' + x.rows.map((r) => r.elapsedMs).join(' / ') + ' ms' : 'NO') : 'n/a'; }],
  ['Busy', 'deferred read-then-write after another commit (timeout 500 ms)', (b) => { const x = d(b, 'busy.deferred_read_to_write_upgrade')?.detail; return x ? `${x.elapsedMs} ms, ${code(x.error)}` : 'n/a'; }],
  ['Busy', 'BEGIN IMMEDIATE first: own write and commit succeed, other writer blocked', (b) => { const x = d(b, 'busy.immediate_avoids_upgrade_failure')?.detail; return x ? `${x.ownInsertOk && x.ownCommitOk}, ${x.otherWriterBlocked}` : 'n/a'; }],
  ['Errors', 'property carrying the SQLite code', (b) => d(b, 'errors.classification')?.propertiesCarryingACode?.join(', ')],
  ['Errors', 'SQLITE_BUSY reachable / SQLITE_LOCKED reachable as a code', (b) => { const x = d(b, 'errors.classification'); return x ? `${x.busyReached} / ${x.lockedReached}${x.lockedReached ? '' : ' (' + (x.errors.LOCKED?.message ?? 'no error') + ')'}` : 'n/a'; }],
  ['Errors', 'busy and locked told apart by that property', (b) => String(d(b, 'errors.classification')?.busyAndLockedDistinguishable)],
  ['Errors', 'extended code kept (BUSY_SNAPSHOT / UNIQUE)', (b) => { const e = d(b, 'busy.deferred_read_to_write_upgrade')?.detail?.error, u = d(b, 'errors.classification')?.errors?.CONSTRAINT_UNIQUE; return `${code(e)} / ${code(u)}`; }],
  ['Transactions', 'transaction() helper', (b) => d(b, 'tx.transaction_helper')?.status === 'absent' ? 'absent' : 'present: nested helper calls use savepoints (' + JSON.stringify(d(b, 'tx.transaction_helper').detail.committed_then_failed_rows) + ')'],
  ['Transactions', 'in-transaction flag; BEGIN inside BEGIN', (b) => { const x = d(b, 'tx.modes_and_flag')?.detail; return x ? `${x.flagName}; ${code(x.nestedBegin)}` : 'n/a'; }],
  ['Transactions', 'raw SAVEPOINT / ROLLBACK TO / RELEASE nesting', (b) => JSON.stringify(d(b, 'tx.nested_savepoints')?.detail?.rows) + ' (expected [1,2])'],
  ['Statements', 'statement finalize/close method', (b) => (d(b, 'stmt.finalize_api')?.status === 'absent' ? 'absent' : d(b, 'stmt.finalize_api')?.detail?.method)],
  ['Statements', 'db close with an open iterator', (b) => { const x = d(b, 'stmt.close_semantics')?.detail?.open_iterator; return x ? (typeof x.close === 'string' ? `returns; WAL files removed: ${x.walFilesRemoved}` : `throws ${x.close.name}: ${x.close.message}`) : 'n/a'; }],
  ['Statements', 'db close with idle prepared statements: really closed?', (b) => { const x = d(b, 'stmt.close_semantics')?.detail?.prepared_never_run; return x ? `WAL files removed: ${x.walFilesRemoved}; old statement afterwards: ${x.oldStatementAfterClose.rows !== undefined ? 'still runs' : x.oldStatementAfterClose.message}` : 'n/a'; }],
  ['Statements', 'bun close(true) with live statements', (b) => { const x = d(b, 'stmt.close_semantics')?.detail?.prepared_never_run__close_true; return x ? `WAL files removed: ${x.walFilesRemoved}` : 'n/a'; }],
  ['Statements', 'statement reused after an early break', (b) => { const x = d(b, 'stmt.reuse_after_early_break')?.detail; return x ? `all() after break: ${typeof x.allAfterBreak === 'number' ? x.allAfterBreak + ' rows' : JSON.stringify(x.allAfterBreak)}` : 'n/a'; }],
  ['Statements', 'same statement used while its iterator is open', (b) => { const x = d(b, 'stmt.use_while_iterator_open')?.detail?.sameStatementWhileIterating; return x?.rows !== undefined ? 'allowed (' + x.rows + ' rows)' : x?.message; }],
  ['Statements', 'built-in statement cache', (b) => (d(b, 'stmt.cache')?.status === 'absent' ? 'absent' : d(b, 'stmt.cache')?.detail?.api)],
  ['Iteration', 'iterator has return() (for-of break releases it)', (b) => String(d(b, 'iter.early_termination_and_return')?.detail?.iteratorHasReturn)],
  ['Iteration', 'open iterator: sees writer commit / checkpoint busy / WAL bytes', (b) => { const x = d(b, 'iter.open_iterator_holds_read_snapshot_and_blocks_checkpoint')?.detail; return x ? `sees ${x.readerCountWhileIteratorOpen_afterWriterCommit} of ${x.committedRowsAtStart + 1}; busy=${x.checkpointWhileOpen.busy}; ${x.walBytesWhileOpen} B` : 'n/a'; }],
  ['Iteration', 'after return(): reader sees commit / checkpoint busy / WAL bytes', (b) => { const x = d(b, 'iter.open_iterator_holds_read_snapshot_and_blocks_checkpoint')?.detail; return x ? `sees ${x.readerCountAfterReturn}; busy=${x.checkpointAfterReturn.busy}; ${x.walBytesAfterReturn} B` : 'n/a'; }],
  ['Iteration', 'rollback-journal db: write while iterator open', (b) => { const x = d(b, 'iter.rollback_journal_iterator_blocks_writer')?.detail; return x ? `${typeof x.writeWhileIteratorOpen === 'string' ? 'ok' : code(x.writeWhileIteratorOpen)}; after return: ${x.writeAfterReturn}` : 'n/a'; }],
  ['Iteration', 'steps row by row (first row then break vs all(), 300k rows)', (b) => { const x = d(b, 'iter.streams_row_by_row')?.detail; return x ? `${x.medianMs_firstRowThenBreak} ms vs ${x.medianMs_all} ms` : 'n/a'; }],
  ['Functions', 'scalar / aggregate', (b) => `${d(b, 'fn.scalar')?.status} / ${d(b, 'fn.aggregate')?.status}`],
  ['Functions', 'integer 2^53+1 as a JS argument', (b) => { const t = d(b, 'fn.scalar')?.detail?.jsTypeOfInt2p53plus1AsArgument; return typeof t === 'string' ? t + ' (silent rounding)' : t?.callFailed ? 'throws ' + t.callFailed.code : 'n/a'; }],
  ['Functions', 'collation API', (b) => d(b, 'fn.collation')?.status],
  ['Functions', 'virtual-table / authorizer / limits / defensive', (b) => { const x = d(b, 'fn.virtual_tables_and_other_hooks')?.detail; return x ? `${x.namesMatchingTableOrModule.join('+') || 'no table API'} / ${x.authorizer} / ${x.limits} / ${x.defensive}` : 'n/a'; }],
  ['Extensions', 'loadExtension API; SQL load_extension() by default', (b) => { const x = d(b, 'ext.loading')?.detail; return x ? `${x.api.loadExtension}${x.api.enableLoadExtension !== 'undefined' ? ' + enableLoadExtension' : ''}; ${x.sqlLoadExtensionFunctionByDefault?.message ?? 'enabled'}` : 'n/a'; }],
  ['Extensions', 'loadExtension() without any opt-in (real .so built from scripts/fixtures/ext.c)', (b) => { const x = d(b, 'ext.loading')?.detail; if (!x) return 'n/a'; if (x.loadExtensionWithoutEnabling === 'loaded') return `LOADS and runs (okfs08_answer() = ${x.exercisedWithoutEnabling})`; return `refused: ${x.loadExtensionWithoutEnabling?.message}${x.withAllowExtensionOption ? '; with allowExtension: loads, answer ' + x.withAllowExtensionOption.answer : ''}`; }],
  ['Backup', 'online backup API', (b) => { const x = d(b, 'backup.online_backup_api'); return x?.status === 'absent' ? 'absent' : `${x?.detail?.api} (copy has ${x?.detail?.rowsInCopy} rows)`; }],
  ['Backup', 'serialize then deserialize: memory db / file db (rollback journal) / file db in WAL', (b) => { const x = d(b, 'backup.serialize_deserialize'); if (x?.status === 'absent') return 'absent'; const w = (m) => (m.serialize ? 'serialize fails: ' + m.serialize.message : m.deserialize === 'ok' ? m.rowsAfterDeserialize + ' rows back' : 'serialize ok, deserialize fails: ' + m.deserialize.message); return `${w(x.detail.memoryDatabase)} / ${w(x.detail.fileDatabase)} / ${w(x.detail.fileDatabaseWal)}`; }],
  ['Backup', 'VACUUM INTO', (b) => (d(b, 'backup.vacuum_into')?.detail?.rowsInCopy === 50 ? 'works (50/50 rows)' : 'n/a')],
  ['Change capture', 'update hooks', (b) => (d(b, 'change.update_hooks')?.status === 'absent' ? 'absent' : d(b, 'change.update_hooks')?.detail?.form + '; events ' + d(b, 'change.update_hooks')?.detail?.events?.map((e) => e[0]).join(',')) ],
  ['Change capture', 'session extension / changeset', (b) => (d(b, 'change.session_extension')?.status === 'absent' ? 'absent' : `works: ${d(b, 'change.session_extension')?.detail?.changesetBytes} B changeset, applied: ${d(b, 'change.session_extension')?.detail?.applyChangesetResult}`)],
  ['Metadata', 'declared type of columns a, b, c(NUMERIC(10,2)), d, e, f(no type), g, h, a+1, count(*)', (b) => { const x = d(b, 'meta.declared_types')?.detail; const t = x?.declaredTypesBeforeStep ?? x?.columns?.map((c) => c.type); return t ? JSON.stringify(t) + (x.declaredTypesBeforeStep ? ' before stepping (declaredTypes)' : ' (columns())') : 'n/a'; }],
  ['Metadata', 'declared type through a view / a subquery (column a BIGINT)', (b) => { const x = d(b, 'meta.declared_types')?.detail; return x ? `${JSON.stringify(x.viewColumns)} / ${JSON.stringify(x.subqueryColumn)}` : 'n/a'; }],
  ['Metadata', 'STRICT: BIGINT column; text into INTEGER', (b) => { const x = d(b, 'meta.strict_tables')?.detail; return x ? `${x.bigintDeclaredInStrict?.message ?? 'accepted'}; ${x.textIntoIntegerColumn?.message ?? 'accepted'}` : 'n/a'; }],
];
gen.values = table(['area', 'observed', ...BINDINGS.map((b) => `${b} (${REF[b]})`)], KEY.map(([a, l, f]) => [a, esc(l), ...BINDINGS.map((b) => { try { return esc(f(b) ?? 'n/a'); } catch (e) { return 'n/a'; } })]));

// ---------- 4. defaults and compile options ----------
gen.compile = (() => {
  const sets = Object.fromEntries(BINDINGS.map((b) => [b, new Set(C(b)?.meta.compile_options ?? [])]));
  const all = [...new Set(BINDINGS.flatMap((b) => [...sets[b]]))].sort();
  const diff = all.filter((o) => BINDINGS.some((b) => sets[b].has(o) !== sets[BINDINGS[0]].has(o)));
  const interesting = ['ENABLE_COLUMN_METADATA', 'ENABLE_SESSION', 'ENABLE_PREUPDATE_HOOK', 'ENABLE_DESERIALIZE', 'ENABLE_FTS5', 'ENABLE_DBPAGE_VTAB', 'OMIT_LOAD_EXTENSION', 'OMIT_SHARED_CACHE', 'DEFAULT_FOREIGN_KEYS=1', 'DQS=0', 'THREADSAFE=2', 'THREADSAFE=1', 'ENABLE_MATH_FUNCTIONS', 'ENABLE_RTREE', 'ENABLE_JSON1', 'ENABLE_DBSTAT_VTAB'];
  const rows = [...new Set([...interesting, ...diff])].map((o) => [o, ...BINDINGS.map((b) => (sets[b].has(o) ? 'yes' : '-'))]);
  const head = `Compile options counted: ${BINDINGS.map((b) => `${b} ${sets[b].size}`).join(', ')}. Rows: a fixed list of options that matter here, plus every option that differs between bindings.\n\n`;
  return head + table(['PRAGMA compile_options entry', ...BINDINGS], rows);
})();

// ---------- 5. node:sqlite stability ----------
gen.stability = (() => {
  const s = rd('node-sqlite-stability.json'); if (!s) return '_not generated_';
  const docs = Object.entries(s.docs).map(([m, x]) => [`Node ${m}.x docs`, x.reachable ? `${x.title}: Stability ${x.stabilityIndex} - ${x.stabilityLabel}` : 'docs host unreachable', esc(x.historyExcerpt ?? '')]);
  const runs = s.runs.filter((r) => !r.skipped).map((r) => [`${r.release} (${r.version}) ${r.flags.join(' ') || 'no flag'}`, r.result?.loads ? `loads (SQLite ${r.result.sqlite})` : `does not load: ${r.result?.code}`, r.warningOnStderr ? esc(r.warningOnStderr) : 'no warning on stderr']);
  return table(['source', 'stability level', 'history excerpt'], docs) + '\n\n' + table(['release run', 'result', 'warning'], runs);
})();

// ---------- 6. integers ----------
const ints = {}; for (const b of BINDINGS) for (const r of RUNTIMES) { const j = rd(`integers/${tagOf(b, r)}.json`); if (j && j.loaded) ints[tagOf(b, r)] = j; }
const truth = rd('integers/truth.json');
const SAFE = 9007199254740991n;
const is64 = (decl) => { if (decl == null) return false; const u = String(decl).toUpperCase().replace(/\(.*\)/, '').replace(/\s+/g, ' ').trim(); return u === 'BIGINT' || u === 'INT8' || u === 'UNSIGNED BIG INT'; };
const ruleOf = (v, decl) => (is64(decl) ? `bigint ${v}` : BigInt(v) >= -SAFE && BigInt(v) <= SAFE ? `number ${v}` : 'DataError');
function cellWords(e, truthV) {
  if (typeof e === 'string') return e.startsWith('ERR:') ? 'throws ' + e.slice(4).replace('ERR_OUT_OF_RANGE', 'ERR_OUT_OF_RANGE') : e;
  const x = e[0][0]; const i = x.indexOf(':'); const kind = x.slice(0, i), val = x.slice(i + 1);
  if (kind === 'number') { const n = Number(val); return BigInt(Math.trunc(n)) === BigInt(truthV) && Number.isSafeInteger(n) ? val : BigInt(Math.trunc(n)) === BigInt(truthV) ? `${val} (exact, not safe)` : `${val} (ROUNDED)`; }
  return `${kind} ${val}`;
}
gen.boundary = (() => {
  if (!truth) return '_not generated_';
  const get = (b, id) => ints[tagOf(b, REF[b])]?.cases.find((c) => c.id === id);
  const rows = truth.values.map((v, k) => {
    const row = [v];
    for (const b of BINDINGS) row.push(esc(cellWords(get(b, 'col:n_integer')?.rows[k]?.number ?? 'n/a', v)));
    row.push(ruleOf(v, 'INTEGER'), ruleOf(v, 'BIGINT'));
    return row;
  });
  return table(['stored value (INTEGER or BIGINT column)', ...BINDINGS.map((b) => `default read, ${b} (${REF[b]})`), 'rule, INTEGER column', 'rule, BIGINT column'], rows);
})();
gen.intSummary = (() => {
  const rows = [];
  for (const b of BINDINGS) for (const r of RUNTIMES) { const j = ints[tagOf(b, r)]; if (!j) continue; const s = j.summary; const f = (o) => Object.entries(o).filter(([k]) => !k.startsWith('sqlite-error')).map(([k, v]) => `${k} ${v}`).join(', '); rows.push([b, r, s.cells, `${s.ruleHolds} / ${s.ruleFails}`, `${s.declAsserted - s.declMismatch} / ${s.declAsserted}`, f(s.number), f(s.bigint), `${s.negativeControl.alwaysNumber} / ${s.negativeControl.alwaysBigint}`]); }
  return table(['binding', 'runtime', 'result sets checked', 'rule holds / fails', 'declared types as expected', 'default mode vs truth', 'lossless mode vs truth', 'negative controls that differ (always-number / always-bigint)'], rows);
})();
gen.intCases = (() => {
  if (!truth) return '_not generated_';
  const picks = [['2^53+1', 9], ['2^63-1', 14], ['-2^63', 15]];
  const rows = [];
  for (const c of truth.cases) {
    const per = BINDINGS.map((b) => ints[tagOf(b, REF[b])]?.cases.find((x) => x.id === c.id));
    const decls = per.map((x) => (x?.decl ? JSON.stringify(x.decl) : 'n/a'));
    const agree = new Set(decls.filter((x) => x !== 'n/a')).size <= 1;
    const cells = picks.map(([lab, k]) => {
      if (c.group === 'mixed-storage') return null;
      const idx = c.paramSets.length === truth.values.length ? k : null; if (idx == null) return null;
      const t = c.rows[idx]; if (!Array.isArray(t)) return 'SQLite: ' + t.sqliteError;
      return t.map((r) => r.map((x, i) => (x.t === 'integer' ? ruleOf(x.v, per[0]?.decl?.[i]) : x.t + ' ' + x.v)).join('; ')).join(' | ');
    });
    if (c.group === 'mixed-storage') { const decl = per[0]?.decl?.[0]; const t = c.rows.map((r) => r[0][0]); rows.push([c.id, c.group, agree ? decls[0] : 'DISAGREE ' + decls.join(' / '), 'rule per stored cell: ' + esc(t.map((x) => (x.t === 'integer' ? ruleOf(x.v, decl) : x.t + ' ' + x.v)).join(', ')), '', '']); continue; }
    if (cells.every((x) => x == null)) { const decl = per[0]?.decl; const t = c.rows.map((r, i) => (Array.isArray(r) ? r.map((row) => row.map((x, j) => (x.t === 'integer' ? ruleOf(x.v, decl?.[j]) : x.t + ' ' + x.v)).join('; ')).join(' | ') : 'SQLite: ' + r.sqliteError)); rows.push([c.id, c.group, agree ? decls[0] : 'DISAGREE ' + decls.join(' / '), esc(t.join(' || ')), '', '']); continue; }
    rows.push([c.id, c.group, agree ? decls[0] : 'DISAGREE ' + decls.join(' / '), ...cells.map((x) => esc(x ?? ''))]);
  }
  return table(['case', 'group', 'declared type as reported (all three bindings agree unless stated)', 'rule: 2^53+1', 'rule: 2^63-1', 'rule: -2^63'], rows);
})();
gen.bind = (() => {
  const first = ints[tagOf('better-sqlite3', 'node24')]; if (!first) return '_not generated_';
  const rows = [];
  const keys = first.bind.filter((x) => x.mode === 'number').map((x) => `${x.kind} ${x.value}`);
  const cell = (x) => { if (!x) return 'n/a'; if (x.error) return 'throws ' + (x.error.name ?? '') + (x.error.code ? ' ' + x.error.code : ''); return `${x.sqlType}${x.kind === 'bigint' ? (x.textEqualsInput ? '' : `, stored as ${x.sqlText} (WRAPPED)`) : ''}`; };
  keys.forEach((k, i) => rows.push([k, ...BINDINGS.flatMap((b) => ['number', 'bigint'].map((m) => cell(ints[tagOf(b, REF[b])]?.bind.filter((x) => x.mode === m)[i])))]));
  return table(['bound value', ...BINDINGS.flatMap((b) => [`${b}, default mode`, `${b}, lossless mode`])], rows);
})();

// ---------- 7. overhead ----------
const ov = {}; for (const b of BINDINGS) for (const r of RUNTIMES) { const j = rd(`overhead/${tagOf(b, r)}.json`); if (j) ov[tagOf(b, r)] = j; }
gen.overhead = (() => {
  const rows = [];
  for (const [t, j] of Object.entries(ov)) for (const bn of j.benches) {
    const us = bn.name.startsWith('point') || bn.name.startsWith('insert');
    const f = (s) => (us ? `${(s.median * 1000).toFixed(2)} us (${(s.min * 1000).toFixed(2)}-${(s.max * 1000).toFixed(2)})` : `${s.median.toFixed(3)} ms (${s.min.toFixed(3)}-${s.max.toFixed(3)})`);
    const v = (k) => (bn.comparison[k] ? `${bn.comparison[k].verdict} (median x${bn.comparison[k].ratio.toFixed(2)})` : 'n/a');
    rows.push([`${j.binding} / ${j.runtime.id}`, bn.name, f(bn.results.raw), f(bn.results.adapter), v('adapter'), bn.results.rule ? f(bn.results.rule) : 'n/a', bn.results.rule ? v('rule') : 'n/a']);
  }
  return table(['binding / runtime', 'benchmark (median, min-max of 21 runs)', 'raw binding', 'thin adapter', 'adapter vs raw', 'adapter + integer rule', 'rule vs raw'], rows);
})();

// ---------- 8. worker ----------
const wk = {}; for (const b of BINDINGS) for (const r of RUNTIMES) { const j = rd(`worker/${tagOf(b, r)}.json`); if (j) wk[tagOf(b, r)] = j; }
const P = (s) => `${s.latencyMs.median.toFixed(s.latencyMs.median < 10 ? 3 : 1)} (${s.latencyMs.min.toFixed(s.latencyMs.min < 10 ? 3 : 1)}-${s.latencyMs.max.toFixed(s.latencyMs.max < 10 ? 3 : 1)})`;
const Bk = (s) => s.longestBlockMs.median.toFixed(s.longestBlockMs.median < 10 ? 2 : 1);
function threshold(cells, key, path) { // smallest cell from which BOTH wins hold in it and every larger cell
  let at = null; for (let i = cells.length - 1; i >= 0; i--) { if (cells[i].judge[path]?.verdict === 'both') at = cells[i]; else break; }
  const blockingFrom = (() => { let x = null; for (let i = cells.length - 1; i >= 0; i--) { if (['both', 'blocking-only'].includes(cells[i].judge[path]?.verdict)) x = cells[i]; else break; } return x; })();
  return { both: at ? at[key] : null, blocking: blockingFrom ? blockingFrom[key] : null };
}
const sizeTables = (onlyFull) => {
  const out = [];
  for (const [t, j] of Object.entries(wk)) {
    if (onlyFull && j.quick) continue;
    const rows = j.size.map((c) => [c.shape, c.rows, `${P(c.paths.inthread)} / ${Bk(c.paths.inthread)}`, ...['clone', 'packed-lazy', 'packed-decode'].map((p) => `${P(c.paths[p])} / ${Bk(c.paths[p])} (${c.judge[p].verdict})`)]);
    out.push(`**${j.binding} on ${j.runtime.id} ${j.runtime.version}** (${j.quick ? 'quick matrix' : 'full matrix'}; cells are latency ms median (min-max) / longest main-thread block ms median; verdict from the pre-registered criteria)\n\n` + table(['shape', 'result rows', 'in-thread', 'worker, clone', 'worker, packed (views only)', 'worker, packed (row objects rebuilt)'], rows));
  }
  return out.join('\n\n');
};
gen.workerSize = sizeTables(false); gen.workerSizeFull = sizeTables(true);
const timeTables = (onlyFull) => {
  const out = [];
  for (const [t, j] of Object.entries(wk)) {
    if (onlyFull && j.quick) continue;
    const rows = j.time.map((c) => [c.targetMs, `${j.calibration[c.targetMs].actualInThreadMedianMs}`, `${P(c.paths.inthread)} / ${Bk(c.paths.inthread)}`, `${P(c.paths.worker)} / ${Bk(c.paths.worker)}`, c.judge.worker.verdict]);
    out.push(`**${j.binding} on ${j.runtime.id}**\n\n` + table(['target query ms', 'measured in-thread ms', 'in-thread: latency / longest block', 'worker: latency / longest block', 'verdict'], rows));
  }
  return out.join('\n\n');
};
gen.workerTime = timeTables(false); gen.workerTimeFull = timeTables(true);
gen.workerThreshold = (() => {
  const rows = [];
  for (const [t, j] of Object.entries(wk)) {
    for (const shape of ['narrow', 'wide']) for (const p of ['clone', 'packed-lazy', 'packed-decode']) {
      const cells = j.size.filter((c) => c.shape === shape); const th = threshold(cells, 'rows', p);
      rows.push([`${j.binding} / ${j.runtime.id}`, `result size, ${shape} rows, ${p}`, th.both == null ? 'no threshold found' : `${th.both} rows`, th.blocking == null ? 'none' : `${th.blocking} rows`]);
    }
    const th = threshold(j.time, 'targetMs', 'worker');
    rows.push([`${j.binding} / ${j.runtime.id}`, 'query time (tiny result), clone', th.both == null ? 'no threshold found' : `${th.both} ms`, th.blocking == null ? 'none' : `${th.blocking} ms`]);
  }
  return table(['binding / runtime', 'sweep', 'threshold: worker wins latency AND blocking from here up', 'blocking-only win from here up (latency not won)'], rows);
})();
const tpTables = (onlyFull) => {
  const out = [];
  for (const [t, j] of Object.entries(wk)) {
    if (onlyFull && j.quick) continue;
    const rows = [];
    for (const w of j.throughput) {
      rows.push([w.workload, 'in-thread (1 request per event-loop turn)', `${w.inthread.reqPerSec.median.toFixed(0)} (${w.inthread.reqPerSec.min.toFixed(0)}-${w.inthread.reqPerSec.max.toFixed(0)})`, w.inthread.timerLagMs.p99.toFixed(2), w.inthread.timerLagMs.max.toFixed(1)]);
      for (const [mode, byR] of Object.entries(w.worker)) for (const [R, x] of Object.entries(byR)) rows.push([w.workload, `worker ${mode}, ${R} reader${R === '1' ? '' : 's'}`, `${x.reqPerSec.median.toFixed(0)} (${x.reqPerSec.min.toFixed(0)}-${x.reqPerSec.max.toFixed(0)})`, x.timerLagMs.p99.toFixed(2), x.timerLagMs.max.toFixed(1)]);
    }
    out.push(`**${j.binding} on ${j.runtime.id}** (${j.cpus} CPUs: ${j.cpuModel})\n\n` + table(['workload', 'path', 'requests/s median (min-max)', 'timer-lag p99 ms', 'timer-lag max ms'], rows));
  }
  return out.join('\n\n');
};
gen.workerThroughput = tpTables(false); gen.workerThroughputFull = tpTables(true);
gen.workerVisibility = (() => {
  const rows = []; for (const f of ls('worker-visibility')) { const j = rd('worker-visibility/' + f); rows.push([`${j.binding} / ${j.runtime.id}`, `${j.autocommitVisible.workerSawIt}/${j.autocommitVisible.writes}`, `${j.uncommittedInvisible.workerCountDuringTx} (expected ${j.uncommittedInvisible.expectedDuring}) then ${j.uncommittedInvisible.workerCountAfterCommit} (expected ${j.uncommittedInvisible.expectedAfter})`, `${j.writerDuringLongRead.fiftyAutocommitWritesMs} ms for 50 writes during a ${j.writerDuringLongRead.longReadMs} ms worker read; blocked: ${j.writerDuringLongRead.writerBlocked}`]); }
  return table(['binding / runtime', 'autocommit writes seen by worker', 'uncommitted tx seen? (worker count during tx, after commit)', 'writer vs long worker read'], rows);
})();

// ---------- 9. Durable Objects ----------
gen.durable = (() => {
  const j = rd('do/do-sqlite.json'); if (!j) return '_not generated: workerd run missing_';
  const rows = []; for (const [k, v] of Object.entries(j)) rows.push([k, v.status, esc(JSON.stringify(v.detail ?? v.threw)).slice(0, 700)]);
  return table(['probe', 'status', 'observed (truncated; full JSON in results/do/do-sqlite.json)'], rows);
})();

// ---------- output ----------
const header = '<!-- generated by scripts/render.mjs from results/**/*.json; do not edit by hand -->\n';
fs.writeFileSync(path.join(RESULTS, 'tables.md'), header + Object.entries(gen).map(([k, v]) => `## ${k}\n\n${v}\n`).join('\n'));
const readme = path.join(ROOT, 'README.md');
if (fs.existsSync(readme)) {
  let s = fs.readFileSync(readme, 'utf8'); let n = 0;
  for (const [k, v] of Object.entries(gen)) { const re = new RegExp(`(<!-- GEN:${k} -->)[\\s\\S]*?(<!-- /GEN:${k} -->)`); if (re.test(s)) { s = s.replace(re, (_, a, b) => `${a}\n${v}\n${b}`); n++; } }
  fs.writeFileSync(readme, s); console.log('README blocks replaced:', n);
}
console.log('wrote results/tables.md,', Object.keys(gen).length, 'tables');
