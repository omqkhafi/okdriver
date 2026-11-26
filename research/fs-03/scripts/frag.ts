// The fragmentation and lifetime suite, server to client. Usage: taskset -c 1,2 node scripts/frag.ts <build> <adapter> [outfile]
// Runs on Node (servers and proxy); the client under test runs on <build> pinned to core 0.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { FakePg, buildScript, type ScriptDef } from './servers/fakepg.ts';
import { FaultProxy, type Plan, type ProxyRun } from './servers/proxy.ts';
import { startClient } from './lib/proc.ts';
import { runtimeFor, describeBuild, resultsDir, workDir } from './lib/builds.ts';

interface Scenario { name: string; script: 'mix' | 'small' | 'tiny'; plan: (s: ScriptDef) => Plan; mustObserve: boolean; group?: boolean; close?: 'fin' | 'rst'; timeoutMs: number }
const SCRIPT_START = 7; // R S S K Z 1 2 precede the scripted messages
const firstBig = (s: ScriptDef, from: number): number => SCRIPT_START + s.items.findIndex((it, i) => i >= from && it.len >= 16000);

export const SCENARIOS: Scenario[] = [
  { name: 'plain-mix', script: 'mix', plan: () => ({ mode: 'pass' }), mustObserve: false, timeoutMs: 30000 },
  { name: 'bytes1-tiny', script: 'tiny', plan: () => ({ mode: 'bytes1', delayMs: 2 }), mustObserve: true, timeoutMs: 40000 },
  { name: 'header-offsets-small', script: 'small', plan: () => ({ mode: 'cuts', delayMs: 2 }), mustObserve: true, timeoutMs: 60000 },
  { name: 'payload-edges-mix', script: 'mix', plan: () => ({ mode: 'cuts', delayMs: 2, only: (len) => len >= 16000, extra: 'mid' }), mustObserve: true, timeoutMs: 60000 },
  { name: 'grouped-small', script: 'small', plan: () => ({ mode: 'group', delayMs: 1, seed: 11 }), mustObserve: false, group: true, timeoutMs: 30000 },
  { name: 'grouped-mix', script: 'mix', plan: () => ({ mode: 'group', delayMs: 1, seed: 12 }), mustObserve: false, group: true, timeoutMs: 60000 },
  { name: 'random-small-max16', script: 'small', plan: () => ({ mode: 'random', seed: 1, maxSize: 16, maxDelayMs: 2 }), mustObserve: false, timeoutMs: 60000 },
  { name: 'random-small-max7', script: 'small', plan: () => ({ mode: 'random', seed: 2, maxSize: 7, maxDelayMs: 2 }), mustObserve: false, timeoutMs: 60000 },
  { name: 'random-mix-max2048', script: 'mix', plan: () => ({ mode: 'random', seed: 5, maxSize: 2048, maxDelayMs: 2 }), mustObserve: false, timeoutMs: 90000 },
  { name: 'random-mix-max8192', script: 'mix', plan: () => ({ mode: 'random', seed: 3, maxSize: 8192, maxDelayMs: 2 }), mustObserve: false, timeoutMs: 60000 },
  { name: 'random-mix-max131072', script: 'mix', plan: () => ({ mode: 'random', seed: 4, maxSize: 131072, maxDelayMs: 2 }), mustObserve: false, timeoutMs: 60000 },
  ...(['fin', 'rst'] as const).flatMap((kind): Scenario[] => [
    { name: `close-${kind}-partial-header`, script: 'mix', close: kind, plan: () => ({ mode: 'close', msgIndex: SCRIPT_START + 100, where: 'header', kind, settleMs: 40 }), mustObserve: false, timeoutMs: 20000 },
    { name: `close-${kind}-partial-payload`, script: 'mix', close: kind, plan: (s) => ({ mode: 'close', msgIndex: firstBig(s, 50), where: 'payload', kind, settleMs: 40 }), mustObserve: false, timeoutMs: 20000 },
    { name: `close-${kind}-between-messages`, script: 'mix', close: kind, plan: () => ({ mode: 'close', msgIndex: SCRIPT_START + 200, where: 'between', kind, settleMs: 40 }), mustObserve: false, timeoutMs: 20000 },
  ]),
];

/** cut class of an absolute offset relative to the proxy's own message boundaries */
const classesOf = (cuts: number[], msgs: [number, number][]): Map<string, [number, number]> => {
  const out = new Map<string, [number, number]>();
  return out; void cuts; void msgs;
};
void classesOf;

export interface ScenarioResult {
  name: string; status: 'pass' | 'fail' | 'ineffective'; reasons: string[];
  messages: number; deliveries: number; cuts: number; observedShare: Record<string, string>; rawBytes: number; durationMs: number; raw: unknown;
}

