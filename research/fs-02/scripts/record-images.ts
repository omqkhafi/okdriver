// FS-02: records the image digests and versions behind every endpoint into results/images.json.
// RepoDigests are the digests the tag resolved to when it was pulled; the locally built images list the source
// they were built from (tarball sha256 or git commit) and the version the binary reports.
import fs from "node:fs";
import path from "node:path";

const here = path.resolve(import.meta.dir, "..");
async function sh(cmd: string[]) {
  const p = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
  const [o, e] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  await p.exited;
  return (o + e).trim();
}
const inspect = async (img: string, fmt: string) => sh(["docker", "image", "inspect", "--format", fmt, img]);
const out: Array<Record<string, string>> = [];

for (const tag of ["14", "15", "16", "17", "18", "19", "19beta3"]) {
  const img = `postgres:${tag}`;
  out.push({
    role: tag === "19beta3" ? "oracle client (libpq with default grease)" : "direct endpoint and pooler backend source",
    image: img,
    digest: (await inspect(img, "{{index .RepoDigests 0}}")).replace(/^.*@/, ""),
    created: await inspect(img, "{{.Created}}"),
    reports: await sh(["docker", "run", "--rm", "--entrypoint", "postgres", img, "--version"]),
  });
}
const srcSha = (v: string) => fs.readFileSync(path.join(here, "work/src/pgbouncer", v, "sha.txt"), "utf8").split(/\s+/)[0]!;
for (const v of ["1.22.1", "1.23.1", "1.26.1"]) {
  out.push({
    role: "PgBouncer, built from the release tarball",
    image: `fs02/pgbouncer:${v}`,
    imageId: await inspect(`fs02/pgbouncer:${v}`, "{{.Id}}"),
    source: `pgbouncer-${v}.tar.gz sha256 ${srcSha(v)} (matches the .sha256 published next to it)`,
    reports: (await sh(["docker", "run", "--rm", `fs02/pgbouncer:${v}`, "--version"])).split("\n")[0]!,
  });
}
const gitHead = (d: string) => sh(["git", "-C", path.join(here, "work/src", d), "log", "-1", "--format=%H %cI"]);
out.push({ role: "Odyssey, built from source tag v1.5.2", image: "fs02/odyssey:1.5.2", imageId: await inspect("fs02/odyssey:1.5.2", "{{.Id}}"), source: `git tag v1.5.2 commit ${await gitHead("odyssey-1.5.2")}` });
out.push({
  role: "PgDog",
  image: "ghcr.io/pgdogdev/pgdog:latest",
  digest: (await inspect("ghcr.io/pgdogdev/pgdog:latest", "{{index .RepoDigests 0}}")).replace(/^.*@/, ""),
  created: await inspect("ghcr.io/pgdogdev/pgdog:latest", "{{.Created}}"),
  reports: `${await inspect("ghcr.io/pgdogdev/pgdog:latest", '{{index .Config.Labels "org.opencontainers.image.version"}}')} (revision ${await inspect("ghcr.io/pgdogdev/pgdog:latest", '{{index .Config.Labels "org.opencontainers.image.revision"}}')})`,
});
out.push({
  role: "Supavisor",
  image: "supabase/supavisor:2.10.1",
  digest: (await inspect("supabase/supavisor:2.10.1", "{{index .RepoDigests 0}}")).replace(/^.*@/, ""),
  created: await inspect("supabase/supavisor:2.10.1", "{{.Created}}"),
});
out.push({
  role: "PgCat (optional, partial)",
  image: "ghcr.io/postgresml/pgcat:latest",
  digest: (await inspect("ghcr.io/postgresml/pgcat:latest", "{{index .RepoDigests 0}}")).replace(/^.*@/, ""),
  created: await inspect("ghcr.io/postgresml/pgcat:latest", "{{.Created}}"),
});
out.push({ role: "pgpool-II (optional), built from source tag V4_7_3", image: "fs02/pgpool:4.7.3", imageId: await inspect("fs02/pgpool:4.7.3", "{{.Id}}"), source: `git tag V4_7_3 commit ${await gitHead("pgpool2-4.7.3")}` });
fs.mkdirSync(path.join(here, "results"), { recursive: true });
fs.writeFileSync(path.join(here, "results", "images.json"), JSON.stringify(out, null, 1) + "\n");
for (const r of out) console.log(`${r["image"]} | ${r["digest"] ?? r["imageId"]} | ${r["reports"] ?? r["source"] ?? ""}`);
