// Authentication matrix: which plugins each server loads by default, which it accepts once available,
// and what happens when the prototype and the two reference clients log in with a plain password.
import { save, pick, root, tryErr, PW, sleep, type Server } from './lib.ts';
import { startProxy } from './mytrace.ts';
import { connect } from '../wire/connect.ts';
import { mysql2, mariadbConnector } from './refs.ts';

type Plan = { plugin: string; setup?: string[]; create: (u: string) => string; note?: string; port?: number };
const my = (plugin: string, setup: string[] = []): Plan => ({ plugin, setup, create: (u) => `create user '${u}'@'%' identified with ${plugin} by 'pw-${plugin}'` });
const ma = (plugin: string, setup: string[] = [], using = `password('pw-${plugin}')`): Plan => ({ plugin, setup, create: (u) => `create user '${u}'@'%' identified via ${plugin} using ${using}` });

function plans(s: Server): Plan[] {
  if (s.family === 'mysql') {
    const ps = [my('caching_sha2_password'), my('sha256_password'), my('mysql_native_password')];
    if (s.id !== 'my84') ps.push({ ...my('mysql_native_password', ["install plugin mysql_native_password soname 'mysql_native_password.so'"]), note: 'after INSTALL PLUGIN' });
    return ps;
  }
  const ps = [ma('mysql_native_password'), ma('mysql_old_password'), ma('ed25519', ["install soname 'auth_ed25519'"]),
    ma('parsec', ["install soname 'auth_parsec'"]), ma('caching_sha2_password', ["install soname 'auth_mysql_sha2'"]), ma('unix_socket')];
  ps[1]!.create = (u) => `create user '${u}'@'%' identified via mysql_old_password using '606706156665cd86'`; // old_password('x'), see note
  ps[1]!.note = "hash of 'x' written literally: OLD_PASSWORD('x') = 606706156665cd86; the login uses password 'x'";
  ps[5]!.create = (u) => `create user '${u}'@'%' identified via unix_socket`;
  return ps;
}
const pwOf = (p: string) => `pw-${p}`;

async function refLogin(kind: 'mysql2' | 'mariadb', port: number, user: string, password: string, tls = false): Promise<string> {
  try {
    if (kind === 'mysql2') {
      const m = await mysql2();
      const c = await m.createConnection({ host: '127.0.0.1', port, user, password, ...(tls ? { ssl: { rejectUnauthorized: false } } : {}) });
      const [r] = await c.query('select current_user() as u'); await c.end(); return 'ok ' + r[0].u;
    }
    const m = await mariadbConnector();
    const c = await m.createConnection({ host: '127.0.0.1', port, user, password, allowPublicKeyRetrieval: true, ...(tls ? { ssl: { rejectUnauthorized: false } } : {}) });
    const r = await c.query('select current_user() as u'); await c.end(); return 'ok ' + r[0].u;
  } catch (e: any) { return 'refused: ' + String(e.message).split('\n')[0]!.slice(0, 160); }
}

async function waitFor(port: number) {
  for (let i = 0; i < 90; i++) { const r = await tryErr(async () => (await root({ port } as Server)).close()); if (r.ok) return; await sleep(1000); }
  throw new Error('server did not come up on ' + port);
}

