// Brings one pooler configuration up, runs the study and the reference clients against it, tears it down.
// Usage: bun scripts/run-target.ts <target-id>
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { bringUp } from './poolers.ts';
import { study } from './study.ts';
import { RESULTS } from './lib/paths.ts';

const id = process.argv[2];
if (!id) { console.error('usage: bun scripts/run-target.ts <target-id>'); process.exit(2); }
let h;
try {
  h = await bringUp(id);
} catch (e: any) {
  mkdirSync(RESULTS + 'targets/', { recursive: true });
  writeFileSync(`${RESULTS}targets/${id}.json`, JSON.stringify({ target: { id }, notVerified: true, blocker: String(e.message).slice(0, 4000) }, null, 1) + '\n');
  console.error(`NOT VERIFIED ${id}: ${e.message}`); process.exit(3);
}
try {
  const s = await study(h.target, h.sproxy);
  // Reference clients straight at the pooler (no delay): the same statement over 20 transactions by 8 clients.
  const refs: any[] = [];
  for (const kind of ['pg', 'pg-unnamed', 'postgres', 'postgres-unnamed']) {
    const child = spawn('bun', [new URL('./ref/refclient.ts', import.meta.url).pathname, kind, h.target.host, String(h.target.port), h.target.user, h.target.password, h.target.database, String(h.target.clients), '20']);
    let out = ''; let err = '';
    child.stdout.on('data', (d) => (out += d)); child.stderr.on('data', (d) => (err += d));
    const code: number = await new Promise((res) => { child.on('close', res); setTimeout(() => { child.kill('SIGKILL'); }, 75000); });
    const line = out.trim().split('\n').filter((l) => l.startsWith('{')).at(-1);
    refs.push(line ? JSON.parse(line) : { kind, failed: `exit ${code}: ${err.slice(0, 200)}` });
  }
  const file = `${RESULTS}targets/${id}.json`;
  const sum = JSON.parse(readFileSync(file, 'utf8'));
  sum.refs = refs;
  writeFileSync(file, JSON.stringify(sum, null, 1) + '\n');
  const rows = Object.entries(s.seqs).map(([k, v]: any) => `${k}:${v.ok}/${v.runs}`).join(' ');
  console.log(`${id}: ${rows}\n  refs: ${refs.map((r) => `${r.kind} ${r.ok ?? '?'}/${r.total ?? '?'}`).join(' ')}`);
} finally { await h.down(); }
process.exit(0);
