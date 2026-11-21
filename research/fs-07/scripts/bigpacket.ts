// 16 MB packet splitting, both directions, through the trace proxy (own parser sees the physical packets).
//  client -> server: a COM_QUERY whose payload is just over 2^24-1 bytes; server -> client: one row value just over 2^24-1 bytes.
//  Also the exact-multiple case: a payload of exactly 0xFFFFFF bytes must be followed by an empty packet.
import { save, pick, root, tryErr, PW } from './lib.ts';
import { startProxy } from './mytrace.ts';
import { connect } from '../wire/connect.ts';
import { COM } from '../wire/shared/constants.ts';
import { MAX_PAYLOAD } from '../wire/shared/packet.ts';

for (const s of pick()) {
  const a = await root(s);
  const defaultMax = String((await a.rows("show variables like 'max_allowed_packet'"))[0]![1]);
  await a.query('set global max_allowed_packet = 134217728'); // the default is smaller on MariaDB; raised so the split itself can be observed
  await a.close();
  const px = await startProxy({ host: '127.0.0.1', port: s.port });
  const c = await connect({ host: '127.0.0.1', port: px.port, user: 'root', password: PW });
  const out: any = { server: s.id, defaultMaxAllowedPacketBeforeTest: defaultMax };
  const lenStr = (n: number) => `select length('${'x'.repeat(n)}')`;
  // payload = 1 (command byte) + sql; choose sql so the payload is exactly 0xFFFFFF, then one byte more
  const sqlOf = (payload: number) => { const base = lenStr(0).length; return lenStr(payload - 1 - base); };
  for (const [label, payload] of [['client payload exactly 0xFFFFFF', MAX_PAYLOAD], ['client payload 0xFFFFFF + 1', MAX_PAYLOAD + 1], ['client payload 2 x 0xFFFFFF', 2 * MAX_PAYLOAD]] as const) {
    const sql = sqlOf(payload);
    const r = await tryErr(async () => (await c.queryAll(sql))[0]!);
    out[label] = r.ok ? (r.v.kind === 'rows' ? `ok, server counted ${r.v.rows[0]![0]} bytes` : r.v.kind === 'err' ? `ERR ${r.v.errno} ${r.v.message.slice(0, 60)}` : r.v.kind) : r.error.slice(0, 100);
    if (!r.ok) break;
  }
  const rr = await tryErr(async () => (await c.queryAll(`select repeat('y', ${MAX_PAYLOAD + 5})`))[0]!);
  out['server row value 0xFFFFFF + 5 bytes'] = rr.ok ? (rr.v.kind === 'rows' ? `ok, client received ${(rr.v.rows[0]![0] as string).length} bytes` : rr.v.kind === 'err' ? `ERR ${rr.v.errno}` : rr.v.kind) : rr.error.slice(0, 100);
  const re = await tryErr(async () => (await c.queryAll(`select repeat('z', ${MAX_PAYLOAD - 9})`))[0]!);
  out['server row packet of exactly 0xFFFFFF payload bytes'] = re.ok ? (re.v.kind === 'rows' ? `ok, ${(re.v.rows[0]![0] as string).length} bytes` : re.v.kind) : re.error.slice(0, 100);
  await new Promise((r) => setTimeout(r, 500));
  const t = px.traces()[0]!;
  // physical packets seen by the proxy's own splitter: lengths of the c2s / s2c packets with length 0xFFFFFF or 0
  const phys = t.raw.filter((p) => p.len === 0xffffff || p.len === 0 || p.len > 0xffffff);
  out.proxyLogicalPacketsOver16MB = t.raw.filter((p) => p.len >= 0xffffff).map((p) => ({ dir: p.dir, seq: p.seq, logicalBytes: p.len }));
  void phys;
  c.destroy(); await px.close();
  const a2 = await root(s); await a2.query(`set global max_allowed_packet = ${defaultMax}`); await a2.close();
  save(`bigpacket/${s.id}.json`, out);
  console.log(s.id, JSON.stringify(out).slice(0, 420));
}
