// Byte-forwarding TCP proxy: adds a fixed one-way delay in each direction and counts, from the bytes alone, how many
// statements are in flight per connection (frontend Syncs seen minus ReadyForQuery delivered to the client). It shares no
// code with the client. This is the instrument for "in-flight depth read from a trace, not from the policy's counters".
// Run: bun delayproxy.ts <listenPort> <targetPort> <oneWayMs> <ctlPort>   (pinned to its own core by the caller)
import net from 'node:net';

const [listenPort, targetPort, oneWayMs, ctlPort] = process.argv.slice(2).map(Number) as [number, number, number, number];
const HIST = 8192;

class FrameCounter {
  private hdr = Buffer.alloc(5); private have = 0; private skip = 0; private startup: boolean;
  constructor(untypedFirst: boolean) { this.startup = untypedFirst; }
  feed(buf: Buffer, onFrame: (type: number) => void): void {
    let o = 0; const n = buf.length;
    while (o < n) {
      if (this.skip > 0) { const k = Math.min(this.skip, n - o); this.skip -= k; o += k; continue; }
      if (this.startup) { // first c2s message: int32 length, no type byte
        while (this.have < 4 && o < n) this.hdr[this.have++] = buf[o++]!;
        if (this.have < 4) break;
        this.skip = this.hdr.readInt32BE(0) - 4; this.have = 0; this.startup = false; continue;
      }
      while (this.have < 5 && o < n) this.hdr[this.have++] = buf[o++]!;
      if (this.have < 5) break;
      onFrame(this.hdr[0]!); this.skip = this.hdr.readInt32BE(1) - 4; this.have = 0;
    }
  }
}

interface Rec { id: number; syncs: number; zs: number; loginDone: boolean; max: number; hist: Uint32Array; open: boolean; closedAtSyncs: number; closedAtZs: number; closedAt: number; c2s: FrameCounter; s2c: FrameCounter }
let conns: Rec[] = [];
let nextId = 0;
const queue: { due: number; sock: net.Socket; buf: Buffer; rec: Rec | null }[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

function deliver(sock: net.Socket, buf: Buffer, rec: Rec | null): void {
  if (sock.destroyed) return;
  if (rec) rec.s2c.feed(buf, (t) => { if (t === 0x5a) { if (!rec.loginDone) rec.loginDone = true; else rec.zs++; } });
  sock.write(buf);
}
function flush(): void {
  timer = null;
  const now = performance.now();
  while (queue.length && queue[0]!.due <= now) { const q = queue.shift()!; deliver(q.sock, q.buf, q.rec); }
  if (queue.length) timer = setTimeout(flush, Math.max(0, queue[0]!.due - performance.now()));
}
function forward(sock: net.Socket, buf: Buffer, rec: Rec | null): void {
  if (oneWayMs <= 0) { deliver(sock, buf, rec); return; }
  queue.push({ due: performance.now() + oneWayMs, sock, buf, rec });
  if (!timer) timer = setTimeout(flush, oneWayMs);
}

net.createServer((cli) => {
  cli.setNoDelay(true);
  const rec: Rec = { id: nextId++, syncs: 0, zs: 0, loginDone: false, max: 0, hist: new Uint32Array(HIST), open: true, closedAtSyncs: 0, closedAtZs: 0, closedAt: 0, c2s: new FrameCounter(true), s2c: new FrameCounter(false) };
  conns.push(rec);
  const up = net.connect({ host: '127.0.0.1', port: targetPort });
  up.setNoDelay(true);
  const pending: Buffer[] = []; let upReady = false;
  up.once('connect', () => { upReady = true; for (const b of pending) forward(up, b, null); pending.length = 0; });
  cli.on('data', (d: Buffer) => {
    rec.c2s.feed(d, (t) => { if (t === 0x53 && rec.loginDone) { rec.syncs++; const depth = rec.syncs - rec.zs; if (depth > rec.max) rec.max = depth; rec.hist[Math.min(depth, HIST - 1)]!++; } });
    if (upReady) forward(up, d, null); else pending.push(d);
  });
  up.on('data', (d: Buffer) => forward(cli, d, rec));
  const closeBoth = () => {
    if (rec.open) { rec.open = false; rec.closedAt = performance.now(); rec.closedAtSyncs = rec.syncs; rec.closedAtZs = rec.zs; }
    setTimeout(() => { cli.destroy(); up.destroy(); }, oneWayMs + 2);
  };
  cli.on('close', closeBoth); up.on('close', closeBoth);
  cli.on('error', () => {}); up.on('error', () => {});
}).listen(listenPort, '127.0.0.1');

const q = (h: Uint32Array, total: number, p: number): number => { let acc = 0; const t = Math.ceil(total * p); for (let i = 0; i < h.length; i++) { acc += h[i]!; if (acc >= t) return i; } return 0; };
const t00 = performance.now(); let cpu0 = process.cpuUsage();
Bun.serve({
  port: ctlPort, hostname: '127.0.0.1',
  fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === '/reset') { conns = []; nextId = 0; cpu0 = process.cpuUsage(); return Response.json({ ok: true, t: performance.now() }); }
    const cpu = process.cpuUsage(cpu0);
    return Response.json({
      oneWayMs, wallMs: performance.now() - t00, cpuMs: (cpu.user + cpu.system) / 1000,
      conns: conns.map((c) => ({ id: c.id, syncs: c.syncs, zs: c.zs, open: c.open, max: c.max, inflightNow: c.syncs - c.zs, onWireAtClose: c.open ? null : c.closedAtSyncs - c.closedAtZs, closedAt: c.closedAt, p50: q(c.hist, c.syncs, 0.5), p99: q(c.hist, c.syncs, 0.99), mean: c.syncs ? c.hist.reduce((a, v, i) => a + v * i, 0) / c.syncs : 0 })),
    });
  },
});
