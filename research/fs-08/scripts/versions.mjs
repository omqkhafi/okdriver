// Record every version used into results/versions.json.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { RESULTS, ROOT, writeJson } from './lib/rt.mjs';
const RT = process.env.RT_DIR || '/tmp/rt/fs08';
const run = (cmd, args) => { const r = spawnSync(cmd, args, { encoding: 'utf8' }); return (r.stdout || r.stderr || '').trim(); };
const pj = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules', p, 'package.json'), 'utf8')).version;
const out = {
  node: Object.fromEntries(['n22', 'n24', 'n26', 'n22.12.0', 'n22.13.0'].map((d) => [d, run(path.join(RT, d, 'bin', 'node'), ['-v'])])),
  bun: { version: run(path.join(RT, 'bun', 'bun'), ['-v']), revision: run(path.join(RT, 'bun', 'bun'), ['-e', 'console.log(Bun.revision)']), pinnedByRepo: fs.readFileSync(path.join(ROOT, '..', '..', '.bun-version'), 'utf8').trim() },
  bunInstalledInThisContainerNotUsed: { version: run('/root/.bun/bin/bun', ['-v']), bundledSqlite: run('/root/.bun/bin/bun', ['-e', 'import {Database} from "bun:sqlite";console.log(new Database(":memory:").query("select sqlite_version() v").get().v)']) },
  bundledSqlite: {},
  betterSqlite3: pj('better-sqlite3'), nodeAddonApi: pj('node-addon-api'),
  researchLockfileSha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, 'bun.lock'))).digest('hex'),
  python: run('python3', ['-I', '-c', 'import sys,sqlite3;print(sys.version.split()[0], "sqlite", sqlite3.sqlite_version)']),
  workerd: run(path.join(process.env.WORKERD_DIR || '/tmp/rt/workerd-pkg', 'node_modules', '.bin', 'workerd'), ['--version']),
  sqlite3Cli: spawnSync('which', ['sqlite3']).status === 0 ? 'present' : 'not installed',
  host: { kernel: os.release(), cpus: os.cpus().length, cpuModel: os.cpus()[0].model, memGiB: Math.round(os.totalmem() / 2 ** 30) },
  nodeSqliteRuntimeNotes: 'node:sqlite bundles its own SQLite per Node release; see results/node-sqlite-stability.json for 22.12.0 and 22.13.0',
};
for (const f of fs.readdirSync(path.join(RESULTS, 'capabilities'))) { const j = JSON.parse(fs.readFileSync(path.join(RESULTS, 'capabilities', f), 'utf8')); if (j.loaded) out.bundledSqlite[f.replace('.json', '')] = j.meta.sqlite_version; }
await writeJson(path.join(RESULTS, 'versions.json'), out);
console.log(JSON.stringify(out, null, 1).slice(0, 1500));
