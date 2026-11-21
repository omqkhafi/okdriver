// Target description shared by the study runner, the poolers module and the hosted runner.
export interface Target {
  /** Stable id used in file names, e.g. `pgbouncer-default`. */
  id: string;
  pooler: string;
  config: string;
  mode: 'direct' | 'transaction' | 'session' | 'hosted';
  host: string; port: number;
  user: string; password: string; database: string;
  tls?: { servername?: string; ca?: string; rejectUnauthorized?: boolean } | false;
  /** Server-side pool size the pooler was configured with (informational). */
  serverPool: number;
  /** Clients for this study (8 for transaction mode; the session-mode control uses as many as the pool allows). */
  clients: number;
  /** The server-side proxy sits between the pooler and Postgres (local targets only). */
  serverSide: boolean;
  /** Reads the pooler's own statistics view. Returns rows as text. */
  stats?: () => Promise<Record<string, unknown>>;
  /** Extra notes written to the result (what the quick start forced, etc.). */
  notes?: string[];
}
