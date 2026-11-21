import { mkdirSync, writeFileSync } from 'node:fs';
import { connect, type ConnectOptions } from '../wire/connect.ts';
import type { Connection } from '../wire/shared/connection.ts';
import servers from './servers.json';

export interface Server { id: string; family: 'mysql' | 'mariadb'; image: string; port: number }
export const SERVERS = servers as Server[];
export const PW = 'fs07-throwaway';
export const RESULTS = new URL('../results/', import.meta.url).pathname;

export function pick(): Server[] {
  const want = process.env.SERVERS?.split(',');
  const off = Number(process.env.PORT_OFFSET ?? 0); // test runs against spare containers on shifted ports
  return (want ? SERVERS.filter((s) => want.includes(s.id)) : SERVERS).map((s) => ({ ...s, port: s.port + off }));
}
export const root = (s: Server, o: Partial<ConnectOptions> = {}): Promise<Connection> =>
  connect({ host: '127.0.0.1', port: s.port, user: 'root', password: PW, ...o });

export function json(v: unknown): string {
  return JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? `${x}n` : x && x.type === 'Buffer' && Array.isArray(x.data) ? `0x${Buffer.from(x.data).toString('hex')}` : x), 2);
}
export function save(rel: string, v: unknown): void {
  const p = RESULTS + rel;
  mkdirSync(p.slice(0, p.lastIndexOf('/')), { recursive: true });
  writeFileSync(p, typeof v === 'string' ? v : json(v) + '\n');
}
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export async function tryErr<T>(f: () => Promise<T>): Promise<{ ok: true; v: T } | { ok: false; error: string; errno?: number; sqlState?: string }> {
  try { return { ok: true, v: await f() }; } catch (e: any) { return { ok: false, error: String(e.message ?? e), errno: e.errno, sqlState: e.sqlState }; }
}
/** Run a SQL string through the image's own CLI (mysql / mariadb) inside the container, as root. */
export async function cli(s: Server, sql: string): Promise<string> {
  const bin = s.family === 'mysql' ? 'mysql' : 'mariadb';
  const p = Bun.spawn(['docker', 'exec', `fs07-${s.id}`, bin, '-uroot', `-p${PW}`, '--batch', '-N', '-e', sql], { stdout: 'pipe', stderr: 'pipe' });
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  await p.exited;
  return (out + (err.replace(/mysql: \[Warning\][^\n]*\n|mariadb: \[Warning\][^\n]*\n/g, ''))).trim();
}

export const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, '')).split('\n').map((l) => l.replace(/^\s*\/\/.*$/, '').replace(/\s\/\/ .*$/, ''));
