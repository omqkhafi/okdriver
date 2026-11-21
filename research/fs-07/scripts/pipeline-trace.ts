// Proxy-side confirmation of the pipelined batches: which statements the independent parser saw, in what order, how the
// responses lined up (an error at exactly the expected index), and how many commands rode in one client write.
import { save, pick, root, PW } from './lib.ts';
import { startProxy } from './mytrace.ts';
import { connect } from '../wire/connect.ts';
import { COM } from '../wire/shared/constants.ts';
import { encodeExecute } from '../wire/shared/connection.ts';

const q = (sql: string) => Buffer.concat([Buffer.from([COM.QUERY]), Buffer.from(sql)]);
for (const s of pick()) {
  const a = await root(s);
  await a.query('create database if not exists fs07'); await a.queryAll('drop table if exists fs07.pt'); await a.query('create table fs07.pt (id int primary key, run varchar(20))');
  const proxy = await startProxy({ host: '127.0.0.1', port: s.port });
  const runs: any[] = [];
  for (let r = 1; r <= 5; r++) {
    const c = await connect({ host: '127.0.0.1', port: proxy.port, user: 'root', password: PW, database: 'fs07' });
    // batch A: 20 queries, #10 fails
    await c.sendMany(Array.from({ length: 20 }, (_, i) => ({ payload: q(i === 9 ? 'select * from fs07.no_such' : `select ${i + 1}`), kind: 'query' as const })));
    for (let i = 0; i < 20; i++) await c.receive();
    // batch B: prepared inserts, duplicate at #5 of 8
    const st = await c.prepare('insert into fs07.pt (id, run) values (?, ?)');
    const ids = [1, 2, 3, 4, 2, 6, 7, 8].map((x) => r * 100 + x);
    await c.sendMany(ids.map((id) => ({ payload: encodeExecute(st.id, [id, `r${r}`]), kind: 'execute' as const, stmt: st })));
    for (let i = 0; i < 8; i++) await c.receive();
    await c.close(); await new Promise((x) => setTimeout(x, 150));
    const t = proxy.traces()[r - 1]!;
    const steps = t.steps.slice(1);
    const queries = steps.filter((x) => x.label === 'COM_QUERY');
    const execs = steps.filter((x) => x.label === 'COM_STMT_EXECUTE');
    const orderOk = queries.map((x) => x.sql).join('|') === Array.from({ length: 20 }, (_, i) => (i === 9 ? 'select * from fs07.no_such' : `select ${i + 1}`)).join('|');
    const errA = queries.map((x, i) => (x.outcome === 'err' ? i + 1 : 0)).filter(Boolean);
    const errB = execs.map((x, i) => (x.outcome === 'err' ? i + 1 : 0)).filter(Boolean);
    const errnoB = execs.filter((x) => x.outcome === 'err').map((x) => x.errno);
    runs.push({ run: r, queriesSeenByProxy: queries.length, orderMatchesSent: orderOk, errorIndexesBatchA: errA, errnoA: queries.filter((x) => x.outcome === 'err').map((x) => x.errno), executesSeenByProxy: execs.length, errorIndexesBatchB: errB, errnoB,
      maxCommandsInOneClientChunk: Math.max(...t.c2sChunkPackets), responsesWithoutMatchingCommand: steps.filter((x) => x.s2c.length === 0 && x.outcome !== 'none').length });
  }
  const ok = runs.every((x) => x.queriesSeenByProxy === 20 && x.orderMatchesSent && x.errorIndexesBatchA.join() === '10' && x.executesSeenByProxy === 8 && x.errorIndexesBatchB.join() === '5');
  save(`pipeline-trace/${s.id}.json`, { server: s.id, runs, traceAgreesWithSentOrderAndErrorPositionsInAllRuns: ok });
  console.log(s.id, ok, 'max commands in one client write:', Math.max(...runs.map((x) => x.maxCommandsInOneClientChunk)));
  await proxy.close(); await a.close();
}
