// Capability and lifetime probes run inside the client process (so they exercise the API under test), against raw servers in capsrv.ts.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { makeTransport } from './lib/make.ts';
import { Tapped } from './lib/harness.ts';
import { Conn } from './lib/driver.ts';
import type { TransportHandlers } from './lib/transport.ts';

export interface Ctx {
  args: Record<string, any>; out: (o: unknown) => void; sleep: (ms: number) => Promise<void>; rssKB: () => number;
  sha: (b: Uint8Array) => string; rendezvous: () => Promise<void>; nextLine: () => Promise<string>; runtime: string; tlsOf: () => any;
  login: { user: string; database: string; password?: string };
}
const host = '127.0.0.1';
const noop: TransportHandlers = { onData() {}, onDrain() {}, onEnd() {}, onClose() {} };

export async function run(ctx: Ctx): Promise<void> {
  const { args, out, sleep } = ctx;
  const spec = args.adapter as string;
  switch (args.task) {
    case 'tls_upgrade': return out(await tlsUpgrade(ctx));
    case 'direct_tls': return out(await directTls(ctx));
    case 'pause_resume': return out(await pauseResume(ctx));
    case 'write_backpressure': return out(await writeBackpressure(ctx));
    case 'terminal': return out(await terminal(ctx));
    case 'lifetime': return out(await lifetime(ctx));
    case 'half_close': return out(await halfClose(ctx));
    case 'keepalive': return out(await keepalive(ctx));
    case 'nodelay': return out(await nodelay(ctx));
    case 'connect_timeout': return out(await connectTimeout(ctx));
    case 'real': return out(await real(ctx));
    default: out({ status: 'unknown task', task: args.task, spec, sleep: typeof sleep });
  }
}

async function tlsUpgrade(ctx: Ctx): Promise<unknown> {
  const { args } = ctx;
  const res: Record<string, unknown> = { runtime: ctx.runtime };
  const ca = readFileSync(args.ca, 'utf8');
  for (const [label, servername] of [['good', 'localhost'], ['mismatch', 'wrong.example']] as const) {
    const t = new Tapped(await makeTransport(args.adapter));
    const c = new Conn(t, ctx.login);
    try {
      await c.open(host, args.port, { mode: 'upgrade', opts: { servername, ca } });
      const r = await c.query('SELECT 1');
      const der = t.peerCertificate();
      res[label] = { ok: true, rows: r.rows, certSha: der ? ctx.sha(der) : null, certLen: der?.length ?? 0 };
    } catch (e) { res[label] = { ok: false, error: String((e as Error).message).slice(0, 120) }; }
    t.destroy();
    await ctx.sleep(100);
  }
  return res;
}

async function directTls(ctx: Ctx): Promise<unknown> {
  const { args } = ctx;
  const ca = readFileSync(args.ca, 'utf8');
  const t = new Tapped(await makeTransport(args.adapter));
  const c = new Conn(t, ctx.login);
  try {
    await c.open(host, args.port, { mode: 'direct', opts: { servername: 'localhost', ca, alpn: ['postgresql'] } });
    const r = await c.query('SELECT 1');
    const der = t.peerCertificate();
    const alpn = t.alpnProtocol(); // read before destroy: the property is gone afterwards on Bun
    t.destroy();
    return { ok: true, rows: r.rows, alpn, certSha: der ? ctx.sha(der) : null };
  } catch (e) { return { ok: false, error: String((e as Error).message).slice(0, 120) }; }
}

async function pauseResume(ctx: Ctx): Promise<unknown> {
  const t = await makeTransport(args_(ctx).adapter);
  let bytes = 0;
  const hash = createHash('sha256');
  let atSettle = 0;
  let ended: () => void;
  const done = new Promise<void>((r) => { ended = r; });
  const total = ctx.args.total as number;
  await t.connect(host, ctx.args.port, {
    ...noop,
    onData: (c) => { bytes += c.length; hash.update(c); if (bytes >= total) ended(); },
    onClose: () => ended(),
  });
  while (bytes < 1_000_000) await ctx.sleep(1);
  t.pause();
  await ctx.sleep(ctx.args.settleMs);
  atSettle = bytes;
  const rss0 = ctx.rssKB();
  await ctx.sleep(ctx.args.windowMs);
  const deliveredWhilePaused = bytes - atSettle;
  const rss1 = ctx.rssKB();
  t.resume();
  await Promise.race([done, ctx.sleep(30000)]);
  const res = { bytes, sha: hash.digest('hex'), deliveredWhilePaused, atSettle, rssGrowthKB: rss1 - rss0, runtime: ctx.runtime, raw: t.stats };
  t.destroy();
  return res;
}
const args_ = (ctx: Ctx) => ctx.args;

async function writeBackpressure(ctx: Ctx): Promise<unknown> {
  const t = await makeTransport(ctx.args.adapter);
  let drains = 0;
  let drainAt = 0;
  await t.connect(host, ctx.args.port, { ...noop, onDrain: () => { drains++; if (!drainAt) drainAt = performance.now(); } });
  const buf = new Uint8Array(ctx.args.size);
  for (let i = 0; i < buf.length; i += 4096) { let x = (i / 4096) | 0; for (let j = 0; j < 4096 && i + j < buf.length; j++) buf[i + j] = (x = (x * 1103515245 + 12345) & 0xff) ; }
  const sha = ctx.sha(buf);
  const t0 = performance.now();
  const accepted = t.write(buf);
  const afterWrite = performance.now() - t0;
  const deadline = performance.now() + 20000;
  while (!drainAt && performance.now() < deadline) await ctx.sleep(5);
  const res = { signal: accepted === false, writeReturnedMs: afterWrite, drainAfterMs: drainAt ? drainAt - t0 : null, drains, sha, runtime: ctx.runtime };
  await ctx.sleep(200);
  t.endWrite();
  await ctx.sleep(1500); // the server answers after its end event
  t.destroy();
  return { ...res, drainsAtEnd: drains };
}

