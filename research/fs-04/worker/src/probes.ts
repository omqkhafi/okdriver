// Probe catalogue. Each probe returns raw observations; the harness decides pass or fail from server-side truth.
// Web APIs only: the same file runs in workerd and, with a node:net adapter, under Bun as the control.
import { Conn, errInfo, sleep, withTimeout, type ConnectFn } from './sock.ts';
import { PgFail, bigBind, bigCopy, cancelRequest, collect, login, openPg, simple, sslRequest, terminateAndClose, type LoginInfo, type Target } from './pg.ts';
import { query } from './wire.ts';
import { myLogin, myOpen, myQuery, myQuit, type MyConn } from './mysql.ts';

export interface Ctx {
  connect: ConnectFn;
  target(name: string): Target;
  runId: string;
  globals: Record<string, any>;
  moduleKeys: string[];
}
type P = Record<string, any>;
const ms = () => Math.round(performance.now() * 100) / 100;

export function surfaceOf(o: unknown): string[] {
  const names = new Set<string>();
  let p: any = o;
  while (p && p !== Object.prototype && p !== Function.prototype) { for (const k of Reflect.ownKeys(p)) names.add(String(k)); p = Object.getPrototypeOf(p); }
  return [...names].sort();
}
const shape = (v: unknown): unknown => {
  if (v === null || v === undefined) return String(v);
  if (typeof v !== 'object') return typeof v;
  return Object.fromEntries(Reflect.ownKeys(v as object).map((k) => [String(k), typeof (v as any)[k]]));
};

interface UpgradeOut { ok: boolean; releaseError?: unknown; writerReleaseError?: unknown; cancelError?: unknown; startTlsError?: unknown; syncThrow: boolean }
const await_ = (p: Promise<unknown>) => { p.catch(() => { /* reported through the pending read */ }); };
/** startTls with a chosen lock situation. The default releases both locks like a driver must. */
function doStartTls(c: Conn, p: P): UpgradeOut {
  const mode: string = p.lockMode ?? 'both-released';
  const out: UpgradeOut = { ok: false, syncThrow: false };
  try {
    if (mode === 'both-released') c.releaseLocks('both');
    else if (mode === 'reader-held') c.releaseLocks('writer');
    else if (mode === 'writer-held') c.releaseLocks('reader');
    else if (mode === 'read-pending' || mode === 'cancel-pending') {
      const pr = c.reader.read(); pr.then(() => { /* settled */ }, () => { /* rejected on release */ });
      (c as any).__pendingProbe = pr;
      if (mode === 'cancel-pending') { try { await_(c.reader.cancel()); } catch (e) { out.cancelError = errInfo(e); } }
      try { c.reader.releaseLock(); } catch (e) { out.releaseError = errInfo(e); }
      try { c.writer.releaseLock(); } catch (e) { out.writerReleaseError = errInfo(e); }
    } // 'none-released' keeps both locks
  } catch (e) { out.releaseError = errInfo(e); }
  try {
    const s = c.sock.startTls(p.startTlsOpts);
    c.sock = s; c.tls = true; c.buf = new Uint8Array(0); c.eof = false;
    try { c.lock(); } catch (e) { out.releaseError ??= errInfo(e); }
    out.ok = true;
  } catch (e) { out.syncThrow = true; out.startTlsError = errInfo(e); }
  return out;
}

async function afterLogin(c: Conn, obs: P, appName: string, t: Target): Promise<LoginInfo | null> {
  try {
    const li = await login(c, t, appName);
    obs.login = { ok: true, pid: li.pid, mechs: li.mechs, authCodes: li.authCodes, serverVersion: li.params.server_version };
    const r = await simple(c, 'select ssl, version, cipher from pg_stat_ssl where pid = pg_backend_pid()');
    obs.pgStatSsl = r.rows[0] ?? null;
    const q = await simple(c, 'select 1, current_setting(\'ssl\')');
    obs.query = { ok: !q.error && q.rows[0]?.[0] === '1', rows: q.rows, error: q.error };
    return li;
  } catch (e) { obs.login = { ok: false, error: errInfo(e), code: e instanceof PgFail ? e.code : undefined }; return null; }
}

