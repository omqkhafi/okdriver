// Runtime evidence for row decoding. Runs one prepared relational query twice on the harness's own createDb()
// (DRIVER=drizzle, jit: true) with the driver's codegen debug switch on, and reports (1) which mapper generators the
// ORM dialect holds and (2) the row mappers the driver compiled with new Function. Not a benchmark.
//   DRIVER=drizzle DATABASE_URL=... node scripts/codegen-probe.ts            (HARNESS must be set)
process.env.DRIZZLE_POSTGRES_CODEGEN_DEBUG = '1';
const harness = process.env.HARNESS!;
const { createDb } = await import(`${harness}/src/drizzle-db.ts`);
const { sql } = await import(new URL(`${harness}/node_modules/drizzle-orm/index.js`, 'file://').href);
const db = createDb();
const dialect = (db as any)._.session.dialect;
console.log('ORM mapper generators:', dialect.mapperGenerators.rows.name, '/', dialect.mapperGenerators.relationalRows.name);
const q = db.query.customers.findFirst({ where: { id: sql.placeholder('id') } }).prepare('probe_customer');
await q.execute({ id: 5 });
console.log('--- second execution of the same named statement');
await q.execute({ id: 6 });
await (db as any).$client.end();
