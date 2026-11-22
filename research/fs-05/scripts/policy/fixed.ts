// fixed: one depth cap D for every connection, least-in-flight placement.
import type { Policy, PolicyFactory } from './types.ts';
export const CONSTANTS = { D: 16 } as const;
export const create: PolicyFactory = (_clock, _n, opts): Policy => {
  const D = opts?.D ?? CONSTANTS.D;
  return {
    name: `fixed:${D}`,
    cap: () => D,
    pick(eligible) {
      let best = eligible[0]!;
      for (const c of eligible) if (c.inFlight < best.inFlight) best = c;
      return best;
    },
    onComplete() {},
  };
};
