// Real-server runs: closed loop and open loop through the shared pool core, against Postgres directly or through the
// delay/trace proxy. One JSON line per run goes to work/raw/real.jsonl (ignored); results/real-*.json are made from it by aggregate.ts.
// Pin: `taskset -c 0 bun scripts/real/run-real.ts <plan>`; the proxy runs on core 1, Postgres on cores 2 and 3 (pg-up.sh).
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { PoolCore, K_ERR, K_FAST, K_LOCK, K_UNLOCK, type Result, type Stmt, type Unit } from '../core/pool.ts';
import { CPU_N_DEFAULT, Generator, mixById, stmtsPerUnit, type CpuN, type Shape } from '../core/workload.ts';
import { makePolicy } from '../policy/index.ts';
import { percentiles, agg } from '../core/stats.ts';
import { DIRECT, expectedValue, RealConn, RealTransport, type Target } from './conn.ts';

export const ROOT = new URL('../../', import.meta.url).pathname;
export const RAW = ROOT + 'work/raw/';
mkdirSync(RAW, { recursive: true });
export const P = 8;
export const WARM_MS = 1000;
export const FAST_TARGET = 103000;

export type Rtt = 'loop' | 'loopT' | 'd4' | 'd20';
export interface Cell { rtt: Rtt; mix: string; shape: Shape; sharing: boolean }
export type Load = { kind: 'closed'; n: number } | { kind: 'open'; rate: number; frac: number; fastTarget?: number; seconds?: number };
export interface RunSpec { cell: Cell; config: string; load: Load; run: number; scenario?: 'normal' | 'stuck' | 'kill'; errRate?: number; label?: string }
export const cellId = (c: Cell) => `${c.rtt}|${c.mix}|${c.shape}|${c.sharing ? 'on' : 'off'}`;
export const loadId = (l: Load) => (l.kind === 'closed' ? `closed${l.n}` : `open${l.frac}`);
export const runKey = (s: RunSpec) => `${s.label ?? ''}|${cellId(s.cell)}|${s.config}|${loadId(s.load)}|${s.run}|${s.scenario ?? 'normal'}|${s.errRate ?? 0}`;

// Proxy set-up: rtt -> where the harness connects. One-way delays are chosen by scripts/real/rtt-probe.ts (results/rtt.json).
export const PROXIES: Record<string, { port: number; ctl: number; oneWay: number }> = {
  loopT: { port: 55501, ctl: 55601, oneWay: 0 },
  d4: { port: 55502, ctl: 55602, oneWay: 1.5 },
  d20: { port: 55503, ctl: 55603, oneWay: 9 },
};
export function loadProxyConfig(): void {
  const f = ROOT + 'results/rtt.json';
  if (existsSync(f)) { const j = JSON.parse(readFileSync(f, 'utf8')); for (const k of Object.keys(PROXIES)) if (j.oneWay?.[k] !== undefined) PROXIES[k]!.oneWay = j.oneWay[k]; }
}
const children: ReturnType<typeof spawn>[] = [];
export function startProxies(which: string[]): void {
  for (const k of which) {
    const p = PROXIES[k]!;
    children.push(spawn('taskset', ['-c', '1', 'bun', new URL('./delayproxy.ts', import.meta.url).pathname, String(p.port), '55432', String(p.oneWay), String(p.ctl)], { stdio: 'ignore' }));
  }
}
export const stopProxies = () => { for (const c of children) c.kill(); };
const ctl = async (rtt: string, path: string) => (await (await fetch(`http://127.0.0.1:${PROXIES[rtt]!.ctl}${path}`)).json()) as any;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const now = () => performance.now();

