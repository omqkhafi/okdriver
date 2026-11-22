// Self-check of the instruments: (1) my encoder against the FS-06 wire encoder (copied to lib/wire.ts), byte for byte;
// (2) a statement of every kind against the real server returns the value the check expects; (3) the delivery check
// catches a planted defect (results delivered to the wrong statement).
import { bind, describe, execute, parse, sync, u8 } from './lib/wire.ts';
import { encodeBatch, expectedValue, RealConn, DIRECT } from './conn.ts';
import { K_CPU, K_ERR, K_FAST, K_LOCK, K_SLEEP, type Result, type Stmt } from '../core/pool.ts';

const sqls: Record<number, string> = {
  [K_FAST]: 'select $1::int8 as uid, v from kv where id = $2::int4',
  [K_SLEEP]: 'select $1::int8 as uid, $2::float8 as ms from pg_sleep($2::float8 / 1000.0)',
  [K_CPU]: 'select $1::int8 as uid, count(*) as c from generate_series(1, $2::int4)',
  [K_ERR]: 'select $1::int8 as uid, 1 / $2::int4 as x',
  [K_LOCK]: 'select $1::int8 as uid, $2::int8 as k from pg_advisory_lock($2::int8)',
};
const mk = (kind: number, uid: number, arg: number): Stmt => ({ uid, kind, arg, cls: 0, t0: 0, sentAt: 0, sentIdle: false, unit: null as never, idx: 0 });
let fail = 0;
const check = (ok: boolean, what: string) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) fail++; };

// (1) bytes
for (const [kind, uid, arg] of [[K_FAST, 7, 42], [K_FAST, 123456, 99999], [K_SLEEP, 1, 5], [K_CPU, 99, 275000], [K_ERR, 10, 0]] as const) {
  const ref = u8(parse('', sqls[kind]!), bind('', '', [String(uid), String(arg)]), describe('P', ''), execute('', 0), sync());
  const mine = encodeBatch([mk(kind, uid, arg)]);
  check(Buffer.compare(Buffer.from(ref), mine) === 0, `encoder bytes equal FS-06 wire.ts for kind ${kind} uid ${uid} arg ${arg}`);
}
// (2) server answers
const got: Result[] = [];
const c = new RealConn(0, (_id, r) => got.push(r), () => {});
await c.open(DIRECT);
const batch = [mk(K_FAST, 1, 5), mk(K_SLEEP, 2, 5), mk(K_CPU, 3, 1000), mk(K_ERR, 4, 0), mk(K_FAST, 5, 77)];
c.write(batch);
const end = performance.now() + 5000;
while (got.length < batch.length && performance.now() < end) await new Promise((r) => setTimeout(r, 5));
check(got.length === batch.length, `5 results for 5 statements in one write (got ${got.length})`);
batch.forEach((s, i) => {
  const r = got[i]!;
  if (s.kind === K_ERR) check(r.err === '22012', `error statement returns 22012 (got ${r.err})`);
  else check(r.err === null && r.uid === s.uid && r.v === expectedValue(s), `kind ${s.kind} uid ${s.uid}: uid ${r.uid} v ${r.v} expected ${expectedValue(s)}`);
});
check(got[4]!.err === null, 'the statement after the failed one is unaffected (its own Sync)');
c.close();
// (3) planted defect: shift the FIFO by one and the pool's check must count mismatches
import { PoolCore } from '../core/pool.ts';
import { makePolicy } from '../policy/index.ts';
{
  const sent: Stmt[][] = [];
  const pool = new PoolCore({ connections: 1, policy: makePolicy('fixed:4', { now: () => 0 }, 1), clock: { now: () => 0 }, sharing: true, transport: { send: (_c, b) => sent.push(b) } });
  const u = { stmts: [mk(K_FAST, 1, 1), mk(K_FAST, 2, 2)], onStmt: () => {}, onDone: () => {}, done: 0, next: 0 };
  u.stmts.forEach((s, i) => { s.unit = u; s.idx = i; });
  pool.submit(u);
  pool.complete(0, { uid: 2, v: 7, err: null }); // the second statement's result arrives first: planted
  pool.complete(0, { uid: 1, v: 4, err: null });
  check(pool.mismatches === 2, `delivery check counts a swapped pair (mismatches ${pool.mismatches})`);
}
process.exit(fail ? 1 : 0);
