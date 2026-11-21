// FS-08: a worker reader (own connection, WAL) sees what the main-thread writer committed, and not what it has not.
// Also: a long read in the worker does not block the writer on the main thread.
import fs from 'node:fs';
import path from 'node:path';
import { getAdapter } from './lib/adapters.mjs';
import { runtime, WORK, RESULTS, writeJson, BINDINGS } from './lib/rt.mjs';
import { spawn } from './lib/workers.mjs';
import { now, sleep } from './lib/stats.mjs';

const binding = process.argv[2];
if (!BINDINGS.includes(binding)) { console.error('usage: probe-worker-visibility.mjs <binding>'); process.exit(2); }
const rt = runtime(); const tag = binding.replace(/[:]/g, '-') + '__' + rt.id;
const a = await getAdapter(binding);
if (!a.ok) { console.log(tag, 'does not load'); process.exit(0); }
const dbPath = path.join(WORK, 'bench', `vis-${tag}.db`); fs.mkdirSync(path.dirname(dbPath), { recursive: true });
for (const s of ['', '-wal', '-shm']) fs.rmSync(dbPath + s, { force: true });
const w = a.open(dbPath, { timeout: 0 });
w.exec('PRAGMA journal_mode=WAL'); w.exec('CREATE TABLE v(id INTEGER PRIMARY KEY)');
const wk = await spawn({ binding, dbPath });
const count = async () => (await wk.call({ op: 'get', sql: 'SELECT count(*) AS c FROM v', params: [] })).row.c;
const ins = w.prepare('INSERT INTO v VALUES (?)');
const res = { binding, runtime: rt };
// 1. every autocommit insert is visible to the worker's next read
let consistent = 0; const N = 100;
for (let i = 1; i <= N; i++) { ins.run(i); if (Number(await count()) === i) consistent++; }
res.autocommitVisible = { writes: N, workerSawIt: consistent };
// 2. an open write transaction is invisible until COMMIT
w.exec('BEGIN IMMEDIATE'); ins.run(1000);
const before = Number(await count()); w.exec('COMMIT'); const after = Number(await count());
res.uncommittedInvisible = { workerCountDuringTx: before, workerCountAfterCommit: after, expectedDuring: N, expectedAfter: N + 1 };
// 3. a long read in the worker does not block the writer
const CTE = 'WITH RECURSIVE c(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM c WHERE i < ?) SELECT count(*) AS n FROM c';
const t0 = now(); const long = wk.call({ op: 'get', sql: CTE, params: [3000000] }); // a few hundred ms of work on the worker
await sleep(20);
const wt0 = now(); for (let i = 2000; i < 2050; i++) ins.run(i); const writeMs = now() - wt0;
await long; const longMs = now() - t0;
res.writerDuringLongRead = { longReadMs: Math.round(longMs), fiftyAutocommitWritesMs: Math.round(writeMs * 10) / 10, writerBlocked: writeMs > longMs / 2 };
await wk.call({ op: 'close' }); wk.terminate(); w.close();
for (const s of ['', '-wal', '-shm']) fs.rmSync(dbPath + s, { force: true });
await writeJson(path.join(RESULTS, 'worker-visibility', tag + '.json'), res);
console.log(tag, JSON.stringify(res.autocommitVisible), JSON.stringify(res.uncommittedInvisible), JSON.stringify(res.writerDuringLongRead));
process.exit(0);
