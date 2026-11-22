// latency-aware: fixed cap, placement by lowest expected completion, from measured per-connection latency.
// Peak-EWMA: the estimate jumps up to a slow observation, falls by ALPHA per faster one, and decays by half
// every HALF_LIFE ms without observations (so a connection that was slow is eventually tried again).
// Expected completion of a new statement on c = estimate(c) x (inFlight(c) + 1). A connection never observed costs 0.
import type { Policy, PolicyFactory } from './types.ts';
export const CONSTANTS = { CAP: 16, ALPHA: 0.2, HALF_LIFE: 1000 } as const;
export const create: PolicyFactory = (clock, n): Policy => {
  const est = new Float64Array(n);
  const seen = new Float64Array(n);
  const cost = (c: { id: number; inFlight: number }) =>
    est[c.id]! * 0.5 ** ((clock.now() - seen[c.id]!) / CONSTANTS.HALF_LIFE) * (c.inFlight + 1);
  return {
    name: 'latency-aware',
    cap: () => CONSTANTS.CAP,
    pick(eligible) {
      let best = eligible[0]!;
      let bestCost = cost(best);
      for (const c of eligible) {
        const x = cost(c);
        if (x < bestCost || (x === bestCost && c.inFlight < best.inFlight)) { best = c; bestCost = x; }
      }
      return best;
    },
    onComplete(c, k) {
      const lat = k.doneAt - k.sentAt;
      const cur = est[c.id]! * 0.5 ** ((k.doneAt - seen[c.id]!) / CONSTANTS.HALF_LIFE);
      est[c.id] = lat > cur ? lat : cur + CONSTANTS.ALPHA * (lat - cur);
      seen[c.id] = k.doneAt;
    },
  };
};
