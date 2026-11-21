// Second tier: kill the connection in the middle of a pipelined batch of autocommit inserts and see which statements ran.
// The client's view (responses received before the loss) is compared with the server's view (rows committed).
import { save, pick, root, PW, sleep } from './lib.ts';
import { startProxy } from './mytrace.ts';
import { connect } from '../wire/connect.ts';
import { encodeExecute } from '../wire/shared/connection.ts';

const RUNS = Number(process.env.RUNS ?? 5);
const N = 300;
for (const s of pick()) {
  const admin = await root(s);
  await admin.query('create database if not exists fs07');
  await admin.queryAll('drop table if exists fs07.killt');
  await admin.query('create table fs07.killt (id int auto_increment primary key, run varchar(40), i int)');
  const proxy = await startProxy({ host: '127.0.0.1', port: s.port });
  const runs: any[] = [];
  for (let r = 1; r <= RUNS; r++) {
    const run = `${s.id}-k${r}`;
    const c = await connect({ host: '127.0.0.1', port: proxy.port, user: 'root', password: PW, database: 'fs07' });
    const st = await c.prepare('insert into fs07.killt (run, i) values (?, ?)');
    const id = c.greeting.connectionId;
    await c.sendMany(Array.from({ length: N }, (_, i) => ({ payload: encodeExecute(st.id, [run, i + 1]), kind: 'execute' as const, stmt: st })));
    setTimeout(() => { admin.query(`kill connection ${id}`).catch(() => {}); }, 8 + r * 4);
    let ok = 0, err = 0, lost = false;
    for (let i = 0; i < N; i++) {
      try { const x = (await c.receive())[0]!; if (x.kind === 'ok') ok++; else err++; } catch { lost = true; break; }
    }
    await sleep(300);
    const rows = (await admin.rows(`select i from fs07.killt where run='${run}' order by id`)).map((x) => Number(x[0]));
    const contiguous = rows.every((v, i) => v === i + 1);
    runs.push({ run: r, statementsSent: N, responsesOkBeforeLoss: ok, responsesErrBeforeLoss: err, connectionLost: lost, rowsCommittedOnServer: rows.length, committedIsPrefixOfSentOrder: contiguous,
      committedBeyondWhatClientSaw: rows.length - ok, clientSawMoreThanServerCommitted: ok > rows.length });
    c.destroy();
  }
  const tr = proxy.traces();
  save(`kill/${s.id}.json`, { server: s.id, killedAfterMs: '12..28 (varies by run)', runs });
  console.log(s.id, runs.map((x) => `${x.responsesOkBeforeLoss}/${x.rowsCommittedOnServer}${x.committedIsPrefixOfSentOrder ? '' : '!'}`).join(' '));
  void tr; await proxy.close(); await admin.close();
}
