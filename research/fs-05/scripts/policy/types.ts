// The contract between a pipeline scheduler policy and the pool that runs it. Nothing here names an engine:
// a policy gets a clock and a view of connection state, and answers two questions.
//   cap(conn)          how many statements may be on the wire on this connection right now
//   pick(eligible)     which of the eligible connections gets the next unit
// The same policy files run in the simulator and in the real client (scripts/core/pool.ts drives both).
export interface Clock { now(): number } // milliseconds, monotonic

export interface ConnState {
  readonly id: number;
  /** Statements written to the wire whose ReadyForQuery has not arrived. */
  readonly inFlight: number;
  /** Send time of the oldest statement in flight; meaningful only when inFlight > 0. */
  readonly oldestSentAt: number;
}

export interface Completion {
  readonly sentAt: number;
  readonly doneAt: number;
  /** Completion time of the previous statement on this connection, or -1. */
  readonly prevDoneAt: number;
  /** The connection had nothing else in flight when this statement was written. */
  readonly sentIdle: boolean;
}

export interface Policy {
  readonly name: string;
  cap(conn: ConnState): number;
  /** `eligible` is never empty and is ordered by connection id. */
  pick(eligible: readonly ConnState[]): ConnState;
  onComplete(conn: ConnState, c: Completion): void;
}
export type PolicyFactory = (clock: Clock, nConns: number, opts?: { D?: number }) => Policy;
