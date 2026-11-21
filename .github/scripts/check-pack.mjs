// Pack check, used by ci.yml (job `pack`) and release.yml (job `verify`).
//
// Usage: node .github/scripts/check-pack.mjs <tarball.tgz>
//
// Fails (exit 1) unless:
//   - the tarball holds exactly package.json, LICENSE, NOTICE and README.md, as regular files
//     under `package/`, each once;
//   - the packed package.json has none of the lifecycle scripts preinstall, install,
//     postinstall or prepare.
//
// Plain ESM, Node built-ins only, no dependencies. It reads the tarball itself instead of
// calling `tar`, so the result does not depend on the tar binary of the runner. Anything it
// does not understand (links, directories, pax or GNU extension headers) is a failure.
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

const PREFIX = "package/";
const EXPECTED = ["LICENSE", "NOTICE", "README.md", "package.json"];
const FORBIDDEN_SCRIPTS = ["preinstall", "install", "postinstall", "prepare"];

function fail(message) {
  console.error(`check-pack: FAIL: ${message}`);
  process.exit(1);
}

function cString(block, start, end) {
  const slice = block.subarray(start, end);
  const nul = slice.indexOf(0);
  return slice.subarray(0, nul === -1 ? slice.length : nul).toString("utf8");
}

function readTar(tar) {
  const entries = new Map();
  let offset = 0;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) {
      return entries;
    }
    const prefix = cString(header, 345, 500);
    const name = (prefix === "" ? "" : `${prefix}/`) + cString(header, 0, 100);
    const sizeField = cString(header, 124, 136).trim();
    if (!/^[0-7]+$/.test(sizeField)) {
      fail(`entry "${name}" has an unsupported size field`);
    }
    const size = Number.parseInt(sizeField, 8);
    const type = String.fromCharCode(header[156]);
    if (type !== "0" && type !== "\0") {
      fail(`entry "${name}" is not a regular file (type "${type === "\0" ? "NUL" : type}")`);
    }
    if (entries.has(name)) {
      fail(`entry "${name}" appears more than once`);
    }
    const start = offset + 512;
    if (start + size > tar.length) {
      fail(`entry "${name}" is truncated`);
    }
    entries.set(name, tar.subarray(start, start + size));
    offset = start + Math.ceil(size / 512) * 512;
  }
  return fail("archive has no end-of-archive marker");
}

const [path, ...extra] = process.argv.slice(2);
if (path === undefined || extra.length > 0) {
  fail("usage: check-pack.mjs <tarball.tgz>");
}

let entries;
try {
  entries = readTar(gunzipSync(readFileSync(path)));
} catch (error) {
  fail(`cannot read "${path}": ${error.message}`);
}

const names = [...entries.keys()];
for (const name of names) {
  if (!name.startsWith(PREFIX)) {
    fail(`entry "${name}" is not under ${PREFIX}`);
  }
}
const files = names.map((name) => name.slice(PREFIX.length)).sort();
if (files.join("\n") !== EXPECTED.join("\n")) {
  fail(`file list is [${files.join(", ")}], expected exactly [${EXPECTED.join(", ")}]`);
}

let manifest;
try {
  manifest = JSON.parse(entries.get(`${PREFIX}package.json`).toString("utf8"));
} catch (error) {
  fail(`packed package.json is not valid JSON: ${error.message}`);
}
const scripts = manifest.scripts;
if (scripts !== undefined) {
  if (scripts === null || typeof scripts !== "object" || Array.isArray(scripts)) {
    fail("packed package.json has a scripts field that is not an object");
  }
  const found = FORBIDDEN_SCRIPTS.filter((name) => Object.hasOwn(scripts, name));
  if (found.length > 0) {
    fail(`packed package.json has install-time scripts: ${found.join(", ")}`);
  }
}

console.log(`check-pack: ok: ${files.join(", ")} (${manifest.name}@${manifest.version})`);
