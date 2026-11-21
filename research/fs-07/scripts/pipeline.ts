// Pipelining probes. "Safe" (defined before running): responses come back in command order; every error
// belongs to exactly one statement; nothing stalls (every response arrives within the timeout);
// nothing is skipped silently (what the server logged matches what was sent, and table effects match).
// Each probe runs 5 times per server. Observations only.
import { save, pick, root, PW, sleep, type Server } from './lib.ts';
import { startProxy, type Proxy } from './mytrace.ts';
import { connect } from '../wire/connect.ts';
import { COM } from '../wire/shared/constants.ts';
import { encodeExecute, type Connection } from '../wire/shared/connection.ts';
import type { Response } from '../wire/shared/result.ts';
import { encodeBulkBigint, encodeExecuteLastPrepared, COM_STMT_BULK_EXECUTE, LAST_PREPARED } from '../wire/mariadb/bulk.ts';

const RUNS = Number(process.env.RUNS ?? 5);
const q = (sql: string) => Buffer.concat([Buffer.from([COM.QUERY]), Buffer.from(sql)]);
const prep = (sql: string) => Buffer.concat([Buffer.from([COM.STMT_PREPARE]), Buffer.from(sql)]);
const kind = (r: Response) => (r.kind === 'err' ? `ERR${r.errno}` : r.kind === 'ok' ? 'OK' : r.kind === 'rows' ? `ROWS${r.rows.length}` : 'PREPARE');

async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let t: any;
  const to = new Promise<never>((_, rej) => (t = setTimeout(() => rej(new Error('TIMEOUT ' + label)), ms)));
  try { return await Promise.race([p, to]); } finally { clearTimeout(t); }
}
/** Read the next n responses (one per command in flight). */
async function readN(c: Connection, n: number, ms = 30000): Promise<Response[][]> {
  const out: Response[][] = [];
  for (let i = 0; i < n; i++) out.push(await withTimeout(c.receive(), ms, `response ${i + 1}/${n}`));
  return out;
}

interface Ctx { s: Server; admin: Connection; proxy: Proxy; run: string }
interface Verdict { safe: boolean; summary: string; detail?: any }

async function serverLog(ctx: Ctx, connId: number) {
  const out: any = {};
  await sleep(150);
  if (ctx.s.family === 'mysql') {
    out.perf = (await ctx.admin.rows(`select event_name, mysql_errno, sql_text from performance_schema.events_statements_history_long h join performance_schema.threads t using (thread_id) where t.processlist_id=${connId} order by event_id`))
      .map((r) => `${String(r[0]).replace('statement/', '')}|${r[1]}|${String(r[2] ?? '').slice(0, 60)}`);
  }
  out.general = (await ctx.admin.rows(`select command_type, argument from mysql.general_log where thread_id=${connId} order by event_time, argument`)).map((r) => `${r[0]}|${String(Buffer.isBuffer(r[1]) ? r[1].toString() : r[1]).slice(0, 60)}`);
  return out;
}
const myConn = async (ctx: Ctx) => { const c = await connect({ host: '127.0.0.1', port: ctx.proxy.port, user: 'root', password: PW, database: 'fs07' }); return c; };
const connIdOf = (c: Connection) => c.greeting.connectionId;