/** p1.tls-upgrade (also p2.options): SSLRequest, startTls, SCRAM, queries. Variants come in as params. */
async function tlsUpgrade(ctx: Ctx, p: P): Promise<unknown> {
  const t = ctx.target(p.target);
  for (const k of ['startTlsOpts', 'connectOpts']) if (p[k]?.expectedServerHostname === '$HOST') p[k] = { ...p[k], expectedServerHostname: t.host }; // keeps the host name out of the request
  const obs: P = { steps: [] as string[] };
  const app = `fs04-${ctx.runId}`;
  let c: Conn;
  try { c = await openPg(ctx.connect, t, { secureTransport: 'starttls', hostname: p.hostname, connectOpts: p.connectOpts }); } catch (e) { return { connectError: errInfo(e) }; }
  try {
    try { obs.opened = shape(await withTimeout(c.sock.opened, 10000, 'opened')); } catch (e) { obs.openedError = errInfo(e); }
    await c.write(sslRequest());
    const ans = await c.readExact(1, 10000);
    obs.answer = String.fromCharCode(ans[0]!);
    obs.leftoverAfterAnswer = c.buf.length;
    obs.bytesWrittenBeforeSwitch = c.written; obs.bytesReadBeforeSwitch = c.received;
    if (obs.answer === 'S' || p.upgradeAfterN) {
      const t0 = ms();
      obs.upgrade = doStartTls(c, p);
      obs.upgradeCallMs = ms() - t0;
      const pend = (c as any).__pendingProbe as Promise<unknown> | undefined;
      if (pend) obs.pendingReadSettled = await Promise.race([pend.then((v) => ({ resolved: shape(v) }), (e) => ({ rejected: errInfo(e) })), sleep(300).then(() => 'still-pending')]);
    }
    if (obs.upgrade?.syncThrow) { /* nothing more to do on a socket that refused */ }
    else {
      await afterLogin(c, obs, app, t);
      if (p.second && obs.login?.ok) {
        // second startTls on the upgraded socket, then check whether the connection still works
        try { c.releaseLocks('both'); const s2 = c.sock.startTls(p.startTlsOpts); obs.secondStartTls = { returned: true, sameObject: s2 === c.sock }; } catch (e) { obs.secondStartTls = { error: errInfo(e) }; }
        try { c.lock(); const q = await simple(c, 'select 2'); obs.afterSecond = { ok: q.rows[0]?.[0] === '2' }; } catch (e) { obs.afterSecond = { error: errInfo(e) }; }
      }
    }
  } catch (e) { obs.error = errInfo(e); }
  obs.bytesWritten = c.written; obs.bytesReceived = c.received;
  await terminateAndClose(c);
  return obs;
}

/** p1.direct-tls: secureTransport "on" from the first byte. */
async function directTls(ctx: Ctx, p: P): Promise<unknown> {
  const t = ctx.target(p.target);
  const obs: P = {};
  const c = await openPg(ctx.connect, t, { secureTransport: 'on', hostname: p.hostname, connectOpts: p.connectOpts });
  try {
    try { obs.opened = shape(await withTimeout(c.sock.opened, 10000, 'opened')); } catch (e) { obs.openedError = errInfo(e); }
    await afterLogin(c, obs, `fs04-${ctx.runId}`, t);
  } catch (e) { obs.error = errInfo(e); }
  await terminateAndClose(c);
  return obs;
}

