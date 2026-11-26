// Raw TCP servers for the capability and lifetime probes. Run on Node. Each keeps its own sha256 of the bytes it wrote or read.
import net from 'node:net';
import { createHash } from 'node:crypto';
import { rng } from './fakepg.ts';

export interface Done { bytes: number; sha: string }
const pattern = (seed: number, n: number): Buffer => { const r = rng(seed); const b = Buffer.allocUnsafe(n); for (let i = 0; i < n; i++) b[i] = Math.floor(r() * 256); return b; };

export class CapServers {
  ports: Record<string, number> = {};
  /** per server name: results of the connections it served, in order */
  results: Record<string, Done[]> = {};
  private servers: net.Server[] = [];
  private sockets = new Set<net.Socket>();

  private add(name: string, handler: (s: net.Socket, report: (d: Done) => void) => void): Promise<void> {
    this.results[name] = [];
    const srv = net.createServer({ noDelay: true }, (s) => {
      this.sockets.add(s); s.on('close', () => this.sockets.delete(s)); s.on('error', () => {});
      handler(s, (d) => this.results[name]!.push(d));
    });
    this.servers.push(srv);
    return new Promise((r) => srv.listen(0, '127.0.0.1', () => { this.ports[name] = (srv.address() as net.AddressInfo).port; r(); }));
  }

  async start(o: { streamBytes: number; stallMs: number; halfBytes: number }): Promise<this> {
    const block = pattern(7, 1 << 20);
    // pushes streamBytes at full speed, honouring backpressure
    await this.add('stream', (s, report) => {
      const h = createHash('sha256');
      let sent = 0;
      const pump = (): void => {
        while (sent < o.streamBytes) {
          const n = Math.min(block.length, o.streamBytes - sent);
          const b = block.subarray(0, n);
          h.update(b); sent += n;
          if (!s.write(b)) { s.once('drain', pump); return; }
        }
        report({ bytes: sent, sha: h.digest('hex') });
      };
      pump();
    });
    // does not read for stallMs, then reads everything and hashes it
    await this.add('stall', (s, report) => {
      const h = createHash('sha256');
      let n = 0;
      s.pause();
      setTimeout(() => s.resume(), o.stallMs);
      s.on('data', (d) => { h.update(d); n += d.length; });
      s.on('end', () => { report({ bytes: n, sha: h.digest('hex') }); s.end(); });
    });
    await this.add('rst', (s) => { s.write(pattern(3, 2000)); setTimeout(() => s.resetAndDestroy(), 100); });
    await this.add('fin', (s) => { s.write(pattern(4, 2500)); setTimeout(() => s.end(), 100); });
    await this.add('hold', (s) => { s.write(pattern(5, 2000)); });
    await this.add('lifetime', (s, report) => {
      const h = createHash('sha256');
      let i = 0, total = 0;
      const tick = (): void => {
        if (i >= 60) { report({ bytes: total, sha: h.digest('hex') }); return; }
        const b = pattern(100 + i, 1000 + 37 * i);
        h.update(b); total += b.length; i++;
        s.write(b);
        setTimeout(tick, 4);
      };
      tick();
    });
    await this.add('half', (s, report) => {
      let got = 0;
      s.on('data', (d) => { got += d.length; });
      s.on('end', () => {
        const b = pattern(9, o.halfBytes);
        report({ bytes: got, sha: createHash('sha256').update(b).digest('hex') });
        s.write(b, () => s.end());
      });
    });
    return this;
  }
  close(): void { for (const s of this.servers) s.close(); for (const s of this.sockets) s.destroy(); }
}
