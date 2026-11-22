// The mixes and unit shapes of the study, generated identically for both instruments.
import { K_CPU, K_ERR, K_FAST, K_SLEEP, type Stmt, type Unit } from './pool.ts';
import { Rng } from './rng.ts';

export interface Mix { id: string; slowKind: 'none' | 'sleep' | 'cpu'; slowMs: number; slowShare: number }
export const MIXES: Mix[] = [
  { id: 'm0-fast', slowKind: 'none', slowMs: 0, slowShare: 0 },
  { id: 'm1-sleep5-1', slowKind: 'sleep', slowMs: 5, slowShare: 0.01 },
  { id: 'm2-sleep50-1', slowKind: 'sleep', slowMs: 50, slowShare: 0.01 },
  { id: 'm3-sleep5-10', slowKind: 'sleep', slowMs: 5, slowShare: 0.10 },
  { id: 'm4-sleep50-10', slowKind: 'sleep', slowMs: 50, slowShare: 0.10 },
  { id: 'm5-cpu5-1', slowKind: 'cpu', slowMs: 5, slowShare: 0.01 },
  { id: 'm6-cpu50-1', slowKind: 'cpu', slowMs: 50, slowShare: 0.01 },
  { id: 'm7-cpu5-10', slowKind: 'cpu', slowMs: 5, slowShare: 0.10 },
  { id: 'm8-cpu50-10', slowKind: 'cpu', slowMs: 50, slowShare: 0.10 },
];
export const mixById = (id: string): Mix => MIXES.find((m) => m.id === id) ?? (() => { throw new Error(`unknown mix ${id}`); })();
export type Shape = 'standalone' | 'pipeline8';
export const stmtsPerUnit = (shape: Shape): number => (shape === 'pipeline8' ? 8 : 1);
export const TABLE_ROWS = 100000;
/** generate_series upper bound per slow-statement length (ms); set by scripts/real/measure-service.ts (results/service.json). */
export type CpuN = (ms: number) => number;
export const CPU_N_DEFAULT: CpuN = (ms) => (ms <= 5 ? 90000 : 900000);

export class Generator {
  private rng: Rng;
  private uid = 0;
  constructor(seed: number, private mix: Mix, private shape: Shape, private errRate = 0, private cpuN: CpuN = CPU_N_DEFAULT) { this.rng = new Rng(seed); }
  rngNext(): number { return this.rng.next(); }
  exp(rate: number): number { return this.rng.exp(rate); }
  normal(): number { return this.rng.normal(); }
  private stmt(unit: Unit, idx: number, t0: number): Stmt {
    const m = this.mix;
    let kind = K_FAST, arg = this.rng.int(TABLE_ROWS), cls = 0;
    if (m.slowShare > 0 && this.rng.next() < m.slowShare) {
      cls = 1;
      if (m.slowKind === 'sleep') { kind = K_SLEEP; arg = m.slowMs; } else { kind = K_CPU; arg = this.cpuN(m.slowMs); }
    } else if (this.errRate > 0 && this.rng.next() < this.errRate) { kind = K_ERR; arg = 0; }
    return { uid: ++this.uid, kind, arg, cls, t0, sentAt: 0, sentIdle: false, unit, idx };
  }
  unit(t0: number, onStmt: Unit['onStmt'], onDone: Unit['onDone']): Unit {
    const u: Unit = { stmts: [], onStmt, onDone, done: 0, next: 0 };
    const n = stmtsPerUnit(this.shape);
    for (let i = 0; i < n; i++) u.stmts.push(this.stmt(u, i, t0));
    return u;
  }
}

/** Latency of one result and which class it is, accumulated per run. */
export class Recorder {
  fast: Float64Array; slow: Float64Array; nFast = 0; nSlow = 0; completed = 0; errors = 0;
  constructor(cap = 400000) { this.fast = new Float64Array(cap); this.slow = new Float64Array(cap / 4); }
  add(cls: number, latencyMs: number): void {
    this.completed++;
    if (cls === 0) { if (this.nFast < this.fast.length) this.fast[this.nFast++] = latencyMs; }
    else if (cls === 1) { if (this.nSlow < this.slow.length) this.slow[this.nSlow++] = latencyMs; }
  }
}
