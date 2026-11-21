// Reference client run: 8 connections, the same statement reused over 20 transactions each, with `pg` or `postgres` (postgres.js).
// The libraries live in work/refclients (installed with bun, never imported by the harness). Prints one JSON line.
// Usage: bun scripts/ref/refclient.ts <pg|pg-unnamed|postgres|postgres-unnamed> <host> <port> <user> <password> <database> [clients] [txns]
import { WORK } from '../lib/paths.ts';

let [kind, host, portS, user, password, database, clientsS, txnsS] = process.argv.slice(2);
// Hosted targets pass the connection parameters through the environment, never on the command line.
if (host === 'env') { host = process.env.FS06_REF_HOST!; portS = process.env.FS06_REF_PORT!; user = process.env.FS06_REF_USER!; password = process.env.FS06_REF_PASSWORD!; database = process.env.FS06_REF_DB!; }
const port = Number(portS), clients = Number(clientsS ?? 8), txns = Number(txnsS ?? 20);
const useTls = process.env.FS06_REF_TLS === '1';
const tlsReject = process.env.FS06_TLS_INSECURE !== '1';
const lib = (p: string) => import(`${WORK}refclients/node_modules/${p}`);

interface Res { ok: number; errors: Record<string, number>; pids: number[] }
const bump = (m: Record<string, number>, k: string) => { m[k] = (m[k] ?? 0) + 1; };
const errKey = (e: any) => `${e?.code ?? e?.name ?? 'error'} ${String(e?.message ?? e).slice(0, 140)}`;

async function runPg(named: boolean): Promise<Res[]> {
  const pg = (await lib('pg/lib/index.js')).default ?? (await lib('pg/lib/index.js'));
  return Promise.all(Array.from({ length: clients }, async (_, i) => {
    const r: Res = { ok: 0, errors: {}, pids: [] }; const pids = new Set<number>();
    const c = new pg.Client({ host, port, user, password, database, application_name: `fs06-ref-pg-${i}`, ...(useTls ? { ssl: { rejectUnauthorized: tlsReject } } : {}) });
    try { await c.connect(); } catch (e) { bump(r.errors, 'connect ' + errKey(e)); return r; }
    c.on('error', () => { /* reported through the query that was running */ });
    for (let k = 0; k < txns; k++) {
      try {
        await c.query('BEGIN');
        const q = named ? { name: 'fs06_ref_stmt', text: 'SELECT $1::int AS n, pg_backend_pid() AS pid', values: [k] } : { text: 'SELECT $1::int AS n, pg_backend_pid() AS pid', values: [k] };
        const res = await c.query(q);
        pids.add(res.rows[0].pid);
        await c.query('COMMIT');
        r.ok++;
      } catch (e) { bump(r.errors, errKey(e)); try { await c.query('ROLLBACK'); } catch { /* ignore */ } }
    }
    r.pids = [...pids]; await c.end().catch(() => {});
    return r;
  }));
}

async function runPostgres(prepare: boolean): Promise<Res[]> {
  const mod = await lib('postgres/src/index.js');
  const postgres = mod.default ?? mod;
  return Promise.all(Array.from({ length: clients }, async (_, i) => {
    const r: Res = { ok: 0, errors: {}, pids: [] }; const pids = new Set<number>();
    const sql = postgres({ host, port, user, pass: password, database, max: 1, prepare, ...(useTls ? { ssl: tlsReject ? 'require' : { rejectUnauthorized: false } } : {}), connection: { application_name: `fs06-ref-pgjs-${i}` }, onnotice: () => {} });
    for (let k = 0; k < txns; k++) {
      try {
        const rows = await sql.begin(async (tx: any) => tx`SELECT ${k}::int AS n, pg_backend_pid() AS pid`);
        pids.add(rows[0].pid); r.ok++;
      } catch (e) { bump(r.errors, errKey(e)); }
    }
    r.pids = [...pids]; await sql.end({ timeout: 2 }).catch(() => {});
    return r;
  }));
}

const t0 = performance.now();
const timer = setTimeout(() => { console.log(JSON.stringify({ kind, timeout: true })); process.exit(0); }, 60000);
const res = kind === 'pg' ? await runPg(true) : kind === 'pg-unnamed' ? await runPg(false) : kind === 'postgres' ? await runPostgres(true) : await runPostgres(false);
clearTimeout(timer);
const errors: Record<string, number> = {};
for (const r of res) for (const [k, v] of Object.entries(r.errors)) errors[k] = (errors[k] ?? 0) + v;
console.log(JSON.stringify({ kind, clients, txnsPerClient: txns, ok: res.reduce((a, r) => a + r.ok, 0), total: clients * txns, errors, distinctPids: [...new Set(res.flatMap((r) => r.pids))].length, ms: Math.round(performance.now() - t0) }));
process.exit(0);
