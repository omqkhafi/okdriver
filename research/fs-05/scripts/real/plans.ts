// The real-run plans, in priority order. If the box runs out, later plans are cut in the order of the brief
// (PgBouncer, CPU-bound slow, 10% share, the 95% rate, extra D values); the correctness, stuck and kill plans are never cut.
// With sharing off a standalone statement holds its connection alone, so every policy that places by least-in-flight is the control
// by construction (cap never binds); only control and latency-aware (different placement) are run there.
import type { Cell } from './run-real.ts';
export const CONF_ON = ['control', 'fixed:4', 'fixed:16', 'fixed:64', 'rtt-aware', 'latency-aware', 'aimd'];
export const CONF_OFF_STANDALONE = ['control', 'latency-aware'];
export const CLOSED_FULL = [4, 32, 256, 2048];
export const CLOSED_RULE = [2048];
export interface PlanCell { cell: Cell; configs: string[]; closed: number[]; fracs: number[]; fastTarget?: number; calibration?: boolean }
const c = (rtt: Cell['rtt'], mix: string, shape: Cell['shape'], sharing: boolean): Cell => ({ rtt, mix, shape, sharing });
const on = (rtt: Cell['rtt'], mix: string, shape: Cell['shape'], full: boolean, fracs = [0.5, 0.8]): PlanCell => ({ cell: c(rtt, mix, shape, true), configs: CONF_ON, closed: full ? CLOSED_FULL : CLOSED_RULE, fracs });
const off = (rtt: Cell['rtt'], mix: string, shape: Cell['shape'], full: boolean, fracs = [0.5, 0.8]): PlanCell =>
  ({ cell: c(rtt, mix, shape, false), configs: shape === 'standalone' ? CONF_OFF_STANDALONE : CONF_ON, closed: full ? CLOSED_FULL : CLOSED_RULE, fracs, fastTarget: rtt === 'd20' || rtt === 'd4' ? 4000 : undefined });
export const PLANS: Record<string, PlanCell[]> = {
  // calibration set for the simulator: fast-only standalone, loopback and 20 ms, sharing on and off
  p1: [
    { ...on('loop', 'm0-fast', 'standalone', true, [0.5, 0.8, 0.95]), calibration: true },
    { ...on('d20', 'm0-fast', 'standalone', true, [0.5, 0.8, 0.95]), calibration: true },
    { ...off('loop', 'm0-fast', 'standalone', true, [0.5, 0.8, 0.95]), calibration: true },
    { ...off('d20', 'm0-fast', 'standalone', true), calibration: true },
  ],
  // held out from the calibration: pipelines, mixed loads, the 5 ms point
  p2: [
    on('loop', 'm0-fast', 'pipeline8', false), on('d20', 'm0-fast', 'pipeline8', false), off('loop', 'm0-fast', 'pipeline8', false), off('d20', 'm0-fast', 'pipeline8', false),
    on('loop', 'm2-sleep50-1', 'standalone', false), on('d20', 'm2-sleep50-1', 'standalone', false), off('loop', 'm2-sleep50-1', 'standalone', false),
    on('loop', 'm1-sleep5-1', 'standalone', false), on('d20', 'm1-sleep5-1', 'standalone', false), off('loop', 'm1-sleep5-1', 'standalone', false),
    on('d4', 'm0-fast', 'standalone', false), off('d4', 'm0-fast', 'standalone', false),
    on('loop', 'm1-sleep5-1', 'pipeline8', false), on('d20', 'm1-sleep5-1', 'pipeline8', false),
    // first on the brief's cut list: the 10% slow share
    on('loop', 'm3-sleep5-10', 'standalone', false), on('d20', 'm3-sleep5-10', 'standalone', false), off('loop', 'm3-sleep5-10', 'standalone', false),
    on('d4', 'm2-sleep50-1', 'standalone', false), on('d4', 'm3-sleep5-10', 'standalone', false),
  ],
};