/** p2.surface: the full Socket surface of the running build, before and after the upgrade. */
async function surface(ctx: Ctx, p: P): Promise<unknown> {
  const t = ctx.target(p.target);
  const c = await openPg(ctx.connect, t, { secureTransport: 'starttls', hostname: p.hostname });
  const obs: P = { moduleExports: ctx.moduleKeys };
  const members = (s: any) => ({
    socket: surfaceOf(s), readable: surfaceOf(s.readable), writable: surfaceOf(s.writable),
    startTlsLength: typeof s.startTls === 'function' ? s.startTls.length : null,
    scalar: Object.fromEntries(surfaceOf(s).filter((k) => !['readable', 'writable', 'opened', 'closed'].includes(k)).map((k) => { try { const v = (s as any)[k]; return [k, typeof v === 'function' ? 'function' : typeof v === 'object' ? shape(v) : v]; } catch (e) { return [k, 'throws ' + errInfo(e).message]; } })),
  });
  try {
    obs.before = members(c.sock);
    try { const o = await withTimeout(c.sock.opened, 10000, 'opened'); obs.openedInfoKeys = shape(o); obs.openedInfoTypes = o && typeof o === 'object' ? Object.fromEntries(Object.entries(o as any).map(([k, v]) => [k, typeof v])) : null; } catch (e) { obs.openedError = errInfo(e); }
    await c.write(sslRequest()); await c.readExact(1);
    const old = c.sock as any;
    const up = doStartTls(c, {});
    obs.upgraded = up.ok;
    if (up.ok) obs.oldSocket = { upgraded: old.upgraded, secureTransport: old.secureTransport, readableLocked: old.readable.locked, writableLocked: old.writable.locked, closed: await Promise.race([old.closed.then(() => 'resolved', (e: unknown) => 'rejected: ' + errInfo(e).message), sleep(300).then(() => 'pending')]) };
    if (up.ok) {
      obs.after = members(c.sock);
      try { const o = await withTimeout(c.sock.opened, 10000, 'opened'); obs.openedInfoAfter = shape(o); } catch (e) { obs.openedAfterError = errInfo(e); }
      // names a driver would look for to get the peer certificate
      const probeNames = ['peerCertificate', 'getPeerCertificate', 'getCertificate', 'certificate', 'cert', 'tlsInfo', 'info', 'getProtocol', 'getCipher', 'tlsSocket', 'upgraded', 'secureTransport', 'remoteAddress', 'localAddress', 'alpnProtocol'];
      obs.candidateMembers = Object.fromEntries(probeNames.map((k) => [k, k in (c.sock as any) ? typeof (c.sock as any)[k] : 'absent']));
    }
  } catch (e) { obs.error = errInfo(e); }
  await c.close();
  return obs;
}

/** p2.writable-types: which chunk types the socket's WritableStream accepts (fresh socket per type). */
async function writableTypes(ctx: Ctx, p: P): Promise<unknown> {
  const t = ctx.target(p.target);
  const sample = () => sslRequest();
  const kinds: Record<string, () => unknown> = {
    string: () => 'abc', arrayBuffer: () => sample().buffer.slice(0), uint8Array: sample, uint8Subarray: () => { const b = new Uint8Array(16); b.set(sample(), 4); return b.subarray(4, 12); },
    dataView: () => new DataView(sample().buffer.slice(0)), uint16Array: () => new Uint16Array(4), number: () => 7,
  };
  const out: P = {};
  for (const [k, mk] of Object.entries(kinds)) {
    const c = await openPg(ctx.connect, t, { secureTransport: 'starttls' });
    try { await withTimeout(c.sock.opened, 10000, 'opened'); await c.writer.write(mk() as any); out[k] = 'accepted'; await sleep(150); } catch (e) { out[k] = 'rejected: ' + errInfo(e).message; }
    await c.close();
  }
  return out;
}

/** p7.blocked: connect() to addresses a platform may refuse; records how each attempt ends. */
async function blocked(ctx: Ctx, p: P): Promise<unknown> {
  const out: P[] = [];
  for (const a of p.addrs as { label: string; hostname: string; port: number; str?: string }[]) {
    const rec: P = { label: a.label }; const t0 = ms();
    try { const s: any = a.str ? ctx.connect(a.str as any) : ctx.connect({ hostname: a.hostname, port: a.port }, { secureTransport: 'off' }); const info = await withTimeout(s.opened, p.timeoutMs ?? 3000, 'opened'); rec.opened = true; rec.secureTransport = s.secureTransport; rec.infoKeys = Object.keys(info as object); try { await s.close(); } catch { /* ignore */ } }
    catch (e) { rec.error = errInfo(e); }
    rec.ms = Math.round(ms() - t0); out.push(rec);
  }
  return out;
}

/** p1.starttls-misuse: startTls() on a socket that was not created with secureTransport "starttls". */
async function startTlsMisuse(ctx: Ctx, p: P): Promise<unknown> {
  const t = ctx.target(p.target);
  const c = await openPg(ctx.connect, t, { secureTransport: p.mode });
  const obs: P = { mode: p.mode };
  try {
    c.releaseLocks('both');
    try { const s = c.sock.startTls(); obs.startTls = { returned: true, sameObject: s === c.sock }; } catch (e) { obs.startTls = { threw: errInfo(e) }; }
  } catch (e) { obs.error = errInfo(e); }
  await c.close();
  return obs;
}

