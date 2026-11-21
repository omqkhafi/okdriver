// Behavioural differences beyond the bytes: types (text and binary decode checked against the server's own
// formatting), failing statements (error numbers), session tracking, transaction flags, RETURNING, JSON,
// COM_RESET_CONNECTION effects, prepared-statement limits, long data, cursors, LOCAL INFILE.
import { save, pick, root, tryErr, PW, sleep, type Server } from './lib.ts';
import { connect } from '../wire/connect.ts';
import { CAP, COM, STATUS, TYPE } from '../wire/shared/constants.ts';
import { encodeExecute, type Connection } from '../wire/shared/connection.ts';
import { Writer } from '../wire/shared/bytes.ts';
import type { Column, Rows, Value } from '../wire/shared/result.ts';

const norm = (v: Value | undefined): string => (v === undefined ? 'undefined' : v === null ? 'NULL' : Buffer.isBuffer(v) ? 'hex:' + v.toString('hex') : String(v));
const typeName = Object.fromEntries(Object.entries(TYPE).map(([k, v]) => [v, k]));

const REQUIRED: [string, string, string][] = [
  ['c_tiny', 'tinyint', '-128'], ['c_tinyu', 'tinyint unsigned', '255'], ['c_t1', 'tinyint(1)', '1'], ['c_small', 'smallint', '-32768'],
  ['c_med', 'mediumint', '-8388608'], ['c_int', 'int', '-2147483648'], ['c_big', 'bigint', '-9223372036854775808'], ['c_bigu', 'bigint unsigned', '18446744073709551615'],
  ['c_dec', 'decimal(20,6)', "'12345678901234.123456'"], ['c_f', 'float', '1.5'], ['c_d', 'double', '3.141592653589793'],
  ['c_vc', 'varchar(40) character set utf8mb4', "'héllo wörld €'"], ['c_vb', 'varbinary(20)', '0x00ff10'], ['c_txt', 'text character set utf8mb4', "'text'"], ['c_blob', 'blob', '0x010203'],
  ['c_bit', 'bit(10)', "b'1010101010'"], ['c_year', 'year', '2155'], ['c_date', 'date', "'9999-12-31'"], ['c_dt6', 'datetime(6)', "'9999-12-31 23:59:59.999999'"],
  ['c_ts6', 'timestamp(6) null', "'2038-01-19 03:14:07.999999'"], ['c_time6', 'time(6)', "'838:59:58.123456'"], ['c_json', 'json', `'{"b": 1, "a": [1, 2, {"c": null}]}'`],
  ['c_enum', "enum('a','b')", "'b'"], ['c_set', "set('x','y')", "'x,y'"], ['c_geom', 'geometry', "ST_GeomFromText('POINT(1 2)')"],
];
const OPTIONAL = (fam: string): [string, string, string][] => [
  ['c_uuid', 'uuid', "'123e4567-e89b-12d3-a456-426614174000'"], ['c_inet4', 'inet4', "'192.168.0.1'"], ['c_inet6', 'inet6', "'::ffff:192.168.0.1'"],
  ['c_vec', 'vector(3)', fam === 'mysql' ? "STRING_TO_VECTOR('[1,2,3]')" : "VEC_FromText('[1,2,3]')"],
];
const BINARYISH = new Set(['c_vb', 'c_blob', 'c_bit', 'c_geom', 'c_vec']);

