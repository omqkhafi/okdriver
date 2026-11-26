// Runs probe variants N times each (default 5) in Worker mode (workerd) and/or control mode (the same probe code through the Bun node:net
// adapter) and writes one result JSON per variant and mode to results/probes/. Usage:
//   bun scripts/run.ts [--mode worker|control|both] [--runs N] [--fresh] <id-prefix | group> ...
import { Lab, serverLog, save, WORKER_PORT, TOKEN, mysqlCli, mysqlPollSql, type RunRec } from './lib/harness.ts';
import { SERVERS } from './lib/servers.ts';
import { pem } from './lib/certs.ts';
import { variants, bigVariant, backpressureVariant, BIG_SPECS, SIZES } from './catalog.ts';
import type { Variant } from './variants.ts';

const args = process.argv.slice(2);
const flag = (n: string, d?: string) => { const i = args.indexOf(n); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
const mode = (flag('--mode', 'worker') ?? 'worker') as 'worker' | 'control' | 'both';
const RUNS = Number(flag('--runs', '5'));
const FRESH = args.includes('--fresh'); if (FRESH) args.splice(args.indexOf('--fresh'), 1);
const only = args.filter((a) => !a.startsWith('--'));

const subst = (x: any): any => typeof x === 'string' ? ({ SELFSIGNED: pem('selfsigned.pem'), CLIENTCERT: pem('client.crt'), CLIENTKEY: pem('client.key') } as Record<string, string>)[x] ?? x
  : Array.isArray(x) ? x.map(subst) : x && typeof x === 'object' ? Object.fromEntries(Object.entries(x).map(([k, v]) => [k, subst(v)])) : x;
const serverOf = (t: string) => t.replace(/-ip$/, '');
const verdict = (v: Variant, checks: Record<string, boolean | null>) => v.required.every((k) => checks[k] === null || checks[k] === true);

export async function runVariant(lab: Lab, v: Variant, m: 'worker' | 'control', runs: number): Promise<any> {
  const out: any[] = []; const tally: Record<string, { pass: number; of: number }> = {};
  const tag = v.id.replace(/[^a-z0-9]/gi, '').slice(-14);
  for (let i = 1; i <= runs; i++) {
    const runId = `${tag}${m[0]}${i}x${Math.random().toString(36).slice(2, 6)}`;
    if (m === 'worker' && (v.fresh || FRESH)) await lab.startWorker();
    lab.proxy.reset(); lab.proxy.cfg = v.proxyCfg ?? {};
    const srv = serverOf(v.target); const isMy = v.group === 'p6' || v.id.includes('.p6.') || v.probe.startsWith('p6'); const admin = (!isMy && (v.poll || v.after)) ? await lab.admin(srv) : null!;
    const t0 = Date.now(); const activity: { t: number; count: number; sleep?: number }[] = [];
    let timer: ReturnType<typeof setInterval> | null = null;
    if (isMy) timer = setInterval(() => { try { const [a, b] = mysqlCli(srv, mysqlPollSql(srv)).split('\t'); activity.push({ t: Date.now() - t0, count: Number(b), sleep: Number(a) }); } catch { /* ignore */ } }, 350);
    else if (v.poll) timer = setInterval(async () => { try { const r = await admin.q(`select count(*) from pg_stat_activity where application_name like 'fs04-${runId}%'`); activity.push({ t: Date.now() - t0, count: Number(r[0]![0]) }); } catch { /* ignore */ } }, 100);
    const params = subst({ ...v.params, target: v.target });
    let rec: RunRec = { run: i, runId, mode: m, wallMs: 0, response: null, proxy: [], log: [] };
    const extra: Record<string, unknown> = {};
    if (v.kind === 'state') {
      const r = await fetch(`http://127.0.0.1:${WORKER_PORT}/state`, { headers: { authorization: `Bearer ${TOKEN}` } }); extra.state = await r.json();
    } else if (v.kind === 'xreq') {
      const a = await lab.call(v.probe, { ...params, phase: 'create' }, runId, m); extra.createOk = a.response?.observations?.created === true;
      const b = await lab.call(v.probe, { ...params, phase: 'use' }, runId, m); extra.use = b.response;
      rec.response = a.response;
    } else {
      const c = await lab.call(v.probe, params, runId, m); rec.response = c.response; rec.httpError = c.httpError;
    }
    rec.wallMs = Date.now() - t0; extra.responseAt = Date.now();
    if (m === 'worker' && lab.worker) { // indicative only: peak RSS and CPU time of the workerd process since its start
      try { const pid = lab.worker.proc.pid; const st = await Bun.file(`/proc/${pid}/status`).text(); const hwm = /VmHWM:\s+(\d+) kB/.exec(st)?.[1]; const stat = (await Bun.file(`/proc/${pid}/stat`).text()).split(') ')[1]!.split(' '); extra.workerd = { peakRssMiB: hwm ? Math.round(Number(hwm) / 1024) : null, cpuMsSinceStart: Math.round((Number(stat[11]) + Number(stat[12])) * 10), freshProcess: !!(v.fresh || FRESH) }; } catch { /* not Linux */ }
    }
    if (v.after) { const sampled: any[] = []; for (const ms of v.after) { await Bun.sleep(Math.max(0, t0 + rec.wallMs + ms - Date.now())); try { const r = await admin.q(`select count(*) from pg_stat_activity where application_name like 'fs04-${runId}%'`); sampled.push({ at: ms, count: Number(r[0]![0]) }); } catch { /* ignore */ } } extra.sampled = sampled; }
    if (isMy) await Bun.sleep(900); // one more server-side sample after the run
    if (timer) clearInterval(timer);
    await Bun.sleep(150);
    rec.activity = activity; rec.extra = extra; rec.proxy = lab.proxy.conns.map((c) => ({ ...c }));
    { const closes = rec.proxy.map((c) => c.closedAt).filter((x): x is number => !!x); if (closes.length) extra.closeLagMs = Math.round(Math.max(...closes) - (extra.responseAt as number)); }
    rec.log = isMy ? [] : serverLog(srv, t0);
        const checks = v.judge(rec, v); const pass = verdict(v, checks);
    for (const [k, val] of Object.entries(checks)) if (val !== null) { tally[k] ??= { pass: 0, of: 0 }; tally[k]!.of++; if (val) tally[k]!.pass++; }
    out.push({ run: i, runId, wallMs: rec.wallMs, pass, checks, httpError: rec.httpError, response: slimResponse(rec.response), extra: slimExtra(extra), proxy: slimProxy(rec.proxy), log: rec.log.slice(-14), activityPeak: activity.length ? Math.max(...activity.map((a) => a.count)) : undefined });
  }
  const passes = out.filter((r) => r.pass).length;
  const res = { id: v.id, title: v.title, group: v.group, mode: m, target: v.target, params: v.params, runs, passes, required: v.required, expectFail: v.expectFail, caught: v.expectFail ? out.every((r) => r.checks[v.expectFail!] === false) : undefined, checks: tally, label: m === 'worker' ? 'local-observed' : 'control', runsDetail: out };
  save(`probes/${v.id}.${m}.json`, res);
  console.log(`${m.padEnd(7)} ${v.id.padEnd(48)} ${passes}/${runs}${v.expectFail ? ` planted(${v.expectFail}) caught=${res.caught}` : ''}  ${Object.entries(tally).filter(([k, t]) => t.pass < t.of).map(([k, t]) => `${k}:${t.pass}/${t.of}`).join(' ')}`);
  return res;
}
const trim = (s: any, n = 600) => { const j = JSON.stringify(s); return j && j.length > 20000 ? { truncated: true, bytes: j.length } : s; };
function slimResponse(r: any) { if (!r) return r; const o = r.observations; if (o?.timeline) { const t = o.timeline as any[]; return { ...r, observations: { ...o, timeline: t.filter((_, i) => i % Math.ceil(t.length / 40) === 0) } }; } return trim(r); }
function slimExtra(e: any) { return trim(e); }
const r1 = (n: number | undefined) => (n === undefined ? n : Math.round(n * 10) / 10);
function slimProxy(cs: any[]) {
  const one = (c: any) => ({ id: c.id, route: c.route, kind: c.kind, label: c.label, openedAt: r1(c.openedAt), closedAt: r1(c.closedAt), closedBy: c.closedBy, c2sBytes: c.c2sBytes, s2cBytes: c.s2cBytes, sslAnswer: c.sslAnswer, tlsAtC2s: c.tlsStartsAtC2sOffset, tlsAtS2c: c.tlsStartsAtS2cOffset,
    bytesBeforeSslAnswer: c.bytesBeforeSslAnswer, cancelPid: c.cancelPid, c2sTypes: c.c2sTypes, s2cErrors: c.s2cErrors.length ? c.s2cErrors : undefined, clientHello: c.clientHello ? { ...c.clientHello, extensions: undefined, cipherSuites: c.clientHello.cipherSuites } : undefined,
    frames: c.frames.length ? c.frames : undefined, copyBodySha256: c.copyBodySha256, copyBodyBytes: c.copyBodyBytes, stalled: c.stalled, flipped: c.flipped });
  if (cs.length <= 8) return cs.map(one);
  const at = cs.map((c) => c.openedAt as number);
  return { connections: cs.length, openedSpreadMs: r1(Math.max(...at) - Math.min(...at)), withErrors: cs.filter((c) => c.s2cErrors.length).length, closedByClient: cs.filter((c) => c.closedBy === 'client').length, sample: cs.slice(0, 2).map(one) };
}

export async function runBigLadder(lab: Lab, specs: string[], m: 'worker' | 'control', runs: number, target = 'pg17-tls') {
  for (const spec of specs) {
    const sizes = SIZES; // 64 KiB up to 128 MiB, never above
    for (let k = 0; k < sizes.length; k++) {
      const res = await runVariant(lab, bigVariant(spec, sizes[k]!, target), m, runs);
      if (res.passes < runs) { // first failing size: test the next size up once, then stop
        if (k + 1 < sizes.length) await runVariant(lab, bigVariant(spec, sizes[k + 1]!, target), m, 1);
        break;
      }
    }
  }
}

if (import.meta.main) {
  const need = new Set<string>(['pg17-tls', 'pg17-plain']);
  if (only.some((p) => p.startsWith('p6'))) { need.add('my84'); need.add('ma118'); }
  const sel = variants.filter((v) => !only.length || only.some((p) => v.id.startsWith(p) || v.group === p));
  for (const v of sel) need.add(serverOf(v.target));
  if (only.some((p) => p.startsWith('pg19'))) { /* servers for the PostgreSQL 19.0 subset */ need.add('pg19-tls'); need.add('pg19-plain'); }
  const lab = new Lab(); await lab.start([...need]);
  const modes = mode === 'both' ? ['control', 'worker'] as const : [mode] as const;
  try {
    for (const m of modes) {
      if (m === 'worker') await lab.startWorker();
      for (const v of sel) { if (m === 'control' && v.kind === 'state') continue; await runVariant(lab, v, m, v.runs ?? RUNS); }
      if (!only.length || only.includes('pg19')) await runBigLadder(lab, ['bind-single'], m, RUNS, 'pg19-tls');
      const all = !only.length || only.includes('p3'); const specs = only.filter((p) => p.startsWith('p3.write.')).map((p) => p.slice(9));
      if (all || specs.length) await runBigLadder(lab, all ? Object.keys(BIG_SPECS) : specs, m, RUNS);
      if (all || only.includes('p3.backpressure')) for (const bp of [true, false]) await runVariant(lab, backpressureVariant(bp), m, RUNS);
    }
  } finally { await lab.stop(); }
}