/** p3.write: large Bind parameter or COPY, single write or chunked. */
async function largeWrite(ctx: Ctx, p: P): Promise<unknown> {
  const t = ctx.target(p.target);
  const obs: P = { size: p.size, mode: p.mode, how: p.how ?? 'bind', chunk: p.chunk, tls: !!p.tls };
  let c: Conn;
  try { c = await openPg(ctx.connect, t, { secureTransport: p.tls ? 'starttls' : 'off', hostname: p.hostname }); } catch (e) { return { ...obs, connectError: errInfo(e) }; }
  try {
    await withTimeout(c.sock.opened, 10000, 'opened');
    if (p.tls) { await c.write(sslRequest()); const a = await c.readExact(1); if (a[0] !== 0x53) throw new Error('server did not answer S'); const u = doStartTls(c, {}); if (!u.ok) throw new Error('startTls failed'); }
    const li = await login(c, t, `fs04-${ctx.runId}`);
    obs.pid = li.pid;
    const t0 = ms();
    try {
      if (obs.how === 'copy') {
        await simple(c, 'create temp table fs04_t(payload bytea)');
        const w = await bigCopy(c, 'fs04_t', p.size, p.seed, p.chunk);
        obs.write = { writeMs: w.writeMs, writes: w.writes }; obs.copy = w.result;
        const r = await simple(c, "select encode(sha256(payload),'hex'), length(payload) from fs04_t", 60000);
        obs.pg = r.rows[0] ?? null; obs.pgError = r.error;
      } else {
        const w = await bigBind(c, p.size, p.seed, p.mode, p.chunk, p.awaitEach ?? true);
        obs.write = w;
        const r = await collect(c, 120000);
        obs.pg = r.rows[0] ?? null; obs.pgError = r.error;
      }
    } catch (e) { obs.writeError = errInfo(e); }
    obs.totalMs = ms() - t0;
  } catch (e) { obs.error = errInfo(e); }
  obs.bytesWritten = c.written;
  await terminateAndClose(c);
  return obs;
}

/** p3.backpressure: records writer.ready / desiredSize while the proxy stops reading. */
async function backpressure(ctx: Ctx, p: P): Promise<unknown> {
  const t = ctx.target(p.target);
  const c = await openPg(ctx.connect, t, { secureTransport: 'off' });
  const obs: P = { size: p.size, chunk: p.chunk, awaitReady: !!p.awaitReady, timeline: [] as any[] };
  try {
    await withTimeout(c.sock.opened, 10000, 'opened');
    await login(c, t, `fs04-${ctx.runId}`);
    const { bindByteaParts, fillPayload } = await import('./payload.ts');
    const { parse, execute, sync, u8 } = await import('./wire.ts');
    const parts = bindByteaParts(p.size);
    await c.write(u8(parse('', "select encode(sha256($1::bytea),'hex'), length($1::bytea)", [17]), parts.head));
    const t0 = ms(); let queued = 0, resolved = 0, pendingReady = 0, longestReadyMs = 0; let n = 0; const writes: Promise<void>[] = [];
    for (let off = 0; off < p.size; off += p.chunk) {
      const len = Math.min(p.chunk, p.size - off); const b = new Uint8Array(len); fillPayload(b, p.seed, off);
      const d = c.writer.desiredSize;
      if (p.awaitReady) {
        if (d !== null && d <= 0) pendingReady++;
        const r0 = ms(); await c.writer.ready; longestReadyMs = Math.max(longestReadyMs, ms() - r0);
      }
      c.written += len; queued++;
      writes.push(c.writer.write(b).then(() => { resolved++; }));
      if (n++ % 8 === 0 || (d !== null && d <= 0 && n % 2 === 0)) obs.timeline.push({ t: ms() - t0, queued, resolved, desiredSize: c.writer.desiredSize });
      if (obs.timeline.length > 400) obs.timeline.splice(1, 1);
    }
    obs.afterLoopMs = ms() - t0; obs.afterLoop = { queued, resolved, desiredSize: c.writer.desiredSize };
    await sleep(p.midStallMs ?? 1500); // the proxy is still stalled here
    obs.midStall = { at: ms() - t0, queued, resolved, desiredSize: c.writer.desiredSize, acceptedBytes: resolved * p.chunk };
    await Promise.all(writes); obs.allWritesResolvedMs = ms() - t0; obs.pendingReady = pendingReady; obs.longestReadyMs = longestReadyMs;
    await c.write(u8(parts.tail, execute('', 0), sync()));
    const r = await collect(c, 120000); obs.pg = r.rows[0] ?? null; obs.pgError = r.error;
  } catch (e) { obs.error = errInfo(e); }
  await terminateAndClose(c);
  return obs;
}

