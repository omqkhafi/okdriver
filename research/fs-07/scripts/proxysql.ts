// Second tier: ProxySQL in front of one MySQL (8.4) and one MariaDB (13.0). Prepared statements, pipelined executes,
// the MariaDB placeholder id and bulk execute, and what ProxySQL itself reports (stats tables).
import { save, sleep, PW, root, SERVERS, tryErr } from './lib.ts';
import { connect } from '../wire/connect.ts';
import { COM } from '../wire/shared/constants.ts';
import { encodeExecute, type Connection } from '../wire/shared/connection.ts';
import { encodeBulkBigint, encodeExecuteLastPrepared } from '../wire/mariadb/bulk.ts';

const TAG = process.env.PROXYSQL_TAG ?? '3.0.12';
const my = SERVERS.find((s) => s.id === 'my84')!, ma = SERVERS.find((s) => s.id === 'ma130')!;
async function sh(args: string[]) { const p = Bun.spawn(args, { stdout: 'pipe', stderr: 'pipe' }); const [o, e] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]); await p.exited; return (o + e).trim(); }
const q = (sql: string) => Buffer.concat([Buffer.from([COM.QUERY]), Buffer.from(sql)]);
const kind = (r: any) => (r.kind === 'err' ? `ERR${r.errno}` : r.kind === 'ok' ? 'OK' : r.kind === 'rows' ? `ROWS${r.rows.length}` : 'PREPARE');

await sh(['docker', 'rm', '-f', 'fs07-proxysql']);
const started = await sh(['docker', 'run', '-d', '--name', 'fs07-proxysql', '--network', 'host', `proxysql/proxysql:${TAG}`]);
console.log('proxysql container', started.slice(0, 12));
let admin: Connection | null = null;
for (let i = 0; i < 60 && !admin; i++) { try { admin = await connect({ host: '127.0.0.1', port: 6032, user: 'admin', password: 'admin' }); } catch { await sleep(1000); } }
if (!admin) throw new Error('ProxySQL admin interface did not come up');
const _qa = admin.queryAll.bind(admin); admin.queryAll = async (sql: string) => { if (process.env.DEBUG_SQL) console.error('SQL>', sql.slice(0, 90)); return _qa(sql); };
const out: any = { image: `proxysql/proxysql:${TAG}`, imageDigest: (await sh(['docker', 'image', 'inspect', `proxysql/proxysql:${TAG}`, '--format', '{{index .RepoDigests 0}}'])) };
out.version = (await admin.rows("select variable_value from global_variables where variable_name='mysql-server_version'"))[0]?.[0];
// backends: a user that exists on both servers with a password the proxy can present
for (const s of [my, ma]) { const a = await root(s); await a.queryAll("drop user if exists 'u_px'@'%'"); await a.query("create user 'u_px'@'%' identified by 'pw-proxy'"); await a.query("grant all on *.* to 'u_px'@'%'"); await a.query('create database if not exists fs07'); await a.queryAll('create table if not exists fs07.bk (a bigint primary key)'); await a.queryAll('create table if not exists fs07.seqlog (id int auto_increment primary key, run varchar(40), i int)'); await a.close(); }
for (const sql of ['delete from mysql_servers', `insert into mysql_servers (hostgroup_id, hostname, port, max_connections) values (10, '127.0.0.1', ${my.port}, 50), (20, '127.0.0.1', ${ma.port}, 50)`,
  'delete from mysql_users', "insert into mysql_users (username, password, default_hostgroup) values ('u_px', 'pw-proxy', 10)",
  "update mysql_users set default_hostgroup = 10 where username = 'u_px'", 'load mysql servers to runtime', 'load mysql users to runtime']) { try { await admin.query(sql); } catch (e) { console.error('admin statement failed:', sql, String(e).slice(0, 200)); throw e; } }
// a second frontend user routed to the MariaDB hostgroup, same backend account
await admin.query("insert into mysql_users (username, password, default_hostgroup, frontend, backend) values ('u_px', 'pw-proxy', 20, 1, 1)").catch(() => {});

