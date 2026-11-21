// Runs one statement once with pg or postgres.js, so the client-side proxy can record the bytes the library sends.
// Usage: bun scripts/ref/one-query.ts <pg|postgres> <named|unnamed> <host> <port> <user> <password> <database> <application_name>
import { WORK } from '../lib/paths.ts';
const [lib, mode, host, portS, user, password, database, app] = process.argv.slice(2);
const port = Number(portS);
const TEXT = 'SELECT $1::int AS n';
if (lib === 'pg') {
  const mod = await import(`${WORK}refclients/node_modules/pg/lib/index.js`);
  const pg = mod.default ?? mod;
  const c = new pg.Client({ host, port, user, password, database, application_name: app });
  await c.connect();
  const r = await c.query(mode === 'named' ? { name: 'fs06_bytes', text: TEXT, values: [7] } : { text: TEXT, values: [7] });
  console.log(JSON.stringify(r.rows));
  await c.end();
} else {
  const mod = await import(`${WORK}refclients/node_modules/postgres/src/index.js`);
  const postgres = mod.default ?? mod;
  const sql = postgres({ host, port, user, pass: password, database, max: 1, prepare: mode === 'named', connection: { application_name: app } });
  const r = await sql.unsafe(TEXT, [7], { prepare: mode === 'named' });
  console.log(JSON.stringify(r));
  await sql.end({ timeout: 2 });
}
process.exit(0);
