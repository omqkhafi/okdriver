// Probes 3 to 5 and the planted faults. Imported for its side effect of registering variants (see catalog.ts).
import { add, variants, judgeBig, judgeBackpressure, judgeConcurrent, judgeLeaveOpen, judgeXreq, judgeGlobal, judgeCancel, judgeStartTls, MiB, type Variant } from './variants.ts';

const P17 = 'pg17-tls', PLAIN = 'pg17-plain';
export const SIZES = [64 * 1024, 1 * MiB, 4 * MiB, 16 * MiB, 64 * MiB, 128 * MiB];
export const sizeLabel = (n: number) => (n >= MiB ? `${n / MiB}MiB` : `${n / 1024}KiB`);

export interface BigSpec { how: 'bind' | 'copy'; mode: 'single' | 'chunk'; chunk: number; tls: boolean; target?: string }
export const BIG_SPECS: Record<string, BigSpec> = {
  'bind-single': { how: 'bind', mode: 'single', chunk: 0, tls: false },
  'bind-chunk64k': { how: 'bind', mode: 'chunk', chunk: 64 * 1024, tls: false },
  'bind-chunk1m': { how: 'bind', mode: 'chunk', chunk: MiB, tls: false },
  'bind-chunk64k-nowait': { how: 'bind', mode: 'chunk', chunk: 64 * 1024, tls: false },
  'copy-chunk64k': { how: 'copy', mode: 'chunk', chunk: 64 * 1024, tls: false },
  'tls-bind-single': { how: 'bind', mode: 'single', chunk: 0, tls: true },
  'tls-bind-chunk64k': { how: 'bind', mode: 'chunk', chunk: 64 * 1024, tls: true },
};
export function bigVariant(spec: string, size: number, target = P17): Variant {
  const pre = target.startsWith('pg19') ? 'pg19.' : '';
  const s = BIG_SPECS[spec]!;
  const seed = (0x5eed0000 + size) | 0;
  return {
    id: `${pre}p3.write.${spec}.${sizeLabel(size)}`, group: 'p3', probe: 'p3.write', target, fresh: true,
    params: { size, seed, mode: s.mode, chunk: s.chunk || size, how: s.how, tls: s.tls, awaitEach: spec !== 'bind-chunk64k-nowait' },
    title: `${s.how} ${s.mode}${s.chunk ? ' ' + sizeLabel(s.chunk) : ''}${s.tls ? ' over TLS' : ''}, ${sizeLabel(size)}`, judge: judgeBig,
    required: ['writeCompleted', 'pgShaMatches', 'pgLengthMatches', 'proxyHashMatches', 'allBytesReachedProxy'],
  };
}
export const backpressureVariant = (awaitReady: boolean): Variant => ({
  id: `p3.backpressure.${awaitReady ? 'await-ready' : 'no-await'}`, group: 'p3', fresh: true, probe: 'p3.backpressure', target: PLAIN.replace('plain', 'tls'),
  params: { size: 24 * MiB, seed: 0x5eed, chunk: 64 * 1024, awaitReady }, title: `proxy stops reading for 4 s after 2 MiB; writer.ready ${awaitReady ? 'awaited' : 'ignored'}`,
  judge: judgeBackpressure, required: ['proxyStalled', 'intact'], proxyCfg: { stall: { afterBytes: 2 * MiB, ms: 4000 } },
});

for (const n of [1, 2, 6, 7, 8, 24, 50]) add({ id: `p4.concurrent.n${n}`, group: 'p4', probe: 'p4.concurrent', target: P17, params: { n, holdMs: 1500, work: 'sleep1' }, title: `${n} sockets from one invocation, all logged in, held, then used at once`, judge: judgeConcurrent, poll: true,
  required: ['allLoggedIn', 'serverSawAllAtOnce', 'allReachedProxy', 'notQueued', 'allUsableAtOnce'] });
