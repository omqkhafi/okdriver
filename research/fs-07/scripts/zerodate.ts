// Zero dates and range edges under each server's own default sql_mode (no sql_mode change).
import { save, pick, root, tryErr } from './lib.ts';

for (const s of pick()) {
  const a = await root(s);
  await a.query('create database if not exists fs07');
  await a.queryAll('drop table if exists fs07.zd'); await a.query('create table fs07.zd (d date, dt datetime(6), t time(6), y year)');
  const out: any = { server: s.id, sql_mode: String((await a.rows('select @@sql_mode'))[0]![0]) };
  for (const [k, sql] of [['zero date', "insert into fs07.zd (d) values ('0000-00-00')"], ['zero day in date', "insert into fs07.zd (d) values ('2020-01-00')"], ['zero datetime', "insert into fs07.zd (dt) values ('0000-00-00 00:00:00')"],
    ['time 838:59:59', "insert into fs07.zd (t) values ('838:59:59')"], ['time 838:59:59.5', "insert into fs07.zd (t) values ('838:59:59.5')"], ['time 839:00:00', "insert into fs07.zd (t) values ('839:00:00')"], ['year 2156', 'insert into fs07.zd (y) values (2156)'], ['datetime year 10000', "insert into fs07.zd (dt) values ('10000-01-01 00:00:00')"]] as const) {
    const r = await tryErr(() => a.query(sql)); out[k] = r.ok ? 'accepted' : `ERR ${r.errno}: ${r.error.slice(r.error.indexOf(')') + 2, r.error.indexOf(')') + 62)}`;
  }
  out.storedRows = (await a.rows('select d, dt, t, y from fs07.zd')).map((r) => r.map((x) => (x === null ? 'NULL' : String(x))).join(' | '));
  await a.close();
  save(`zerodate/${s.id}.json`, out);
  console.log(s.id, out['zero date'], '|', out['time 838:59:59.5'], '|', out['zero day in date']);
}
