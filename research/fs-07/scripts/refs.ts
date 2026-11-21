// Reference clients, installed with bun into the gitignored work/ directory. Never imported by the wire library.
const WORK = new URL('../work/node_modules/', import.meta.url).pathname;
export async function mysql2(): Promise<any> { return (await import(WORK + 'mysql2/promise.js')).default ?? (await import(WORK + 'mysql2/promise.js')); }
export async function mariadbConnector(): Promise<any> { const m = await import(WORK + 'mariadb/promise.js'); return m.default ?? m; }
export const REF_VERSIONS = () => ({
  mysql2: JSON.parse(require('node:fs').readFileSync(WORK + 'mysql2/package.json', 'utf8')).version,
  mariadb: JSON.parse(require('node:fs').readFileSync(WORK + 'mariadb/package.json', 'utf8')).version,
});
