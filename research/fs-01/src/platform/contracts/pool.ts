export interface PooledConnection<C> {
  readonly conn: C;
  release(): void;
  /** Remove the connection from the pool instead of returning it. */
  destroy(): void;
}
export interface ConnectionPool<C> {
  acquire(signal: AbortSignal): Promise<PooledConnection<C>>;
  drain(deadline: number): Promise<void>;
}
