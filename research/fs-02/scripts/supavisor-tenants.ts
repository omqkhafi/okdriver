// Creates the two Supavisor tenants (be17 -> fs02-be17, be19 -> fs02-be19) through its management API.
// Reads SUPA_API_JWT_SECRET and FS02_PASSWORD from the environment; prints only status codes.
import crypto from "node:crypto";

const secret = process.env["SUPA_API_JWT_SECRET"];
const password = process.env["FS02_PASSWORD"];
if (!secret || !password) throw new Error("SUPA_API_JWT_SECRET and FS02_PASSWORD must be set");
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
const now = Math.floor(Date.now() / 1000);
const head = b64({ alg: "HS256", typ: "JWT" });
const body = b64({ iss: "supabase", role: "anon", iat: now, exp: now + 3600 });
const sig = crypto.createHmac("sha256", secret).update(`${head}.${body}`).digest("base64url");
const jwt = `${head}.${body}.${sig}`;

for (const be of ["17", "19"]) {
  const res = await fetch(`http://127.0.0.1:4000/api/tenants/be${be}`, {
    method: "PUT",
    headers: { "content-type": "application/json", authorization: `Bearer ${jwt}`, accept: "application/json" },
    body: JSON.stringify({
      tenant: {
        db_host: `fs02-be${be}`,
        db_port: 5432,
        db_database: "fs02",
        ip_version: "auto",
        enforce_ssl: false,
        require_user: false,
        auth_query: "SELECT rolname, rolpassword FROM pg_authid WHERE rolname=$1;",
        users: [{ db_user: "fs02", db_password: password, pool_size: 10, mode_type: "transaction", is_manager: true }],
      },
    }),
  });
  console.log(`tenant be${be}: HTTP ${res.status}`);
  if (res.status >= 300) console.log((await res.text()).split(password).join("<redacted>").slice(0, 300));
}
