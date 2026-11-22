// Deterministic discrete-event simulator, virtual clock (milliseconds). It runs the same PoolCore and the same policy files
// as the real client. Server model: one serial backend per connection; CPU work of all busy backends shares `cores` cores
// (processor sharing); timed statements hold their backend without using CPU. Client model: one thread that serialises
// every issue, write and read, so client-bound shows up here as it does on the real box. Parameters come from
// scripts/sim/calibrate.ts (fitted on the real calibration cells); nothing else is tuned.
import { PoolCore, type Result, type Stmt, type Unit, K_SLEEP, K_CPU } from '../core/pool.ts';
import { Generator, mixById, stmtsPerUnit, type Shape } from '../core/workload.ts';
import { makePolicy } from '../policy/index.ts';
import { percentiles } from '../core/stats.ts';

export interface SimParams {
  /** server CPU per statement (ms of one core) and its log-normal spread */
  sFast: number; sigma: number;
  /** server CPU for waking a backend that was idle when a batch arrived (receive syscall, scheduling) */
  wake: number;
  cores: number;
  /** with probability hiccupP a statement is held an extra exponential time with mean hiccupMs (no CPU): the depth-1 latency tail of the real server */
  hiccupP: number; hiccupMs: number;
  /** extra time a timed statement takes beyond its sleep (ms); CPU of the CPU-bound statements (ms of one core) for the 5 ms and the 50 ms bound (service.json) */
  sleepExtra: number; cpuMs5: number; cpuMs50: number; cpuN5: number;
  /** client thread costs (ms): per unit issued, per statement encoded, per statement decoded, per write, per read */
  cUnit: number; cStmt: number; cDec: number; cWrite: number; cRead: number;
  /** one-way network delay (ms) at loopback; open-loop arrivals are handled on a timer grid of this many ms */
  oneWay0: number; arrTick: number;
}
export interface Net { oneWay: number; quantum: number }
export interface SimSpec {
  net: Net; mix: string; shape: Shape; sharing: boolean; config: string; seed: number;
  load: { kind: 'closed'; n: number } | { kind: 'open'; rate: number; fastTarget?: number };
  P?: number;
  /** closed loop: warm-up and measurement window (virtual ms) */
  warmMs?: number; closedMs?: number;
}
export interface SimResult {
  thr: number; fastP50: number; fastP99: number; fastP999: number; slowP99: number; nFast: number; nFastDone: number; nSlow: number; completed: number;
  cpuUsPerStmt: number; util: number; overloaded: boolean; mismatches: number; misorders: number; maxInFlight: number; events: number; avgQueue: number;
}

class Heap {
  t: number[] = []; s: number[] = []; k: number[] = []; a: number[] = []; b: any[] = [];
  private seq = 0;
  get size() { return this.t.length; }
  push(t: number, kind: number, a: number, b: any = null): void {
    let i = this.t.length;
    this.t.push(t); this.s.push(this.seq++); this.k.push(kind); this.a.push(a); this.b.push(b);
    while (i > 0) { const p = (i - 1) >> 1; if (this.less(i, p)) { this.swap(i, p); i = p; } else break; }
  }
  private less(i: number, j: number) { return this.t[i]! < this.t[j]! || (this.t[i] === this.t[j] && this.s[i]! < this.s[j]!); }
  private swap(i: number, j: number) {
    for (const arr of [this.t, this.s, this.k, this.a, this.b] as any[][]) { const x = arr[i]; arr[i] = arr[j]; arr[j] = x; }
  }
  pop(): { t: number; k: number; a: number; b: any } {
    const r = { t: this.t[0]!, k: this.k[0]!, a: this.a[0]!, b: this.b[0] };
    const n = this.t.length - 1;
    if (n > 0) { for (const arr of [this.t, this.s, this.k, this.a, this.b] as any[][]) arr[0] = arr[n]; }
    for (const arr of [this.t, this.s, this.k, this.a, this.b] as any[][]) arr.pop();
    let i = 0;
    for (;;) {
      const l = 2 * i + 1, rr = l + 1; let m = i;
      if (l < n && this.less(l, m)) m = l;
      if (rr < n && this.less(rr, m)) m = rr;
      if (m === i) break;
      this.swap(i, m); i = m;
    }
    return r;
  }
}

const EV_SRV_ARRIVE = 1, EV_PS = 2, EV_SLEEP = 3, EV_CLIENT = 4;

interface Backend { id: number; q: Stmt[]; cur: Stmt | null; cpuLeft: number; sleepMs: number; extra: Map<Stmt, number> }
interface Item { t: number; s: Stmt; res: Result }

