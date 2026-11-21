// The ablation ladder. Rung 1 is direct-pg.ts. Each rung adds one thing and keeps the rest.
//   1 direct          own socket loop, no platform contract
//   2 wirecore        PgCore driven by a raw socket (script-local loop, ad-hoc decode, no codec registry)
//   3 +transport      the same loop over the Transport contract (TcpTransport)
//   4 +coord+pool     rung 3 behind SimpleCoordinator.admit and SimplePool.acquire
//   5 full            Client.query: coordinator, pool, WireSession, codec registry, error mapper
import net from "node:net";
import { ByteWriter, SimpleCoordinator, SimplePool, type CoreEvent } from "../../src/platform/index.ts";
import { PgCore } from "../../src/engines/postgres/index.ts";
import { TcpTransport } from "../../src/transports/index.ts";
import { openClient } from "../../src/entry/compose.ts";
import { postgresPackage } from "../../src/entry/packages.ts";
import { DirectPg } from "./direct-pg.ts";

export interface Runner {
  query(i: number): Promise<unknown>;
  close(): Promise<void>;
}
export type Rung = "1-direct" | "2-wirecore" | "3-transport" | "4-coord-pool" | "5-full";
export const RUNGS: Rung[] = ["1-direct", "2-wirecore", "3-transport", "4-coord-pool", "5-full"];
const BASE = 2n ** 53n;
const SQL = "SELECT $1::int8";
const dec = new TextDecoder();
const never = new AbortController().signal;

/** Minimal pool for the rungs that have no pool contract: a free list and a waiter queue. */
class MiniPool<C> {
  private free: C[];
  private waiters: ((c: C) => void)[] = [];
  constructor(conns: C[]) { this.free = conns.slice(); }
  acquire(): Promise<C> {
    const c = this.free.pop();
    return c !== undefined ? Promise.resolve(c) : new Promise((r) => this.waiters.push(r));
  }
  release(c: C): void {
    const w = this.waiters.shift();
    if (w !== undefined) w(c);
    else this.free.push(c);
  }
}
function pooled<C extends { query(i: number): Promise<unknown>; close(): Promise<void> }>(conns: C[]): Runner {
  if (conns.length === 1) return conns[0]!;
  const pool = new MiniPool(conns);
  return {
    async query(i) { const c = await pool.acquire(); try { return await c.query(i); } finally { pool.release(c); } },
    close: async () => { for (const c of conns) await c.close(); },
  };
}

// ---- rung 2 -------------------------------------------------------------------------------------
class RawCoreConn {
  private core = new PgCore();
  private nextId = 1;
  private waiting = new Map<number, { resolve(v: bigint): void; reject(e: unknown): void }>();
  private ready: (() => void) | undefined;
  private sock!: net.Socket;
  static async open(port: number): Promise<RawCoreConn> {
    const c = new RawCoreConn();
    c.sock = net.connect({ host: "127.0.0.1", port });
    c.sock.setNoDelay(true);
    await new Promise<void>((r, j) => { c.sock.once("connect", r); c.sock.once("error", j); });
    c.sock.on("data", (b: Buffer) => c.handle(c.core.receive(b, b.length)));
    const ready = new Promise<void>((r) => (c.ready = r));
    const w = new ByteWriter(128);
    c.core.encode({ kind: "startup", user: "postgres", database: "fs01" }, w);
    c.sock.write(w.take());
    await ready;
    return c;
  }
  private handle(events: readonly CoreEvent[]): void {
    for (const ev of events) {
      if (ev.kind === "ready") this.ready?.();
      else if (ev.kind === "result") { const p = this.waiting.get(ev.id)!; this.waiting.delete(ev.id); p.resolve(BigInt(dec.decode(ev.result.rows[0]![0] as Uint8Array))); }
      else if (ev.kind === "error") { const p = this.waiting.get(ev.id!)!; this.waiting.delete(ev.id!); p.reject(ev.error); }
    }
  }
  query(i: number): Promise<bigint> {
    const id = this.nextId++;
    const w = new ByteWriter(128);
    this.core.encode({ kind: "query", id, sql: SQL, params: [{ tag: 0, data: String(BASE + BigInt(i)) }] }, w);
    return new Promise((resolve, reject) => { this.waiting.set(id, { resolve, reject }); this.sock.write(w.take()); });
  }
  async close(): Promise<void> { this.sock.destroy(); }
}

