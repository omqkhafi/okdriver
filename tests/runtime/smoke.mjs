// Shared runtime smoke body. Plain ESM, no imports, no dependencies.
// Every runtime entry imports `runSmoke` and calls it with the runtime its job asked for.
// A failed check throws, so the entry exits non-zero.

/** Name the runtime this code is running on: "bun", "node", "workerd" or "unknown". */
export function detectRuntime() {
  // workerd also exposes a Node-like `process`, so test for it first.
  if (typeof navigator !== "undefined" && navigator.userAgent === "Cloudflare-Workers") {
    return "workerd";
  }
  if (typeof process !== "undefined" && process.versions) {
    // Bun reports a Node version too, so test for Bun before Node.
    if (process.versions.bun) return "bun";
    if (process.release && process.release.name === "node") return "node";
  }
  return "unknown";
}

/** The exact version string the runtime reports about itself, or null if it reports none. */
export function runtimeVersion(runtime) {
  if (runtime === "node") return process.versions.node;
  if (runtime === "bun") return `${process.versions.bun} (${Bun.revision})`;
  // workerd exposes no version at run time; the job prints `workerd --version`.
  return null;
}

function check(condition, message) {
  if (!condition) throw new Error(`smoke check failed: ${message}`);
}

async function hex(buffer) {
  return Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Run the checks.
 * @param {string | undefined} expected What the job asked for: "node:<major>", "bun" or "workerd".
 * @returns {Promise<{ runtime: string, version: string | null }>}
 */
export async function runSmoke(expected) {
  check(typeof expected === "string" && expected !== "", "EXPECT_RUNTIME is not set");
  const runtime = detectRuntime();
  const [expectedName, expectedMajor] = expected.split(":");
  check(
    runtime === expectedName,
    `expected runtime ${expected}, but this is ${runtime}`,
  );
  if (expectedName === "node") {
    check(/^\d+$/.test(expectedMajor ?? ""), `expected "node:<major>", got ${expected}`);
    const major = process.versions.node.split(".")[0];
    check(major === expectedMajor, `expected Node major ${expectedMajor}, got ${process.versions.node}`);
  } else {
    check(expectedMajor === undefined, `unexpected qualifier in ${expected}`);
  }

  // TextEncoder / TextDecoder round trip, including a multi-byte code point.
  const text = "okdriver é中🚀";
  const bytes = new TextEncoder().encode(text);
  check(bytes.length === 9 + 2 + 3 + 4, `TextEncoder produced ${bytes.length} bytes`);
  check(new TextDecoder().decode(bytes) === text, "TextDecoder round trip");

  // SHA-256 of "abc" from FIPS 180-2 appendix B.1.
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("abc"));
  check(
    (await hex(digest)) === "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    "crypto.subtle SHA-256 of abc",
  );

  // structuredClone keeps structure and copies instead of aliasing.
  const original = { n: 1n, d: new Date(0), m: new Map([["k", [1, 2, 3]]]), u: new Uint8Array([1, 2]) };
  const copy = structuredClone(original);
  check(copy !== original && copy.m !== original.m, "structuredClone must copy");
  check(copy.n === 1n && copy.d.getTime() === 0, "structuredClone bigint and Date");
  check(copy.m.get("k")?.join() === "1,2,3" && copy.u.join() === "1,2", "structuredClone Map and Uint8Array");

  // URL parsing.
  const url = new URL("postgres://user@host:5432/db?sslmode=require#frag");
  check(
    url.protocol === "postgres:" && url.hostname === "host" && url.port === "5432" &&
      url.pathname === "/db" && url.searchParams.get("sslmode") === "require",
    "URL parsing",
  );

  return { runtime, version: runtimeVersion(runtime) };
}