/** p4.concurrent: n sockets from one invocation, all logged in and held. */
async function concurrent(ctx: Ctx, p: P): Promise<unknown> {
  const t = ctx.target(p.target);
  const t0 = ms();
  const items = Array.from({ length: p.n }, (_, k) => (async () => {
    const rec: P = { k, connectCalledAt: ms() - t0 };
    let c: Conn | null = null;
    try {
      c = await openPg(ctx.connect, t, { secureTransport: 'off' });
      await withTimeout(c.sock.opened, p.openTimeoutMs ?? 60000, 'opened'); rec.openedAt = ms() - t0;
      const li = await login(c, t, `fs04-${ctx.runId}-${k}`); rec.loginAt = ms() - t0; rec.pid = li.pid;
    } catch (e) { rec.error = errInfo(e); rec.errorAt = ms() - t0; }
    return { rec, c };
  })());
  const all = await Promise.all(items);
  const obs: P = { n: p.n, sockets: all.map((x) => x.rec), allLoggedInAt: ms() - t0 };
  obs.openedOrder = all.filter((x) => x.rec.openedAt !== undefined).sort((a, b) => a.rec.openedAt - b.rec.openedAt).map((x) => x.rec.k);
  const live = all.filter((x) => x.c && x.rec.pid);
  if (p.idleExtra) {
    // do idle sockets count? connect one more while the others sit idle
    const e0 = ms();
    try { const ec = await openPg(ctx.connect, t, { secureTransport: 'off' }); await withTimeout(ec.sock.opened, 4000, 'opened'); obs.extra = { openedAfterMs: ms() - e0 }; await ec.close(); } catch (e) { obs.extra = { error: errInfo(e), afterMs: ms() - e0 }; }
  }
  await sleep(p.holdMs ?? 1500);
  if (p.work === 'sleep1') {
    const w0 = ms();
    const res = await Promise.all(live.map(async (x) => { try { const r = await simple(x.c!, 'select pg_sleep(1), 1', 20000); return r.error ? 'error' : 'ok'; } catch (e) { return 'fail'; } }));
    obs.work = { wallMs: ms() - w0, ok: res.filter((r) => r === 'ok').length, of: live.length };
  }
  await Promise.all(all.map((x) => (x.c ? terminateAndClose(x.c) : Promise.resolve())));
  return obs;
}

/** p4.cross-request: create in one request (phase create), use in another (phase use). */
async function crossRequest(ctx: Ctx, p: P): Promise<unknown> {
  const t = ctx.target(p.target);
  if (p.phase === 'create') {
    const c = await openPg(ctx.connect, t, { secureTransport: 'off' });
    await withTimeout(c.sock.opened, 10000, 'opened');
    const li = await login(c, t, `fs04-${ctx.runId}-x`);
    ctx.globals.xreq = c;
    return { created: true, pid: li.pid };
  }
  const c: Conn | undefined = ctx.globals.xreq;
  if (!c) return { used: false, reason: 'no socket in this isolate' };
  const obs: P = {};
  try { const r = await simple(c, 'select 1', 5000); obs.query = { rows: r.rows, error: r.error }; } catch (e) { obs.queryError = errInfo(e); }
  try { await c.write(new Uint8Array([0x58, 0, 0, 0, 4])); obs.writeAfter = 'ok'; } catch (e) { obs.writeError = errInfo(e); }
  try { await withTimeout(c.sock.close(), 3000, 'close'); obs.close = 'ok'; } catch (e) { obs.closeError = errInfo(e); }
  return obs;
}

