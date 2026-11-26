// Records the exact runtime strings of every build used. Usage: node scripts/builds-info.ts
import { execFileSync } from 'node:child_process';
import { writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { RUNTIMES, resultsDir } from './lib/builds.ts';

const sh = (c: string, a: string[]): string => { try { return execFileSync(c, a, { encoding: 'utf8' }).trim(); } catch (e) { return `unavailable: ${String(e).slice(0, 80)}`; } };
const builds = Object.entries(RUNTIMES).filter(([, p]) => existsSync(p)).map(([id, p]) => ({
  id, runtime: id.startsWith('node') ? 'node' : 'bun', version: sh(p, ['--version']), ...(id.startsWith('node') ? {} : { revision: sh(p, ['--revision']) }),
}));
const out = {
  recordedAt: new Date().toISOString(),
  builds,
  npmDistTagsAtInstall: sh('npm', ['view', 'bun', 'dist-tags', '--json']),
  repoBunVersionFile: sh('cat', [join(import.meta.dirname, '..', '..', '..', '.bun-version')]),
  docker: sh('docker', ['--version']),
  postgresImage: sh('docker', ['image', 'inspect', 'postgres:19.0', '--format', '{{index .RepoDigests 0}}']),
  psql: sh('psql', ['--version']),
  os: sh('uname', ['-sr']),
  cores: sh('nproc', []),
  cpu: sh('sh', ['-c', "grep -m1 'model name' /proc/cpuinfo | cut -d: -f2"]),
};
writeFileSync(join(resultsDir, 'builds.json'), JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify(out, null, 1));
