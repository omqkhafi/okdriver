// Maps a build id to the runtime that runs the client. Bun builds come from `npm i --prefix work/<id> bun@<tag>` (scratch only, see README).
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const RUNTIMES: Record<string, string> = {
  release: join(root, 'work/release/node_modules/.bin/bun'),
  canary: join(root, 'work/canary/node_modules/.bin/bun'),
  node22: process.execPath,
  node24: join(root, 'work/node24/node_modules/.bin/node'),
};
export const runtimeFor = (id: string): string => {
  const p = RUNTIMES[id];
  if (!p || !existsSync(p)) throw new Error(`build ${id} is not installed`);
  return p;
};
export const describeBuild = (id: string): { id: string; path: string; version: string; revision?: string } => {
  const p = runtimeFor(id);
  if (id.startsWith('node')) return { id, path: p, version: execFileSync(p, ['--version']).toString().trim() };
  return { id, path: p, version: execFileSync(p, ['--version']).toString().trim(), revision: execFileSync(p, ['--revision']).toString().trim() };
};
export const certDir = join(root, 'work/certs');
export const readCert = (n: string): Buffer => readFileSync(join(certDir, n));
export const resultsDir = join(root, 'results');
export const workDir = join(root, 'work');
