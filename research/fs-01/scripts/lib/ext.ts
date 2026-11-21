// Run external programs: the independent readers (psql, mysql, mariadb, python sqlite3, curl) and docker.
export interface Ran {
  code: number;
  out: string;
  err: string;
}
export async function run(cmd: string[], input?: string): Promise<Ran> {
  const p = Bun.spawn(cmd, { stdin: input === undefined ? "ignore" : new TextEncoder().encode(input), stdout: "pipe", stderr: "pipe" });
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  return { code: await p.exited, out, err };
}
export async function must(cmd: string[], input?: string): Promise<string> {
  const r = await run(cmd, input);
  if (r.code !== 0) throw new Error(`${cmd.join(" ")} exited ${r.code}: ${r.err || r.out}`);
  return r.out;
}
export const FS01 = new URL("..", import.meta.url).pathname.replace(/\/$/, "").replace(/\/scripts$/, "");
