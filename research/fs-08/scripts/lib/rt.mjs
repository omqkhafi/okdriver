// Runtime and binding identification, shared by every FS-08 script. Plain ESM, runs on Node and Bun.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..', '..'); // research/fs-08
export const WORK = path.join(ROOT, 'work');
export const RESULTS = path.join(ROOT, 'results');
export const require = createRequire(import.meta.url);

export const BINDINGS = ['bun:sqlite', 'node:sqlite', 'better-sqlite3'];

export function runtime() {
  if (globalThis.Bun) return { id: 'bun', name: 'Bun', version: globalThis.Bun.version };
  const major = process.versions.node.split('.')[0];
  return { id: 'node' + major, name: 'Node.js', version: process.versions.node };
}

/** Load a binding module. Never throws: returns {ok:false, error} when it does not load here. */
export async function loadBinding(binding) {
  try {
    if (binding === 'bun:sqlite') {
      const m = await import('bun:sqlite');
      return { ok: true, mod: m, Database: m.Database };
    }
    if (binding === 'node:sqlite') {
      const m = await import('node:sqlite');
      return { ok: true, mod: m, Database: m.DatabaseSync };
    }
    if (binding === 'better-sqlite3') {
      const D = require('better-sqlite3');
      return { ok: true, mod: D, Database: D };
    }
    return { ok: false, error: 'unknown binding ' + binding };
  } catch (e) {
    return { ok: false, error: describeError(e) };
  }
}

export function describeError(e) {
  if (e === null || typeof e !== 'object') return { message: String(e) };
  const o = { name: e.name, message: String(e.message).slice(0, 300) };
  for (const k of ['code', 'errno', 'errcode', 'errstr', 'byteOffset']) {
    if (e[k] !== undefined) o[k] = typeof e[k] === 'bigint' ? String(e[k]) : e[k];
  }
  return o;
}

export function writeJson(file, obj, { compact = false } = {}) {
  return import('node:fs').then((fs) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, (compact ? JSON.stringify(obj) : JSON.stringify(obj, null, 2)) + '\n');
  });
}
