// Fills scripts/README.template.md from results/tables/*.md and results/images.json and writes README.md.
// A line `{{table:NAME}}` is replaced by results/tables/NAME.md (heading line dropped); `{{images}}` by the image table.
import fs from "node:fs";
import path from "node:path";

const here = path.resolve(import.meta.dir, "..");
const tpl = fs.readFileSync(path.join(here, "scripts", "README.template.md"), "utf8");
const table = (n: string) => fs.readFileSync(path.join(here, "results", "tables", `${n}.md`), "utf8").split("\n").slice(1).join("\n").trim();
const images = JSON.parse(fs.readFileSync(path.join(here, "results", "images.json"), "utf8")) as Array<Record<string, string>>;
const imgTable = [
  "| image | role | digest or image id | version reported / source |",
  "|---|---|---|---|",
  ...images.map((i) => `| \`${i["image"]}\` | ${i["role"]} | \`${i["digest"] ?? i["imageId"]}\` | ${(i["reports"] ?? i["source"] ?? "").replace(/\|/g, "\\|")} |`),
].join("\n");
const out = tpl.replace(/\{\{table:([A-Za-z0-9]+)\}\}/g, (_m, n: string) => table(n)).replace("{{images}}", imgTable);
fs.writeFileSync(path.join(here, "README.md"), out);
console.log(`README.md written (${out.length} bytes)`);