// ---------------------------------------------------------------- probes
const N = 50;
const HUGE = 'select b.id, b.pad from fs07.big b cross join (select 1 union all select 2 union all select 3 union all select 4) k'; // 80,000 rows, about 80 MB
const probes: Record<string, (ctx: Ctx) => Promise<Verdict>> = {
  async 'P1 query batch (50 COM_QUERY in one write)'(ctx) {
    const c = await myConn(ctx);
    await c.sendMany(Array.from({ length: N }, (_, i) => ({ payload: q(`select ${i + 1} /*${ctx.run}*/`), kind: 'query' as const })));
    const res = await readN(c, N);
    const inOrder = res.every((r, i) => r[0]!.kind === 'rows' && String((r[0] as any).rows[0][0]) === String(i + 1));
    const log = await serverLog(ctx, connIdOf(c));
    const ran = log.general.filter((l: string) => l.includes(`/*${ctx.run}*/`)).map((l: string) => Number(/select (\d+)/.exec(l)?.[1]));
    const logged = ran.length === N && ran.every((v: number, i: number) => v === i + 1);
    await c.close();
    return { safe: inOrder && logged, summary: `inOrder=${inOrder} serverLogged=${ran.length}/${N} inSentOrder=${logged}` };
  },
  async 'P2 execute batch (50 COM_STMT_EXECUTE inserts in one write)'(ctx) {
    const c = await myConn(ctx);
    const st = await c.prepare('insert into fs07.seqlog (run, i) values (?, ?)');
    await c.sendMany(Array.from({ length: N }, (_, i) => ({ payload: encodeExecute(st.id, [ctx.run, i + 1]), kind: 'execute' as const, stmt: st })));
    const res = await readN(c, N);
    const allOk = res.every((r) => r[0]!.kind === 'ok' && (r[0] as any).affectedRows === 1);
    const rows = await ctx.admin.rows(`select i from fs07.seqlog where run='${ctx.run}' order by id`);
    const order = rows.map((r) => Number(r[0]));
    const inOrder = order.length === N && order.every((v, i) => v === i + 1);
    await c.close();
    return { safe: allOk && inOrder, summary: `allOk=${allOk} rowsInserted=${order.length}/${N} serverOrderMatches=${inOrder}` };
  },
  async 'P3 error in the middle (COM_QUERY, #10 of 20 fails)'(ctx) {
    const c = await myConn(ctx);
    await c.sendMany(Array.from({ length: 20 }, (_, i) => ({ payload: q(i === 9 ? `select * from fs07.no_such_${ctx.run}` : `select ${i + 1} /*${ctx.run}*/`), kind: 'query' as const })));
    const res = await readN(c, 20);
    const kinds = res.map((r) => kind(r[0]!));
    const only10 = kinds.every((k, i) => (i === 9 ? k === 'ERR1146' : k === 'ROWS1'));
    const after = await c.ping().then(() => true, () => false);
    const log = await serverLog(ctx, connIdOf(c));
    const logged = log.general.filter((l: string) => l.includes(ctx.run)).length;
    await c.close();
    return { safe: only10 && logged === 20 && after, summary: `errorOnlyAtIndex10=${only10} serverLogged=${logged}/20 connectionUsableAfter=${after}`, detail: only10 ? undefined : kinds };
  },
  async 'P4 error in the middle (COM_STMT_EXECUTE, duplicate key at #5 of 8)'(ctx) {
    const c = await myConn(ctx);
    const base = Number(ctx.run.slice(-4)) * 100;
    const st = await c.prepare('insert into fs07.pk (id, run) values (?, ?)');
    const ids = [1, 2, 3, 4, 2, 6, 7, 8].map((x) => base + x);
    await c.sendMany(ids.map((id) => ({ payload: encodeExecute(st.id, [id, ctx.run]), kind: 'execute' as const, stmt: st })));
    const res = await readN(c, 8);
    const kinds = res.map((r) => kind(r[0]!));
    const only5 = kinds.every((k, i) => (i === 4 ? k === 'ERR1062' : k === 'OK'));
    const rows = await ctx.admin.rows(`select count(*) from fs07.pk where run='${ctx.run}'`);
    await c.close();
    return { safe: only5 && Number(rows[0]![0]) === 7, summary: `errorOnlyAtIndex5=${only5} rowsInTable=${rows[0]![0]}/7`, detail: only5 ? undefined : kinds };
  },
  async 'P5 prepare + execute(0xFFFFFFFF) without waiting'(ctx) {
    const c = await myConn(ctx);
    await c.sendMany([{ payload: prep('select ? + 1'), kind: 'prepare' }, { payload: encodeExecuteLastPrepared(41n), kind: 'execute' }]);
    const res = await readN(c, 2).catch((e) => [[{ kind: 'err', errno: -1, sqlState: '', message: String(e) } as Response]]);
    const kinds = res.map((r) => kind(r[0]!));
    const val = res[1]?.[0]?.kind === 'rows' ? String((res[1][0] as any).rows[0][0]) : null;
    const usable = await c.ping().then(() => true, () => false);
    await c.close().catch(() => {});
    return { safe: kinds[0] === 'PREPARE' && val === '42', summary: `responses=${kinds.join(',')} value=${val} connectionUsableAfter=${usable}`, detail: res.flat().filter((r) => r.kind === 'err').map((r: any) => `${r.errno}: ${r.message}`) };
  },
  async 'P5b prepare + execute with a guessed next statement id'(ctx) {
    const c = await myConn(ctx);
    const first = await c.prepare('select 1'); await first.close();
    const guess = first.id + 1;
    await c.sendMany([{ payload: prep('select ? + 1'), kind: 'prepare' }, { payload: encodeExecute(guess, [41]), kind: 'execute' }]);
    const res = await readN(c, 2);
    const real = res[0]![0]!.kind === 'prepare' ? (res[0]![0] as any).id : null;
    const kinds = res.map((r) => kind(r[0]!));
    await c.close();
    return { safe: false, summary: `firstId=${first.id} guess=${guess} assignedId=${real} guessMatches=${real === guess} responses=${kinds.join(',')}` };
  },
  async 'P6 failing prepare then execute(0xFFFFFFFF)'(ctx) {
    const c = await myConn(ctx);
    await c.sendMany([{ payload: prep('selec ?'), kind: 'prepare' }, { payload: encodeExecuteLastPrepared(1n), kind: 'execute' }]);
    const res = await readN(c, 2);
    const kinds = res.map((r) => kind(r[0]!));
    const errs = res.flat().filter((r) => r.kind === 'err').map((r: any) => `${r.errno}`);
    const usable = await c.ping().then(() => true, () => false);
    await c.close();
    return { safe: kinds.length === 2 && kinds.every((k) => k.startsWith('ERR')) && usable, summary: `responses=${kinds.join(',')} errnos=${errs.join('/')} connectionUsableAfter=${usable}` };
  },
  async 'P7 large result in the middle, slow reader (3 commands, 20 MB middle result)'(ctx) {
    const c = await myConn(ctx);
    const t0 = Date.now();
    c.pauseReading();
    await c.sendMany([{ payload: q('select 1'), kind: 'query' }, { payload: q('select id, pad from fs07.big order by id'), kind: 'query' }, { payload: q('select 3'), kind: 'query' }]);
    setTimeout(() => c.resumeReading(), 1500); // slow reader: nothing read for 1.5 s
    const res = await readN(c, 3, 60000).catch((e) => String(e));
    if (typeof res === 'string') { c.destroy(); return { safe: false, summary: res }; }
    const ok = res[0]![0]!.kind === 'rows' && (res[1]![0] as any).rows.length === 20000 && String((res[2]![0] as any).rows[0][0]) === '3';
    await c.close();
    return { safe: ok, summary: `inOrder=${ok} bigRows=${(res[1]![0] as any).rows.length} ms=${Date.now() - t0}` };
  },
  async 'P8 stall: client stops reading and keeps writing (24 MB of filler behind a 20 MB result)'(ctx) {
    const c = await myConn(ctx);
    const pad = 'x'.repeat(16000);
    const fillers = 1500;
    c.pauseReading();
    const items = [{ payload: q('select 1'), kind: 'query' as const }, { payload: q(HUGE), kind: 'query' as const },
      ...Array.from({ length: fillers }, () => ({ payload: q(`select 2 /*${pad}*/`), kind: 'query' as const }))];
    const t0 = Date.now();
    let writeDone = false;
    const w = c.sendMany(items).then(() => { writeDone = true; });
    await sleep(8000);
    const cb = writeDone;
    const plist = await ctx.admin.rows(`select state, time from information_schema.processlist where id = ${connIdOf(c)}`);
    const startedAt8s = (await ctx.admin.rows(`select count(*) from mysql.general_log where thread_id=${connIdOf(c)} and argument like '%select 2 /*%'`))[0]![0];
    const stalledAt8s = Number(startedAt8s) < fillers;
    c.resumeReading();
    const res = await readN(c, items.length, 120000).catch((e) => String(e));
    await w.catch(() => {});
    if (typeof res === 'string') { c.destroy(); return { safe: false, summary: `stalledWhileNotReading=${stalledAt8s} afterResume=${res}` }; }
    const ok = (res[1]![0] as any).rows.length === 80000 && res.slice(2).every((r) => r[0]!.kind === 'rows');
    await c.close();
    return { safe: ok, summary: `serverStartedFillersAt8sWhileClientNotReading=${startedAt8s}/${fillers} serverStalled=${stalledAt8s} serverState="${plist[0]?.[0]}" clientWriteCallbackFired=${cb} recoveredAfterResume=${ok} totalMs=${Date.now() - t0}` };
  },
  async 'P8b server gives up on a reader that stops (net_write_timeout=2 s, reader paused 6 s)'(ctx) {
    const c = await myConn(ctx);
    await c.query('set session net_write_timeout = 2');
    c.pauseReading();
    await c.sendMany([{ payload: q(`/*${ctx.run}*/ select 1`), kind: 'query' }, { payload: q(`/*${ctx.run}*/ ${HUGE}`), kind: 'query' }, { payload: q(`/*${ctx.run}*/ select 3`), kind: 'query' }]);
    await sleep(6000);
    c.resumeReading();
    const got: string[] = [];
    for (let i = 0; i < 3; i++) { const r = await readN(c, 1, 20000).then((x) => kind(x[0]![0]!), (e) => 'LOST:' + String(e.message ?? e).slice(0, 40)); got.push(r); if (r.startsWith('LOST')) break; }
    const log = await serverLog(ctx, connIdOf(c));
    const ran = log.general.filter((l: string) => l.includes(ctx.run)).length;
    c.destroy();
    return { safe: false, summary: `responsesReceived=${got.join(',')} statementsServerLogged=${ran}/3` };
  },
  async 'P9a bulk execute: 100 rows in one COM_STMT_BULK_EXECUTE (0xFA)'(ctx) {
    const c = await myConn(ctx);
    const base = BigInt(Number(ctx.run.slice(-4)) * 1000);
    const st = await c.prepare('insert into fs07.bk (a) values (?)');
    await c.send(encodeBulkBigint(st.id, Array.from({ length: 100 }, (_, i) => [base + BigInt(i)])), 'execute', st);
    const res = await readN(c, 1).catch((e) => [[{ kind: 'err', errno: -1, sqlState: '', message: String(e) } as Response]]);
    const r = res[0]![0]!;
    const rows = await ctx.admin.rows(`select count(*) from fs07.bk where a >= ${base} and a < ${base + 100n}`);
    const usable = await c.ping().then(() => true, () => false);
    await c.close().catch(() => {});
    return { safe: r.kind === 'ok' && Number(rows[0]![0]) === 100, summary: `response=${kind(r)}${r.kind === 'ok' ? ' affected=' + r.affectedRows : r.kind === 'err' ? ' ' + r.message.slice(0, 50) : ''} rowsInTable=${rows[0]![0]}/100 connectionUsableAfter=${usable}` };
  },
  async 'P9b bulk execute with a duplicate key at row 50 of 100'(ctx) {
    const c = await myConn(ctx);
    const base = BigInt(Number(ctx.run.slice(-4)) * 1000 + 500);
    const st = await c.prepare('insert into fs07.bk (a) values (?)');
    const rows = Array.from({ length: 100 }, (_, i) => [base + BigInt(i === 49 ? 0 : i)]);
    await ctx.admin.query(`insert into fs07.bk (a) values (${base})`);
    await c.send(encodeBulkBigint(st.id, rows), 'execute', st);
    const res = await readN(c, 1).catch((e) => [[{ kind: 'err', errno: -1, sqlState: '', message: String(e) } as Response]]);
    const r = res[0]![0]!;
    const n = await ctx.admin.rows(`select count(*) from fs07.bk where a >= ${base} and a < ${base + 100n}`);
    await c.close().catch(() => {});
    return { safe: false, summary: `response=${kind(r)} rowsInTableAfter=${n[0]![0]} (1 pre-existing; 100 sent, row 50 duplicates it)` };
  },
  async 'P9c prepare + bulk execute(0xFFFFFFFF) without waiting'(ctx) {
    const c = await myConn(ctx);
    const base = BigInt(Number(ctx.run.slice(-4)) * 1000 + 700);
    await c.sendMany([{ payload: prep('insert into fs07.bk (a) values (?)'), kind: 'prepare' }, { payload: encodeBulkBigint(LAST_PREPARED, Array.from({ length: 10 }, (_, i) => [base + BigInt(i)])), kind: 'execute' }]);
    const res = await readN(c, 2).catch((e) => [[{ kind: 'err', errno: -1, sqlState: '', message: String(e) } as Response]]);
    const n = await ctx.admin.rows(`select count(*) from fs07.bk where a >= ${base} and a < ${base + 10n}`);
    await c.close().catch(() => {});
    return { safe: false, summary: `responses=${res.map((r) => kind(r[0]!)).join(',')} rowsInTable=${n[0]![0]}/10` };
  },
};

