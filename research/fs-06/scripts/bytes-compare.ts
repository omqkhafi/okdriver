// Compares the bytes of this harness with `pg` and `postgres` (postgres.js) for one named and one unnamed statement,
// captured by the client-side proxy against Postgres directly. Writes results/bytes-compare.json and .md.
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { PgConn } from './lib/client.ts';
import { RecordingProxy, type MsgRec } from './lib/proxy.ts';
import { parse, bind, describe, execute, sync, u8 } from './lib/wire.ts';
import { RESULTS } from './lib/paths.ts';

const PORT = 55430;
const proxy = new RecordingProxy({ name: 'bytes', port: PORT, targetHost: '127.0.0.1', targetPort: 55400, delayMs: 0 });
await proxy.start();
const SQL = 'SELECT $1::int AS n';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const cases: { who: string; mode: 'named' | 'unnamed'; app: string }[] = [];
for (const who of ['harness', 'pg', 'postgres.js']) for (const mode of ['named', 'unnamed'] as const) cases.push({ who, mode, app: `fs06-bytes-${who}-${mode}` });

for (const c of cases) {
  if (c.who === 'harness') {
    const conn = await PgConn.connect({ host: '127.0.0.1', port: PORT, user: 'fs06', password: 'fs06pw', database: 'fs06', appName: c.app });
    const nm = c.mode === 'named' ? 'fs06_bytes' : '';
    conn.write(u8(parse(nm, SQL), bind('', nm, ['7']), describe('P', ''), execute('', 0), sync()));
    await conn.collect(1, 5000); conn.close();
  } else {
    const child = spawn('bun', [new URL('./ref/one-query.ts', import.meta.url).pathname, c.who === 'pg' ? 'pg' : 'postgres', c.mode, '127.0.0.1', String(PORT), 'fs06', 'fs06pw', 'fs06', c.app]);
    let err = ''; child.stderr.on('data', (d) => (err += d));
    const code: number = await new Promise((res) => child.on('close', res));
    if (code !== 0) { console.error(c.who, c.mode, err); process.exit(1); }
  }
  await sleep(150);
}
await sleep(300);

interface Flush { frames: { type: string; len: number; name?: string; sql?: string; stmt?: string; kind?: string; hex: string }[] }
const out: Record<string, Flush[]> = {};
for (const c of cases) {
  const conn = [...proxy.conns.values()].find((x) => x.app === c.app);
  const ms: MsgRec[] = proxy.msgs.filter((m) => m.conn === conn?.id && m.dir === 'c2s' && m.type !== 'Startup' && m.type !== 'p' && m.hex);
  const groups = new Map<number, MsgRec[]>();
  for (const m of ms) { if (!groups.has(m.t)) groups.set(m.t, []); groups.get(m.t)!.push(m); }
  out[`${c.who} ${c.mode}`] = [...groups.values()].map((g) => ({ frames: g.map((m) => ({ type: m.type, len: m.len, ...(m.d && 'name' in m.d ? { name: m.d.name as string } : {}), ...(m.d && 'sql' in m.d ? { sql: m.d.sql as string } : {}), ...(m.d && 'stmt' in m.d ? { stmt: m.d.stmt as string } : {}), ...(m.d && 'kind' in m.d ? { kind: m.d.kind as string, name: m.d.name as string } : {}), hex: m.hex! })) }));
}
await proxy.stop();

const md: string[] = ['# Bytes: harness vs `pg` vs `postgres` (postgres.js)', '', `Statement \`${SQL}\`, parameter 7, captured by the client-side proxy against Postgres directly (no pooler, no delay). Each row is one TCP flush from the client; letters are frontend message types (P Parse, B Bind, D Describe, E Execute, S Sync, Q Query, X Terminate, C Close).`, ''];
for (const [k, flushes] of Object.entries(out)) {
  md.push(`## ${k}`, '', '| flush | messages | detail |', '| --- | --- | --- |');
  flushes.forEach((f, i) => md.push(`| ${i + 1} | ${f.frames.map((x) => x.type + (x.kind ? `(${x.kind})` : '')).join(' ')} | ${f.frames.filter((x) => x.type === 'P').map((x) => `Parse name=\`${x.name}\` sql=\`${(x.sql ?? '').slice(0, 60)}\``).join('; ')} |`));
  const mode = k.split(' ')[1]!; const ref = out[`harness ${mode}`]?.[0]?.frames ?? []; const mine = flushes[0]?.frames ?? [];
  if (!k.startsWith('harness')) {
    const same = (t: string) => { const a = ref.filter((x) => x.type === t).map((x) => x.hex).join(); const b = mine.filter((x) => x.type === t).map((x) => x.hex).join(); return a === b; };
    md.push('', `Byte-identical to the harness: ${['P', 'B', 'D', 'E', 'S'].map((t) => `${t} ${same(t) ? 'yes' : 'no'}`).join(', ')}; same frame order: ${ref.map((x) => x.type).join('') === mine.map((x) => x.type).join('')}.`);
  }
  md.push('');
}
writeFileSync(RESULTS + 'bytes-compare.json', JSON.stringify(out, null, 1) + '\n');
writeFileSync(RESULTS + 'bytes-compare.md', md.join('\n') + '\n');
console.log(md.join('\n'));
