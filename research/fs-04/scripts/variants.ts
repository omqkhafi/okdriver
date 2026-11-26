// Probe variants and their judges. A judge turns one run's raw records (Worker observations, proxy records, server log,
// server-side polls) into named boolean checks. `required` lists the checks that must hold for a run to count as a pass.
// null = the check does not apply to this run (for example proxy hashes on a TLS connection).
import { createHash } from 'node:crypto';
import { pem } from './lib/certs.ts';
import { fillPayload, bindByteaParts, copyBinaryParts } from '../worker/src/payload.ts';
import type { RunRec } from './lib/harness.ts';

export type Checks = Record<string, boolean | null>;
export interface Variant {
  id: string; group: string; probe: string; target: string; params: Record<string, any>; title: string;
  required: string[]; judge: (r: RunRec, v: Variant) => Checks;
  fresh?: boolean; runs?: number; kind?: 'normal' | 'xreq' | 'state'; poll?: boolean; after?: number[]; proxyCfg?: any;
  servers?: string[]; expectFail?: string; // planted fault: the check that must be the one that fails
  note?: string;
}
const o = (r: RunRec): any => r.response?.observations ?? {};
const logHas = (r: RunRec, re: RegExp) => r.log.some((l) => re.test(l));
// log lines are matched on this run's application_name, so a line left over from the previous run can never count
const mine = (r: RunRec) => r.log.filter((l) => l.includes(r.runId));
// Production has no proxy and no server log: checks that need them become null (not applicable) and the session's own pg_stat_ssl row stays.
const prod = (r: RunRec) => r.mode === 'production';
const authorized = (r: RunRec) => (prod(r) ? o(r).login?.ok === true : mine(r).some((l) => /connection authorized/.test(l)));
const sslLog = (r: RunRec) => prod(r) || mine(r).some((l) => /connection authorized.*SSL enabled/.test(l));
const mainConn = (r: RunRec) => r.proxy.find((c) => c.kind === 'ssl-request' || c.kind === 'startup' || c.kind === 'direct-tls');

// ---- probe 1: TLS upgrade ------------------------------------------------------------------------------------------
const judgeStartTls = (r: RunRec): Checks => {
  const x = o(r), c = mainConn(r);
  return {
    answerS: x.answer === 'S',
    noLeftoverAtSwitch: x.leftoverAfterAnswer === 0,
    upgradeCallOk: x.upgrade?.ok === true,
    loginOk: x.login?.ok === true,
    serverSsl: x.pgStatSsl?.[0] === 't' && sslLog(r),
    queryOk: x.query?.ok === true,
    proxyClientHello: prod(r) ? null : !!c?.clientHello && c.sslAnswer === 'S',
    noStrayBytes: prod(r) ? x.bytesWrittenBeforeSwitch === 8 && x.bytesReadBeforeSwitch === 1 : !!c && c.tlsStartsAtC2sOffset === 8 && c.tlsStartsAtS2cOffset === 1 && c.bytesBeforeSslAnswer === undefined && x.bytesWrittenBeforeSwitch === 8,
  };
};
const judgeServerN = (r: RunRec): Checks => {
  const x = o(r), c = mainConn(r);
  return { answerN: x.answer === 'N', loginOk: x.login?.ok === true, queryOk: x.query?.ok === true, serverNoSsl: x.pgStatSsl?.[0] === 'f' && !sslLog(r), proxySawN: c?.sslAnswer === 'N' };
};
const judgeDirect = (r: RunRec): Checks => {
  const x = o(r), c = mainConn(r);
  return { loginOk: x.login?.ok === true, serverSsl: x.pgStatSsl?.[0] === 't' && sslLog(r), alpnSent: prod(r) ? null : c?.clientHello?.alpn?.includes('postgresql') ?? false, proxySawDirectTls: prod(r) ? null : c?.kind === 'direct-tls' };
};
const judgeLock = (r: RunRec): Checks => ({ upgradeCallOk: o(r).upgrade?.ok === true, loginOk: o(r).login?.ok === true, serverSsl: o(r).pgStatSsl?.[0] === 't' && sslLog(r) });
const judgeSecond = (r: RunRec): Checks => ({ ...judgeStartTls(r), secondStartTlsRefused: !!o(r).secondStartTls?.error, connectionUsableAfter: o(r).afterSecond?.ok === true });