async function types(s: Server, a: Connection) {
  await a.queryAll('drop table if exists fs07.ty');
  await a.query(`create table fs07.ty (id int auto_increment primary key, ${REQUIRED.map(([n, t]) => `${n} ${t}`).join(', ')})`);
  const cols = [...REQUIRED];
  const optional: Record<string, string> = {};
  for (const [n, t, e] of OPTIONAL(s.family)) {
    const r = await tryErr(() => a.query(`alter table fs07.ty add column ${n} ${t}`));
    optional[n] = r.ok ? 'supported' : r.error.slice(0, 90);
    if (r.ok) cols.push([n, t, e]);
  }
  const ins = await tryErr(() => a.query(`insert into fs07.ty (${cols.map((c) => c[0]).join(',')}) values (${cols.map((c) => c[2]).join(',')})`));
  await a.query('insert into fs07.ty () values ()');
  await a.queryAll("set session sql_mode=''");
  const zero = await tryErr(() => a.query("insert into fs07.ty (c_date, c_dt6) values ('0000-00-00', '0000-00-00 00:00:00')"));
  await a.queryAll('set session sql_mode=default');
  const sel = 'select * from fs07.ty order by id';
  const text = (await a.query(sel)) as Rows;
  const st = await a.prepare(sel);
  const bin = (await st.execute([])) as Rows;
  const names = cols.map((c) => c[0]);
  const serverStr: Record<string, string> = {};
  const srv = (await a.query(`select ${names.map((n) => (BINARYISH.has(n) ? `hex(${n})` : `cast(${n} as char)`)).join(', ')} from fs07.ty where id = 1`)) as Rows;
  names.forEach((n, i) => (serverStr[n] = String(srv.rows[0]![i])));
  const out: any[] = [];
  text.columns.forEach((col: Column, i: number) => {
    if (col.name === 'id') return;
    const t = text.rows[0]![i]!, b = bin.rows[0]![i]!;
    const ss = serverStr[col.name]!;
    const dec = (v: Value) => (Buffer.isBuffer(v) ? v.toString('hex').replace(/^0+/, '') : null);
    let agreeServer: boolean;
    if (BINARYISH.has(col.name)) agreeServer = (dec(t) ?? '').toLowerCase() === ss.toLowerCase().replace(/^0+/, '');
    else if (typeof t === 'number') agreeServer = Number(ss) === t;
    else agreeServer = norm(t) === ss;
    out.push({ column: col.name, wireType: `${col.type} ${typeName[col.type] ?? '?'}`, charset: col.charset, flags: col.flags, decimals: col.decimals, length: col.length, extra: col.extra ?? null,
      jsType: typeof t === 'bigint' ? 'bigint' : Buffer.isBuffer(t) ? 'Buffer' : typeof t, text: norm(t), binary: norm(b), textEqualsBinary: norm(t) === norm(b), agreesWithServerFormatting: agreeServer, serverSays: ss });
  });
  const lastRow = (r: Rows) => r.rows[r.rows.length - 1]!;
  const zr = { text: [lastRow(text)[names.indexOf('c_date') + 1], lastRow(text)[names.indexOf('c_dt6') + 1]].map(norm), binary: [lastRow(bin)[names.indexOf('c_date') + 1], lastRow(bin)[names.indexOf('c_dt6') + 1]].map(norm) };
  const lit = (await a.query("select 1, 1.5, 'a', 1e0, null, true, now(), current_date, uuid(), @@version_comment, 1 + 1, -1, 2147483648, 4294967296")) as Rows;
  const lit2 = (await a.query('select 1 as a, 18446744073709551616 as b, 1 = 1 as c, count(*) as d, sum(1) as e, avg(1) as f, 10 div 3 as g, 7 / 2 as h, abs(-1) as i, length("x") as j, "x" as k, concat("a","b") as l, json_object("a", 1) as m from (select 1) t')) as Rows;
  return { optionalTypes: optional, insertAllOk: ins.ok ? true : ins.error, zeroDate: { insert: zero.ok ? 'ok (sql_mode empty)' : zero.error, decoded: zr },
    columns: out, literalAndExpressionTypes: lit2.columns.map((c, i) => `${c.name}:${typeName[c.type] ?? c.type}/cs${c.charset}/flags${c.flags}`), literalValues: lit.columns.map((c) => `${typeName[c.type] ?? c.type}`) };
}

