// Brings one pooler configuration up in the Docker network `fs06`, between the server-side proxy and the client port.
//   harness client -> client-side proxy (20 ms each way) -> pooler container -> server-side proxy -> Postgres container
import { spawnSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { PgConn } from './lib/client.ts';
import { simpleQuery, asObjects } from './lib/admin.ts';
import { RecordingProxy } from './lib/proxy.ts';
import type { Target } from './lib/target.ts';
import { WORK } from './lib/paths.ts';

export const PG_PORT = 55400;
export const SERVER_PROXY_PORT = 55401;
export const POOLER_PORT = 55410;
export const ADMIN_PORT = 55411;
export const NET = 'fs06';
export const PG_USER = 'fs06', PG_PASSWORD = 'fs06pw', PG_DB = 'fs06';
export const POOL_SIZE = 2;
const CONTAINER = 'fs06-pooler';
const UPSTREAM_HOST = 'host.docker.internal'; // the Docker host gateway: where the server-side proxy listens

export const sh = (cmd: string, opts: { allowFail?: boolean } = {}): string => {
  const r = spawnSync('bash', ['-c', cmd], { encoding: 'utf8' });
  if (r.status !== 0 && !opts.allowFail) throw new Error(`command failed (${r.status}): ${cmd}\n${r.stdout}\n${r.stderr}`);
  return (r.stdout ?? '') + (r.stderr ?? '');
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface Handle { target: Target; sproxy: RecordingProxy; down(): Promise<void>; logs(): string }

export const pooledConfig = (id: string) => { const d = `${WORK}conf/${id}/`; mkdirSync(d, { recursive: true }); return d; };

export function ensurePostgres(): void {
  const running = sh(`docker ps -q -f name=^fs06-pg$`, { allowFail: true }).trim();
  if (running) return;
  sh(`docker network create ${NET}`, { allowFail: true });
  sh(`docker rm -f fs06-pg`, { allowFail: true });
  sh(`docker run -d --name fs06-pg --network ${NET} -p 127.0.0.1:${PG_PORT}:5432 -e POSTGRES_USER=${PG_USER} -e POSTGRES_PASSWORD=${PG_PASSWORD} -e POSTGRES_DB=${PG_DB} postgres:19.0 -c max_connections=200`);
}

export async function waitFor(fn: () => Promise<boolean>, what: string, ms = 60000): Promise<void> {
  const end = Date.now() + ms; let last = '';
  while (Date.now() < end) { try { if (await fn()) return; } catch (e: any) { last = e.message; } await sleep(500); }
  throw new Error(`timeout waiting for ${what}: ${last}`);
}

export const scramSecret = () => sh(`docker exec fs06-pg psql -U ${PG_USER} -d ${PG_DB} -tAc "select rolpassword from pg_authid where rolname='${PG_USER}'"`).trim();

interface Spec {
  id: string; pooler: string; config: string; mode: Target['mode'];
  image: string; args?: string; dockerArgs?: string; mounts: string[]; clients: number; serverPool: number;
  env?: Record<string, string>;
  stats?: () => Promise<Record<string, unknown>>;
  notes?: string[];
  user?: string; password?: string; database?: string;
  ready?: () => Promise<boolean>;
  /** Runs before the pooler container starts (e.g. a metadata database). */
  pre?: () => Promise<void>;
  /** Runs after the pooler container started and before the readiness probe (e.g. creating a tenant through an API). */
  post?: () => Promise<void>;
  cleanup?: () => void;
}

async function raise(spec: Spec): Promise<Handle> {
  ensurePostgres();
  await waitFor(async () => (await simpleQuery({ host: '127.0.0.1', port: PG_PORT, user: PG_USER, password: PG_PASSWORD, database: PG_DB }, 'select 1')).rows.length === 1, 'postgres');
  sh(`docker rm -f ${CONTAINER}`, { allowFail: true });
  sh(`docker exec fs06-pg psql -U ${PG_USER} -d ${PG_DB} -c "select pg_terminate_backend(pid) from pg_stat_activity where pid <> pg_backend_pid() and datname='${PG_DB}'"`, { allowFail: true });
  await spec.pre?.();
  const sproxy = new RecordingProxy({ name: 'server-side', port: SERVER_PROXY_PORT, listenHost: '0.0.0.0', targetHost: '127.0.0.1', targetPort: PG_PORT, delayMs: 0 });
  await sproxy.start();
  const env = Object.entries(spec.env ?? {}).map(([k, v]) => `-e ${k}=${JSON.stringify(v)}`).join(' ');
  sh(`docker run -d --name ${CONTAINER} --network ${NET} --add-host ${UPSTREAM_HOST}:host-gateway -p 127.0.0.1:${POOLER_PORT}:6432 ${spec.mounts.map((m) => `-v ${m}`).join(' ')} ${env} ${spec.dockerArgs ?? ''} ${spec.image} ${spec.args ?? ''}`);
  await spec.post?.();
  const target: Target = {
    id: spec.id, pooler: spec.pooler, config: spec.config, mode: spec.mode, host: '127.0.0.1', port: POOLER_PORT,
    user: spec.user ?? PG_USER, password: spec.password ?? PG_PASSWORD, database: spec.database ?? PG_DB,
    serverPool: spec.serverPool, clients: spec.clients, serverSide: true, stats: spec.stats, notes: spec.notes, tls: false,
  };
  try {
    await waitFor(async () => {
      if (!sh(`docker ps -q -f name=^${CONTAINER}$`, { allowFail: true }).trim()) throw new Error('container exited: ' + sh(`docker logs ${CONTAINER} 2>&1 | tail -15`, { allowFail: true }));
      const c = await PgConn.connect({ host: target.host, port: target.port, user: target.user, password: target.password, database: target.database, connectTimeoutMs: 5000 });
      c.write(new Uint8Array([81, 0, 0, 0, 13, 115, 101, 108, 101, 99, 116, 32, 49, 0])); // Query "select 1"
      const r = await c.collect(1, 8000); c.close();
      return r.end === 'ok' && r.msgs.some((m) => m.type === 'D');
    }, `${spec.id} to answer select 1`, 90000);
  } catch (e) {
    const logs = sh(`docker logs ${CONTAINER} 2>&1 | tail -40`, { allowFail: true });
    await sproxy.stop(); sh(`docker rm -f ${CONTAINER}`, { allowFail: true }); spec.cleanup?.();
    throw new Error(`${(e as Error).message}\n--- pooler log ---\n${logs}`);
  }
  await sleep(500);
  sproxy.reset();
  return { target, sproxy, logs: () => sh(`docker logs ${CONTAINER} 2>&1 | tail -80`, { allowFail: true }), down: async () => { await sproxy.stop(); sh(`docker rm -f ${CONTAINER}`, { allowFail: true }); spec.cleanup?.(); } };
}

// ------------------------------------------------------------------------------------------------ PgBouncer
export const PGBOUNCER_IMAGE = 'fs06/pgbouncer:1.26.1';
function pgbouncer(config: 'default' | 'on' | 'off' | 'session'): Spec {
  const id = `pgbouncer-${config}`; const dir = pooledConfig(id);
  const mode = config === 'session' ? 'session' : 'transaction';
  const pool = config === 'session' ? 8 : POOL_SIZE;
  const mps = config === 'on' ? 'max_prepared_statements = 200\n' : config === 'off' ? 'max_prepared_statements = 0\n' : '';
  writeFileSync(dir + 'pgbouncer.ini', `[databases]
${PG_DB} = host=${UPSTREAM_HOST} port=${SERVER_PROXY_PORT} dbname=${PG_DB} pool_size=${pool}

[pgbouncer]
listen_addr = 0.0.0.0
listen_port = 6432
auth_type = scram-sha-256
auth_file = /etc/pgbouncer/userlist.txt
admin_users = ${PG_USER}
pool_mode = ${mode}
default_pool_size = ${pool}
max_client_conn = 200
server_tls_sslmode = disable
logfile = /dev/stdout
unix_socket_dir =
${mps}`);
  writeFileSync(dir + 'userlist.txt', `"${PG_USER}" "${scramSecret()}"\n`);
  const admin = { host: '127.0.0.1', port: POOLER_PORT, user: PG_USER, password: PG_PASSWORD, database: 'pgbouncer' };
  return {
    id, pooler: 'pgbouncer', config, mode, image: PGBOUNCER_IMAGE, dockerArgs: '-u 65534:65534', args: '/etc/pgbouncer/pgbouncer.ini', mounts: [`${dir}:/etc/pgbouncer`], clients: 8, serverPool: pool,
    notes: ['PgBouncer refuses to run as root, so the container runs as uid 65534', 'auth_type scram-sha-256 needs an auth_file; the SCRAM secret was read from pg_authid', 'unix_socket_dir emptied so the container needs no socket directory', 'server_tls_sslmode disable (the server-side proxy answers no TLS)'],
    stats: async () => ({
      pools: asObjects(await simpleQuery(admin, 'SHOW POOLS')).filter((r: any) => r.database === PG_DB),
      servers: asObjects(await simpleQuery(admin, 'SHOW SERVERS')).filter((r: any) => r.database === PG_DB).map((r: any) => ({ state: r.state, link: r.link ? 'client' : '', pid: r.remote_pid })),
      config: asObjects(await simpleQuery(admin, 'SHOW CONFIG')).filter((r: any) => ['max_prepared_statements', 'pool_mode', 'default_pool_size'].includes(String(r.key))).map((r: any) => `${r.key}=${r.value}`),
    }),
  };
}

// ------------------------------------------------------------------------------------------------ PgDog
export const PGDOG_IMAGE = 'ghcr.io/pgdogdev/pgdog:v0.1.66';
function pgdog(config: 'default' | 'extended' | 'extended_anonymous' | 'disabled' | 'session'): Spec {
  const id = `pgdog-${config}`; const dir = pooledConfig(id);
  const mode = config === 'session' ? 'session' : 'transaction';
  const pool = config === 'session' ? 8 : POOL_SIZE;
  const ps = ['extended', 'extended_anonymous', 'disabled'].includes(config) ? `prepared_statements = "${config}"\n` : '';
  writeFileSync(dir + 'pgdog.toml', `[general]
host = "0.0.0.0"
port = 6432
pooler_mode = "${mode}"
default_pool_size = ${pool}
min_pool_size = 1
openmetrics_port = 9090
${ps}
[admin]
name = "admin"
user = "admin"
password = "pgdogadmin"

[[databases]]
name = "${PG_DB}"
host = "${UPSTREAM_HOST}"
port = ${SERVER_PROXY_PORT}
`);
  writeFileSync(dir + 'users.toml', `[[users]]
name = "${PG_USER}"
database = "${PG_DB}"
password = "${PG_PASSWORD}"
pool_size = ${pool}
`);
  const admin = { host: '127.0.0.1', port: POOLER_PORT, user: 'admin', password: 'pgdogadmin', database: 'admin' };
  return {
    id, pooler: 'pgdog', config, mode, image: PGDOG_IMAGE, mounts: [`${dir}:/pgdog`], clients: 8, serverPool: pool,
    notes: ['pgdog.toml and users.toml are read from /pgdog; the user password is stored in plain text in users.toml', 'PgDog disables prepared-statement handling automatically in session mode (core.rs prepared_statements())'],
    stats: async () => ({
      pools: asObjects(await simpleQuery(admin, 'SHOW POOLS')).filter((r: any) => r.database === PG_DB),
      servers: asObjects(await simpleQuery(admin, 'SHOW SERVERS')).map((r: any) => ({ state: r.state, database: r.database, application_name: r.application_name })),
    }),
  };
}

// ------------------------------------------------------------------------------------------------ Odyssey
export const ODYSSEY_IMAGE = 'ghcr.io/yandex/odyssey:1.5.2';
function odyssey(config: 'default' | 'on' | 'off' | 'session'): Spec {
  const id = `odyssey-${config}`; const dir = pooledConfig(id);
  const mode = config === 'session' ? 'session' : 'transaction';
  const pool = config === 'session' ? 8 : POOL_SIZE;
  const rps = config === 'on' ? '        pool_reserve_prepared_statement yes\n' : config === 'off' ? '        pool_reserve_prepared_statement no\n' : '';
  writeFileSync(dir + 'odyssey.conf', `unix_socket_dir "/tmp"
unix_socket_mode "0644"
log_format "%p %t %l [%i %s] (%c) %m\\n"
log_to_stdout yes
log_session yes
log_query no
log_config yes
daemonize no
locks_dir "/tmp/odyssey"
listen {
  host "*"
  port 6432
}
storage "local" {
  type "local"
}
storage "postgres_server" {
  type "remote"
  host "${UPSTREAM_HOST}"
  port ${SERVER_PROXY_PORT}
  tls "disable"
}
database "${PG_DB}" {
  user "${PG_USER}" {
    authentication "scram-sha-256"
    password "${PG_PASSWORD}"
    storage "postgres_server"
    storage_user "${PG_USER}"
    storage_password "${PG_PASSWORD}"
    pool "${mode}"
    pool_size ${pool}
    client_fwd_error yes
${rps}  }
}
database "console" {
  user "console" {
    authentication "none"
    role "admin"
    pool "session"
    storage "local"
  }
}
`);
  const admin = { host: '127.0.0.1', port: POOLER_PORT, user: 'console', password: '', database: 'console' };
  return {
    id, pooler: 'odyssey', config, mode, image: ODYSSEY_IMAGE, mounts: [`${dir}/odyssey.conf:/etc/odyssey/odyssey.conf`], clients: 8, serverPool: pool,
    notes: ['scram-sha-256 on the client side needs the plain password in the route (password "..."), and storage_user/storage_password for the backend login', 'the image entrypoint uses a mounted /etc/odyssey/odyssey.conf unchanged'],
    stats: async () => ({
      pools: asObjects(await simpleQuery(admin, 'SHOW POOLS')).filter((r: any) => r.database === PG_DB),
      servers: asObjects(await simpleQuery(admin, 'SHOW SERVERS')).filter((r: any) => r.database === PG_DB).map((r: any) => ({ state: r.state, pid: r.remote_pid ?? r.pid })),
    }),
  };
}

// ------------------------------------------------------------------------------------------------ Supavisor
export const SUPAVISOR_IMAGE = 'supabase/supavisor:2.10.1';
const TENANT = 'fs06t';
function supavisor(config: 'default' | 'on' | 'session'): Spec {
  const id = `supavisor-${config}`;
  const mode = config === 'session' ? 'session' : 'transaction';
  const pool = config === 'session' ? 8 : POOL_SIZE;
  const jwt = () => {
    const b = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const h = b({ alg: 'HS256', typ: 'JWT' }), p = b({ iss: 'supabase', role: 'anon', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 });
    return `${h}.${p}.${createHmac('sha256', 'dev').update(`${h}.${p}`).digest('base64url')}`;
  };
  const metrics = async (): Promise<Record<string, unknown>> => {
    const r = await fetch('http://127.0.0.1:4000/metrics', { headers: { authorization: `Bearer ${jwt()}` } });
    const out: Record<string, string> = {};
    for (const l of (await r.text()).split('\n')) {
      if (l.startsWith('#') || !l.includes(`tenant="${TENANT}"`)) continue;
      const m = /^(supavisor_(?:db_handler_db_connection_count|db_handler_started_count|client_joins_ok|client_connection_duration_count|client_queries_count))\{.*\}\s+(\S+)$/.exec(l);
      if (m) out[m[1]!] = m[2]!;
    }
    return out;
  };
  return {
    id, pooler: 'supavisor', config, mode, image: SUPAVISOR_IMAGE, clients: 8, serverPool: pool, mounts: [],
    user: `${PG_USER}.${TENANT}`,
    dockerArgs: '-p 127.0.0.1:4000:4000',
    args: `sh -c "/app/bin/migrate && /app/bin/server"`,
    env: {
      RLIMIT_NOFILE: '', PORT: '4000',
      PROXY_PORT_TRANSACTION: mode === 'transaction' ? '6432' : '6543', PROXY_PORT_SESSION: mode === 'session' ? '6432' : '5452',
      DATABASE_URL: 'ecto://postgres:postgres@fs06-supa-meta:5432/postgres', CLUSTER_POSTGRES: 'true',
      SECRET_KEY_BASE: '12345678901234567890121234567890123456789012345678903212345678901234567890123456789032123456789012345678901234567890323456789032',
      VAULT_ENC_KEY: '12345678901234567890123456789032', API_JWT_SECRET: 'dev', METRICS_JWT_SECRET: 'dev', REGION: 'local', ERL_AFLAGS: '-proto_dist inet_tcp',
      ...(config === 'on' ? { NAMED_PREPARED_STATEMENTS_ENABLED: 'true' } : {}),
    },
    notes: [
      'Supavisor needs its own metadata Postgres (second container, same postgres:19.0 image), created fresh for every configuration',
      'the image entrypoint raises RLIMIT_NOFILE and fails in this sandbox, so RLIMIT_NOFILE is set empty',
      'tenants are created through the management API with an HS256 JWT signed with API_JWT_SECRET; the client user is `<user>.<tenant>`',
      'a tenant with a non-manager user and no auth_query is rejected (400), so the user is a manager user and the tenant has an auth_query reading pg_authid',
      'pool mode follows the listening port (transaction or session); NAMED_PREPARED_STATEMENTS_ENABLED=true is the documented switch for named statements in transaction mode',
    ],
    stats: metrics,
    pre: async () => {
      sh(`docker rm -f fs06-supa-meta`, { allowFail: true });
      sh(`docker run -d --name fs06-supa-meta --network ${NET} -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=postgres postgres:19.0`);
      await waitFor(async () => sh(`docker exec fs06-supa-meta pg_isready -U postgres`, { allowFail: true }).includes("accepting connections") && sh(`docker exec fs06-supa-meta psql -U postgres -tAc "create schema if not exists _supavisor"`, { allowFail: true }).includes("CREATE"), "supavisor metadata database", 60000);
    },
    post: async () => {
      await waitFor(async () => (await fetch('http://127.0.0.1:4000/api/health')).ok, 'supavisor management API', 90000);
      const r = await fetch(`http://127.0.0.1:4000/api/tenants/${TENANT}`, { method: 'PUT', headers: { authorization: `Bearer ${jwt()}`, 'content-type': 'application/json' }, body: JSON.stringify({ tenant: {
        db_host: UPSTREAM_HOST, db_port: SERVER_PROXY_PORT, db_database: PG_DB, ip_version: 'auto', enforce_ssl: false, require_user: false,
        auth_query: 'SELECT rolname, rolpassword FROM pg_authid WHERE rolname=$1;', default_pool_size: pool,
        users: [{ db_user: PG_USER, db_password: PG_PASSWORD, pool_size: pool, mode_type: mode, is_manager: true }] } }) });
      if (r.status >= 300) throw new Error(`tenant creation failed: ${r.status} ${(await r.text()).slice(0, 300)}`);
    },
    cleanup: () => { sh(`docker rm -f fs06-supa-meta`, { allowFail: true }); },
  };
}

export const SPECS: Record<string, () => Spec> = {
  'supavisor-default': () => supavisor('default'), 'supavisor-on': () => supavisor('on'), 'supavisor-session': () => supavisor('session'),
  'pgbouncer-default': () => pgbouncer('default'), 'pgbouncer-on': () => pgbouncer('on'), 'pgbouncer-off': () => pgbouncer('off'), 'pgbouncer-session': () => pgbouncer('session'),
  'pgdog-default': () => pgdog('default'), 'pgdog-extended': () => pgdog('extended'), 'pgdog-extended_anonymous': () => pgdog('extended_anonymous'), 'pgdog-disabled': () => pgdog('disabled'), 'pgdog-session': () => pgdog('session'),
  'odyssey-default': () => odyssey('default'), 'odyssey-on': () => odyssey('on'), 'odyssey-off': () => odyssey('off'), 'odyssey-session': () => odyssey('session'),
};

export async function bringUp(id: string): Promise<Handle> {
  const mk = SPECS[id];
  if (!mk) throw new Error(`unknown target ${id}; known: ${Object.keys(SPECS).join(', ')}`);
  return raise(mk());
}
void existsSync;
