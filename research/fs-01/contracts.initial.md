# FS-01 initial contracts (appendix A4 and A5, verbatim)

Saved unchanged from the roadmap (appendix A4 and A5 of the task) before any code was
written. Everything under `src/platform/contracts/` is free to differ; the differences are in the
"Contract revisions" table in `README.md`.

## A4. Provisional contract sketches (roadmap section 5)

```ts
// platform/contracts/engine.ts
export interface EngineDescriptor<Caps extends CapabilitySet> {
  readonly id: 'postgres' | 'mysql' | 'mariadb' | 'sqlite';
  readonly class: 'wire' | 'embedded' | 'service';
  readonly contractVersion: string;            // Driver Contract version implemented
  capabilities(ctx: ConnectContext): Caps;     // after negotiation, never before
  errors: ErrorMapper;                         // vendor code -> shared taxonomy
  codecs: CodecRegistry;                       // generated from the engine contract
}
export interface WireCore {                    // Sans-IO, implemented per wire engine
  receive(buf: Uint8Array, len: number): readonly CoreEvent[];
  encode(cmd: CoreCommand, out: Writer): void;
  readonly phase: 'startup' | 'ready' | 'busy' | 'stream' | 'closed' | 'failed';
  readonly inFlight: number;                   // commands awaiting completion
}
export interface EmbeddedCore {                // implemented per SQLite binding
  prepare(sql: string): EmbeddedStatement;
  exec(sql: string): void;
  readonly inTransaction: boolean;
  close(): void;
}
```
Service integration contract and execution coordinator (provisional, validated in FS-01). A service integration has no persistent connection to pool, so the platform separates two things the first draft merged. The execution coordinator governs concurrency and resources for every engine class. The connection pool is a resource provider that only wire engines use.
```ts
export interface ServiceCore {                  // D1, libSQL/Hrana
  execute(req: ServiceRequest, signal: AbortSignal): Promise<ServiceResult>;
  // The atomic unit, where the service defines one (D1 batch).
  batch?(reqs: readonly ServiceRequest[], signal: AbortSignal): Promise<readonly ServiceResult[]>;
  // Interactive transactions, only where the service really has them (Hrana streams).
  openStream?(signal: AbortSignal): Promise<ServiceStream>;
  close(): Promise<void>;
}
export interface ExecutionCoordinator {         // platform-owned, all engine classes
  admit(work: WorkItem, signal: AbortSignal): Promise<Lease>;   // limits, queue timeout, cancellation
  readonly stats: CoordinatorStats;
}
export interface ConnectionPool {               // wire engines only
  acquire(signal: AbortSignal): Promise<PooledConnection>;
  drain(deadline: number): Promise<void>;
}
```
Transport contract
```ts
export interface Transport {
  readonly kind: 'tcp' | 'tls' | 'unix' | 'websocket' | 'http';
  readonly caps: TransportCaps;                // what this transport can really do
  open(target: Endpoint, signal: AbortSignal): Promise<void>;
  write(chunks: readonly Uint8Array[]): void;  // caller coalesces
  onData(cb: (buf: Uint8Array, len: number) => void): void;
  upgradeTls?(opts: TlsOptions): Promise<TlsInfo>;   // TlsInfo.endpointHash for channel binding
  close(reason?: Error): void;
}
export interface TransportCaps {
  streaming: boolean;        // false for stateless HTTP
  startTls: boolean;
  channelBinding: 'tls-server-end-point' | 'none';
  keepalive: boolean;
  halfOpenDetection: boolean;
  secondConnectionForCancel: boolean;
}
```

## A5. Capability model, error taxonomy, type contract

A capability is a typed fact about one engine on one transport under one profile. A feature that is missing is a compile-time error where the types can know it and a CapabilityError at call time where they cannot. No transport or engine may declare a capability without a passing conformance test for that cell.
```ts
export interface CapabilitySet {
  pipelining: boolean;
  protocolPrepared: boolean;
  interactiveTransactions: boolean;
  savepoints: boolean;
  returning: boolean;
  streamingResults: boolean;
  bulkLoad: false | { formats: readonly ('text' | 'csv' | 'binary')[] };
  notifications: boolean;
  changeStream: boolean;
  cancel: 'server' | 'local-only' | 'none';
  int64: 'bigint';
  multiResult: boolean;
}
```
Error taxonomy (shared)
| Field | Meaning |
|---|---|
| class | connection, auth, tls, protocol, syntax, constraint, serialization, deadlock, timeout, cancelled, resource, capability, internal |
| phase | connect, auth, prepare, bind, execute, fetch, commit, close |
| statementOutcome | not-sent, rejected-no-effects, rejected-effects-possible, applied, partially-applied, unknown (section 14) |
| transactionState | none, open, committed, rolled-back, implicitly-committed, failed-open, unknown (section 14) |
| retry | safe, safe-in-new-transaction, never, caller-decides |
| vendor | Engine code untouched (SQLSTATE, MySQL errno, SQLite result code) |
| redacted | True when parameters or secrets were removed from the message |

Type contract. Each engine has a machine-readable contract file per type that generates its codec, tests and documentation. Cross-engine consistency is a rule, not a shared codec: integers of a 64-bit declared type are always bigint, exact decimals are always strings unless the caller picks a decimal codec, binary data is always Uint8Array, and no value is ever silently lossy.