const FAILS: [string, string][] = [
  ['E01 syntax error', 'selec 1'], ['E02 unknown table', 'select * from fs07.nope'], ['E03 unknown column', 'select nope from fs07.pk'],
  ['E04 duplicate key', "insert into fs07.pk (id, run) values (1, 'a'), (1, 'b')"], ['E05 NOT NULL violation', 'insert into fs07.nn (a) values (null)'],
  ['E06 value too long', "insert into fs07.nn (a, b) values (1, 'toolong')"], ['E07 division by zero (strict insert)', 'insert into fs07.nn (a) values (1/0)'],
  ['E08 out of range', 'insert into fs07.nn (a, c) values (1, 300)'], ['E09 invalid JSON value', "insert into fs07.js (j) values ('{bad')"],
  ['E10 foreign key violation', 'insert into fs07.child (pid) values (999)'], ['E11 CHECK constraint violation', 'insert into fs07.nn (a, d) values (1, -1)'],
  ['E12 unknown database', 'use fs07_nope'], ['E13 unknown variable', 'set @@no_such_variable = 1'], ['E14 bad sql_mode value', "set sql_mode = 'nonsense'"],
  ['E15 table exists', 'create table fs07.pk (a int)'], ['E16 cannot drop (unknown)', 'drop table fs07.nope'], ['E17 subquery returns more than 1 row', 'select (select id from fs07.pk union all select 2 union all select 3)'],
  ['E18 invalid cast / bad argument', "select json_extract('{bad', '$')"], ['E19 RETURNING on INSERT', "insert into fs07.pk (id, run) values (7001, 'r') returning id"],
  ['E20 create sequence', 'create sequence fs07.sq'],
];

