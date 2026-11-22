// control: depth 1, no pipelining. A connection carries one statement at a time.
import type { Policy, PolicyFactory } from './types.ts';
export const CONSTANTS = {} as const;
export const create: PolicyFactory = (): Policy => ({
  name: 'control',
  cap: () => 1,
  pick(eligible) {
    let best = eligible[0]!;
    for (const c of eligible) if (c.inFlight < best.inFlight) best = c;
    return best;
  },
  onComplete() {},
});