// ---- probe 2: certificates -----------------------------------------------------------------------------------------
const accepted = (r: RunRec): boolean => o(r).login?.ok === true && o(r).pgStatSsl?.[0] === 't' && sslLog(r);
const rejected = (r: RunRec): boolean => o(r).login?.ok !== true && (prod(r) || !authorized(r));
const judgeAccept = (r: RunRec): Checks => ({ accepted: accepted(r), sniIsHostname: prod(r) ? null : r.proxy[0]?.clientHello?.sni != null });
const judgeReject = (r: RunRec): Checks => ({ rejected: rejected(r), noAuthenticatedSession: prod(r) ? null : !authorized(r) });
const judgeHonoured = (what: 'accept' | 'reject' | 'sni' | 'alpn', sni?: string) => (r: RunRec): Checks => {
  const c = mainConn(r);
  if (prod(r) && (what === 'sni' || what === 'alpn')) return { honoured: null }; // needs the ClientHello: not observable in production
  const v = what === 'accept' ? accepted(r) : what === 'reject' ? rejected(r) : what === 'sni' ? c?.clientHello?.sni === sni : (c?.clientHello?.alpn?.includes('postgresql') ?? false);
  return { honoured: v };
};
const judgeClientCert = (r: RunRec): Checks => ({ serverRejectedNoClientCert: o(r).login?.ok !== true && logHas(r, /client certificate|certificate required|tlsv13 alert certificate required|peer did not return a certificate/i), noAuthenticatedSession: !authorized(r) });
const judgeSurface = (r: RunRec): Checks => {
  const x = o(r); const cand = x.candidateMembers ?? {};
  const certNames = ['peerCertificate', 'getPeerCertificate', 'getCertificate', 'certificate', 'cert', 'tlsInfo', 'getProtocol', 'getCipher', 'tlsSocket', 'alpnProtocol'];
  const all = [...(x.after?.socket ?? []), ...(x.before?.socket ?? [])].map(String);
  return { listed: all.length > 0, upgraded: x.upgraded === true, noPeerCertificateApi: certNames.every((k) => cand[k] === 'absent') && !all.some((k) => /cert|peer|hash|binding|fingerprint/i.test(k)) };
};

// ---- probe 3: large writes -----------------------------------------------------------------------------------------
const MiB = 1024 * 1024;
const cache = new Map<string, { sha: string; frame: string; copy: string }>();
export function expectedFor(size: number, seed: number) {
  const k = `${size}:${seed}`; const hit = cache.get(k); if (hit) return hit;
  const payload = new Uint8Array(size); fillPayload(payload, seed, 0);
  const sha = createHash('sha256').update(payload).digest('hex');
  const bp = bindByteaParts(size);
  const frame = createHash('sha256').update(bp.head).update(payload).update(bp.tail).digest('hex');
  const cp = copyBinaryParts(size);
  const copy = createHash('sha256').update(cp.head).update(payload).update(cp.tail).digest('hex');
  cache.clear(); const v = { sha, frame, copy }; cache.set(k, v); return v;
}
const judgeBig = (r: RunRec, v: Variant): Checks => {
  const x = o(r); const e = expectedFor(v.params.size, v.params.seed);
  const plain = !v.params.tls; const conn = r.proxy.find((c) => c.kind === 'startup' || c.kind === 'ssl-request');
  const copy = v.params.how === 'copy';
  return {
    writeCompleted: !x.writeError && !x.error && !!x.write,
    pgShaMatches: x.pg?.[0] === e.sha,
    pgLengthMatches: x.pg?.[1] === String(v.params.size),
    proxyHashMatches: plain && !prod(r) ? (copy ? conn?.copyBodySha256 === e.copy : conn?.frames.find((f) => f.type === 'B')?.sha256 === e.frame) : null,
    allBytesReachedProxy: plain && !prod(r) ? (conn?.c2sBytes ?? 0) >= v.params.size : null,
  };
};
const judgeBackpressure = (r: RunRec, v: Variant): Checks => {
  const x = o(r); const e = expectedFor(v.params.size, v.params.seed); const c = r.proxy[0];
  const tl: any[] = x.timeline ?? [];
  return {
    proxyStalled: !!c?.stalled?.resumedAt,
    intact: x.pg?.[0] === e.sha,
    desiredSizeSignals: tl.some((p) => p.desiredSize !== null && p.desiredSize <= 0) || (x.midStall?.desiredSize ?? 1) <= 0,
    readyPendsDuringStall: (x.pendingReady ?? 0) > 0,
    writesPendDuringStall: !!x.midStall && x.midStall.resolved < x.midStall.queued,
  };
};

