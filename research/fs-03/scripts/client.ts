// The process under test. Runs on Bun (release or canary) or Node: `<runtime> scripts/client.ts <json>`.
// Prints exactly one line `RESULT <json>`; perf runs also print `READY` and wait for `GO` and `BYE` on stdin so that the
// orchestrator can read /proc/<pid>/stat around the measured part only.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { makeTransport } from './lib/make.ts';
import { Tapped } from './lib/harness.ts';
import { Conn } from './lib/driver.ts';
import type { TransportHandlers } from './lib/transport.ts';

const args = JSON.parse(process.argv[2]!) as Record<string, any>;
const lines: string[] = [];
let stdinBuf = '';
const waiters: ((l: string) => void)[] = [];
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d: string) => { stdinBuf += d; let i; while ((i = stdinBuf.indexOf('\n')) >= 0) { const l = stdinBuf.slice(0, i); stdinBuf = stdinBuf.slice(i + 1); const w = waiters.shift(); if (w) w(l); else lines.push(l); } });
const nextLine = (): Promise<string> => new Promise((r) => { const l = lines.shift(); if (l !== undefined) r(l); else waiters.push(r); });
const out = (obj: unknown): void => { process.stdout.write('RESULT ' + JSON.stringify(obj) + '\n'); };
const rendezvous = async (): Promise<void> => { process.stdout.write('READY\n'); await nextLine(); };
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const rssKB = (): number => Number(/VmRSS:\s+(\d+)/.exec(readFileSync('/proc/self/status', 'utf8'))![1]);
const runtime = typeof (globalThis as any).Bun !== 'undefined' ? `bun ${(globalThis as any).Bun.version} ${(globalThis as any).Bun.revision}` : `node ${process.version}`;
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const tlsOf = (): any => args.tls ? { mode: args.tls.mode, opts: { servername: args.tls.servername ?? 'localhost', ca: readFileSync(args.tls.ca, 'utf8'), alpn: args.tls.alpn } } : undefined;
const login = { user: args.user ?? 'fs03', database: args.database ?? 'fs03', password: args.password };

async function perf(): Promise<void> {
  const t = new Tapped(await makeTransport(args.adapter));
  t.recordBounds = false;
  const c = new Conn(t, { ...login });
  await c.open(args.host ?? '127.0.0.1', args.port, tlsOf());
  await rendezvous();
  let res: Record<string, unknown>;
  if (args.workload === 'w1') {
    const r = await c.w1(args.sql, args.n);
    const s = Array.from(r.lat).sort((a, b) => a - b);
    res = { seconds: r.seconds, ops: args.n, p50us: s[Math.floor(s.length * 0.5)], p99us: s[Math.floor(s.length * 0.99)] };
  } else if (args.workload === 'w2') {
    const r = await c.w2(args.sql, args.n, args.depth ?? 100);
    res = { seconds: r.seconds, ops: args.n };
  } else if (args.workload === 'w3') {
    const r = await c.w3(args.sql);
    res = { seconds: r.seconds, rows: r.rows, bytes: r.bytes, deliveries: t.deliveries, wireBytes: t.bytes };
  } else if (args.workload === 'w4') {
    const r = await c.w4(args.sql, args.bytes);
    res = { seconds: r.seconds, bytes: args.bytes, drains: t.stats.drainEvents };
  } else throw new Error('workload');
  res.rssPeakKB = Number(/VmHWM:\s+(\d+)/.exec(readFileSync('/proc/self/status', 'utf8'))![1]);
  res.pid = process.pid;
  out({ ...res, runtime });
  process.stdout.write('DONE\n');
  await nextLine();
  t.destroy();
  setTimeout(() => process.exit(0), 20);
}

/** Fragmentation scenario: login, run the script statement, report what the core decoded and what the adapter delivered. */
async function frag(): Promise<void> {
  const t = new Tapped(await makeTransport(args.adapter));
  const c = new Conn(t, { user: 'fs03', database: 'fs03' });
  const seq: string[] = [];
  let maxPerDelivery = 0, thisDelivery = 0;
  c.core.tap = (type, payload) => { seq.push(`${String.fromCharCode(type)} ${payload.length} ${sha(payload)}`); thisDelivery++; };
  t.onDelivery = () => { maxPerDelivery = Math.max(maxPerDelivery, thisDelivery); thisDelivery = 0; };
  try { await c.open(args.host ?? '127.0.0.1', args.port); } catch (e) { out({ status: 'open-failed', error: String(e) }); return; }
  let status = 'pending';
  let failure = '';
  const done = new Promise<void>((resolve) => {
    c.onTerminal = (e) => { if (status === 'pending') status = 'terminal'; failure = e.message; resolve(); };
    c.core.onResult = () => { if (status === 'pending') status = 'result'; resolve(); };
  });
  c.core.execute('SELECT 1 -- fs03 script');
  c.flush();
  const timeout = sleep(args.timeoutMs ?? 20000).then(() => { if (status === 'pending') status = 'hang'; });
  await Promise.race([done, timeout]);
  await sleep(args.settleMs ?? 150); // late events after the end must show up
  if (status === 'result') { t.destroy(); await sleep(50); }
  writeFileSync(args.outFile, JSON.stringify({ seq, bounds: t.bounds }));
  out({
    status, failure, messages: seq.length, rawBytes: t.bytes, rawSha: t.hash.digest('hex'), deliveries: t.deliveries,
    maxMessagesPerDelivery: maxPerDelivery, terminalCalls: t.terminalCalls, dataAfterTerminal: t.dataAfterTerminal,
    raw: t.stats, runtime, adapter: t.name,
  });
  setTimeout(() => process.exit(0), 20);
}

import('./client-cap.ts').then(async (cap) => {
  const ctx = { args, out, sleep, rssKB, sha, rendezvous, nextLine, runtime, tlsOf, login };
  if (args.task === 'perf') await perf();
  else if (args.task === 'frag') await frag();
  else await cap.run(ctx);
  setTimeout(() => process.exit(0), 20);
}).catch((e) => { out({ status: 'crash', error: String(e?.stack ?? e) }); setTimeout(() => process.exit(1), 20); });