export interface RunResult {
  spec: RunSpec; ok: boolean; error?: string;
  thr: number; fastP50: number; fastP99: number; fastP999: number; slowP99: number; nFast: number; nFastDone: number; nSlow: number; completed: number;
  cpuUsPerStmt: number; util: number; overloaded: boolean; wallMs: number;
  defects: { wrongResult: number; unexpectedError: number; errorWrong: number; mismatch: number; misorder: number };
  errorsSeen: number; errorsExpected: number;
  maxInFlightPolicy: number[]; trace?: any; proxyCpuUtil?: number;
  scenario?: any;
}

export async function runOnce(spec: RunSpec): Promise<RunResult> {
  const { cell } = spec;
  const mix = mixById(cell.mix);
  const target: Target = cell.rtt === 'loop' ? DIRECT : { ...DIRECT, port: PROXIES[cell.rtt]!.port };
  const traced = cell.rtt !== 'loop';
  if (traced) await ctl(cell.rtt, '/reset');
  const transport = new RealTransport();
  const clock = { now };
  const policy = makePolicy(spec.config, clock, P);
  const results: { pool?: PoolCore } = {};
  const lostStmts = new WeakSet<Stmt>();
  let blockerConn = -1;
  const defects = { wrongResult: 0, unexpectedError: 0, errorWrong: 0, mismatch: 0, misorder: 0 };
  const maxIn = new Array(P).fill(0);
  const lostReports: any[] = [];
  const conns: RealConn[] = [];
  for (let i = 0; i < P; i++) {
    const c = new RealConn(i, (id, r) => results.pool!.complete(id, r), (id) => {
      if (stopped) return;
      const rep = results.pool!.lose(id);
      for (const s of [...rep.onWire, ...rep.notSent]) lostStmts.add(s);
      lostReports.push({ connId: id, at: now(), onWire: rep.onWire.length, notSent: rep.notSent.length });
    });
    await c.open(target);
    conns.push(c); transport.conns.push(c);
  }
  let stopped = false;
  const send = transport.send.bind(transport);
  transport.send = (id, batch) => {
    send(id, batch);
    const d = results.pool!.inFlightOf(id); if (d > maxIn[id]) maxIn[id] = d;
    if (blockerConn < 0 && batch.some((s) => s.kind === K_LOCK)) blockerConn = id;
  };
  const pool = new PoolCore({ connections: P, policy, clock, sharing: cell.sharing, transport });
  results.pool = pool;

  const gen = new Generator(1000 + spec.run * 7919 + (spec.load.kind === 'open' ? Math.round(spec.load.frac * 100) : 0), mix, cell.shape, spec.errRate ?? 0, cpuN);
  const rec = { fast: new Float64Array(500000), slow: new Float64Array(120000), nFast: 0, nSlow: 0, completed: 0, errors: 0, errorsExpected: 0 };
  let winStart = Infinity, winEnd = Infinity;
  const outstanding = new Set<Unit>();
  const openLoop = spec.load.kind === 'open';
  const windows: { name: string; from: number; to: number; fast: number[]; }[] = [];
  const onStmt = (s: Stmt, r: Result) => {
    const t = now();
    if (s.kind === K_ERR) { if (r.err !== '22012') defects.errorWrong++; else rec.errors++; }
    else if (s.kind !== K_LOCK && s.kind !== K_UNLOCK) {
      if (r.err !== null) defects.unexpectedError++;
      else if (r.uid !== s.uid || r.v !== expectedValue(s)) defects.wrongResult++;
    }
    const inWin = t >= winStart && t <= winEnd;
    if (inWin) rec.completed++;
    // closed loop: latencies of statements that complete inside the window; open loop: every statement scheduled after the warm-up,
    // however late it completes (so the drain after the last arrival is part of the tail)
    if (openLoop ? s.t0 >= winStart : inWin) {
      if (s.cls === 0 && s.kind !== K_ERR) { if (rec.nFast < rec.fast.length) rec.fast[rec.nFast++] = t - s.t0; for (const w of windows) if (s.t0 >= w.from && s.t0 < w.to) w.fast.push(t - s.t0); }
      else if (s.cls === 1) { if (rec.nSlow < rec.slow.length) rec.slow[rec.nSlow++] = t - s.t0; }
    }
  };
  const t0run = now();
  let cpuStart = process.cpuUsage(), wallStart = t0run;
  let overloaded = false;
  let nFastDone = -1;
  const scen: any = {};
  let lastArrival = 0;

  if (spec.load.kind === 'closed') {
    const N = spec.load.n;
    let stop = false;
    const issue = (): void => { const u = gen.unit(now(), onStmt, onDone); pool.submit(u); };
    const onDone = (): void => { if (!stop) issue(); };
    for (let i = 0; i < N; i++) issue();
    await sleep(WARM_MS);
    winStart = now(); cpuStart = process.cpuUsage(); wallStart = winStart;
    await sleep(3000);
    winEnd = now(); stop = true;
  } else {
    const L = spec.load;
    const spu = stmtsPerUnit(cell.shape);
    const unitRate = L.rate / spu / 1000; // units per ms
    const fastFrac = 1 - mix.slowShare;
    const dur = WARM_MS + (L.seconds ? L.seconds * 1000 : ((L.fastTarget ?? FAST_TARGET) / (L.rate * fastFrac)) * 1000);
    const start = now();
    winStart = start + WARM_MS;
    const scenarioStuck = spec.scenario === 'stuck';
    const tStuck = 3000, hold = 3000;
    if (scenarioStuck) windows.push({ name: 'before', from: start + WARM_MS, to: start + tStuck, fast: [] }, { name: 'during', from: start + tStuck, to: start + tStuck + hold, fast: [] }, { name: 'after', from: start + tStuck + hold, to: start + tStuck + hold + 3000, fast: [] });
    let next = start + gen.exp(unitRate);
    let issued = 0;
    const end = scenarioStuck ? start + tStuck + hold + 3000 : start + dur;
    let holder: RealConn | null = null;
    const holderRes: Result[] = [];
    if (scenarioStuck) {
      holder = new RealConn(99, (_i, r) => holderRes.push(r), () => {});
      await holder.open(target);
      const mk = (kind: number, uid: number): Stmt => ({ uid, kind, arg: 4242, cls: 2, t0: 0, sentAt: 0, sentIdle: false, unit: null as never, idx: 0 });
      holder.write([mk(K_LOCK, -1 >>> 0)]);
      while (holderRes.length < 1) await sleep(2);
      scen.stuckSnap = {};
    }
    let stuckDone = false, releaseDone = false, killDone = false;
    const admin = spec.scenario === 'kill' ? await (async () => { const { PgConn } = await import('./lib/client.ts'); return PgConn.connect({ host: DIRECT.host, port: DIRECT.port, user: DIRECT.user, password: DIRECT.password, database: DIRECT.database, tls: false }); })() : null;
    const snap = async (name: string) => { if (traced) scen.stuckSnap[name] = (await ctl(cell.rtt, '/stats')).conns.map((c: any) => [c.syncs, c.zs]); };
    await new Promise<void>((resolve) => {
      const tick = () => {
        const t = now();
        while (next <= t && next < end) {
          const u = gen.unit(next, onStmt, (uu) => outstanding.delete(uu));
          outstanding.add(u); pool.submit(u); issued++; lastArrival = next;
          next += gen.exp(unitRate);
        }
        if (scenarioStuck && !stuckDone && t >= start + tStuck) {
          stuckDone = true;
          scen.blockerAt = t - start;
          const u: Unit = { stmts: [], onStmt: () => {}, onDone: () => {}, done: 0, next: 0 };
          u.stmts.push({ uid: 1e9, kind: K_LOCK, arg: 4242, cls: 2, t0: t, sentAt: 0, sentIdle: false, unit: u, idx: 0 });
          pool.submit(u);
          void snap('atBlock');
        }
        if (scenarioStuck && !releaseDone && t >= start + tStuck + hold) {
          releaseDone = true; scen.releaseAt = t - start;
          void snap('atRelease');
          const mk: Stmt = { uid: -2 >>> 0, kind: K_UNLOCK, arg: 4242, cls: 2, t0: 0, sentAt: 0, sentIdle: false, unit: null as never, idx: 0 };
          holder!.write([mk]);
        }
        if (admin && !killDone && t >= start + WARM_MS + 2000) {
          killDone = true; scen.killAt = t - start; scen.killConn = 3;
          scen.inFlightBeforeKill = pool.inFlightOf(3);
          void killViaQuery(admin, conns[3]!.pid);
        }
        if (t >= end) { resolve(); return; }
        setTimeout(tick, Math.max(0, next - now()));
      };
      tick();
    });
    winEnd = now();
    // grace: wait for the outstanding statements
    const graceEnd = now() + 3000;
    while (outstanding.size > 0 && now() < graceEnd) {
      let live = 0; for (const u of outstanding) { if (u.stmts.some((s) => lostStmts.has(s))) outstanding.delete(u); else live++; }
      if (live === 0) break;
      await sleep(5);
    }
    let live = 0; for (const u of outstanding) if (!u.stmts.some((s) => lostStmts.has(s))) live++;
    if (live > 0) {
      overloaded = true; nFastDone = rec.nFast;
      const tEnd = now();
      for (const u of outstanding) { if (u.stmts.some((s) => lostStmts.has(s))) continue; for (const s of u.stmts.slice(u.done)) if (s.t0 >= winStart) { if (s.cls === 0 && s.kind !== K_ERR) rec.fast[rec.nFast++] = tEnd - s.t0; else if (s.cls === 1) rec.slow[rec.nSlow++] = tEnd - s.t0; } }
    }
    winEnd = Math.max(winEnd, now());
    if (holder) holder.close();
    if (admin) admin.close();
    void lastArrival;
  }
  const cpu = process.cpuUsage(cpuStart);
  const wall = now() - wallStart;
  const cpuMs = (cpu.user + cpu.system) / 1000;
  let trace: any, proxyCpuUtil: number | undefined;
  if (traced) {
    const st = await ctl(cell.rtt, '/stats');
    trace = { max: Math.max(...st.conns.map((c: any) => c.max)), perConn: st.conns.map((c: any) => ({ max: c.max, p50: c.p50, p99: c.p99, mean: +c.mean.toFixed(2), syncs: c.syncs, zs: c.zs, onWireAtClose: c.onWireAtClose })), syncs: st.conns.reduce((a: number, c: any) => a + c.syncs, 0), zs: st.conns.reduce((a: number, c: any) => a + c.zs, 0) };
    proxyCpuUtil = st.cpuMs / st.wallMs;
    if (spec.scenario === 'kill') scen.proxyAtClose = st.conns.map((c: any) => c.onWireAtClose);
  }
  stopped = true;
  for (const c of conns) c.close();
  await sleep(20);
  const win = spec.load.kind === 'closed' ? 3000 : Math.max(1, winEnd - winStart);
  const f = percentiles(rec.fast, rec.nFast, [0.5, 0.99, 0.999]);
  const sl = percentiles(rec.slow, rec.nSlow, [0.99]);
  defects.mismatch = pool.mismatches; defects.misorder = pool.misorders;
  if (windows.length) scen.windows = windows.map((w) => { const a = Float64Array.from(w.fast); const p = percentiles(a, a.length, [0.5, 0.99, 0.999, 1]); return { name: w.name, n: a.length, p50: p[0], p99: p[1], p999: p[2], max: p[3], over100ms: w.fast.filter((x) => x > 100).length }; });
  if (blockerConn >= 0) scen.blockerConn = blockerConn;
  if (lostReports.length) scen.lost = lostReports;
  const res: RunResult = {
    spec, ok: true, thr: rec.completed / (win / 1000), fastP50: f[0]!, fastP99: f[1]!, fastP999: f[2]!, slowP99: sl[0]!, nFast: rec.nFast, nFastDone: nFastDone >= 0 ? nFastDone : rec.nFast, nSlow: rec.nSlow, completed: rec.completed,
    cpuUsPerStmt: rec.completed ? (cpuMs * 1000) / rec.completed : NaN, util: cpuMs / (spec.load.kind === 'closed' ? wall : Math.max(1, wall)), overloaded, wallMs: now() - t0run,
    defects, errorsSeen: rec.errors, errorsExpected: 0, maxInFlightPolicy: maxIn, trace, proxyCpuUtil, scenario: Object.keys(scen).length ? scen : undefined,
  };
  Bun.gc(true);
  return res;
}