add({ id: 'p4.idle-count.n6', group: 'p4', probe: 'p4.concurrent', target: P17, params: { n: 6, holdMs: 500, idleExtra: true }, title: '6 idle logged-in sockets, then a 7th: do idle sockets count', judge: judgeConcurrent, poll: true, required: ['allLoggedIn', 'idleDoNotCount'] });
add({ id: 'p4.cross-request', group: 'p4', probe: 'p4.cross-request', target: P17, params: {}, kind: 'xreq', fresh: true, title: 'socket created in one request, used in the next', judge: judgeXreq, required: ['created', 'crossRequestUseWorks'] });
add({ id: 'p4.leave-open', group: 'p4', probe: 'p4.leave-open', target: P17, params: {}, title: 'socket left open at the end of the request: what the server sees', judge: judgeLeaveOpen, poll: true, after: [300, 2000, 8000], required: ['responded', 'serverSawConnection', 'closedWithin1sOfResponse', 'serverNoneAtEnd'] });
add({ id: 'p4.global-scope', group: 'p4', probe: 'state', target: P17, params: {}, kind: 'state', fresh: true, title: 'connect() at global scope (module evaluation)', judge: judgeGlobal, required: ['socketAtGlobalScopeThrows'] });

const cancel = (id: string, title: string, params: any, extra: Partial<Variant> = {}) => add({ id: `p5.${id}`, group: 'p5', probe: 'p5.cancel', target: P17, params, title, judge: judgeCancel, required: ['queryEnded57014', 'endedWithin2500msOfCancel', 'cancelSocketClosedByServer', 'serverLogged57014', 'cancelSocketOpenedFast'], ...extra });
cancel('cancel.plain', 'pg_sleep(30) on socket 1, CancelRequest on socket 2 after 1 s', {});
cancel('cancel.busy6', 'cancel while 6 other sockets are busy (the cancel socket is the 8th)', { busyOthers: 6, busySec: 6 });
cancel('cancel.tls-main-plain-cancel', 'main connection on TLS, CancelRequest in plain', { tlsMain: true, cancelVia: 'plain' });
cancel('cancel.tls-main-tls-cancel', 'main connection on TLS, CancelRequest after SSLRequest and startTls', { tlsMain: true, cancelVia: 'tls' });

// ---- PostgreSQL 19.0: a subset, same judges, target replaced ------------------------------------------------------------
for (const id of ['p4.concurrent.n8', 'p4.concurrent.n50', 'p5.cancel.plain', 'p5.cancel.tls-main-tls-cancel', 'p2.matrix.trusted-right-name', 'p2.matrix.trusted-wrong-name']) {
  const v = variants.find((x) => x.id === id)!; variants.push({ ...v, id: 'pg19.' + id, target: 'pg19-tls', title: v.title + ' (PostgreSQL 19.0)' });
}
// ---- planted faults: each must be caught by the named check ---------------------------------------------------------
export const PLANTED_IDS: string[] = [];
const plant = (v: Variant) => { v.id = 'planted.' + v.id; PLANTED_IDS.push(v.id); add(v as any); };
plant({ ...bigVariant('bind-single', MiB), title: 'planted: proxy flips one payload byte (plain Bind, 1 MiB)', proxyCfg: { flip: { c2sOffset: 600000 } }, expectFail: 'pgShaMatches' } as Variant);
plant({ id: 'p1.starttls.flip', group: 'planted', probe: 'p1.tls-upgrade', target: P17, params: {}, title: 'planted: proxy flips one byte of the TLS stream', judge: judgeStartTls, required: ['loginOk', 'serverSsl'], proxyCfg: { flip: { c2sOffset: 700 } }, expectFail: 'loginOk' } as Variant);
plant({ id: 'p1.starttls.server-without-tls', group: 'planted', probe: 'p1.tls-upgrade', target: 'pg17-plain', params: {}, title: 'planted: server without TLS (expects TLS)', judge: judgeStartTls, required: ['answerS', 'serverSsl'], expectFail: 'answerS' } as Variant);
plant({ id: 'p5.cancel.wrong-key', group: 'planted', probe: 'p5.cancel', target: P17, params: { wrongKey: true, waitMs: 3000 }, title: 'planted: CancelRequest with a wrong secret key', judge: judgeCancel, required: ['endedWithin2500msOfCancel', 'queryEnded57014'], expectFail: 'endedWithin2500msOfCancel' } as Variant);