// ---- probe 4: concurrency ------------------------------------------------------------------------------------------
const judgeConcurrent = (r: RunRec, v: Variant): Checks => {
  const x = o(r); const n = v.params.n; const socks: any[] = x.sockets ?? [];
  const peak = Math.max(0, ...(r.activity ?? []).map((a) => a.count));
  const opens = r.proxy.filter((c) => c.kind === 'startup').map((c) => c.openedAt);
  const wopen = socks.map((s) => s.openedAt).filter((t) => typeof t === 'number') as number[]; // the Worker's own clock: when each opened resolved
  return {
    allLoggedIn: socks.filter((s) => s.pid).length === n,
    serverSawAllAtOnce: prod(r) && !r.activity?.length ? null : peak >= n,
    allReachedProxy: prod(r) ? null : opens.length === n,
    notQueued: prod(r) ? wopen.length === n && Math.max(...wopen) - Math.min(...wopen) < 1000 : opens.length === n && Math.max(...opens) - Math.min(...opens) < 1000,
    workerOpenedSpreadUnder1s: wopen.length === n && Math.max(...wopen) - Math.min(...wopen) < 1000,
    allUsableAtOnce: v.params.work === 'sleep1' ? x.work?.ok === n && x.work?.wallMs < 2500 : null,
    idleDoNotCount: v.params.idleExtra ? x.extra?.openedAfterMs !== undefined && x.extra.openedAfterMs < 1500 : null,
  };
};
const judgeLeaveOpen = (r: RunRec): Checks => {
  const s = r.extra?.sampled as { at: number; count: number }[] | undefined; const c = r.proxy.find((k) => k.kind === 'startup');
  const lag = r.extra?.closeLagMs as number | undefined;
  if (prod(r)) return { responded: o(r).returnedWithOpenSocket === true, serverSawConnection: null, closedByPlatformNotServer: null, closedWithin1sOfResponse: null, serverNoneAtEnd: s?.length ? s[s.length - 1]!.count === 0 : null };
  return { responded: o(r).returnedWithOpenSocket === true, serverSawConnection: (c?.s2cTypes['Z'] ?? 0) >= 1, closedByPlatformNotServer: c?.closedBy === 'client', closedWithin1sOfResponse: lag !== undefined && lag < 1000, serverNoneAtEnd: !!s?.length && s[s.length - 1]!.count === 0 };
};
const judgeXreq = (r: RunRec): Checks => {
  const u = r.extra?.use as any; const x = u?.observations ?? {};
  return { created: r.extra?.createOk === true, crossRequestUseWorks: x.query?.rows?.[0]?.[0] === '1', refusedWithError: !!(x.queryError || x.writeError) };
};
const judgeGlobal = (r: RunRec): Checks => {
  const g = (r.extra as any)?.state?.globalScope; return { socketAtGlobalScopeThrows: g?.threw === true, errorMentionsGlobalScope: /global scope/i.test(g?.error?.message ?? '') };
};

// ---- probe 5: cancel -----------------------------------------------------------------------------------------------
const judgeCancel = (r: RunRec): Checks => {
  const x = o(r);
  return {
    queryEnded57014: x.result?.error?.code === '57014',
    endedWithin2500msOfCancel: typeof x.endedAfterCancelSentMs === 'number' && x.endedAfterCancelSentMs < 2500,
    cancelSocketClosedByServer: x.cancel?.drain?.ended === 'eof',
    serverLogged57014: prod(r) ? null : logHas(r, /canceling statement due to user request/),
    cancelSocketOpenedFast: typeof x.cancel?.openedAfterMs === 'number' && x.cancel.openedAfterMs < 2000,
  };
};

