// Policy ids used by every script: control, fixed:<D>, rtt-aware, latency-aware, aimd.
import type { Clock, Policy } from './types.ts';
import { create as control } from './control.ts';
import { create as fixed } from './fixed.ts';
import { create as rttAware } from './rtt-aware.ts';
import { create as latencyAware } from './latency-aware.ts';
import { create as aimd } from './aimd.ts';

export const POLICY_FILES = ['control', 'fixed', 'rtt-aware', 'latency-aware', 'aimd'] as const; // the order of the brief
export function makePolicy(id: string, clock: Clock, n: number): Policy {
  if (id === 'control') return control(clock, n);
  if (id.startsWith('fixed:')) return fixed(clock, n, { D: Number(id.slice(6)) });
  if (id === 'rtt-aware') return rttAware(clock, n);
  if (id === 'latency-aware') return latencyAware(clock, n);
  if (id === 'aimd') return aimd(clock, n);
  throw new Error(`unknown policy ${id}`);
}
