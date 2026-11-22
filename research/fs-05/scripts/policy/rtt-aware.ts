// rtt-aware: depth cap from the measured round trip and service time, least-in-flight placement.
// rtt = minimum latency over the last WINDOW statements that were written to an idle connection.
// svc = EWMA (weight ALPHA) of the gap between consecutive completions when the statement queued behind another.
// cap = ceil(rtt / svc) + 1 (enough statements to cover the round trip), at most DMAX; INIT until both are known.
import type { Policy, PolicyFactory } from './types.ts';
export const CONSTANTS = { ALPHA: 0.05, DMAX: 128, INIT: 2, WINDOW: 64 } as const;
export const create: PolicyFactory = (): Policy => {
  const ring = new Float64Array(CONSTANTS.WINDOW).fill(Infinity);
  let at = 0;
  let svc = NaN;
  let cap: number = CONSTANTS.INIT;
  return {
    name: 'rtt-aware',
    cap: () => cap,
    pick(eligible) {
      let best = eligible[0]!;
      for (const c of eligible) if (c.inFlight < best.inFlight) best = c;
      return best;
    },
    onComplete(_c, k) {
      if (k.sentIdle) { ring[at++ % CONSTANTS.WINDOW] = k.doneAt - k.sentAt; }
      else if (k.sentAt < k.prevDoneAt) {
        const gap = k.doneAt - k.prevDoneAt;
        svc = Number.isNaN(svc) ? gap : svc + CONSTANTS.ALPHA * (gap - svc);
      }
      let rtt = Infinity;
      for (let i = 0; i < CONSTANTS.WINDOW; i++) if (ring[i]! < rtt) rtt = ring[i]!;
      if (Number.isFinite(rtt) && svc > 0) cap = Math.max(1, Math.min(CONSTANTS.DMAX, Math.ceil(rtt / svc) + 1));
    },
  };
};
