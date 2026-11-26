// Process helpers for the orchestrator (Node): run a client under taskset, read /proc, talk the READY/GO/DONE/BYE protocol.
import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

export interface Build { id: string; bun: string; version: string; revision: string }
export interface ClientOpts { runtime: string; cpu: string; args: Record<string, unknown>; timeoutMs?: number }
const CLK = 100; // CLK_TCK on Linux
export const cpuTicks = (pid: number): number => {
  const s = readFileSync(`/proc/${pid}/stat`, 'utf8');
  const f = s.slice(s.lastIndexOf(')') + 2).split(' ');
  return Number(f[11]) + Number(f[12]); // utime + stime
};
export const ticksToSeconds = (t: number): number => t / CLK;
export const hwmKB = (pid: number): number => Number(/VmHWM:\s+(\d+)/.exec(readFileSync(`/proc/${pid}/status`, 'utf8'))![1]);

export interface Running { child: ChildProcess; pid: number; lines: AsyncIterator<string>; result: Promise<any>; send: (l: string) => void; waitFor: (prefix: string, ms?: number) => Promise<string>; stderr: () => string }
const scriptPath = new URL('../client.ts', import.meta.url).pathname;

export function startClient(o: ClientOpts): Running {
  const isNode = o.runtime === 'node' || o.runtime.endsWith('/node');
  const argv = ['-c', o.cpu, o.runtime, ...(isNode ? ['--no-warnings'] : []), scriptPath, JSON.stringify(o.args)];
  // the shell this study ran in exports BUN_OPTIONS=--smol, which changes the GC and memory behaviour of the Bun under test
  const env = { ...process.env }; delete env.BUN_OPTIONS; delete env.NODE_OPTIONS;
  const child = spawn('taskset', argv, { stdio: ['pipe', 'pipe', 'pipe'], env });
  let err = '';
  child.stderr!.on('data', (d) => { err += d; });
  const rl = createInterface({ input: child.stdout! });
  const queue: string[] = [];
  const waiters: { prefix: string; res: (l: string) => void; rej: (e: Error) => void }[] = [];
  let ended = false;
  const dispatch = (): void => {
    for (let wi = 0; wi < waiters.length;) {
      const w = waiters[wi]!;
      const qi = queue.findIndex((l) => l.startsWith(w.prefix));
      if (qi >= 0) { const [l] = queue.splice(qi, 1); waiters.splice(wi, 1); w.res(l!); } else wi++;
    }
    if (ended) for (const w of waiters.splice(0)) w.rej(new Error(`client exited before ${w.prefix}: ${err.slice(0, 500)}`));
  };
  rl.on('line', (l) => { queue.push(l); dispatch(); });
  child.on('close', () => { ended = true; dispatch(); });
  const timeout = o.timeoutMs ?? 120000;
  const waitFor = (prefix: string, ms = timeout): Promise<string> => new Promise((res, rej) => {
    const t = setTimeout(() => { rej(new Error(`timeout waiting for ${prefix}`)); try { child.kill('SIGKILL'); } catch {} }, ms);
    waiters.push({ prefix, res: (l) => { clearTimeout(t); res(l); }, rej: (e) => { clearTimeout(t); rej(e); } });
    dispatch();
  });
  const result = waitFor('RESULT ').then((l) => JSON.parse(l.slice(7)));
  result.catch(() => {});
  return { child, pid: child.pid!, lines: null as never, result, send: (l) => child.stdin!.write(l + '\n'), waitFor, stderr: () => err };
}
export const exited = (r: Running): Promise<void> => new Promise((res) => { if (r.child.exitCode !== null) res(); else r.child.on('close', () => res()); });
