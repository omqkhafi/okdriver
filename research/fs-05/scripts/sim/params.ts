// Simulator parameters: the structure is fixed here, the numbers come from results/service.json (measured) and
// results/calibration.json (fitted on the real calibration cells).
import { existsSync, readFileSync } from 'node:fs';
import type { Net, SimParams } from './sim.ts';
const ROOT = new URL('../../', import.meta.url).pathname;
export const DEFAULT: SimParams = { sFast: 0.02, sigma: 0.3, wake: 0.01, cores: 2, hiccupP: 0.02, hiccupMs: 0.4, sleepExtra: 0.4, cpuMs5: 5.4, cpuMs50: 50.8, cpuN5: 71052, cUnit: 0.002, cStmt: 0.004, cDec: 0.004, cWrite: 0.004, cRead: 0.003, oneWay0: 0.03, arrTick: 1 };
export interface Calibration { attempt: number; params: SimParams; oneWay: Record<string, number>; quantum: Record<string, number> }
export function loadParams(): { params: SimParams; nets: Record<string, Net> } {
  const svc = existsSync(ROOT + 'results/service.json') ? JSON.parse(readFileSync(ROOT + 'results/service.json', 'utf8')) : null;
  const cal: Calibration | null = existsSync(ROOT + 'results/calibration.json') ? JSON.parse(readFileSync(ROOT + 'results/calibration.json', 'utf8')) : null;
  const params: SimParams = { ...DEFAULT, ...(cal?.params ?? {}) };
  if (svc) { params.cpuN5 = svc.cpuN5; params.cpuMs5 = svc.cpu5check.p50 - svc.fast.p50; params.cpuMs50 = svc.cpu50check.p50 - svc.fast.p50; params.sleepExtra = svc.sleep5.p50 - 5 - svc.fast.p50; }
  const ow = cal?.oneWay ?? {};
  const nets: Record<string, Net> = {
    loop: { oneWay: params.oneWay0, quantum: 0 },
    // simulator-only point (no netem in this session): an ideal 1 ms round trip
    ms1: { oneWay: 0.5, quantum: 0 },
    d4: { oneWay: ow.d4 ?? 2, quantum: cal?.quantum.d4 ?? 1 },
    d20: { oneWay: ow.d20 ?? 9.5, quantum: cal?.quantum.d20 ?? 1 },
  };
  return { params, nets };
}