async function runServer(s: Server, extra?: { suffix: string }) {
  const rows: any[] = [];
  const admin = await root(s);
  const defaults = await admin.rows("select plugin_name, plugin_status from information_schema.plugins where plugin_type='AUTHENTICATION' order by 1");
  let n = 0;
  for (const p of plans(s)) {
    const user = `fs07_a${++n}`;
    const entry: any = { plugin: p.plugin, note: p.note };
    await admin.queryAll(`drop user if exists '${user}'@'%'`);
    for (const sql of p.setup ?? []) { const r = await tryErr(() => admin.query(sql)); entry.setup = (entry.setup ?? []).concat([{ sql, result: r.ok ? 'ok' : r.error }]); }
    const cr = await tryErr(() => admin.query(p.create(user)));
    entry.create = cr.ok ? 'ok' : cr.error;
    if (!cr.ok) { rows.push(entry); continue; }
    entry.storedPlugin = (await admin.rows(`select plugin from mysql.user where user='${user}'`))[0]?.[0];
    const password = p.plugin === 'mysql_old_password' ? 'x' : pwOf(p.plugin);
    // prototype: through the trace proxy, twice (second login shows the caching_sha2 fast path), then wrong password, then over TLS
    const proxy = await startProxy({ host: '127.0.0.1', port: s.port });
    const attempts: any = {};
    for (const label of ['first', 'second']) {
      const r = await tryErr(async () => { const c = await connect({ host: '127.0.0.1', port: proxy.port, user, password }); const u = (await c.rows('select current_user()'))[0]![0]; await c.close(); return u; });
      attempts[label] = r.ok ? 'ok' : 'refused: ' + r.error.slice(0, 160);
    }
    const bad = await tryErr(async () => { const c = await connect({ host: '127.0.0.1', port: proxy.port, user, password: 'wrong' }); await c.close(); });
    attempts.wrongPassword = bad.ok ? 'ACCEPTED (unexpected)' : bad.error.slice(0, 160);
    await sleep(150);
    entry.authPacketKinds = proxy.traces().map((t) => ({ greetingPlugin: undefined, kinds: t.steps[0]!.s2c.map((x) => x.kind).join(','), switchTo: t.plugin ?? null, outcome: t.steps[0]!.outcome, errno: t.steps[0]!.errno ?? null }));
    await proxy.close();
    entry.prototype = attempts;
    entry.mysql2 = await refLogin('mysql2', s.port, user, password);
    entry.mariadbConnector = await refLogin('mariadb', s.port, user, password);
    const tlsP = await tryErr(async () => { const c = await connect({ host: '127.0.0.1', port: s.port, user, password, tls: { rejectUnauthorized: false } }); const i = c.tlsInfo; await c.close(); return i; });
    entry.overTls = {
      prototype: tlsP.ok ? 'ok ' + JSON.stringify(tlsP.v) : 'refused: ' + tlsP.error.slice(0, 160),
      mysql2: await refLogin('mysql2', s.port, user, password, true),
      mariadbConnector: await refLogin('mariadb', s.port, user, password, true),
    };
    await admin.queryAll(`drop user if exists '${user}'@'%'`);
    rows.push(entry);
  }
  await admin.close();
  return { id: s.id + (extra?.suffix ?? ''), defaultLoadedBeforeAnyInstall: defaults, plugins: rows };
}

for (const s of pick()) {
  const res = await runServer(s);
  save(`auth/${s.id}.json`, res);
  console.log(s.id, res.plugins.map((p: any) => `${p.plugin}:${p.prototype ? p.prototype.first.slice(0, 20) : p.create.slice(0, 40)}`).join(' | '));
}
// MySQL 8.4 with the deprecated plugin switched on at start-up, the only way it can be enabled there.
if (!process.env.SERVERS || process.env.SERVERS.includes('my84')) {
  const sp = Bun.spawn(['docker', 'run', '-d', '--rm', '--name', 'fs07-my84n', '-p', '127.0.0.1:34011:3306', '-e', `MYSQL_ROOT_PASSWORD=${PW}`, '-e', 'MYSQL_ROOT_HOST=%', 'mysql:8.4', '--mysql-native-password=ON', '--max-connections=100', '--innodb-buffer-pool-size=64M'], { stdout: 'ignore' });
  await sp.exited;
  await waitFor(34011);
  const s: Server = { id: 'my84', family: 'mysql', image: 'mysql:8.4', port: 34011 };
  const res = await runServer(s, { suffix: '-native-on' });
  save('auth/my84-native-on.json', res);
  console.log('my84-native-on', res.plugins.map((p: any) => `${p.plugin}:${p.prototype ? p.prototype.first.slice(0, 20) : p.create.slice(0, 40)}`).join(' | '));
  await Bun.spawn(['docker', 'rm', '-f', 'fs07-my84n'], { stdout: 'ignore' }).exited;
}