// ---- catalogue -----------------------------------------------------------------------------------------------------
const P17 = 'pg17-tls';
const V: Variant[] = [];
const add = (v: Omit<Variant, 'judge' | 'required'> & { judge: Variant['judge']; required?: string[] }) => V.push({ ...v, required: v.required ?? Object.keys(v.judge({ response: { observations: {} }, proxy: [], log: [] } as any, v as any)).filter(() => true) });
const req = (...names: string[]) => names;

for (const pg of ['pg17', 'pg19']) {
  const tgt = pg + '-tls', plain = pg + '-plain';
  add({ id: `p1.starttls.${tgt}`, group: 'p1', probe: 'p1.tls-upgrade', target: tgt, params: {}, title: 'SSLRequest, S, startTls(), SCRAM, query', judge: judgeStartTls });
  add({ id: `p1.server-n.${plain}`, group: 'p1', probe: 'p1.tls-upgrade', target: plain, params: {}, title: 'server answers N, plaintext continues on the same socket', judge: judgeServerN });
  add({ id: `p1.direct-tls.${tgt}`, group: 'p1', probe: 'p1.direct-tls', target: tgt, params: {}, title: 'secureTransport "on" from the first byte', judge: judgeDirect, required: ['loginOk', 'serverSsl'] });
}
add({ id: 'p1.direct-tls.alpn-option.pg17-tls', group: 'p1', probe: 'p1.direct-tls', target: P17, params: { connectOpts: { alpn: ['postgresql'] } }, title: 'secureTransport "on" with an alpn option naming postgresql', judge: judgeDirect, required: ['loginOk', 'serverSsl', 'alpnSent'] });
for (const lm of ['none-released', 'reader-held', 'writer-held', 'read-pending', 'cancel-pending']) add({ id: `p1.lock.${lm}`, group: 'p1', probe: 'p1.tls-upgrade', target: P17, params: { lockMode: lm }, title: `startTls with lock situation ${lm}`, judge: judgeLock });
add({ id: 'p1.second-starttls', group: 'p1', probe: 'p1.tls-upgrade', target: P17, params: { second: true }, title: 'a second startTls() on the upgraded socket', judge: judgeSecond, required: ['loginOk', 'serverSsl', 'secondStartTlsRefused', 'connectionUsableAfter'] });
for (const mode of ['off', 'on']) add({ id: `p1.starttls-misuse.${mode}`, group: 'p1', probe: 'p1.starttls-misuse', target: mode === 'on' ? P17 : 'pg17-plain', params: { mode }, title: `startTls() on a socket created with secureTransport "${mode}"`, judge: (r) => ({ startTlsRefused: !!o(r).startTls?.threw }), required: ['startTlsRefused'] });
add({ id: 'p1.starttls-after-N', group: 'p1', probe: 'p1.tls-upgrade', target: 'pg17-plain', params: { upgradeAfterN: true }, title: 'startTls() although the server answered N', judge: (r) => ({ loginFailsOrTlsRefused: o(r).login?.ok !== true }), required: ['loginFailsOrTlsRefused'] });

add({ id: 'p2.matrix.trusted-right-name', group: 'p2', probe: 'p2.options', target: P17, params: {}, title: 'trusted CA, right name: expect accept', judge: judgeAccept, required: ['accepted'] });
add({ id: 'p2.matrix.selfsigned-untrusted', group: 'p2', probe: 'p2.options', target: 'pg17-selfsigned', params: {}, title: 'self-signed, not trusted: expect reject', judge: judgeReject, required: ['rejected', 'noAuthenticatedSession'] });
add({ id: 'p2.matrix.trusted-wrong-name', group: 'p2', probe: 'p2.options', target: P17, params: { hostname: 'wrong.fs04.test' }, title: 'trusted CA, name does not match: expect reject', judge: judgeReject, required: ['rejected', 'noAuthenticatedSession'] });
add({ id: 'p2.matrix.expired', group: 'p2', probe: 'p2.options', target: 'pg17-expired', params: {}, title: 'trusted CA, expired: expect reject', judge: judgeReject, required: ['rejected', 'noAuthenticatedSession'] });
// options: each says what the option does, from outcome and from the ClientHello the proxy saw
const SS = () => pem('selfsigned.pem');
const opt = (id: string, target: string, params: any, title: string, what: 'accept' | 'reject' | 'sni' | 'alpn', sni?: string) =>
  add({ id: `p2.opt.${id}`, group: 'p2', probe: 'p2.options', target, params, title, judge: judgeHonoured(what, sni), required: ['honoured'] });
