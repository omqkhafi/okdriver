// Wire comparison matrix (prototype across the servers) and golden traces (reference clients and CLIs).
import { save, pick, root, tryErr, PW, sleep, cli, type Server, SERVERS } from './lib.ts';
import { startProxy, type ConnTrace } from './mytrace.ts';
import { connect } from '../wire/connect.ts';
import { maskStep } from './mask.ts';
import { mysql2, mariadbConnector, REF_VERSIONS } from './refs.ts';

type Op = { name: string; kind: 'text' | 'prep' | 'ping' | 'reset'; sql?: string; params?: any[] };

export const OPS: Op[] = [
  { name: 'ok-do', kind: 'text', sql: 'do 1' },
  { name: 'rs-basic', kind: 'text', sql: "select 1 as a, 'x' as b, null as c" },
  { name: 'rs-types', kind: 'text', sql: "select cast(7 as signed) i, cast(7 as unsigned) u, 1.5 d, 1e0 f, _utf8mb4'é' s, _binary'ab' bin, cast('2020-01-02' as date) dt, cast('2020-01-02 03:04:05.5' as datetime(6)) dtm, cast('838:59:59' as time) tm, b'101' bt, json_object('a', 1) js" },
  { name: 'ddl-drop', kind: 'text', sql: 'drop table if exists fs07.t1' },
  { name: 'ddl-create', kind: 'text', sql: 'create table fs07.t1 (id bigint unsigned primary key auto_increment, v varchar(20), d decimal(10,2), ts datetime(6), j json)' },
  { name: 'ok-insert', kind: 'text', sql: "insert into fs07.t1 (v, d, ts, j) values ('a', 1.25, '2020-01-02 03:04:05.123456', '{\"k\": [1, 2]}'), ('b', null, null, null)" },
  { name: 'rs-table', kind: 'text', sql: 'select * from fs07.t1 order by id' },
  { name: 'ok-update', kind: 'text', sql: "update fs07.t1 set v = 'z' where id = 1" },
  { name: 'ps-select', kind: 'prep', sql: 'select id, v, d, ts, j from fs07.t1 where id > ? and v <> ? order by id', params: [0, 'q'] },
  { name: 'ps-insert', kind: 'prep', sql: 'insert into fs07.t1 (v) values (?)', params: ['pp'] },
  { name: 'ping', kind: 'ping' },
  { name: 'reset', kind: 'reset' },
  { name: 'err-table', kind: 'text', sql: 'select * from fs07.no_such_table' },
  { name: 'err-syntax', kind: 'text', sql: 'selec 1' },
  { name: 'ok-autocommit', kind: 'text', sql: 'set autocommit = 0' },
  { name: 'rs-after-set', kind: 'text', sql: 'select @@autocommit' },
];

async function protoRun(port: number, extra: Record<string, any> = {}): Promise<void> {
  const c = await connect({ host: '127.0.0.1', port, user: 'root', password: PW, database: 'fs07', ...extra });
  for (const op of OPS) {
    if (op.kind === 'text') await c.queryAll(op.sql!);
    else if (op.kind === 'ping') await c.ping();
    else if (op.kind === 'reset') { await c.resetConnection(); await c.queryAll('use fs07'); }
    else { const st = await c.prepare(op.sql!); await st.executeAll(op.params!); await st.reset(); await st.executeAll(op.params!); await st.close(); }
  }
  await c.close();
}

async function setup(s: Server) {
  const c = await root(s);
  await c.query('create database if not exists fs07');
  await c.close();
}

