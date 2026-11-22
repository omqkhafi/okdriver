// aimd: per-connection cap grows by ADD per cap completions while latency stays within THRESH x the connection's
// minimum latency, and is multiplied by MULT when it does not (at most once per window: only a statement written
// after the previous cut can cause the next). Least-in-flight placement.
import type { Policy, PolicyFactory } from './types.ts';
export const CONSTANTS = { INIT: 2, MAX: 128, ADD: 1, MULT: 0.5, THRESH: 2 } as const;
export const create: PolicyFactory = (_clock, n): Policy => {
  const cap = new Float64Array(n).fill(CONSTANTS.INIT);
  const base = new Float64Array(n).fill(Infinity);
  const lastCut = new Float64Array(n).fill(-Infinity);
  return {
    name: 'aimd',
    cap: (c) => Math.max(1, Math.floor(cap[c.id]!)),
    pick(eligible) {
      let best = eligible[0]!;
      for (const c of eligible) if (c.inFlight < best.inFlight) best = c;
      return best;
    },
    onComplete(c, k) {
      const lat = k.doneAt - k.sentAt;
      if (lat < base[c.id]!) base[c.id] = lat;
      if (lat <= CONSTANTS.THRESH * base[c.id]!) cap[c.id] = Math.min(CONSTANTS.MAX, cap[c.id]! + CONSTANTS.ADD / cap[c.id]!);
      else if (k.sentAt >= lastCut[c.id]!) { cap[c.id] = Math.max(1, cap[c.id]! * CONSTANTS.MULT); lastCut[c.id] = k.doneAt; }
    },
  };
};