const CAP = Number(process.env.FRAG_TIMEOUT_CAP_MS ?? 0); // planted-fault runs cap the hang timeout so a broken adapter fails fast
export async function runScenario(sc0: Scenario, runtime: string, adapter: string, tmp: string): Promise<ScenarioResult> {
  const sc = CAP ? { ...sc0, timeoutMs: Math.min(sc0.timeoutMs, CAP) } : sc0;
  const script = buildScript(sc.script, 1000 + SCENARIOS.indexOf(sc0));
  const pg = await new FakePg({ script }).listen();
  const px = new FaultProxy(pg.port);
  await px.listen();
  px.plan = sc.plan(script);
  const outFile = join(tmp, `frag-${adapter}-${sc.name}.json`);
  const t0 = Date.now();
  const reasons: string[] = [];
  let r: any = null, f: { seq: string[]; bounds: number[] } = { seq: [], bounds: [] };
  try {
    const c = startClient({ runtime, cpu: '0', args: { task: 'frag', adapter, port: px.port, outFile, timeoutMs: sc.timeoutMs }, timeoutMs: sc.timeoutMs + 20000 });
    r = await c.result;
    f = JSON.parse(readFileSync(outFile, 'utf8'));
  } catch (e) { reasons.push(`client: ${String(e).slice(0, 200)}`); }
  await new Promise((res) => setTimeout(res, 60));
  const run: ProxyRun | undefined = px.runs[0];
  const sent = pg.conns[0]?.sent.lines ?? [];
  const observedShare: Record<string, string> = {};
  let effective = true;
  if (r && run) {
    const expectedAll = sent;
    let expected = expectedAll;
    if (sc.close && run.closedAt !== null) expected = expectedAll.slice(0, run.messages.filter(([, e]) => e <= run.closedAt!).length);
    const prefixOk = f.seq.length <= expected.length && f.seq.every((l, i) => l === expected[i]);
    if (!prefixOk) reasons.push('decoded sequence differs from the server script');
    if (!sc.close && f.seq.length !== expected.length) reasons.push(`decoded ${f.seq.length} messages, script has ${expected.length}`);
    if (sc.close) {
      if (r.status !== 'terminal') reasons.push(`status ${r.status}, expected a terminal event`);
      if (f.seq.length !== expected.length) {
        if (sc.close === 'fin') reasons.push(`decoded ${f.seq.length} complete messages, ${expected.length} were sent in full`);
      }
      if (sc.close === 'fin' ? r.rawBytes !== run.s2cBytes : r.rawBytes > run.s2cBytes) reasons.push(`delivered ${r.rawBytes} bytes, proxy sent ${run.s2cBytes}`);
      if (sc.close === 'fin' && r.rawSha !== run.s2cSha) reasons.push('delivered bytes hash differs from the proxy hash');
    } else {
      if (r.status !== 'result') reasons.push(`status ${r.status}`);
      if (r.rawSha !== run.s2cSha) reasons.push('delivered bytes hash differs from the proxy hash');
      if (r.rawBytes !== run.s2cBytes) reasons.push(`delivered ${r.rawBytes} bytes, proxy sent ${run.s2cBytes}`);
    }
    if (r.terminalCalls !== 1) reasons.push(`terminal events: ${r.terminalCalls}`);
    if (r.dataAfterTerminal !== 0) reasons.push(`data after terminal: ${r.dataAfterTerminal}`);
    if (sc.group && r.maxMessagesPerDelivery < 2) { effective = false; reasons.push('no delivery held two messages'); }
    // effectiveness per cut class
    if (sc.plan(script).mode === 'cuts' || sc.plan(script).mode === 'bytes1') {
      const bounds = new Set(f.bounds);
      const classes = new Map<string, [number, number]>();
      const bump = (k: string, hit: boolean): void => { const v = classes.get(k) ?? [0, 0]; v[0]++; if (hit) v[1]++; classes.set(k, v); };
      if (sc.plan(script).mode === 'bytes1') for (const c of run.cuts) bump('single byte', bounds.has(c));
      else {
        const starts = new Map(run.messages.map(([s, e], i) => [i, [s, e] as [number, number]]));
        const byOffset = new Set(run.cuts);
        for (const [s, e] of starts.values()) {
          for (let k = 1; k <= 5; k++) if (byOffset.has(s + k)) bump(`header +${k}`, bounds.has(s + k));
          if (e - 1 > s + 5 && byOffset.has(e - 1)) bump('payload end -1', bounds.has(e - 1));
          if (e > s + 5 && byOffset.has(e)) bump('payload end', bounds.has(e));
          if (byOffset.has(e + 1)) bump('payload end +1', bounds.has(e + 1));
        }
      }
      for (const [k, [n, h]] of classes) { observedShare[k] = `${h}/${n}`; if (sc.mustObserve && h / n < 0.95) { effective = false; reasons.push(`cut class ${k}: ${h}/${n} observed`); } }
    }
  } else if (!reasons.length) reasons.push('no result');
  pg.close(); px.close();
  const bad = reasons.filter((x) => !x.startsWith('cut class') && x !== 'no delivery held two messages');
  return {
    name: sc.name, status: bad.length ? 'fail' : effective ? 'pass' : 'ineffective', reasons, messages: r?.messages ?? 0, deliveries: r?.deliveries ?? 0, cuts: run?.cuts.length ?? 0,
    observedShare, rawBytes: r?.rawBytes ?? 0, durationMs: Date.now() - t0, raw: r?.raw ?? null,
  };
}

export async function runSuite(build: string, adapter: string, only?: string[]): Promise<{ build: ReturnType<typeof describeBuild>; adapter: string; results: ScenarioResult[]; passShare: number }> {
  const runtime = runtimeFor(build);
  const tmp = join(workDir, 'tmp'); mkdirSync(tmp, { recursive: true });
  const results: ScenarioResult[] = [];
  for (const sc of SCENARIOS) {
    if (only && !only.includes(sc.name)) continue;
    const r = await runScenario(sc, runtime, adapter, tmp);
    results.push(r);
    console.error(`${build} ${adapter} ${r.name}: ${r.status} ${r.reasons.join('; ')} (${r.durationMs} ms)`);
  }
  return { build: describeBuild(build), adapter, results, passShare: results.filter((r) => r.status === 'pass').length / results.length };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [build, adapter, outName] = process.argv.slice(2);
  const res = await runSuite(build!, adapter!);
  const name = outName ?? `fragmentation.${build}.${adapter}.json`;
  mkdirSync(resultsDir, { recursive: true });
  writeFileSync(join(resultsDir, name), JSON.stringify(res, null, 2) + '\n');
  console.log(`${build} ${adapter}: ${res.results.filter((r) => r.status === 'pass').length}/${res.results.length} pass`);
  process.exit(0);
}