function groupSteps(perServer: Record<string, ConnTrace>) {
  const ids = Object.keys(perServer);
  const nSteps = Math.max(...ids.map((i) => perServer[i]!.steps.length));
  const rows: any[] = [];
  for (let i = 0; i < nSteps; i++) {
    const classes = new Map<string, string[]>();
    const label = perServer[ids[0]!]!.steps[i]?.label ?? '?';
    const detail: Record<string, any> = {};
    for (const id of ids) {
      const st = perServer[id]!.steps[i];
      if (!st) continue;
      const m = maskStep(st);
      const key = JSON.stringify([m.c2s, m.s2c]);
      (classes.get(key) ?? classes.set(key, []).get(key)!).push(id);
      detail[id] = m;
    }
    const groups = [...classes.values()];
    // describe the first difference between the first two classes
    let diff: any = null;
    if (groups.length > 1) {
      const a = detail[groups[0]![0]!], b = detail[groups[1]![0]!];
      const pk = (x: any) => [...x.c2s.map((h: string) => ({ kind: 'C', hex: h })), ...x.s2c];
      const pa = pk(a), pb = pk(b);
      for (let k = 0; k < Math.max(pa.length, pb.length); k++) {
        if (pa[k]?.hex !== pb[k]?.hex) {
          const ha: string = pa[k]?.hex ?? '', hb: string = pb[k]?.hex ?? '';
          let j = 0; while (j < ha.length && ha[j] === hb[j]) j++;
          diff = { packetIndex: k, kindA: pa[k]?.kind, kindB: pb[k]?.kind, firstDifferingByte: j >> 1, a: ha.slice(Math.max(0, j - 8), j + 24), b: hb.slice(Math.max(0, j - 8), j + 24), classCount: groups.length };
          break;
        }
      }
    }
    const sample = detail[ids[0]!];
    rows.push({ step: i, label, sql: perServer[ids[0]!]!.steps[i]?.sql, identicalAcrossAll: groups.length === 1, groups, diff, packetKinds: sample ? sample.s2c.map((p: any) => p.kind).join(',') : '' });
  }
  return rows;
}

const mode = process.argv[2] ?? 'all';
const servers = pick();
const traces: Record<string, ConnTrace> = {};
if (mode === 'all' || mode === 'matrix') {
  for (const s of servers) {
    await setup(s);
    const px = await startProxy({ host: '127.0.0.1', port: s.port });
    await protoRun(px.port);
    await sleep(200);
    traces[s.id] = px.traces()[0]!;
    save(`wire/trace-summary/${s.id}.json`, px.traces()[0]!.steps.map((st) => ({ idx: st.idx, label: st.label, sql: st.sql, outcome: st.outcome, errno: st.errno, kinds: st.s2c.map((x) => x.kind).join(','), c2sBytes: st.c2s.reduce((n, x) => n + x.hex.length / 2, 0), s2cBytes: st.s2c.reduce((n, x) => n + x.hex.length / 2, 0) })));
    await px.close();
    console.log('matrix', s.id, traces[s.id]!.steps.length, 'steps');
  }
  // label steps with the op names: step 0 is greeting+auth, then one step per command in order
  const rows = groupSteps(traces);
  const out = rows.map((r) => ({ ...r }));
  save('wire/matrix.json', { servers: servers.map((s) => s.id), rows: out });
  const md: string[] = ['| step | command | result shape | identical on all servers | classes |', '| --- | --- | --- | --- | --- |'];
  for (const r of rows) md.push(`| ${r.step} | ${r.label}${r.sql ? ' `' + r.sql.replace(/\|/g, '\\|').slice(0, 50) + '`' : ''} | ${r.packetKinds.slice(0, 60)} | ${r.identicalAcrossAll ? 'yes' : 'NO'} | ${r.identicalAcrossAll ? '' : r.groups.map((g: string[]) => g.join('+')).join(' / ')} |`);
  save('wire/matrix.md', md.join('\n') + '\n');
  save('wire/matrix-raw.json', { note: 'masked packet hex for one representative of each class, per step', rows: rows.map((r) => ({ step: r.step, label: r.label, classes: r.groups.map((g: string[]) => ({ servers: g, c2s: maskStep(traces[g[0]!]!.steps[r.step]!).c2s.map((h) => h.slice(0, 400)), s2c: maskStep(traces[g[0]!]!.steps[r.step]!).s2c.map((p) => ({ kind: p.kind, hex: p.hex.slice(0, 400) })) })) })) });
}

