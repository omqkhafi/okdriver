// Composition: an engine package plus a transport plus the platform's coordinator and pool.
// ADR 042 has no owner for this code; see the "entry" finding in README.md.
import {
  Client,
  connectWithRetry,
  EmbeddedSession,
  ServiceSession,
  SimpleCoordinator,
  SimplePool,
  WireSession,
  type CapabilitySet,
  type EmbeddedCore,
  type EngineDescriptor,
  type Endpoint,
  type ServiceCore,
  type Session,
  type SessionSource,
  type TransportFactory,
  type WireCore,
} from "../platform/index.ts";
import { HttpTransport, TcpTransport } from "../transports/index.ts";

export type EnginePackage =
  | { readonly class: "wire"; readonly descriptor: EngineDescriptor; newCore(): WireCore }
  | { readonly class: "embedded"; readonly descriptor: EngineDescriptor; open(path: string): EmbeddedCore }
  | { readonly class: "service"; readonly descriptor: EngineDescriptor; newCore(t: TransportFactory, e: Endpoint): ServiceCore };

export interface Target {
  readonly endpoint: Endpoint; // unused by embedded engines
  readonly path?: string; // embedded: database file
  readonly user: string;
  readonly database: string;
}
export interface OpenOptions {
  /** Coordinator limit. */
  readonly limit: number;
  /** Pool size, wire engines only. */
  readonly poolMax?: number;
  readonly connectTimeoutMs?: number;
}
export interface Opened {
  readonly client: Client;
  readonly coordinator: SimpleCoordinator;
  readonly pool: SimplePool<WireSession> | undefined;
  close(): Promise<void>;
}

const never = new AbortController().signal;

export async function openClient(pkg: EnginePackage, target: Target, o: OpenOptions): Promise<Opened> {
  const coordinator = new SimpleCoordinator(o.limit);
  const timeout = o.connectTimeoutMs ?? 10_000;
  let source: SessionSource;
  let pool: SimplePool<WireSession> | undefined;
  switch (pkg.class) {
    case "wire": {
      pool = new SimplePool<WireSession>({
        max: o.poolMax ?? o.limit,
        create: () =>
          connectWithRetry(
            (sig) =>
              WireSession.connect(
                { descriptor: pkg.descriptor, core: pkg.newCore(), transport: new TcpTransport(), endpoint: target.endpoint, user: target.user, database: target.database },
                sig,
              ),
            timeout,
            never,
          ),
        destroy: (s) => s.close(),
      });
      const p = pool;
      source = {
        async checkout(signal) {
          const pc = await p.acquire(signal);
          return {
            session: pc.conn,
            release: () => (pc.conn.broken ? pc.destroy() : pc.release()),
            discard: () => pc.destroy(),
          };
        },
        close: () => p.drain(Date.now() + 5000),
      };
      break;
    }
    case "embedded": {
      const session: Session = new EmbeddedSession(pkg.descriptor, pkg.open(target.path ?? ":memory:"));
      source = { checkout: async () => ({ session, release() {}, discard() {} }), close: () => session.close() };
      break;
    }
    case "service": {
      const core = pkg.newCore(() => new HttpTransport(), target.endpoint);
      // The handshake happens on first use, inside the caller's admission, and is shared by concurrent first callers.
      let first: Promise<CapabilitySet> | undefined;
      const handshake = (): Promise<CapabilitySet> => {
        first ??= connectWithRetry((sig) => ServiceSession.connect(pkg.descriptor, core, sig), timeout, never).then(
          (s) => s.capabilities,
          (e) => {
            first = undefined; // the next caller tries again
            throw e;
          },
        );
        return first;
      };
      source = {
        checkout: async () => ({ session: ServiceSession.attach(await handshake(), pkg.descriptor, core), release() {}, discard() {} }),
        close: () => core.close(),
      };
      break;
    }
  }
  const client = new Client(pkg.descriptor, source, coordinator);
  return { client, coordinator, pool, close: () => client.close() };
}
