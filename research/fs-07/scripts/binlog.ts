// Second tier: binlog table-map metadata per server, with the image's own tools only (no binlog reader here; FS-11 owns that).
// Each server is started in its own throwaway container with the binary log on, once with its default
// binlog_row_metadata and once with FULL. SHOW BINLOG EVENTS (the server's own view) gives the size of the Table_map event;
// mysqlbinlog / mariadb-binlog -vv shows whether row images carry column names.
import { save, sleep, PW, SERVERS, type Server } from './lib.ts';
import { connect } from '../wire/connect.ts';

const DDL = "create table fs07.bl (a int unsigned not null, b varchar(10) character set utf8mb4, c enum('x','y'), d bit(3), e decimal(5,2), f tinyint, g blob, primary key (a))";
async function sh(args: string[]) { const p = Bun.spawn(args, { stdout: 'pipe', stderr: 'pipe' }); const [o, e] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]); await p.exited; return (o + e).trim(); }

for (const s of SERVERS.filter((x) => !process.env.SERVERS || process.env.SERVERS.split(',').includes(x.id))) {
  const out: any = { server: s.id, variants: {} };
  for (const variant of ['default', 'FULL']) {
    const name = `fs07-bl-${s.id}-${variant.toLowerCase()}`;
    const port = 34200 + SERVERS.indexOf(s) * 2 + (variant === 'FULL' ? 1 : 0);
    await sh(['docker', 'rm', '-f', name]);
    const flags = ['--log-bin=fs07bin', '--server-id=1', '--binlog-format=ROW', '--innodb-buffer-pool-size=64M', ...(variant === 'FULL' ? ['--binlog-row-metadata=FULL'] : [])];
    const env = s.family === 'mysql' ? 'MYSQL_ROOT_PASSWORD' : 'MARIADB_ROOT_PASSWORD';
    await sh(['docker', 'run', '-d', '--name', name, '-p', `127.0.0.1:${port}:3306`, '-e', `${env}=${PW}`, '-e', `${env.replace('ROOT_PASSWORD', 'ROOT_HOST')}=%`, s.image, ...flags]);
    let c: any = null;
    for (let i = 0; i < 90 && !c; i++) { try { c = await connect({ host: '127.0.0.1', port, user: 'root', password: PW }); } catch { await sleep(1000); } }
    if (!c) { out.variants[variant] = 'server did not start'; continue; }
    const v: any = {};
    v.binlog_row_metadata = (await c.rows("show variables like 'binlog_row_metadata'"))[0]?.[1] ?? '(variable absent)';
    v.binlog_format = (await c.rows("show variables like 'binlog_format'"))[0]?.[1];
    await c.query('create database fs07'); await c.query(DDL);
    await c.query("insert into fs07.bl values (1, 'é', 'y', b'101', 12.34, -5, 0x0102)");
    await c.query('flush logs');
    const logs = await c.rows('show binary logs');
    const first = String(logs[logs.length - 2]![0]); // the entrypoint's temporary server wrote the earlier file(s); ours is the one before the file opened by FLUSH LOGS
    const events = await c.rows(`show binlog events in '${first}'`);
    const norm = (x: any) => (Buffer.isBuffer(x) ? x.toString() : String(x));
    const evs = events.map((e: any[]) => e.map(norm));
    // size of an event = next event's Pos minus its own Pos (End_log_pos is 0 inside a group on MariaDB)
    v.tableMapEvent = evs.flatMap((e: string[], i: number) => (e[2] === 'Table_map' ? [{ pos: Number(e[1]), eventBytes: Number(evs[i + 1]![1]) - Number(e[1]), info: e[5] }] : []));
    v.gtidEventInfo = evs.find((e: string[]) => e[2] === 'Gtid')?.[5] ?? null;
    v.annotateRowsInfo = evs.find((e: string[]) => e[2] === 'Annotate_rows')?.[5] ?? null;
    v.eventTypesSeen = [...new Set(events.map((e: any[]) => norm(e[2])))];
    const bin = s.family === 'mysql' ? 'mysqlbinlog' : 'mariadb-binlog';
    const have = await sh(['docker', 'exec', name, 'sh', '-c', `command -v ${bin} || echo absent`]);
    if (have.endsWith('absent')) v.imageTool = `${bin} is not in the ${s.image} image`;
    else {
      const dump = await sh(['docker', 'exec', name, bin, '-vv', '--base64-output=DECODE-ROWS', `/var/lib/mysql/${first}`]);
      v.imageTool = bin;
      v.rowImageLines = dump.split('\n').filter((l) => l.startsWith('###')).slice(0, 12);
    }
    out.variants[variant] = v;
    await c.close();
    await sh(['docker', 'rm', '-f', name]);
  }
  save(`binlog/${s.id}.json`, out);
  console.log(s.id, Object.entries(out.variants).map(([k, v]: any) => `${k}: meta=${v.binlog_row_metadata} tableMapBytes=${v.tableMapEvent?.[0]?.eventBytes}`).join(' | '));
}