async function killViaQuery(admin: import('./lib/client.ts').PgConn, pid: number): Promise<void> {
  const { query } = await import('./lib/wire.ts');
  admin.write(query(`select pg_terminate_backend(${pid})`));
}

const cpuN: CpuN = (ms) => {
  const f = ROOT + 'results/service.json';
  const j = existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null;
  return j ? (ms <= 5 ? j.cpuN5 : j.cpuN50) : CPU_N_DEFAULT(ms);
};

export function loadDone(file = RAW + 'real.jsonl'): Map<string, RunResult> {
  const m = new Map<string, RunResult>();
  if (existsSync(file)) for (const l of readFileSync(file, 'utf8').split('\n')) if (l) { try { const r = JSON.parse(l) as RunResult; m.set(runKey(r.spec), r); } catch { /* partial line */ } }
  return m;
}

/** Runs one cell: closed-loop at every caller count for every config, then open loops at fractions of T*. */
export async function runCell(cell: Cell, configs: string[], opts: { closed: number[]; fracs: number[]; runs: number; file?: string; label?: string; fastTarget?: number }): Promise<void> {
  const file = opts.file ?? RAW + 'real.jsonl';
  const done = loadDone(file);
  const exec = async (spec: RunSpec): Promise<RunResult> => {
    const k = runKey(spec);
    const have = done.get(k); if (have) return have;
    let r: RunResult;
    try { r = await runOnce(spec); } catch (e: any) { r = { spec, ok: false, error: String(e?.message ?? e) } as RunResult; }
    appendFileSync(file, JSON.stringify(r) + '\n'); done.set(k, r);
    console.log(`${cellId(cell)} ${spec.config} ${loadId(spec.load)} run${spec.run}: ${r.ok ? `thr=${r.thr.toFixed(0)} p999=${r.fastP999.toFixed(2)} slowP99=${r.slowP99.toFixed(1)} cpu=${r.cpuUsPerStmt.toFixed(1)}us util=${r.util.toFixed(2)}${r.overloaded ? ' OVERLOADED' : ''} defects=${JSON.stringify(r.defects)}` : 'ERROR ' + r.error}`);
    return r;
  };
  for (const n of opts.closed) for (const config of configs) for (let run = 0; run < opts.runs; run++) await exec({ cell, config, load: { kind: 'closed', n }, run, label: opts.label });
  const nmax = Math.max(...opts.closed);
  let tstar = 0;
  for (const config of configs) { const t = agg(Array.from({ length: opts.runs }, (_, i) => done.get(runKey({ cell, config, load: { kind: 'closed', n: nmax }, run: i, label: opts.label }))).filter((r) => r?.ok).map((r) => r!.thr)).med; if (t > tstar) tstar = t; }
  console.log(`${cellId(cell)} T*=${tstar.toFixed(0)}`);
  for (const frac of opts.fracs) for (const config of configs) for (let run = 0; run < opts.runs; run++) await exec({ cell, config, load: { kind: 'open', rate: Math.round(frac * tstar), frac, fastTarget: opts.fastTarget }, run, label: opts.label });
}
