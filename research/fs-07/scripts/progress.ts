// MariaDB progress reporting (MARIADB_CLIENT_PROGRESS, extended bit 1): an ERR-shaped packet with errno 65535 during a long statement.
import { save, pick, root, PW } from './lib.ts';
import { connect } from '../wire/connect.ts';
import { COM } from '../wire/shared/constants.ts';
import { Reader } from '../wire/shared/bytes.ts';

for (const s of pick()) {
  const a = await root(s);
  await a.query('create database if not exists fs07');
  const hasBig = (await a.rows("select count(*) from information_schema.tables where table_schema='fs07' and table_name='big'"))[0]![0];
  if (Number(hasBig) === 0) { await a.queryAll('create table fs07.big (id int primary key, pad varchar(1000))'); await a.query(`insert into fs07.big values ${Array.from({ length: 2000 }, (_, i) => `(${i + 1}, 'p')`).join(',')}`); }
  await a.close();
  const out: any = { server: s.id };
  const c = await connect({ host: '127.0.0.1', port: s.port, user: 'root', password: PW, database: 'fs07', extCaps: s.family === 'mariadb' ? 1 : 0 });
  out.progressCapabilityOffered = s.family === 'mariadb' ? !!(c.greeting.reserved.readUInt32LE(6) & 1) : false;
  out.progressCapabilityNegotiated = !!(c.neg.ext & 1);
  if (s.family === 'mariadb') await c.query('set session progress_report_time = 1');
  await c.query('drop table if exists fs07.pg'); await c.query('create table fs07.pg (a int, pad varchar(200))'); await c.query(`insert into fs07.pg values ${Array.from({ length: 2000 }, (_, i) => `(${i}, repeat(char(65 + ${i % 26}), 100))`).join(',')}`); for (let i = 0; i < 8; i++) await c.query('insert into fs07.pg select a, pad from fs07.pg');
  await c.send(Buffer.concat([Buffer.from([COM.QUERY]), Buffer.from('alter table fs07.pg add index (pad), algorithm=copy')]), 'none');
  c.beginRawResponse();
  const seen: any[] = [];
  for (let i = 0; i < 200; i++) {
    const p = await c.readPacket(); const h = p.payload[0];
    if (h === 0xff) { const r = new Reader(p.payload, 1); const errno = r.u16(); if (errno === 0xffff) { const n = r.u8(); const stage = r.u8(), max = r.u8(), prog = r.u24(); const info = r.lenencString(); seen.push({ progressPacket: true, stage, maxStage: max, progressPermille: prog, info }); } else seen.push({ err: errno }); continue; }
    seen.push({ header: '0x' + h!.toString(16) }); break;
  }
  out.packetsDuringAlter = seen.slice(0, 6); out.progressPacketCount = seen.filter((x) => x.progressPacket).length;
  c.destroy();
  save(`progress/${s.id}.json`, out);
  console.log(s.id, out.progressCapabilityOffered, out.progressCapabilityNegotiated, out.progressPacketCount, JSON.stringify(seen.slice(-1)));
}