opt('startTls.expectedServerHostname-right', P17, { startTlsOpts: { expectedServerHostname: 'pg.fs04.test' } }, 'expectedServerHostname equals the cert name (control: accept)', 'accept');
opt('startTls.expectedServerHostname-wrong', P17, { startTlsOpts: { expectedServerHostname: 'wrong.fs04.test' } }, 'expectedServerHostname wrong while connect name is right: honoured means reject', 'reject');
opt('startTls.expectedServerHostname-fixes-ip', 'pg17-tls-ip', { startTlsOpts: { expectedServerHostname: 'pg.fs04.test' } }, 'connect by IP, expectedServerHostname = cert name: honoured means accept', 'accept');
opt('connect-by-ip-no-option', 'pg17-tls-ip', {}, 'connect by IP without option (control: name mismatch expected to reject)', 'reject');
opt('startTls.expectedServerHostname-sni', 'pg17-tls-ip', { startTlsOpts: { expectedServerHostname: 'pg.fs04.test' } }, 'does expectedServerHostname become the SNI value', 'sni', 'pg.fs04.test');
opt('startTls.rejectUnauthorized-false', 'pg17-selfsigned', { startTlsOpts: { rejectUnauthorized: false } }, 'rejectUnauthorized:false on startTls, untrusted cert: honoured means accept', 'accept');
opt('connect.rejectUnauthorized-false', 'pg17-selfsigned', { connectOpts: { rejectUnauthorized: false } }, 'rejectUnauthorized:false on connect, untrusted cert: honoured means accept', 'accept');
opt('startTls.ca', 'pg17-selfsigned', { startTlsOpts: { ca: 'SELFSIGNED' } }, 'ca on startTls with the self-signed cert: honoured means accept', 'accept');
opt('connect.ca', 'pg17-selfsigned', { connectOpts: { ca: 'SELFSIGNED' } }, 'ca on connect with the self-signed cert: honoured means accept', 'accept');
opt('startTls.servername', P17, { startTlsOpts: { servername: 'sni.fs04.test' } }, 'servername on startTls: honoured means the ClientHello SNI changes', 'sni', 'sni.fs04.test');
opt('connect.servername', P17, { connectOpts: { servername: 'sni.fs04.test' } }, 'servername on connect: honoured means the ClientHello SNI changes', 'sni', 'sni.fs04.test');
opt('startTls.alpn', P17, { startTlsOpts: { alpn: ['postgresql'] } }, 'alpn on startTls: honoured means ALPN postgresql is in the ClientHello', 'alpn');
opt('connect.alpn', P17, { connectOpts: { alpn: ['postgresql'] } }, 'alpn on connect: honoured means ALPN postgresql is in the ClientHello', 'alpn');
opt('connect.alpnProtocols', P17, { connectOpts: { alpnProtocols: ['postgresql'] } }, 'alpnProtocols on connect', 'alpn');
add({ id: 'p2.clientcert.none', group: 'p2', probe: 'p2.options', target: 'pg17-clientcert', params: {}, title: 'server requires a client certificate; none offered: the server must refuse (control for the next row)', judge: judgeClientCert });
add({ id: 'p2.clientcert.options', group: 'p2', probe: 'p2.options', target: 'pg17-clientcert', params: { startTlsOpts: { cert: 'CLIENTCERT', key: 'CLIENTKEY' }, connectOpts: { cert: 'CLIENTCERT', key: 'CLIENTKEY' } }, title: 'client certificate and key offered as connect and startTls options: accepted only if the platform presents it', judge: judgeAccept, required: ['accepted'] });
add({ id: 'p2.surface', group: 'p2', probe: 'p2.surface', target: P17, params: {}, title: 'Socket and SocketInfo surface; any peer-certificate member', judge: judgeSurface });

export const PLANTED: Variant[] = [];
export const variants = V;
export { judgeBig, judgeBackpressure, judgeConcurrent, judgeLeaveOpen, judgeXreq, judgeGlobal, judgeCancel, judgeStartTls, add, PLANTED as planted, MiB, req };