async function terminal(ctx: Ctx): Promise<unknown> {
  const t = new Tapped(await makeTransport(ctx.args.adapter));
  let bytes = 0;
  await t.connect(host, ctx.args.port, { ...noop, onData: (c) => { bytes += c.length; }, onClose: () => {} });
  if (ctx.args.local) { while (bytes < 1000) await ctx.sleep(1); t.destroy(); }
  await ctx.sleep(ctx.args.waitMs ?? 700);
  return { terminalCalls: t.terminalCalls, dataAfterTerminal: t.dataAfterTerminal, error: t.terminalError, raw: t.stats, bytes, runtime: ctx.runtime };
}

async function lifetime(ctx: Ctx): Promise<unknown> {
  const t = await makeTransport(ctx.args.adapter);
  interface Seen { view: Uint8Array; copy: Uint8Array; buffer: ArrayBufferLike; off: number }
  const seen: Seen[] = [];
  let changedAtNextDelivery = 0, changedSameTick = 0, changedMicrotask = 0, sameArrayBuffer = 0, deliveries = 0, bytes = 0;
  const lens = new Set<number>();
  let prev: Seen | null = null;
  const same = (a: Uint8Array, b: Uint8Array) => { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; };
  await t.connect(host, ctx.args.port, {
    ...noop,
    onData: (c) => {
      deliveries++; bytes += c.length; lens.add(c.length);
      if (prev) {
        if (!same(prev.view, prev.copy)) changedAtNextDelivery++;
        if (prev.buffer === c.buffer) sameArrayBuffer++;
      }
      const s: Seen = { view: c, copy: Uint8Array.from(c), buffer: c.buffer, off: c.byteOffset };
      seen.push(s);
      prev = s;
      queueMicrotask(() => { if (!same(s.view, s.copy)) changedMicrotask++; });
    },
  });
  await ctx.sleep(ctx.args.waitMs);
  let changedAtEnd = 0;
  for (const s of seen) if (!same(s.view, s.copy)) changedAtEnd++;
  void changedSameTick;
  const res = { deliveries, bytes, distinctLengths: lens.size, viewsChangedBeforeNextDelivery: changedAtNextDelivery, viewsChangedAfterMicrotask: changedMicrotask, viewsChangedAtEnd: changedAtEnd, consecutiveDeliveriesSharingArrayBuffer: sameArrayBuffer, runtime: ctx.runtime };
  t.destroy();
  return res;
}

async function halfClose(ctx: Ctx): Promise<unknown> {
  const t = new Tapped(await makeTransport(ctx.args.adapter, { allowHalfOpen: true }));
  let bytes = 0;
  const hash = createHash('sha256');
  await t.connect(host, ctx.args.port, { ...noop, onData: (c) => { bytes += c.length; hash.update(c); } });
  t.write(new TextEncoder().encode('0123456789'));
  await ctx.sleep(50);
  t.endWrite();
  await ctx.sleep(800);
  return { bytes, sha: hash.digest('hex'), terminalCalls: t.terminalCalls, endCalls: t.endCalls, runtime: ctx.runtime, raw: t.stats };
}

async function keepalive(ctx: Ctx): Promise<unknown> {
  const t = await makeTransport(ctx.args.adapter);
  await t.connect(host, ctx.args.port, noop);
  let threw = '';
  try { t.setKeepAlive(true, 30000); } catch (e) { threw = String(e); }
  await ctx.rendezvous();
  t.destroy();
  return { threw, runtime: ctx.runtime };
}

async function nodelay(ctx: Ctx): Promise<unknown> {
  const t = await makeTransport(ctx.args.adapter);
  await t.connect(host, ctx.args.port, noop);
  let threw = '';
  try { t.setNoDelay(true); } catch (e) { threw = String(e); }
  await ctx.rendezvous();
  t.destroy();
  return { threw, runtime: ctx.runtime };
}

async function connectTimeout(ctx: Ctx): Promise<unknown> {
  const t = new Tapped(await makeTransport(ctx.args.adapter));
  const t0 = performance.now();
  let settled = 'pending';
  const p = t.connect(host, ctx.args.port, noop).then(() => { settled = 'connected'; }, (e) => { settled = `rejected: ${String(e.message).slice(0, 60)}`; });
  await Promise.race([p, ctx.sleep(ctx.args.timeoutMs)]);
  const afterMs = performance.now() - t0;
  const stateAtTimeout = settled;
  let destroyResult = 'ok';
  try { t.destroy(); } catch (e) { destroyResult = `threw: ${String((e as Error).message).slice(0, 60)}`; }
  await ctx.sleep(500);
  return { stateAtTimeout, afterMs, destroyResult, settledAfterDestroy: settled, terminalCalls: t.terminalCalls, runtime: ctx.runtime };
}

async function real(ctx: Ctx): Promise<unknown> {
  const t = new Tapped(await makeTransport(ctx.args.adapter));
  const c = new Conn(t, { ...ctx.login, collect: true });
  await c.open(host, ctx.args.port, ctx.tlsOf());
  const outRows: unknown[] = [];
  for (const sql of ctx.args.queries as string[]) {
    const r = await c.query(sql);
    outRows.push({ error: r.error, rows: r.data, tag: r.tag });
  }
  t.destroy();
  return { results: outRows, runtime: ctx.runtime };
}
