// The pool scheduler shared by the simulator and the real client. It owns the queue, the per-connection FIFO of
// statements on the wire, the depth window and the sharing switch; the policy only answers cap() and pick().
// Late binding: a unit waits in the pool queue until some connection is eligible, so a statement is never queued
// behind a connection that is at its cap (statements assigned but not yet written exist only as the unsent rest of a
// caller's pipeline).
//   sharing on : a connection is eligible when it holds no unsent rest of a pipeline and inFlight < cap.
//   sharing off: a connection is eligible only when it is idle (one caller at a time); cap is then the window
//                inside that caller's own pipeline.
import type { Clock, ConnState, Policy } from '../policy/types.ts';

export const K_FAST = 0, K_SLEEP = 1, K_CPU = 2, K_ERR = 3, K_LOCK = 4, K_UNLOCK = 5;
export interface Stmt {
  uid: number;
  kind: number;
  /** fast: row id; sleep: milliseconds; cpu: generate_series upper bound; err: 0; lock: advisory key. */
  arg: number;
  /** 0 fast, 1 slow, 2 other (blocker). Metrics only. */
  cls: number;
  /** Scheduled send time (open loop) or submit time (closed loop). */
  t0: number;
  sentAt: number;
  sentIdle: boolean;
  unit: Unit;
  idx: number;
}
export interface Result { uid: number; v: number; err: string | null }
export interface Unit {
  stmts: Stmt[];
  /** Called for each statement result, in the order the connection returned them. */
  onStmt: (s: Stmt, r: Result) => void;
  onDone: (u: Unit) => void;
  done: number;
  /** Next statement index to write; set while the unit sits on a connection. */
  next: number;
}
export interface Transport { send(connId: number, batch: Stmt[]): void }
export interface LostReport { connId: number; onWire: Stmt[]; notSent: Stmt[] }

class Conn implements ConnState {
  inFlight = 0;
  fifo: Stmt[] = [];
  head = 0;
  rest: Unit | null = null;
  alive = true;
  lastDoneAt = -1;
  batch: Stmt[] = [];
  constructor(readonly id: number) {}
  get oldestSentAt(): number { return this.fifo[this.head]?.sentAt ?? 0; }
}

export interface PoolOptions { connections: number; policy: Policy; clock: Clock; sharing: boolean; transport: Transport }

export class PoolCore {
  private conns: Conn[];
  private queue: Unit[] = [];
  private qHead = 0;
  private pumping = false;
  private again = false;
  private elig: Conn[] = [];
  /** Defects the pool itself can see: a result that does not belong to the statement at the head of the FIFO. */
  mismatches = 0;
  misorders = 0;
  constructor(private o: PoolOptions) { this.conns = Array.from({ length: o.connections }, (_, i) => new Conn(i)); }

  stateOf(id: number): ConnState { return this.conns[id]!; }
  get queued(): number { return this.queue.length - this.qHead; }
  inFlightOf(id: number): number { return this.conns[id]!.inFlight; }

  submit(u: Unit): void {
    u.done = 0; u.next = 0;
    this.queue.push(u);
    this.pump();
  }

  /** The transport reports the next ReadyForQuery of connection `connId`. */
  complete(connId: number, r: Result): void {
    const c = this.conns[connId]!;
    const s = c.fifo[c.head]!;
    c.fifo[c.head++] = undefined as never;
    if (c.head > 1024 && c.head * 2 > c.fifo.length) { c.fifo = c.fifo.slice(c.head); c.head = 0; }
    c.inFlight--;
    const now = this.o.clock.now();
    if (r.err === null && r.uid !== s.uid) this.mismatches++;
    if (s.idx !== s.unit.done) this.misorders++;
    this.o.policy.onComplete(c, { sentAt: s.sentAt, doneAt: now, prevDoneAt: c.lastDoneAt, sentIdle: s.sentIdle });
    c.lastDoneAt = now;
    const u = s.unit;
    u.done++;
    u.onStmt(s, r);
    if (u.done === u.stmts.length) u.onDone(u);
    this.pump();
  }

  /** The connection died. Statements on the wire have an unknown outcome; the unsent rest of a pipeline never left. */
  lose(connId: number): LostReport {
    const c = this.conns[connId]!;
    c.alive = false;
    const onWire = c.fifo.slice(c.head);
    const notSent = c.rest ? c.rest.stmts.slice(c.rest.next) : [];
    c.fifo = []; c.head = 0; c.inFlight = 0; c.rest = null;
    this.pump();
    return { connId, onWire, notSent };
  }

  private window(c: Conn): number { return this.o.policy.cap(c) - c.inFlight; }

  private sendFrom(c: Conn): void {
    const u = c.rest!;
    const now = this.o.clock.now();
    let room = this.window(c);
    while (room-- > 0 && u.next < u.stmts.length) {
      const s = u.stmts[u.next++]!;
      s.sentAt = now; s.sentIdle = c.inFlight === 0;
      c.fifo.push(s); c.inFlight++; c.batch.push(s);
    }
    if (u.next >= u.stmts.length) c.rest = null;
  }

  pump(): void {
    if (this.pumping) { this.again = true; return; }
    this.pumping = true;
    do {
      this.again = false;
      for (const c of this.conns) if (c.alive && c.rest && this.window(c) > 0) this.sendFrom(c);
      while (this.qHead < this.queue.length) {
        const el = this.elig; el.length = 0;
        for (const c of this.conns) {
          if (!c.alive || c.rest) continue;
          if (this.o.sharing ? this.window(c) > 0 : c.inFlight === 0) el.push(c);
        }
        if (el.length === 0) break;
        const c = this.o.policy.pick(el) as Conn;
        c.rest = this.queue[this.qHead]!; this.queue[this.qHead++] = undefined as never;
        this.sendFrom(c);
      }
      if (this.qHead > 1024 && this.qHead * 2 > this.queue.length) { this.queue = this.queue.slice(this.qHead); this.qHead = 0; }
      for (const c of this.conns) if (c.batch.length) { const b = c.batch; c.batch = []; this.o.transport.send(c.id, b); }
    } while (this.again);
    this.pumping = false;
  }
}