// ---- probe 6: MySQL 8.4 and MariaDB 11.8 ----------------------------------------------------------------------------
const myTlsJudge = (r: any, v: Variant) => {
  const x = r.response?.observations ?? {}; const c = r.proxy.find((k: any) => k.kind === 'ssl-request');
  const ciphers = (r.activity ?? []).map((a: any) => a.count);
  return {
    greetingOffersSsl: x.greeting?.serverOffersSsl === true,
    noServerByteBeforeSwitch: x.leftoverAtSwitch === 0,
    startTlsOk: x.startTls === 'ok',
    loginOk: x.login?.ok === true,
    serverSsl: !!x.sslStatus?.Ssl_cipher,
    queryOk: x.query?.ok === true,
    proxyClientHello: !!c?.clientHello && c.tlsStartsAtC2sOffset === 36,
    serverOracleSeesTls: v.target === 'my84' ? Math.max(0, ...ciphers) >= 1 : null,
  };
};
const myKillJudge = (r: any) => {
  const x = r.response?.observations ?? {}; const s = (r.activity ?? []).filter((a: any) => a.sleep !== undefined);
  return {
    bothLoggedIn: typeof x.connectionId === 'number',
    killAccepted: x.kill?.ok === true,
    endedWithin2500msOfKill: typeof x.endedAfterKillMs === 'number' && x.endedAfterKillMs < 2500,
    serverShowedSleepRunning: s.some((a: any) => a.sleep >= 1),
    serverQueryGoneAtEnd: s.length > 0 && s[s.length - 1].sleep === 0,
  };
};
for (const id of ['my84', 'ma118']) {
  add({ id: `p6.tls.${id}.upgrade`, group: 'p6', probe: 'p6.tls-upgrade', target: id, params: { holdMs: 1200 }, title: `${id}: SSL request packet, startTls() with nothing pending, auth over TLS`, judge: myTlsJudge as any });
  add({ id: `p6.tls.${id}.read-pending`, group: 'p6', probe: 'p6.tls-upgrade', target: id, params: { holdMs: 1200, lockMode: 'read-pending' }, title: `${id}: same with a read pending when the locks are released`, judge: myTlsJudge as any });
  add({ id: `p6.tls.${id}.cancel-pending`, group: 'p6', probe: 'p6.tls-upgrade', target: id, params: { holdMs: 1200, lockMode: 'cancel-pending' }, title: `${id}: a read is pending; cancel() it, release the locks, then startTls()`, judge: myTlsJudge as any });
  add({ id: `p6.tls.${id}.locks-held`, group: 'p6', probe: 'p6.tls-upgrade', target: id, params: { holdMs: 1200, lockMode: 'none-released' }, title: `${id}: startTls() with both locks still held`, judge: myTlsJudge as any });
  add({ id: `p6.kill.${id}`, group: 'p6', probe: 'p6.kill-query', target: id, params: {}, title: `${id}: SELECT SLEEP(30), KILL QUERY on a second authenticated connection after 1 s`, judge: myKillJudge as any });
}
plant({ id: 'p6.kill.my84.wrong-id', group: 'planted', probe: 'p6.kill-query', target: 'my84', params: { wrongId: true }, title: 'planted: KILL QUERY with a wrong connection id', judge: myKillJudge as any, required: ['killAccepted', 'endedWithin2500msOfKill'], expectFail: 'endedWithin2500msOfKill' } as Variant);
export { variants };