/** p4.leave-open: a socket still open when the response is returned. */
async function leaveOpen(ctx: Ctx, p: P): Promise<unknown> {
  const t = ctx.target(p.target);
  const c = await openPg(ctx.connect, t, { secureTransport: 'off' });
  await withTimeout(c.sock.opened, 10000, 'opened');
  const li = await login(c, t, `fs04-${ctx.runId}-open`);
  return { pid: li.pid, returnedWithOpenSocket: true };
}

/** p5.cancel: pg_sleep on socket 1, CancelRequest on socket 2. */
async function cancel(ctx: Ctx, p: P): Promise<unknown> {
  const t = ctx.target(p.target);
  const obs: P = { params: { tlsMain: !!p.tlsMain, cancelVia: p.cancelVia ?? 'plain', busyOthers: p.busyOthers ?? 0, wrongKey: !!p.wrongKey } };
  const others: { c: Conn; done: Promise<unknown> }[] = [];
  const main = await openPg(ctx.connect, t, { secureTransport: p.tlsMain ? 'starttls' : 'off' });
  const stamp = ms();
  try {
    await withTimeout(main.sock.opened, 10000, 'opened');
    if (p.tlsMain) { await main.write(sslRequest()); const a = await main.readExact(1); obs.mainSslAnswer = String.fromCharCode(a[0]!); if (a[0] === 0x53) { const u = doStartTls(main, {}); if (!u.ok) throw new Error('startTls failed'); } }
    const li = await login(main, t, `fs04-${ctx.runId}-main`);
    obs.pid = li.pid;
    for (let k = 0; k < (p.busyOthers ?? 0); k++) {
      const oc = await openPg(ctx.connect, t, { secureTransport: 'off' }); await withTimeout(oc.sock.opened, 10000, 'opened'); await login(oc, t, `fs04-${ctx.runId}-busy${k}`);
      await oc.write(query(`select pg_sleep(${p.busySec ?? 6})`));
      others.push({ c: oc, done: collect(oc, 30000).catch(() => null) });
    }
    obs.socketsOpenBeforeCancel = 1 + others.length;
    const q0 = ms();
    await main.write(query('select pg_sleep(30)'));
    const result = collect(main, p.waitMs ? p.waitMs + 40000 : 40000).then((r) => ({ at: ms(), r }), (e) => ({ at: ms(), e: errInfo(e) }));
    await sleep(p.afterMs ?? 1000);
    const cancelOnce = async (key: number) => {
      const o: P = {}; const s0 = ms();
      const cc = await openPg(ctx.connect, t, { secureTransport: p.cancelVia === 'tls' ? 'starttls' : 'off' });
      try {
        await withTimeout(cc.sock.opened, 40000, 'opened'); o.openedAfterMs = ms() - s0;
        if (p.cancelVia === 'tls') { await cc.write(sslRequest()); const a = await cc.readExact(1); o.sslAnswer = String.fromCharCode(a[0]!); if (a[0] === 0x53) { const u = doStartTls(cc, {}); o.upgraded = u.ok; } }
        o.sentAt = ms(); await cc.write(cancelRequest(li.pid, key)); o.drain = await cc.drain(5000); o.doneAfterMs = ms() - s0;
      } catch (e) { o.error = errInfo(e); }
      await cc.close();
      return o;
    };
    obs.cancel = await cancelOnce(p.wrongKey ? (li.key ^ 0x5a5a5a5a) | 0 : li.key);
    if (p.wrongKey) {
      const early = await Promise.race([result, sleep(p.waitMs ?? 3000).then(() => null)]);
      obs.endedWithoutRealCancel = early !== null;
      obs.cleanupCancel = await cancelOnce(li.key); // stop the 30 s sleep
    }
    const fin: any = await result;
    obs.queryMs = fin.at - q0; obs.endedAfterCancelSentMs = obs.cancel.sentAt !== undefined ? fin.at - obs.cancel.sentAt : null;
    obs.result = fin.r ? { error: fin.r.error ?? null, rows: fin.r.rows } : { error: fin.e };
  } catch (e) { obs.error = errInfo(e); }
  await Promise.all(others.map(async (o) => { await Promise.race([o.done, sleep(7000)]); await terminateAndClose(o.c); }));
  await terminateAndClose(main);
  obs.totalMs = ms() - stamp;
  return obs;
}