// ---- rung 3 and 4 ----------------------------------------------------------------------------------
class TransportCoreConn {
  private core = new PgCore();
  private nextId = 1;
  private waiting = new Map<number, { resolve(v: bigint): void; reject(e: unknown): void }>();
  private ready: (() => void) | undefined;
  private t = new TcpTransport();
  static async open(port: number): Promise<TransportCoreConn> {
    const c = new TransportCoreConn();
    c.t.onData((b, len) => c.handle(c.core.receive(b, len)));
    c.t.onClose(() => {});
    await c.t.open({ host: "127.0.0.1", port }, never);
    const ready = new Promise<void>((r) => (c.ready = r));
    const w = new ByteWriter(128);
    c.core.encode({ kind: "startup", user: "postgres", database: "fs01" }, w);
    c.t.write([w.take()]);
    await ready;
    return c;
  }
  private handle(events: readonly CoreEvent[]): void {
    for (const ev of events) {
      if (ev.kind === "ready") this.ready?.();
      else if (ev.kind === "result") { const p = this.waiting.get(ev.id)!; this.waiting.delete(ev.id); p.resolve(BigInt(dec.decode(ev.result.rows[0]![0] as Uint8Array))); }
      else if (ev.kind === "error") { const p = this.waiting.get(ev.id!)!; this.waiting.delete(ev.id!); p.reject(ev.error); }
    }
  }
  query(i: number): Promise<bigint> {
    const id = this.nextId++;
    const w = new ByteWriter(128);
    this.core.encode({ kind: "query", id, sql: SQL, params: [{ tag: 0, data: String(BASE + BigInt(i)) }] }, w);
    return new Promise((resolve, reject) => { this.waiting.set(id, { resolve, reject }); this.t.write([w.take()]); });
  }
  async close(): Promise<void> { this.t.close(); }
}

// ---- factory ------------------------------------------------------------------------------------------
export async function open(rung: Rung, port: number, conns: number): Promise<Runner> {
  switch (rung) {
    case "1-direct": {
      const cs = await Promise.all(Array.from({ length: conns }, () => DirectPg.connect(port)));
      return pooled(cs.map((c) => ({ query: (i: number) => c.query(BASE + BigInt(i)), close: () => c.close() })));
    }
    case "2-wirecore":
      return pooled(await Promise.all(Array.from({ length: conns }, () => RawCoreConn.open(port))));
    case "3-transport":
      return pooled(await Promise.all(Array.from({ length: conns }, () => TransportCoreConn.open(port))));
    case "4-coord-pool": {
      const coordinator = new SimpleCoordinator(conns);
      const pool = new SimplePool<TransportCoreConn>({ max: conns, create: () => TransportCoreConn.open(port), destroy: (c) => c.close() });
      return {
        async query(i) {
          const lease = await coordinator.admit({ kind: "query" }, never);
          try {
            const pc = await pool.acquire(never);
            try { return await pc.conn.query(i); } finally { pc.release(); }
          } finally { lease.release(); }
        },
        close: () => pool.drain(Date.now() + 5000),
      };
    }
    case "5-full": {
      const o = await openClient(postgresPackage, { endpoint: { host: "127.0.0.1", port }, user: "postgres", database: "fs01" }, { limit: conns, poolMax: conns });
      return {
        async query(i) { return (await o.client.query(SQL, [BASE + BigInt(i)])).rows[0]![0]; },
        close: () => o.close(),
      };
    }
  }
}
