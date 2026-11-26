// The fault proxy. Runs on Node. Sits between the client under test and a scripted server, re-cuts the server-to-client stream
// according to a plan, and keeps its own sha256 and byte count per direction. It has its own message parser (header scan only).
import net from 'node:net';
import { createHash } from 'node:crypto';
import { rng } from './fakepg.ts';

export type Plan =
  | { mode: 'pass' }
  | { mode: 'bytes1'; delayMs: number }
  | { mode: 'cuts'; delayMs: number; only?: (len: number) => boolean; extra?: 'mid' }
  | { mode: 'group'; delayMs: number; seed: number }
  | { mode: 'random'; seed: number; maxSize: number; maxDelayMs: number }
  | { mode: 'close'; msgIndex: number; where: 'header' | 'payload' | 'between'; kind: 'fin' | 'rst'; settleMs: number };

export interface ProxyRun {
  plan: Plan;
  c2sBytes: number; c2sSha: string;
  s2cBytes: number; s2cSha: string;
  /** absolute offsets at which the proxy ended a write */
  cuts: number[];
  /** message boundaries parsed in the server-to-client stream: [start, end) */
  messages: [number, number][];
  closedAt: number | null;
}
const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class FaultProxy {
  port = 0;
  private server!: net.Server;
  runs: ProxyRun[] = [];
  upstreamPort: number;
  plan: Plan = { mode: 'pass' };
  constructor(upstreamPort: number) { this.upstreamPort = upstreamPort; }

  async listen(): Promise<this> {
    this.server = net.createServer({ noDelay: true }, (c) => this.handle(c));
    await new Promise<void>((r) => this.server.listen(0, '127.0.0.1', r));
    this.port = (this.server.address() as net.AddressInfo).port;
    return this;
  }
  close(): void { this.server.close(); }

  private handle(client: net.Socket): void {
    const plan = this.plan;
    const run: ProxyRun = { plan, c2sBytes: 0, c2sSha: '', s2cBytes: 0, s2cSha: '', cuts: [], messages: [], closedAt: null };
    this.runs.push(run);
    const up = net.connect({ host: '127.0.0.1', port: this.upstreamPort, noDelay: true });
    const c2s = createHash('sha256'), s2c = createHash('sha256');
    client.on('error', () => {}); up.on('error', () => {});
    client.on('data', (d: Buffer) => { c2s.update(d); run.c2sBytes += d.length; up.write(d); });
    client.on('close', () => { run.c2sSha = c2s.digest('hex'); up.destroy(); });

    // server-to-client side
    const queue: Buffer[] = [];
    let queued = 0;          // bytes in queue
    let sentTo = 0;          // absolute offset already written to the client
    let known = 0;           // absolute offset received from upstream
    let upstreamEnded = false;
    const cutList: number[] = []; // candidate cut offsets, ascending, from parsed headers
    let cutAt = 0;
    // header scanner
    let hdr: number[] = [];
    let scanPos = 0, msgStart = 0, msgEnd = 0, inMsg = false;
    const r = rng(plan.mode === 'group' || plan.mode === 'random' ? plan.seed : 1);
    let groupLeft = 0, groupCount = 0;
    let closeOffset: number | null = null;
    const addCut = (o: number): void => { if (o > (cutList[cutList.length - 1] ?? -1)) cutList.push(o); };
    const onMessage = (start: number, end: number, len: number): void => {
      const idx = run.messages.length;
      run.messages.push([start, end]);
      if (plan.mode === 'cuts' && (!plan.only || plan.only(len))) {
        const set = new Set<number>([start + 1, start + 2, start + 3, start + 4, start + 5, end - 1, end, end + 1]);
        if (plan.extra === 'mid') set.add(start + 5 + (len >> 1));
        for (const o of [...set].sort((a, b) => a - b)) if (o > start && o <= end + 1) addCut(o);
      } else if (plan.mode === 'cuts') addCut(end);
      if (plan.mode === 'group') {
        if (groupLeft === 0) { groupLeft = 2 + Math.floor(r() * 49); groupCount = 0; }
        groupCount++;
        if (groupCount === groupLeft) { addCut(end); groupLeft = 0; }
      }
      if (plan.mode === 'close' && idx === plan.msgIndex) {
        closeOffset = plan.where === 'header' ? start + 3 : plan.where === 'payload' ? start + 5 + (len >> 1) : end;
      }
    };
    const scan = (chunk: Buffer): void => {
      for (let i = 0; i < chunk.length;) {
        if (!inMsg) {
          hdr.push(chunk[i++]!); scanPos++;
          if (hdr.length === 5) {
            const len = ((hdr[1]! << 24) | (hdr[2]! << 16) | (hdr[3]! << 8) | hdr[4]!) - 4;
            msgStart = scanPos - 5; msgEnd = scanPos + len; inMsg = true; hdr = [];
            onMessage(msgStart, msgEnd, len);
            if (len === 0) inMsg = false;
          }
        } else {
          const n = Math.min(msgEnd - scanPos, chunk.length - i);
          i += n; scanPos += n;
          if (scanPos === msgEnd) inMsg = false;
        }
      }
    };
    const take = (n: number): Buffer => {
      const parts: Buffer[] = [];
      let need = n;
      while (need > 0) {
        const head = queue[0]!;
        if (head.length <= need) { parts.push(head); need -= head.length; queue.shift(); } else { parts.push(head.subarray(0, need)); queue[0] = head.subarray(need); need = 0; }
      }
      queued -= n;
      return parts.length === 1 ? parts[0]! : Buffer.concat(parts);
    };
    const emit = async (n: number): Promise<void> => {
      const b = take(n);
      s2c.update(b); run.s2cBytes += b.length; sentTo += b.length;
      run.cuts.push(sentTo);
      await new Promise<void>((res) => client.write(b, () => res()));
    };
    let pumping = false;
    let idleFlush = false; // set by a timer when the server has been silent: send what is held
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    const pump = async (): Promise<void> => {
      if (pumping) return;
      pumping = true;
      try {
        for (;;) {
          if (client.destroyed) return;
          let target: number;
          if (plan.mode === 'pass') target = known;
          else if (plan.mode === 'close') target = closeOffset === null ? known : Math.min(closeOffset, known);
          else if (plan.mode === 'bytes1') target = sentTo + 1;
          else if (plan.mode === 'random') target = sentTo + 1 + Math.floor(r() * plan.maxSize);
          else {
            while (cutAt < cutList.length && cutList[cutAt]! <= sentTo) cutAt++;
            target = cutList[cutAt] ?? Infinity;
          }
          if (target > known) { if (upstreamEnded || (idleFlush && known > sentTo)) target = known; else break; }
          if (target <= sentTo) break;
          await emit(target - sentTo);
          if (plan.mode === 'pass') continue;
          const d = plan.mode === 'random' ? Math.floor(r() * (plan.maxDelayMs + 1)) : plan.mode === 'close' ? 0 : plan.delayMs;
          if (d > 0) await delay(d); else await new Promise<void>((res) => setImmediate(res));
        }
        if (plan.mode === 'close' && closeOffset !== null && sentTo >= closeOffset && run.closedAt === null) {
          run.closedAt = sentTo;
          await delay(plan.settleMs);
          up.destroy();
          if (plan.kind === 'rst') client.resetAndDestroy(); else client.end();
        } else if (upstreamEnded && sentTo >= known && plan.mode !== 'close' && !client.destroyed) client.end();
      } finally { pumping = false; }
    };
    up.on('data', (d: Buffer) => {
      queue.push(d); queued += d.length; known += d.length; scan(d); idleFlush = false;
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => { idleFlush = true; void pump(); }, 40);
      void pump();
    });
    up.on('end', () => { upstreamEnded = true; void pump(); });
    up.on('close', () => { upstreamEnded = true; run.s2cSha = s2c.digest('hex'); });
  }
}