/** p6.tls-upgrade: MySQL / MariaDB. The client writes the SSL request packet and upgrades without any server byte, optionally with a read pending. */
async function myTls(ctx: Ctx, p: P): Promise<unknown> {
  const t = ctx.target(p.target);
  const obs: P = {};
  const c = myOpen(ctx.connect, t, p.hostname);
  try {
    obs.opened = shape(await withTimeout(c.sock.opened, 10000, 'opened'));
    const m = await myLogin(c, t, { tls: p.tls !== false, lockMode: p.lockMode, startTlsOpts: p.startTlsOpts }, obs);
    obs.login = { ok: true };
    const st = await myQuery(m, "show session status where variable_name in ('Ssl_cipher','Ssl_version')");
    obs.sslStatus = Object.fromEntries(st.rows.map((r) => [r[0]!, r[1]!]));
    const q = await myQuery(m, 'select connection_id(), 1+1');
    obs.query = { ok: q.rows[0]?.[1] === '2', connectionId: q.rows[0]?.[0] };
    if (p.holdMs) await sleep(p.holdMs);
    await myQuit(m);
  } catch (e) { obs.login = { ok: false, error: errInfo(e) }; await c.close(); }
  obs.bytesWritten = c.written; obs.bytesReceived = c.received;
  return obs;
}

/** p6.kill-query: SELECT SLEEP(30) on connection 1, KILL QUERY <id> from a second authenticated connection after 1 s. */
async function myKill(ctx: Ctx, p: P): Promise<unknown> {
  const t = ctx.target(p.target);
  const obs: P = {};
  const open = async (label: string) => { const c = myOpen(ctx.connect, t); await withTimeout(c.sock.opened, 10000, 'opened'); const rec: P = {}; const m = await myLogin(c, t, { tls: true }, rec); return m as MyConn; };
  let m1: MyConn | null = null, m2: MyConn | null = null;
  try {
    m1 = await open('main'); m2 = await open('killer');
    const id = (await myQuery(m1, 'select connection_id()')).rows[0]![0]!; obs.connectionId = Number(id);
    const q0 = ms();
    const res = myQuery(m1, 'select sleep(30)', 40000).then((r) => ({ at: ms(), r }), (e) => ({ at: ms(), e: errInfo(e) }));
    await sleep(p.afterMs ?? 1000);
    const k0 = ms();
    const target = p.wrongId ? obs.connectionId + 100000 : obs.connectionId;
    const kr = await myQuery(m2, `kill query ${target}`); obs.kill = { ok: !!kr.ok, error: kr.error, ms: ms() - k0 };
    const fin: any = await Promise.race([res, sleep(p.wrongId ? 4000 : 20000).then(() => null)]);
    if (fin === null) { obs.queryStillRunningAfterMs = ms() - k0; await myQuery(m2, `kill query ${obs.connectionId}`); const f2: any = await res; obs.finalAfterCleanup = f2.r ?? f2.e; }
    else { obs.endedAfterKillMs = fin.at - k0; obs.result = fin.r ? { rows: fin.r.rows, error: fin.r.error ?? null } : { error: fin.e }; obs.queryMs = fin.at - q0; }
  } catch (e) { obs.error = errInfo(e); }
  if (m1) await myQuit(m1); if (m2) await myQuit(m2);
  return obs;
}

export const PROBES: Record<string, (ctx: Ctx, p: P) => Promise<unknown>> = {
  'p1.tls-upgrade': tlsUpgrade, 'p2.options': tlsUpgrade, 'p1.direct-tls': directTls, 'p2.surface': surface, 'p2.writable-types': writableTypes, 'p7.blocked': blocked, 'p1.starttls-misuse': startTlsMisuse,
  'p3.write': largeWrite, 'p3.backpressure': backpressure,
  'p4.concurrent': concurrent, 'p4.cross-request': crossRequest, 'p4.leave-open': leaveOpen,
  'p5.cancel': cancel, 'p6.tls-upgrade': myTls, 'p6.kill-query': myKill,
};