export function runSim(spec: SimSpec, p: SimParams): SimResult {
  const P = spec.P ?? 8;
  const mix = mixById(spec.mix);
  const gen = new Generator(spec.seed * 7919 + 17, mix, spec.shape);
  const heap = new Heap();
  let T = 0;                 // event time
  let ct = 0;                // client thread time inside a callback
  const clock = { now: () => ct };
  const policy = makePolicy(spec.config, clock, P);
  const ow = spec.net.oneWay, q = spec.net.quantum;
  const qz = (t: number) => (q > 0 ? Math.ceil(t / q - 1e-9) * q : t);

  // ---- server
  const backends: Backend[] = Array.from({ length: P }, (_, i) => ({ id: i, q: [], cur: null, cpuLeft: 0, sleepMs: 0, extra: new Map() }));
  let V = 0, psT = 0, psN = 0, psVersion = 0;
  const psJobs: { vt: number; b: Backend }[] = [];
  const psPush = (j: { vt: number; b: Backend }) => { psJobs.push(j); psJobs.sort((x, y) => x.vt - y.vt); };
  const psAdvance = (t: number) => { if (psN > 0) V += (t - psT) * Math.min(1, p.cores / psN); psT = t; };
  const psSchedule = (t: number) => {
    psVersion++;
    if (psJobs.length === 0) return;
    const rate = Math.min(1, p.cores / psN);
    heap.push(t + Math.max(0, psJobs[0]!.vt - V) / rate, EV_PS, psVersion);
  };
  const cost = (s: Stmt, first: boolean): { cpu: number; sleep: number } => {
    const ln = Math.exp(p.sigma * gen.normal() - (p.sigma * p.sigma) / 2);
    const base = p.sFast * ln + (first ? p.wake : 0);
    const hic = gen.rngNext() < p.hiccupP ? -Math.log(1 - gen.rngNext()) * p.hiccupMs : 0;
    if (s.kind === K_SLEEP) return { cpu: base, sleep: s.arg + p.sleepExtra + hic };
    if (s.kind === K_CPU) return { cpu: base + (s.arg === p.cpuN5 ? p.cpuMs5 : p.cpuMs50), sleep: hic };
    return { cpu: base, sleep: hic };
  };
  const startNext = (b: Backend, t: number) => {
    if (b.cur) return;
    const s = b.q.shift();
    if (!s) return;
    b.cur = s;
    const first = b.extra.get(s) === 1; b.extra.delete(s);
    const c = cost(s, first);
    b.sleepMs = c.sleep;
    psAdvance(t); psPush({ vt: V + c.cpu, b }); psN++; psSchedule(t);
  };
  const respond = (b: Backend, t: number) => {
    const s = b.cur!; b.cur = null;
    const ta = qz(t + ow);
    rx[b.id]!.push({ t: ta, s, res: { uid: s.uid, v: 0, err: null } });
    wakeClient(ta);
    startNext(b, t);
  };

  // ---- client
  const rx: Item[][] = Array.from({ length: P }, () => []);
  let clientFree = 0, wakeAt = -1;
  let busyMs = 0, qSum = 0, qN = 0;
  const transport = {
    send(connId: number, batch: Stmt[]) {
      ct += p.cWrite;
      const ta = qz(ct + ow);
      heap.push(ta, EV_SRV_ARRIVE, connId, batch);
    },
  };
  const pool = new PoolCore({ connections: P, policy, clock, sharing: spec.sharing, transport });

  // measurement
  let winStart = Infinity, winEnd = Infinity;
  const fast = new Float64Array(500000), slow = new Float64Array(120000);
  let nFast = 0, nSlow = 0, completed = 0, maxIn = 0;
  let busyAtStart = 0;
  const openLoop = spec.load.kind === 'open';
  const onStmt = (s: Stmt, _r: Result) => {
    const inWin = ct >= winStart && ct <= winEnd;
    if (inWin) completed++;
    if (openLoop ? s.t0 >= winStart : inWin) {
      if (s.cls === 0) { if (nFast < fast.length) fast[nFast++] = ct - s.t0; } else if (s.cls === 1) { if (nSlow < slow.length) slow[nSlow++] = ct - s.t0; }
    }
  };
  const outstanding = new Set<Unit>();
  const mkUnit = (t0: number, closed: boolean): Unit => gen.unit(t0, onStmt, (u) => { outstanding.delete(u); if (closed && !stopClosed) { ct += p.cUnit + p.cStmt * stmtsPerUnit(spec.shape); const nu = mkUnit(ct, true); pool.submit(nu); } });
  let stopClosed = false;

  // open-loop arrivals
  let nextArr = Infinity, arrEnd = 0, unitRate = 0;
  const arrAvail = (t: number) => (p.arrTick > 0 ? Math.ceil(t / p.arrTick - 1e-9) * p.arrTick : t);

  const nextItemTime = (): number => {
    let m = Infinity;
    for (let c = 0; c < P; c++) { const h = rx[c]![0]; if (h && h.t < m) m = h.t; }
    if (nextArr < arrEnd) { const a = arrAvail(nextArr); if (a < m) m = a; }
    return m;
  };
  const wakeClient = (ta: number) => { const at = Math.max(ta, clientFree); if (wakeAt < 0 || at < wakeAt) { wakeAt = at; heap.push(at, EV_CLIENT, 0); } };
  const clientRun = (t: number) => {
    wakeAt = -1;
    ct = Math.max(t, clientFree);
    const start = ct;
    for (;;) {
      // earliest pending item that is available at ct
      let bestC = -1, bt = Infinity;
      for (let c = 0; c < P; c++) { const h = rx[c]![0]; if (h && h.t <= ct && h.t < bt) { bt = h.t; bestC = c; } }
      const arrT = nextArr < arrEnd ? arrAvail(nextArr) : Infinity;
      if (bestC >= 0 && bt <= arrT) {
        const r = rx[bestC]!;
        let k = 0; while (k < r.length && r[k]!.t <= ct) k++;
        ct += p.cRead;
        const items = r.splice(0, k);
        for (const it of items) { ct += p.cDec; pool.complete(bestC, it.res); }
        const d = pool.inFlightOf(bestC); if (d > maxIn) maxIn = d;
      } else if (arrT <= ct) {
        ct += p.cUnit + p.cStmt * stmtsPerUnit(spec.shape);
        const u = mkUnit(nextArr, false); outstanding.add(u); pool.submit(u);
        nextArr += gen.exp(unitRate);
      } else break;
    }
    qSum += pool.queued; qN++;
    busyMs += ct - start;
    clientFree = ct;
    const nt = nextItemTime();
    if (nt < Infinity) { wakeAt = Math.max(nt, clientFree); heap.push(wakeAt, EV_CLIENT, 0); }
  };

  // ---- run
  const WARM = spec.warmMs ?? 1000;
  const CLOSED = spec.closedMs ?? 2000;
  let endT: number;
  let overloaded = false, nFastDone = -1;
  if (spec.load.kind === 'closed') {
    const n = spec.load.n;
    winStart = WARM; winEnd = WARM + CLOSED; endT = winEnd;
    ct = 0;
    for (let i = 0; i < n; i++) { ct += p.cUnit + p.cStmt * stmtsPerUnit(spec.shape); pool.submit(mkUnit(ct, true)); }
    clientFree = ct; busyMs += ct;
  } else {
    const L = spec.load;
    const spu = stmtsPerUnit(spec.shape);
    unitRate = L.rate / spu / 1000;
    const dur = WARM + ((L.fastTarget ?? 103000) / (L.rate * (1 - mix.slowShare))) * 1000;
    winStart = WARM; arrEnd = dur; winEnd = dur; endT = dur + 3000;
    nextArr = gen.exp(unitRate);
    wakeClient(arrAvail(nextArr));
  }
  let events = 0;
  let busyWinStart = -1;
  while (heap.size) {
    const e = heap.pop();
    if (e.t > endT) {
      if (spec.load.kind === 'open' && e.t > endT) break;
    }
    T = e.t; events++;
    if (busyWinStart < 0 && T >= winStart) { busyWinStart = busyMs; busyAtStart = busyMs; }
    if (spec.load.kind === 'closed' && T > winEnd) break;
    switch (e.k) {
      case EV_SRV_ARRIVE: {
        const b = backends[e.a]!; const batch = e.b as Stmt[];
        const idle = !b.cur && b.q.length === 0; // the receive wake-up is paid only by a backend that was waiting for input
        batch.forEach((s, i) => { if (i === 0 && idle) b.extra.set(s, 1); b.q.push(s); });
        startNext(b, T);
        break;
      }
      case EV_PS: {
        if (e.a !== psVersion) break;
        psAdvance(T);
        const done: Backend[] = [];
        while (psJobs.length && psJobs[0]!.vt <= V + 1e-9) { done.push(psJobs.shift()!.b); psN--; }
        psSchedule(T);
        for (const b of done) { if (b.sleepMs > 0) heap.push(T + b.sleepMs, EV_SLEEP, b.id); else respond(b, T); }
        break;
      }
      case EV_SLEEP: respond(backends[e.a]!, T); break;
      case EV_CLIENT: if (T === wakeAt) clientRun(T); break; // a later wake-up that was superseded by an earlier one is stale
    }
  }
  if (spec.load.kind === 'open') {
    const tEnd = Math.min(endT, T);
    const live = [...outstanding].filter((u) => u.done < u.stmts.length);
    if (live.length > 0) {
      overloaded = true; nFastDone = nFast;
      for (const u of live) for (const s of u.stmts.slice(u.done)) if (s.t0 >= winStart) { if (s.cls === 0) fast[nFast++] = tEnd - s.t0; else if (s.cls === 1) slow[nSlow++] = tEnd - s.t0; }
    }
  }
  const win = spec.load.kind === 'closed' ? CLOSED : Math.max(1, winEnd - winStart);
  const f = percentiles(fast, nFast, [0.5, 0.99, 0.999]);
  const sl = percentiles(slow, nSlow, [0.99]);
  const busyWin = busyMs - (busyWinStart < 0 ? 0 : busyAtStart);
  return {
    thr: completed / (win / 1000), fastP50: f[0]!, fastP99: f[1]!, fastP999: f[2]!, slowP99: sl[0]!, nFast, nFastDone: nFastDone >= 0 ? nFastDone : nFast, nSlow, completed,
    cpuUsPerStmt: completed ? (busyWin * 1000) / completed : NaN, util: Math.min(1, busyWin / win), overloaded, mismatches: pool.mismatches, misorders: pool.misorders, maxInFlight: maxIn, events, avgQueue: qN ? qSum / qN : 0,
  };
}
