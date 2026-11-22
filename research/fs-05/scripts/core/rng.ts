// Seeded PRNG (mulberry32) shared by the workload generator in both instruments.
export class Rng {
  private s: number;
  constructor(seed: number) { this.s = seed >>> 0; }
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  exp(rate: number): number { return -Math.log(1 - this.next()) / rate; }
  int(n: number): number { return Math.floor(this.next() * n); }
  /** Standard normal (Box-Muller). */
  normal(): number { return Math.sqrt(-2 * Math.log(1 - this.next())) * Math.cos(2 * Math.PI * this.next()); }
}