async function failures(s: Server, a: Connection) {
  for (const t of ['pk', 'nn', 'js', 'child', 'parent']) await a.queryAll(`drop table if exists fs07.${t}`);
  await a.query('create table fs07.parent (id int primary key) engine=innodb');
  await a.query('create table fs07.child (id int auto_increment primary key, pid int, foreign key (pid) references fs07.parent (id)) engine=innodb');
  await a.query('create table fs07.pk (id int primary key, run varchar(40))');
  await a.query('create table fs07.nn (a int not null, b varchar(3), c tinyint unsigned, d int, check (d is null or d >= 0))');
  await a.query('create table fs07.js (j json)').catch(() => {});
  await a.queryAll('drop table if exists fs07.sq');
  const out: Record<string, any> = {};
  for (const [name, sql] of FAILS) {
    const r = (await a.queryAll(sql)).find((x) => x.kind === 'err') ?? { kind: 'no error' };
    out[name] = r.kind === 'err' ? { errno: r.errno, sqlState: r.sqlState, message: r.message.slice(0, 110) } : 'NO ERROR (statement succeeded)';
  }
  // protocol-level failures
  const pc = await connect({ host: '127.0.0.1', port: s.port, user: 'root', password: PW });
  await pc.send(Buffer.from([0x99]), 'ok'); const u = (await pc.receive())[0]!;
  out['E21 unknown command byte 0x99'] = u.kind === 'err' ? { errno: u.errno, sqlState: u.sqlState, message: u.message.slice(0, 80) } : 'no error';
  await pc.send(encodeExecute(0x1234, []), 'execute'); const u2 = (await pc.receive())[0]!;
  out['E22 execute unknown statement id'] = u2.kind === 'err' ? { errno: u2.errno, sqlState: u2.sqlState, message: u2.message.slice(0, 80) } : 'no error';
  await pc.close();
  const bad = await tryErr(() => connect({ host: '127.0.0.1', port: s.port, user: 'root', password: 'wrong' }));
  out['E23 access denied'] = bad.ok ? 'accepted' : { errno: bad.errno, sqlState: bad.sqlState, message: bad.error.replace(/@'[^']*'/, "@'<ADDR>'").slice(0, 100) };
  // lock wait timeout and deadlock between two connections
  await a.query("insert into fs07.pk values (900, 'x'), (901, 'y')");
  const c1 = await root(s), c2 = await root(s);
  await c1.query('set session innodb_lock_wait_timeout = 1'); await c2.query('set session innodb_lock_wait_timeout = 1');
  await c1.query('begin'); await c1.query('update fs07.pk set run = "a" where id = 900');
  await c2.query('begin');
  const lw = (await c2.queryAll('update fs07.pk set run = "b" where id = 900')).find((x) => x.kind === 'err') as any;
  out['E24 lock wait timeout'] = lw ? { errno: lw.errno, sqlState: lw.sqlState, message: lw.message.slice(0, 80) } : 'no error';
  await c1.query('rollback'); await c2.query('rollback');
  await c1.query('set session innodb_lock_wait_timeout = 10'); await c2.query('set session innodb_lock_wait_timeout = 10');
  await c1.query('begin'); await c2.query('begin');
  await c1.query('update fs07.pk set run = "a" where id = 900'); await c2.query('update fs07.pk set run = "b" where id = 901');
  const p1 = c1.queryAll('update fs07.pk set run = "a" where id = 901');
  await sleep(300);
  const p2 = await c2.queryAll('update fs07.pk set run = "b" where id = 900');
  const r1 = await p1;
  const dl = [...r1, ...p2].find((x) => x.kind === 'err') as any;
  out['E25 deadlock'] = dl ? { errno: dl.errno, sqlState: dl.sqlState, message: dl.message.slice(0, 80) } : 'no error';
  await c1.query('rollback').catch(() => {}); await c2.query('rollback').catch(() => {});
  await c1.close(); await c2.close();
  return out;
}

const OKSUM = (r: any) => (r.kind === 'ok' ? { status: '0x' + r.status.toString(16), flags: Object.entries(STATUS).filter(([, v]) => r.status & v).map(([k]) => k), info: r.info, warnings: r.warnings, session: r.sessionState.map((e: any) => `${e.type}:${e.data.toString('latin1').replace(/[^\x20-\x7e]/g, '·')}`) } : r.kind);

async function misc(s: Server, a: Connection) {
  const out: any = {};
  // B1 multi-statements
  const c0 = await root(s);
  out.B1_multiStatementDefaultOff = (await c0.queryAll('select 1; select 2')).map((r) => (r.kind === 'err' ? `ERR ${r.errno}` : r.kind));
  await c0.close();
  const cm = await root(s, { multiStatements: true });
  out.B1_multiStatementOn = (await cm.queryAll('select 1; select 2; do 3')).map((r) => (r.kind === 'rows' ? `rows(${r.rows[0]![0]})` : r.kind === 'ok' ? 'ok' : 'ERR'));
  // B2 multi-results from a stored procedure, with and without the capability
  await cm.queryAll('drop procedure if exists fs07.p2');
  await cm.query('create procedure fs07.p2() begin select 1 as a; select 2 as b; end');
  out.B2_callWithMultiResults = (await cm.queryAll('call fs07.p2()')).map((r) => (r.kind === 'rows' ? `rows(${r.rows[0]![0]})` : r.kind === 'ok' ? 'ok' : `ERR ${(r as any).errno}`));
  await cm.close();
  const cn = await root(s, { removeCaps: CAP.MULTI_RESULTS | CAP.PS_MULTI_RESULTS });
  out.B2_callWithoutMultiResults = (await cn.queryAll('call fs07.p2()')).map((r) => (r.kind === 'rows' ? `rows(${r.rows[0]![0]})` : r.kind === 'ok' ? 'ok' : `ERR ${(r as any).errno}: ${(r as any).message.slice(0, 60)}`));
  await cn.close();
  // B3 session tracking, B4 transaction status, B5 savepoint / isolation variable
  const c = await root(s);
  const track: any[] = [];
  track.push(['default session_track vars', (await c.rows("show variables like 'session_track%'")).map((r) => `${r[0]}=${r[1]}`)]);
  await c.query("set session session_track_system_variables = '*'").catch(() => {});
  for (const sql of ['set @@session.sql_mode = ""', 'set autocommit = 0', 'set names utf8mb4 collate utf8mb4_bin', 'use fs07', 'set time_zone = "+02:00"']) track.push([sql, OKSUM(await c.query(sql))]);
  out.B3_sessionTrackingOnOk = track;
  const tx: any[] = [];
  for (const sql of ['set autocommit = 1', 'begin', 'insert into fs07.pk values (801, "t")', 'create table fs07.implicit_ddl (a int)', 'insert into fs07.pk values (802, "t")', 'savepoint sp1', 'rollback to savepoint sp1', 'commit', 'start transaction read only', 'rollback', 'drop table fs07.implicit_ddl', 'delete from fs07.pk where id in (801, 802)']) {
    const r = await tryErr(() => c.query(sql)); tx.push([sql, r.ok ? OKSUM(r.v) : r.error.slice(0, 70)]);
  }
  out.B4_transactionStatusFlags = tx;
  const iso: any = {};
  for (const v of ['transaction_isolation', 'tx_isolation']) { const r = await tryErr(() => c.rows(`select @@${v}`)); iso[v] = r.ok ? String(r.v[0]![0]) : 'unknown variable'; }
  out.B5_isolationVariable = iso;
  await c.close();
  // B6 RETURNING
  const rt: any = {};
  await a.queryAll('drop table if exists fs07.rt'); await a.query('create table fs07.rt (id int auto_increment primary key, v int)');
  for (const [k, sql] of [['insert', 'insert into fs07.rt (v) values (1) returning id, v'], ['replace', 'replace into fs07.rt (id, v) values (1, 2) returning id, v'], ['update', 'update fs07.rt set v = 3 where id = 1 returning id, v'], ['delete', 'delete from fs07.rt where id = 1 returning id, v']] as const) {
    const r = await a.queryAll(sql); const x = r[0]!; rt[k] = x.kind === 'rows' ? `rows ${JSON.stringify(x.rows.map((rw) => rw.map(norm)))}` : x.kind === 'err' ? `ERR ${x.errno}: ${x.message.slice(0, 50)}` : x.kind;
  }
  out.B6_returning = rt;
  // B7 JSON
  const js: any = {};
  await a.queryAll('drop table if exists fs07.jt'); await a.query('create table fs07.jt (j json)');
  await a.query(`insert into fs07.jt values ('{"b":   1, "a": 2}')`);
  js.storedBack = norm((await a.rows('select j from fs07.jt'))[0]![0]);
  js.showCreateTable = String((await a.rows('show create table fs07.jt'))[0]![1]).replace(/\s+/g, ' ');
  js.informationSchemaDataType = (await a.rows("select data_type, column_type from information_schema.columns where table_schema='fs07' and table_name='jt'"))[0]!.map(norm);
  const cj = await tryErr(() => a.query("select cast('1' as json) as z"));
  js.castAsJson = cj.ok ? 'supported' : cj.error.slice(0, 80);
  const jo = (await a.query("select json_object('a', 1) as j, json_array(1) as k")) as Rows;
  js.jsonFunctionResultColumns = jo.columns.map((c) => `${c.name}: ${typeName[c.type] ?? c.type}/cs${c.charset}/flags${c.flags}/${JSON.stringify(c.extra ?? null)}`);
  out.B7_json = js;
  return out;
}

async function lifecycle(s: Server, a: Connection) {
  const out: any = {};
  // B9 COM_RESET_CONNECTION effects
  const c = await root(s);
  await c.query('use fs07'); await c.query('set @x = 1'); await c.query('create temporary table tmp_r (a int)');
  await c.query('set session sql_mode = ""'); await c.query('set autocommit = 0'); await c.query('set names latin1');
  const st = await c.prepare('select 1');
  const before = (await c.rows('select database(), @x, @@sql_mode, @@autocommit, @@character_set_client, @@collation_connection'))[0]!.map(norm);
  const ok = await c.resetConnection();
  const after = (await c.rows('select database(), @x, @@sql_mode, @@autocommit, @@character_set_client, @@collation_connection'))[0]!.map(norm);
  const tmp = await tryErr(() => c.query('select * from tmp_r'));
  const ex = (await st.executeAll([])).map((r) => (r.kind === 'err' ? `ERR ${r.errno}` : r.kind));
  out.B9_resetConnection = { before, after, columns: 'database, @x, sql_mode, autocommit, character_set_client, collation_connection', temporaryTableAfter: tmp.ok ? 'still there' : tmp.error.slice(0, 60), preparedStatementAfter: ex, okStatusFlags: OKSUM(ok) };
  await c.close();
  // B10 max_prepared_stmt_count
  await a.query('set global max_prepared_stmt_count = 3');
  const p1 = await root(s), p2 = await root(s);
  const res: string[] = [];
  for (const [i, conn] of [p1, p1, p2, p2].entries()) { const r = await tryErr(() => conn.prepare('select ' + i)); res.push(r.ok ? 'ok' : `ERR ${r.errno}`); }
  out.B10_maxPreparedStmtCount_3_prepareResultsAcrossTwoConnections = res;
  await p1.close(); await p2.close();
  await sleep(200);
  await a.query('set global max_prepared_stmt_count = 16382');
  out.B10_countAfterClosingConnections = (await a.rows("show global status like 'prepared_stmt_count'"))[0]!.map(norm);
  // B11 SEND_LONG_DATA
  await a.queryAll('drop table if exists fs07.lb'); await a.query('create table fs07.lb (id int auto_increment primary key, b longblob)');
  const l = await root(s, { database: 'fs07' });
  const ls = await l.prepare('insert into fs07.lb (b) values (?)');
  await ls.sendLongData(0, Buffer.alloc(100000, 1)); await ls.sendLongData(0, Buffer.alloc(100000, 2));
  const exec = new Writer().u8(COM.STMT_EXECUTE).u32(ls.id).u8(0).u32(1).bytes(Buffer.from([0])).u8(1).u8(252).u8(0).toBuffer();
  await l.send(exec, 'execute', ls);
  const lr = (await l.receive())[0]!;
  out.B11_sendLongData = { response: lr.kind === 'ok' ? `ok affected ${lr.affectedRows}` : lr.kind === 'err' ? `ERR ${lr.errno} ${lr.message.slice(0, 60)}` : lr.kind, storedBytes: norm((await a.rows('select length(b) from fs07.lb'))[0]![0]) };
  await l.close();
  // B12 cursor / COM_STMT_FETCH
  const k = await root(s, { database: 'fs07' });
  await k.queryAll('drop table if exists fs07.cur'); await k.query('create table fs07.cur (id int primary key)');
  await k.query('insert into fs07.cur values (1),(2),(3),(4),(5),(6),(7),(8),(9),(10)');
  const cs = await k.prepare('select id from fs07.cur order by id');
  const opened = await cs.openCursor([]);
  const fetched: string[] = [];
  for (let i = 0; i < 3; i++) { const r = (await cs.fetch(4))[0]!; fetched.push(r.kind === 'rows' ? `${r.rows.length} rows [${r.rows.map((x) => x[0]).join(',')}] status=${OKSUM({ kind: 'ok', status: r.status, info: '', warnings: 0, sessionState: [] }).flags.join('|')}` : r.kind === 'err' ? `ERR ${r.errno} ${r.message.slice(0, 50)}` : r.kind); }
  // can another command run while the cursor is open?
  await cs.reset().catch(() => {});
  const cs2 = await k.prepare('select id from fs07.cur order by id');
  await cs2.openCursor([]);
  const f1 = (await cs2.fetch(3))[0]!;
  const between = await tryErr(async () => (await k.query('select 99')) as Rows);
  const f2 = (await cs2.fetch(3))[0]!;
  out.B12b_commandBetweenFetches = { firstFetch: f1.kind === 'rows' ? f1.rows.map((x) => x[0]) : f1.kind, selectInBetween: between.ok ? String(between.v.rows[0]![0]) : between.error.slice(0, 80), secondFetch: f2.kind === 'rows' ? f2.rows.map((x) => x[0]) : f2.kind === 'err' ? `ERR ${f2.errno}: ${f2.message.slice(0, 60)}` : f2.kind };
  out.B12_cursor = { openedRowsReturnedByExecute: opened.kind === 'rows' ? opened.rows.length : opened.kind, openedStatusFlags: opened.kind === 'rows' ? OKSUM({ kind: 'ok', status: opened.status, info: '', warnings: 0, sessionState: [] }).flags : null, fetches: fetched };
  await k.close();
  // B13 LOAD DATA LOCAL INFILE
  const lo: any = { serverVariable_local_infile: (await a.rows("show variables like 'local_infile'"))[0]![1] };
  const d = await root(s, { database: 'fs07' });
  lo.clientWithoutLocalFilesCapability = (await d.queryAll("load data local infile '/etc/hostname' into table fs07.lb (b)")).map((r) => (r.kind === 'err' ? `ERR ${r.errno}: ${r.message.slice(0, 80)}` : r.kind));
  await d.close();
  const d2 = await tryErr(async () => { const x = await root(s, { database: 'fs07', addCaps: CAP.LOCAL_FILES }); const r = await x.queryAll("load data local infile '/etc/hostname' into table fs07.lb (b)").catch((e) => [{ kind: 'err', errno: -1, message: String(e.message) } as any]); x.destroy(); return r.map((q: any) => (q.kind === 'err' ? `ERR ${q.errno}: ${q.message.slice(0, 90)}` : q.kind)); });
  lo.clientWithLocalFilesCapability = d2.ok ? d2.v : d2.error;
  out.B13_loadDataLocalInfile = lo;
  // B14 failover and replication signals (read_only, group replication, GTID format, redirection variable, target_session_attrs)
  const fo: any = {};
  for (const v of ['read_only', 'super_read_only', 'innodb_read_only', 'gtid_mode', 'gtid_current_pos', 'gtid_executed', 'gtid_domain_id', 'server_id', 'redirect_url', 'wsrep_on']) {
    const r = await tryErr(() => a.rows(`select @@global.${v}`)); fo[v] = r.ok ? norm(r.v[0]![0]) : 'unknown variable';
  }
  fo.groupReplicationMembersTable = (await tryErr(() => a.rows('select count(*) from performance_schema.replication_group_members'))).ok ? 'exists' : 'absent';
  fo.targetSessionAttrsLikeVariables = (await a.rows("show variables like '%session_attrs%'")).length;
  fo.relevantPlugins = (await a.rows("select plugin_name, plugin_status from information_schema.plugins where plugin_name in ('group_replication','wsrep','rpl_semi_sync_master','rpl_semi_sync_source')")).map((r) => r.map(norm).join(':'));
  out.B14_failoverAndReplicationSignals = fo;
  return out;
}

for (const s of pick()) {
  const a = await root(s);
  await a.query('create database if not exists fs07');
  await a.queryAll('use fs07');
  const res: any = { server: s.id, version: a.greeting.serverVersion };
  for (const [k, f] of [['types', types], ['failures', failures], ['misc', misc], ['lifecycle', lifecycle]] as const) {
    const r = await tryErr(() => f(s, a));
    res[k] = r.ok ? r.v : { ERROR: r.error };
  }
  await a.close();
  save(`behaviour/${s.id}.json`, res);
  console.log(s.id, Object.entries(res).filter(([, v]: any) => v?.ERROR).map(([k, v]: any) => `${k}: ${v.ERROR}`).join(' | ') || 'ok');
}