if (mode === 'all' || mode === 'golden') {
  const golden: any = { refVersions: REF_VERSIONS(), servers: {} as any };
  const textOps = OPS.filter((o) => o.kind === 'text') as (Op & { sql: string })[];
  for (const s of servers) {
    await setup(s);
    const per: Record<string, ConnTrace | null> = {};
    // prototype
    { const px = await startProxy({ host: '127.0.0.1', port: s.port }); await protoRun(px.port); await sleep(150); per.prototype = px.traces()[0]!; await px.close(); }
    // prototype with the capability set matched to each reference client, so shape differences are not capability artefacts
    { const px = await startProxy({ host: '127.0.0.1', port: s.port }); await protoRun(px.port, { deprecateEof: false }); await sleep(150); per['prototype(no DEPRECATE_EOF)'] = px.traces()[0]!; await px.close(); }
    if (s.family === 'mariadb') { const px = await startProxy({ host: '127.0.0.1', port: s.port }); await protoRun(px.port, { extCaps: 16 }); await sleep(150); per['prototype(+CACHE_METADATA)'] = px.traces()[0]!; await px.close(); }
    // mysql2
    { const px = await startProxy({ host: '127.0.0.1', port: s.port }); const m = await mysql2();
      const r = await tryErr(async () => { const c = await m.createConnection({ host: '127.0.0.1', port: px.port, user: 'root', password: PW, database: 'fs07', rowsAsArray: true });
        for (const op of OPS) { if (op.kind === 'text') await c.query(op.sql).catch(() => {}); else if (op.kind === 'ping') await c.ping(); else if (op.kind === 'prep') { await c.execute(op.sql, op.params); await c.execute(op.sql, op.params); await c.unprepare(op.sql); } }
        await c.end(); });
      await sleep(150); per.mysql2 = px.traces()[0] ?? null; if (!r.ok) golden.servers[s.id + '.mysql2.error'] = r.error; await px.close(); }
    // MariaDB Connector/Node.js
    { const px = await startProxy({ host: '127.0.0.1', port: s.port }); const m = await mariadbConnector();
      const r = await tryErr(async () => { const c = await m.createConnection({ host: '127.0.0.1', port: px.port, user: 'root', password: PW, database: 'fs07', rowsAsArray: true, allowPublicKeyRetrieval: true });
        for (const op of OPS) { if (op.kind === 'text') await c.query(op.sql).catch(() => {}); else if (op.kind === 'ping') await c.ping(); else if (op.kind === 'reset') await c.reset(); else { await c.execute(op.sql, op.params); await c.execute(op.sql, op.params); } }
        await c.end(); });
      await sleep(150); per.mariadb = px.traces()[0] ?? null; if (!r.ok) golden.servers[s.id + '.mariadb.error'] = r.error; await px.close(); }
    // the image's own CLI (a text-only client), run in a throwaway container on the host network
    { const px = await startProxy({ host: '127.0.0.1', port: s.port });
      const bin = s.family === 'mysql' ? 'mysql' : 'mariadb';
      const script = textOps.map((o) => o.sql).join(';\n') + ';';
      const p = Bun.spawn(['docker', 'run', '--rm', '--network', 'host', '--entrypoint', bin, s.image, '-h127.0.0.1', `-P${px.port}`, '-uroot', `-p${PW}`, s.family === 'mysql' ? '--ssl-mode=DISABLED' : '--skip-ssl', '--force', '--batch', 'fs07', '-e', script], { stdout: 'pipe', stderr: 'pipe' });
      await p.exited; await sleep(150); per.cli = px.traces()[0] ?? null; await px.close(); }
    const rowsOut: any[] = [];
    for (const [client, t] of Object.entries(per)) {
      if (client.startsWith('prototype') || !t) continue;
      const mine = (client === 'mysql2' ? per['prototype(no DEPRECATE_EOF)'] : client === 'mariadb' && per['prototype(+CACHE_METADATA)'] ? per['prototype(+CACHE_METADATA)'] : per.prototype)!;
      const protoSteps = mine.steps.slice(1);
      const hs = t.steps[0]!;
      rowsOut.push({ client, handshake: { matchedPrototypeRun: Object.keys(per).find((k) => per[k] === mine), clientCaps: '0x' + (t.clientCaps ?? 0).toString(16), protoCaps: '0x' + (mine.clientCaps ?? 0).toString(16), clientExt: t.clientExt, protoExt: mine.clientExt, tls: t.tls, deprecateEof: t.deprecateEof, authOutcome: hs.outcome } });
      // compare per command: first reference step with the same label and sql
      const used = new Set<number>();
      for (const ps of protoSteps) {
        if (ps.label === 'COM_QUIT') continue;
        const bare = (x: string | undefined) => (x ?? '').replace(/^\u0000\u0001/, ''); // CLIENT_QUERY_ATTRIBUTES prefix (parameter count 0, set count 1)
        const idx = t.steps.findIndex((x, k) => k > 0 && !used.has(k) && x.label === ps.label && bare(x.sql) === bare(ps.sql));
        if (idx < 0) { rowsOut.push({ client, label: ps.label, sql: ps.sql?.slice(0, 40), result: 'not sent by this client' }); continue; }
        used.add(idx);
        const rs = t.steps[idx]!;
        const attrPrefix = (ps.label === 'COM_QUERY' || ps.label === 'COM_STMT_PREPARE') && rs.c2s[0]!.hex === ps.c2s[0]!.hex.slice(0, 2) + (ps.label === 'COM_QUERY' ? '0001' : '') + ps.c2s[0]!.hex.slice(2) && ps.label === 'COM_QUERY';
        // statement ids are per connection and differ between clients; they are masked when comparing (the reference's id is reported)
        const stmtOp = ['COM_STMT_EXECUTE', 'COM_STMT_CLOSE', 'COM_STMT_RESET', 'COM_STMT_FETCH'].includes(ps.label);
        const unid = (h: string) => (stmtOp ? h.slice(0, 2) + '<id>' + h.slice(10) : h);
        const refId = stmtOp ? rs.c2s[0]!.hex.slice(2, 10) : null;
        const same = unid(rs.c2s[0]!.hex) === unid(ps.c2s[0]!.hex) || attrPrefix;
        const row: any = { client, label: ps.label, sql: ps.sql?.slice(0, 40), requestBytesEqual: same, ...(attrPrefix ? { note: 'identical apart from the 2-byte CLIENT_QUERY_ATTRIBUTES prefix (00 01) before the SQL' } : {}), serverReplyKinds: rs.s2c.map((x) => x.kind).join(',') === ps.s2c.map((x) => x.kind).join(',') ? 'same shape' : 'DIFFERENT SHAPE' };
        if (refId === 'ffffffff') row.note = 'reference used the placeholder statement id 0xFFFFFFFF (prepare-and-execute without waiting)';
        if (!same) { row.prototypeHex = ps.c2s[0]!.hex.slice(0, 160); row.clientHex = rs.c2s[0]!.hex.slice(0, 160); }
        rowsOut.push(row);
      }
      // commands the reference sent that the prototype did not
      for (const [k, x] of t.steps.entries()) if (k > 0 && !used.has(k) && x.label !== 'COM_QUIT') rowsOut.push({ client, label: x.label, sql: x.sql?.slice(0, 40), result: 'only sent by this client' });
    }
    golden.servers[s.id] = rowsOut;
    console.log('golden', s.id, rowsOut.length);
  }
  save('wire/golden.json', golden);
}
