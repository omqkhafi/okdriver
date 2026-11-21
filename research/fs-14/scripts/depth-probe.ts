// Direct probe of how many statements a pool keeps in flight on one connection, with more concurrent callers than
// connections. Sends CALLERS concurrent single-row lookups through a pool of POOL_MAX connections to Postgres (reached
// through scripts/pgtrace.ts, which does the counting). Not a benchmark.
//
//   node scripts/depth-probe.ts <drizzle | drizzle-off | drizzle-depth4 | pg | bunsql> <url> [callers] [pool-max]
//   (bun scripts/depth-probe.ts bunsql ... for Bun.SQL)
import { createRequire } from 'node:module';
const [variant, url, callers = '400', poolMax = '2'] = process.argv.slice(2);
const harness = process.env.HARNESS!;                       // the clone: the packages resolve from its node_modules
const require = createRequire(`${harness}/package.json`);
const N = Number(callers), max = Number(poolMax);
const sql = 'SELECT id, company_name FROM customers WHERE id = $1';
const run = async (one: (i: number) => Promise<unknown>) => { await Promise.all(Array.from({ length: N }, (_, i) => one(i + 1))); };

if (variant.startsWith('drizzle')) {
  const { Pool } = require('drizzle-orm/postgres');
  const pipeline = variant === 'drizzle-off' ? false : variant === 'drizzle-depth4' ? { depth: 4 } : undefined;
  const pool = new Pool({ url, max, pipeline });
  await pool.query(sql, [1], { name: 'probe' });            // first use of the name: Parse + Describe once, results text
  await run((id) => pool.query(sql, [id], { name: 'probe' }));
  await pool.end();
} else if (variant === 'pg') {
  const pg = require('pg');
  const pool = new pg.Pool({ connectionString: url, max });
  await run((id) => pool.query({ name: 'probe', text: sql, values: [id] }));
  await pool.end();
} else if (variant === 'bunsql') {
  // @ts-ignore Bun only
  const db = new Bun.SQL(url, { prepare: true, max });
  await run((id) => db.unsafe(sql, [id]));
  await db.close();
} else throw new Error(`unknown variant ${variant}`);
console.log(`${variant}: ${N} callers, pool max ${max}, done`);
