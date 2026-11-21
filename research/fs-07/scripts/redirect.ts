// MariaDB server-initiated redirection (11.3+): redirect_url is carried to the client in the session-state tracker of an OK packet.
import { save, pick, root, tryErr, PW } from './lib.ts';
import { connect } from '../wire/connect.ts';

for (const s of pick().filter((x) => x.family === 'mariadb')) {
  const a = await root(s);
  const out: any = { server: s.id };
  const v = await tryErr(() => a.rows("show variables like 'redirect_url'"));
  out.variableRedirectUrl = v.ok ? (v.v.length ? 'exists' : 'absent') : v.error.slice(0, 80);
  const set = await tryErr(() => a.query("set global redirect_url = 'mariadb://127.0.0.1:34001'"));
  out.setGlobal = set.ok ? 'ok' : set.error.slice(0, 100);
  if (set.ok) {
    const c = await connect({ host: '127.0.0.1', port: s.port, user: 'root', password: PW });
    const dec = (b: Buffer) => b.toString('latin1').replace(/[^\x20-\x7e]/g, '·');
    out.stateInHandshakeOk = c.handshakeOk?.sessionState.map((e) => `${e.type}:${dec(e.data)}`) ?? [];
    const r = await c.query('select 1');
    out.stateInNextOk = r.kind === 'ok' ? r.sessionState.map((e) => `${e.type}:${dec(e.data)}`) : 'a result set (no OK packet)';
    await c.close();
    await a.query("set global redirect_url = ''");
  }
  await a.close();
  save(`redirect/${s.id}.json`, out);
  console.log(s.id, JSON.stringify(out));
}
