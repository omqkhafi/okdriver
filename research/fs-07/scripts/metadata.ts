// Metadata skipping. MySQL: CLIENT_OPTIONAL_RESULTSET_METADATA + resultset_metadata. MariaDB: MARIADB_CLIENT_CACHE_METADATA.
// What the server sends on prepare, first execute, repeated execute, text query, and after the table changes shape.
import { save, pick, root, tryErr, PW } from './lib.ts';
import { connect } from '../wire/connect.ts';
import { OPTIONAL_RESULTSET_METADATA } from '../wire/mysql/profile.ts';
import { STATUS } from '../wire/shared/constants.ts';
import type { Rows } from '../wire/shared/result.ts';

const sum = (r: any) => (r.kind === 'rows' ? { rows: r.rows.length, metadataSkipped: r.metadataSkipped, metadataChangedFlag: !!(r.status & STATUS.METADATA_CHANGED), columns: r.columns.length } : r.kind);
for (const s of pick()) {
  const a = await root(s);
  await a.query('create database if not exists fs07');
  await a.queryAll('drop table if exists fs07.mt'); await a.query('create table fs07.mt (a int, b varchar(5))'); await a.query("insert into fs07.mt values (1,'x'),(2,'y')");
  const out: any = { server: s.id, mechanism: s.family === 'mysql' ? 'CLIENT_OPTIONAL_RESULTSET_METADATA (bit 25) + resultset_metadata' : 'MARIADB_CLIENT_CACHE_METADATA (extended bit 16)' };
  const opts = s.family === 'mysql' ? { addCaps: OPTIONAL_RESULTSET_METADATA } : { extCaps: 16 };
  const c = await connect({ host: '127.0.0.1', port: s.port, user: 'root', password: PW, database: 'fs07', ...opts });
  out.offeredByServer = s.family === 'mysql' ? !!(c.greeting.capabilities & OPTIONAL_RESULTSET_METADATA) : !!(c.greeting.reserved.readUInt32LE(6) & 16);
  out.negotiated = s.family === 'mysql' ? !!(c.neg.caps & OPTIONAL_RESULTSET_METADATA) : !!(c.neg.ext & 16);
  const st = await c.prepare('select a, b from fs07.mt order by a');
  if (s.family === 'mysql') {
    await c.query("set session resultset_metadata = 'NONE'");
    const pn = await c.prepare('select a, b from fs07.mt');
    out.prepareUnderNone = { tailHex: pn.tail.toString('hex'), columnDefinitionsInResponse: pn.columns.length, parameterDefinitionsInResponse: pn.params.length };
    await pn.close();
  }
  out.prepareOkTailHex = st.tail.toString('hex');
  out.firstExecute = sum(await st.execute([]));
  out.secondExecute = sum(await st.execute([]));
  // a text query has no PREPARE to cache columns from; done on its own connection because a result left half-read would hold a metadata lock
  const c2 = await connect({ host: '127.0.0.1', port: s.port, user: 'root', password: PW, database: 'fs07', ...opts });
  if (s.family === 'mysql') await c2.query("set session resultset_metadata = 'NONE'");
  const tq = await tryErr(async () => sum(await c2.query('select a, b from fs07.mt')));
  out.textQuery = tq.ok ? tq.v : tq.error.slice(0, 90);
  c2.destroy();
  await new Promise((r) => setTimeout(r, 300));
  await a.query('alter table fs07.mt add column c int default 7');
  const afterDdl = await tryErr(async () => sum(await st.execute([])));
  out.executeAfterAlterTableAddColumn = afterDdl.ok ? afterDdl.v : afterDdl.error.slice(0, 120);
  const again = await tryErr(async () => sum(await st.execute([])));
  out.nextExecuteAfterThat = again.ok ? again.v : again.error.slice(0, 120);
  // the hazard case: a SELECT * whose table changes shape while the client keeps its cached column definitions
  if (s.family === 'mysql') await c.query("set session resultset_metadata = 'FULL'");
  const sa = await c.prepare('select * from fs07.mt order by a');
  if (s.family === 'mysql') await c.query("set session resultset_metadata = 'NONE'");
  const before = await sa.execute([]);
  await a.query('alter table fs07.mt add column d int default 9');
  const afterStar = await tryErr(async () => { const r = (await sa.execute([])) as Rows; return { metadataSkipped: r.metadataSkipped, columnsClientUses: r.columns.length, firstRowAsDecoded: r.rows[0]!.map(String) }; });
  out.selectStarBeforeAlter = { columns: (before as Rows).columns.length, firstRow: (before as Rows).rows[0]!.map(String) };
  out.selectStarAfterAddColumn = afterStar.ok ? afterStar.v : afterStar.error.slice(0, 120);
  out.truthFromServerAfterAlter = (await a.rows('select * from fs07.mt order by a'))[0]!.map(String);
  c.destroy(); await a.close();
  save(`metadata/${s.id}.json`, out);
  console.log(s.id, out.offeredByServer, out.negotiated, JSON.stringify(out.firstExecute), JSON.stringify(out.secondExecute), JSON.stringify(out.executeAfterAlterTableAddColumn));
}
