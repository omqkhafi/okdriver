// FS-08: node:sqlite stability level per Node line (official docs), whether a warning is emitted, and the first 22.x
// release where the module loads without a flag (observed on real releases, not read from a changelog).
// Usage: node scripts/node-sqlite-stability.mjs     (needs curl; RT_DIR as in scripts/env.sh)
import { spawnSync, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { RESULTS, WORK, writeJson } from './lib/rt.mjs';

const RT = process.env.RT_DIR || '/tmp/rt/fs08';
const docsDir = path.join(WORK, 'docs'); fs.mkdirSync(docsDir, { recursive: true });
const out = { docs: {}, runs: [] };
const strip = (s) => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
for (const m of [22, 24, 26]) {
  const f = path.join(docsDir, `sqlite-v${m}.html`);
  const url = `https://nodejs.org/docs/latest-v${m}.x/api/sqlite.html`;
  try { execFileSync('curl', ['-fsS', '-m', '60', '-o', f, url]); } catch (e) { out.docs[m] = { url, reachable: false, note: 'docs host unreachable; rely on observed behaviour' }; continue; }
  const html = fs.readFileSync(f, 'utf8');
  const title = (html.match(/<title>([^<]*)/) || [])[1];
  const stab = html.match(/Stability: ([0-9.]+)<\/a>\s*-\s*([A-Za-z ]+)\./);
  const hi = html.indexOf('History'); const hist = hi > 0 ? strip(html.slice(hi, hi + 1500)).slice(0, 400) : null;
  out.docs[m] = { url, reachable: true, title, stabilityIndex: stab ? stab[1] : null, stabilityLabel: stab ? stab[2].trim() : null, historyExcerpt: hist };
}
const probe = `import('node:sqlite').then(m=>{const d=new m.DatabaseSync(':memory:');const v=d.prepare('select sqlite_version() v').get().v;console.log(JSON.stringify({loads:true,exports:Object.keys(m).length,sqlite:v}))},e=>console.log(JSON.stringify({loads:false,code:e.code,message:e.message})))`;
for (const [label, dir] of [['22.12.0', 'n22.12.0'], ['22.13.0', 'n22.13.0'], ['22 (newest)', 'n22'], ['24 (newest)', 'n24'], ['26 (newest)', 'n26']]) {
  const node = path.join(RT, dir, 'bin', 'node');
  if (!fs.existsSync(node)) { out.runs.push({ release: label, skipped: 'runtime not present' }); continue; }
  const ver = spawnSync(node, ['-v'], { encoding: 'utf8' }).stdout.trim();
  for (const flags of [[], ['--experimental-sqlite']]) {
    if (flags.length && label !== '22.12.0') continue;
    const r = spawnSync(node, [...flags, '-e', probe], { encoding: 'utf8', timeout: 30000 });
    let parsed = null; try { parsed = JSON.parse(r.stdout.trim().split('\n').pop()); } catch {}
    out.runs.push({ release: label, version: ver, flags, result: parsed, warningOnStderr: /ExperimentalWarning/.test(r.stderr) ? (r.stderr.match(/\(node:\d+\) (ExperimentalWarning[^\n]*)/) || [])[1] : null });
  }
}
await writeJson(path.join(RESULTS, 'node-sqlite-stability.json'), out);
console.log(JSON.stringify(out.runs.map((r) => [r.release, r.flags?.join(' ') || '', r.result?.loads, r.warningOnStderr ? 'warns' : 'no warning'])));
