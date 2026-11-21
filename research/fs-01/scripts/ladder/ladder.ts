// Ablation ladder harness. Usage: bun run scripts/ladder/ladder.ts [--port 55432] [--repeats 10] [--s1 20000] [--s2 50000] [--warm 2000] [--out file]
// Also runs unmodified on Node 22 with type stripping (information only).
import { writeFileSync } from "node:fs";
import os from "node:os";
import { open, RUNGS, type Rung } from "./rungs.ts";

const arg = (k: string, d: number | string): string => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1]! : String(d); };
const PORT = Number(arg("port", 55432));
const REPEATS = Number(arg("repeats", 10));
const N1 = Number(arg("s1", 20000));
const N2 = Number(arg("s2", 50000));
const WARM = Number(arg("warm", 2000));
const OUT = arg("out", "results/ladder-runs.json");

function mulberry32(a: number): () => number {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const rnd = mulberry32(20260121);
const shuffle = <T,>(a: T[]): T[] => { const b = a.slice(); for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [b[i], b[j]] = [b[j]!, b[i]!]; } return b; };
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function drive(r: { query(i: number): Promise<unknown> }, total: number, callers: number, from: number): Promise<void> {
  let next = 0;
  const worker = async (): Promise<void> => { while (next < total) { const i = from + next++; await r.query(i); } };
  await Promise.all(Array.from({ length: callers }, worker));
}

interface Run { repeat: number; scenario: 1 | 2; rung: Rung; queries: number; wallUsPerQuery: number; cpuUsPerQuery: number }
const runs: Run[] = [];
const scenarios = [
  { id: 1 as const, conns: 1, callers: 1, n: N1 },
  { id: 2 as const, conns: 8, callers: 64, n: N2 },
];
const runtime = typeof (globalThis as any).Bun !== "undefined" ? `bun ${(globalThis as any).Bun.version}` : `node ${process.versions.node}`;
console.log(`ladder on ${runtime}, ${os.cpus().length} vCPU visible, port ${PORT}, repeats ${REPEATS}, warm-up ${WARM}`);
for (let rep = 1; rep <= REPEATS; rep++) {
  for (const sc of scenarios) {
    for (const rung of shuffle(RUNGS)) {
      const runner = await open(rung, PORT, sc.conns);
      await drive(runner, WARM, sc.callers, 0); // discarded
      await sleep(50);
      const c0 = process.cpuUsage();
      const t0 = performance.now();
      await drive(runner, sc.n, sc.callers, WARM);
      const wall = performance.now() - t0;
      const c = process.cpuUsage(c0);
      await runner.close();
      runs.push({ repeat: rep, scenario: sc.id, rung, queries: sc.n, wallUsPerQuery: (wall * 1000) / sc.n, cpuUsPerQuery: (c.user + c.system) / sc.n });
      console.log(`rep ${rep} s${sc.id} ${rung.padEnd(13)} wall ${((wall * 1000) / sc.n).toFixed(1)} us/q  cpu ${((c.user + c.system) / sc.n).toFixed(1)} us/q`);
      await sleep(100);
    }
  }
}
writeFileSync(OUT, JSON.stringify({ runtime, vcpu: os.cpus().length, repeats: REPEATS, warmup: WARM, scenarios, runs }, null, 1));
console.log(`wrote ${OUT}`);
