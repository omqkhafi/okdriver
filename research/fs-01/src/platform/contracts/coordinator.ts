export interface WorkItem {
  readonly kind: "query" | "transaction" | "connect";
  /** Queue timeout in milliseconds. Absent means wait until aborted. */
  readonly queueTimeoutMs?: number;
}
export interface Lease {
  release(): void;
}
export interface CoordinatorStats {
  readonly limit: number;
  readonly active: number;
  readonly queued: number;
  readonly maxActive: number;
  readonly admitted: number;
  readonly cancelledInQueue: number;
  readonly timedOutInQueue: number;
}
export interface ExecutionCoordinator {
  admit(work: WorkItem, signal: AbortSignal): Promise<Lease>;
  readonly stats: CoordinatorStats;
}
