// FS-02 oracle 1: psql (libpq) from the postgres:19 image against every endpoint with
// max_protocol_version 3.0, 3.2 and latest. Writes results/oracle-psql.csv.
//
//   FS02_PASSWORD=... bun scripts/oracle-psql.ts [--only id,id] [--tier A|B]
//       [--image postgres:19beta3 --container fs02-psql-beta --mpvs default --file oracle-psql-beta3.csv]
//
// With --mpvs default no max_protocol_version is passed, so a libpq beta that greases by default does so.
//
// One long-lived client container (fs02-psql, host network) is used; scripts/lab.sh down removes it.
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const arg = (n: string) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const here = path.resolve(import.meta.dir, "..");
const only = arg("only")?.split(",");
const tier = arg("tier") ?? "A";
const image = arg("image") ?? "postgres:19";
const container = arg("container") ?? "fs02-psql";
const mpvs = (arg("mpvs") ?? "3.0,3.2,latest").split(",");
const fileName = arg("file") ?? "oracle-psql.csv";
const password = process.env["FS02_PASSWORD"];
if (!password) throw new Error("FS02_PASSWORD is empty");
const endpoints = JSON.parse(fs.readFileSync(path.join(here, "endpoints.json"), "utf8")) as Array<{ id: string; host: string; port: number; user: string; database: string; tls: boolean }>;

async function sh(cmd: string[], env: Record<string, string> = {}) {
  const p = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe", env: { ...process.env, ...env } });
  const [o, e] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  return { code: await p.exited, out: o, err: e };
}

const have = await sh(["docker", "ps", "-q", "--filter", `name=^${container}$`]);
if (!have.out.trim()) {
  const r = await sh(["docker", "run", "-d", "--name", container, "--network", "host", "-e", "PGPASSWORD", "--entrypoint", "sleep", image, "infinity"], { PGPASSWORD: password });
  if (r.code !== 0) throw new Error(r.err);
}
const ver = image + " / " + (await sh(["docker", "exec", container, "psql", "--version"])).out.trim();

const file = path.join(here, "results", fileName);
const header = "endpoint,tier,max_protocol_version,outcome,protocol_version,select1,error_text,psql";
let rows: string[] = fs.existsSync(file) ? fs.readFileSync(file, "utf8").trim().split("\n").slice(1) : [];
const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

for (const ep of endpoints) {
  if (only && !only.includes(ep.id)) continue;
  if (tier === "B" && !ep.tls) continue;
  rows = rows.filter((r) => !r.startsWith(`${ep.id},${tier},`));
  for (const mpv of mpvs) {
    const conn = `host=${ep.host} port=${ep.port} user=${ep.user} dbname=${ep.database} sslmode=${tier === "B" ? "require" : "disable"} connect_timeout=10${mpv === "default" ? "" : ` max_protocol_version=${mpv}`}`;
    const r = await sh(["docker", "exec", "-e", "PGPASSWORD", container, "psql", conn, "-X", "-A", "-t", "-c", "select 1", "-c", "\\conninfo"], { PGPASSWORD: password });
    const text = (r.out + "\n" + r.err).split(password).join("<redacted>");
    const connected = r.code === 0;
    const pv = /Protocol Version\|?\s*\|?\s*([0-9.]+)/.exec(r.out)?.[1] ?? "";
    const sel = connected && r.out.split("\n")[0]?.trim() === "1" ? "ok" : connected ? "unexpected" : "-";
    const errText = connected ? "" : text.replace(/\s+/g, " ").trim();
    rows.push([ep.id, tier, mpv, connected ? "connected" : "failed", pv, sel, errText, ver].map(esc).join(","));
    console.log(`${ep.id} ${tier} psql max_protocol_version=${mpv}: ${connected ? `connected ${pv}` : `failed: ${errText.slice(0, 140)}`}`);
  }
}
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, header + "\n" + rows.join("\n") + "\n");