async function viaProxy(hg: 10 | 20, name: string) {
  const res: any = { backend: hg === 10 ? my.id : ma.id };
  await admin!.query(`update mysql_users set default_hostgroup = ${hg} where username = 'u_px'`); await admin!.query('load mysql users to runtime');
  const run = `px-${name}-${Date.now() % 100000}`;
  // each section on its own frontend connection: a section that desynchronises the connection must not hide the others
  const section = async (label: string, fn: (k: Connection) => Promise<unknown>) => {
    const c = await tryErr(() => connect({ host: '127.0.0.1', port: 6033, user: 'u_px', password: 'pw-proxy', database: 'fs07' }));
    if (!c.ok) { res[label] = 'connect failed: ' + c.error.slice(0, 100); return; }
    c.v.strictSeq = false;
    const r = await tryErr(() => Promise.race([fn(c.v), new Promise((_, rej) => setTimeout(() => rej(new Error('TIMEOUT 20s')), 20000))]));
    res[label] = r.ok ? r.v : 'EXCEPTION: ' + r.error.slice(0, 140);
    if (c.v.seqMismatches) res[label + '_sequenceIdMismatches'] = c.v.seqMismatches;
    c.v.destroy();
  };
  await section('greeting', async (k) => ({ version: k.greeting.serverVersion, plugin: k.greeting.authPluginName, caps: '0x' + k.greeting.capabilities.toString(16), mariadbExtWord: k.greeting.reserved.readUInt32LE(6), profileChosen: k.profile.family, negotiatedExt: k.neg.ext, backendVersionSeenBySql: (await k.rows('select @@version'))[0]![0] }));
  await section('prepareExecuteResetClosePing', async (k) => { const st = await k.prepare('select ? + 1'); const r = (await st.execute([41])) as any; const rs = await st.reset().then(() => 'reset ok', (e) => 'reset ' + e.message.slice(0, 50)); await st.close(); await k.ping(); return { value: String(r.rows[0][0]), rs, ping: 'ok' }; });
  await section('executeBatch50', async (k) => {
    const s2 = await k.prepare('insert into fs07.seqlog (run, i) values (?, ?)');
    await k.sendMany(Array.from({ length: 50 }, (_, i) => ({ payload: encodeExecute(s2.id, [run, i + 1]), kind: 'execute' as const, stmt: s2 })));
    const kinds: string[] = []; for (let i = 0; i < 50; i++) kinds.push(kind((await k.receive())[0]));
    return { responses: [...new Set(kinds)].join(','), allOk: kinds.every((x) => x === 'OK') };
  });
  { const a2 = await root(hg === 10 ? my : ma); const rows = (await a2.rows(`select i from fs07.seqlog where run='${run}' order by id`)).map((x) => Number(x[0])); const eb = { rowsOnBackendOutOf50: rows.length, backendOrderMatches: rows.length === 50 && rows.every((v, i) => v === i + 1) }; res.executeBatch50 = typeof res.executeBatch50 === 'object' ? { ...res.executeBatch50, ...eb } : { result: res.executeBatch50, ...eb }; await a2.close(); }
  await section('queryBatch20_errorAt10', async (k) => {
    await k.sendMany(Array.from({ length: 20 }, (_, i) => ({ payload: q(i === 9 ? 'select * from fs07.nope' : `select ${i + 1}`), kind: 'query' as const })));
    const k20: string[] = []; for (let i = 0; i < 20; i++) k20.push(kind((await k.receive())[0]));
    return { onlyIndex10IsError: k20.every((x, i) => (i === 9 ? x === 'ERR1146' : x === 'ROWS1')), responses: k20.join(',') };
  });
  await section('prepareThenPlaceholderExecute', async (k) => {
    await k.sendMany([{ payload: Buffer.concat([Buffer.from([COM.STMT_PREPARE]), Buffer.from('select ? + 1')]), kind: 'prepare' }, { payload: encodeExecuteLastPrepared(41n), kind: 'execute' }]);
    return [kind((await k.receive())[0]), kind((await k.receive())[0])];
  });
  await section('bulkExecute', async (k) => { const sb = await k.prepare('insert into fs07.bk (a) values (?)'); const base = BigInt(hg * 1000000 + Date.now() % 100000); await k.send(encodeBulkBigint(sb.id, Array.from({ length: 20 }, (_, i) => [base + BigInt(i)])), 'execute', sb); return kind((await k.receive())[0]); });
  await section('resetConnection', async (k) => { await k.resetConnection(); return 'ok'; });
  return res;
}
out.mysqlBackend = await viaProxy(10, 'my');
out.mariadbBackend = await viaProxy(20, 'ma');
const stat = async (sql: string) => (await tryErr(() => admin!.rows(sql))).ok ? (await admin!.rows(sql)).map((r) => r.map((x) => (Buffer.isBuffer(x) ? x.toString() : String(x)))) : 'unavailable';
out.statsGlobal = await stat("select variable_name, variable_value from stats_mysql_global where variable_name in ('Com_backend_stmt_prepare','Com_backend_stmt_execute','Com_backend_stmt_close','Com_frontend_stmt_prepare','Com_frontend_stmt_execute','Com_frontend_stmt_close','Client_Connections_connected','Server_Connections_created','MySQL_Thread_Workers','ConnPool_get_conn_success','ConnPool_get_conn_failure')");
out.statsPreparedStatements = await stat('select hostgroup, username, digest_text, count_star from stats_mysql_prepared_statements_info limit 10');
out.statsConnectionPool = await stat('select hostgroup, srv_host, srv_port, status, ConnUsed, ConnFree, Queries from stats_mysql_connection_pool');
save('proxysql.json', out);
console.log(JSON.stringify({ mysql: out.mysqlBackend, mariadb: out.mariadbBackend }, (k, v) => (typeof v === 'bigint' ? Number(v) : v), 1).slice(0, 3000));
await admin.close();
await sh(['docker', 'rm', '-f', 'fs07-proxysql']);