async function setup(s: Server) {
  const a = await root(s);
  await a.query('create database if not exists fs07');
  await a.queryAll('set session sql_notes=0');
  for (const t of ['seqlog', 'pk', 'bk', 'big']) await a.queryAll(`drop table if exists fs07.${t}`);
  await a.query('create table fs07.seqlog (id int auto_increment primary key, run varchar(40), i int)');
  await a.query('create table fs07.pk (id int primary key, run varchar(40))');
  await a.query('create table fs07.bk (a bigint primary key)');
  await a.query('create table fs07.big (id int primary key, pad varchar(1000))');
  const pad = 'y'.repeat(1000);
  for (let b = 0; b < 20000; b += 500) await a.query(`insert into fs07.big values ${Array.from({ length: 500 }, (_, i) => `(${b + i + 1}, '${pad}')`).join(',')}`);
  if (s.family === 'mysql') await a.query("update performance_schema.setup_consumers set enabled='YES' where name in ('events_statements_history_long','events_statements_history')");
  return a;
}

const only = process.env.PROBES?.split(',');
for (const s of pick()) {
  const admin = await setup(s);
  const proxy = await startProxy({ host: '127.0.0.1', port: s.port });
  const result: Record<string, { runs: Verdict[]; safeRuns: number; distinctSummaries: string[] }> = {};
  for (const [name, fn] of Object.entries(probes)) {
    if (only && !only.some((o) => name.startsWith(o))) continue;
    const runs: Verdict[] = [];
    for (let r = 1; r <= RUNS; r++) {
      const run = `${s.id}-${name.slice(0, 3).trim()}-${r}`.replace(/[^A-Za-z0-9-]/g, '') + String(1000 + r).slice(-4).padStart(4, '0');
      const t0 = Date.now();
      try { const v = await withTimeout(fn({ s, admin, proxy, run: `${run.replace(/[^A-Za-z0-9]/g, '')}${1000 + r}` }), 240000, 'probe'); runs.push(v); }
      catch (e: any) { runs.push({ safe: false, summary: 'EXCEPTION ' + String(e.message ?? e).slice(0, 120) }); }
      void t0;
    }
    const distinct = [...new Set(runs.map((x) => x.summary.replace(/ ms=\d+| totalMs=\d+/g, '')))];
    result[name] = { runs, safeRuns: runs.filter((x) => x.safe).length, distinctSummaries: distinct };
    console.log(s.id, name.slice(0, 40), `${result[name]!.safeRuns}/${RUNS} safe`, '|', distinct[0]?.slice(0, 140));
  }
  // proxy-side evidence: coalescing of the pipelined writes
  save(`pipeline/${s.id}.json`, { server: s.id, runsPerProbe: RUNS, probes: result, proxyConnections: proxy.traces().length, maxCommandsInOneClientWrite: Math.max(...proxy.traces().flatMap((t) => t.c2sChunkPackets)) });
  await proxy.close(); await admin.close();
}
