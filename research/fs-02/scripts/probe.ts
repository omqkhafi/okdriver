// FS-02 probe: PostgreSQL startup / protocol-negotiation prober.
//
// Plain TypeScript on node:net, node:tls and node:crypto only. Independent of src/ and of any
// other OKDriver code: it builds StartupMessage bytes itself, parses backend messages itself and
// implements the SCRAM-SHA-256 client itself.
//
//   FS02_PASSWORD=... bun research/fs-02/scripts/probe.ts --host H --port P --user U --database D \
//       [--id label] [--tls] [--requests R0,R1,...] [--timeout 10000] [--raw-dir dir] [--csv file] [--json]
//
// The password is read from an environment variable (default FS02_PASSWORD, or --password-env NAME),
// is never printed, never written, and is scrubbed from every string and hex dump that is stored.
//
// Requests (each is its own connection):
//   R0 3.0 control | R1 3.2 | R2 3.9999 (libpq grease value) | R3 libpq grease shape
//   (3.9999 + _pq_.test_protocol_negotiation) | R4 3.0 + unknown _pq_ option
//   R5 3.2 + the same unknown option | R6 major 4.0 (informational, must be a clean error)

import net from "node:net";
import tls from "node:tls";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------------------------
// Constants and request catalogue
// ---------------------------------------------------------------------------------------------

export const PROBE_VERSION = "1";
const V = (major: number, minor: number) => major * 65536 + minor;
export const V30 = V(3, 0);
export const V32 = V(3, 2);
const SSL_REQUEST_CODE = 80877103;
const CANCEL_REQUEST_CODE = 80877102;
export const UNKNOWN_OPTION = "_pq_.fs02_probe_unknown";
export const GREASE_OPTION = "_pq_.test_protocol_negotiation";

export interface RequestSpec {
  id: string;
  label: string;
  version: number;
  extra: Array<[string, string]>;
  /** Names the server must list in NegotiateProtocolVersion if it negotiates. */
  unknownOptions: string[];
  /** What a correct endpoint may answer: classes that count as a pass for the endpoint verdict. */
  informational: boolean;
}

export const REQUESTS: RequestSpec[] = [
  { id: "R0", label: "3.0 control", version: V30, extra: [], unknownOptions: [], informational: false },
  { id: "R1", label: "3.2", version: V32, extra: [], unknownOptions: [], informational: false },
  { id: "R2", label: "3.9999 grease version", version: V(3, 9999), extra: [], unknownOptions: [], informational: false },
  {
    id: "R3",
    label: "libpq grease shape (3.9999 + _pq_.test_protocol_negotiation)",
    version: V(3, 9999),
    extra: [[GREASE_OPTION, ""]],
    unknownOptions: [GREASE_OPTION],
    informational: false,
  },
  { id: "R4", label: "3.0 + unknown _pq_ option", version: V30, extra: [[UNKNOWN_OPTION, "1"]], unknownOptions: [UNKNOWN_OPTION], informational: false },
  { id: "R5", label: "3.2 + unknown _pq_ option", version: V32, extra: [[UNKNOWN_OPTION, "1"]], unknownOptions: [UNKNOWN_OPTION], informational: false },
  { id: "R6", label: "major 4.0 (informational)", version: V(4, 0), extra: [], unknownOptions: [], informational: true },
];

/**
 * Diagnostic requests, not part of the R0..R6 matrix: they run only when named with --requests (or
 * matrix.ts --diag) and are reported separately. They isolate why an endpoint failed a matrix cell.
 */
export const DIAGNOSTICS: RequestSpec[] = [
  { id: "D1", label: "3.0 + unknown _pq_ option with an EMPTY value", version: V30, extra: [[UNKNOWN_OPTION, ""]], unknownOptions: [UNKNOWN_OPTION], informational: true },
  { id: "D2", label: "3.9999 + unknown _pq_ option with value 1", version: V(3, 9999), extra: [[UNKNOWN_OPTION, "1"]], unknownOptions: [UNKNOWN_OPTION], informational: true },
  { id: "D3", label: "3.9999 + _pq_.test_protocol_negotiation with value 1", version: V(3, 9999), extra: [[GREASE_OPTION, "1"]], unknownOptions: [GREASE_OPTION], informational: true },
];

export type CellClass =
  | "OK-exact"
  | "OK-negotiated"
  | "Bad-negotiate"
  | "Silent-accept"
  | "Reject-clean"
  | "Drop"
  | "Hang"
  | "Other"
  | "Unreachable";

export const fmtVersion = (v: number) => `${v >>> 16}.${v & 0xffff}`;
const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");

// ---------------------------------------------------------------------------------------------
// Options and result types
// ---------------------------------------------------------------------------------------------

export interface ProbeOptions {
  host: string;
  port: number;
  user: string;
  database: string;
  password: string;
  id: string;
  tls: boolean;
  timeoutMs: number;
  appName: string;
  /** milliseconds between starting pg_sleep and sending the CancelRequest */
  cancelAfterMs: number;
  /** TLS server name (SNI); defaults to the host when it is not an IP literal */
  servername?: string;
  /** verify the server certificate chain and name (default: no verification, for self-signed lab certificates) */
  verifyTls?: boolean;
}

interface RawEvent {
  d: "out" | "in";
  t: number;
  hex: string;
}
interface RawLog {
  events: RawEvent[];
  bytes: { out: number; in: number };
  truncated: { out: boolean; in: boolean };
}
const RAW_CAP = 4096;
const newRaw = (): RawLog => ({ events: [], bytes: { out: 0, in: 0 }, truncated: { out: false, in: false } });

export interface Negotiation {
  version: string;
  options: string[];
  /** true when it arrived after AuthenticationOk */
  late: boolean;
  /** true when it arrived after the first Authentication request (R) message */
  afterAuthRequest: boolean;
}

export interface ErrorInfo {
  severity: string;
  sqlstate: string;
  message: string;
}

export interface Cell {
  endpoint: string;
  tier: "A" | "B";
  request: string;
  requested: string;
  startupExtra: string[];
  class: CellClass;
  classReason: string;
  firstMessage: string;
  messageSequence: string;
  negotiations: Negotiation[];
  authOutcome: string;
  keyBytes: number | null;
  versionInForce: string;
  keyValid: boolean | null;
  ready: boolean;
  select1: string;
  cancel: string;
  cancelDetail: string;
  error: ErrorInfo | null;
  serverVersion: string;
  tlsInfo: string;
  durationMs: number;
  raw: { startup: RawLog; cancel: RawLog | null };
}

// ---------------------------------------------------------------------------------------------
// Wire helpers
// ---------------------------------------------------------------------------------------------

function cstr(s: string): Buffer {
  return Buffer.concat([Buffer.from(s, "utf8"), Buffer.from([0])]);
}

/** StartupMessage: Int32 length, Int32 version, name/value cstrings, final zero byte. */
export function buildStartup(version: number, params: Array<[string, string]>): Buffer {
  const parts: Buffer[] = [Buffer.alloc(8)];
  for (const [k, v] of params) parts.push(cstr(k), cstr(v));
  parts.push(Buffer.from([0]));
  const b = Buffer.concat(parts);
  b.writeInt32BE(b.length, 0);
  b.writeInt32BE(version, 4);
  return b;
}

function frontend(type: string, body: Buffer): Buffer {
  const b = Buffer.alloc(5 + body.length);
  b.write(type, 0, "latin1");
  b.writeInt32BE(4 + body.length, 1);
  body.copy(b, 5);
  return b;
}

export function buildCancelRequest(pid: number, key: Buffer): Buffer {
  const b = Buffer.alloc(12 + key.length);
  b.writeInt32BE(12 + key.length, 0);
  b.writeInt32BE(CANCEL_REQUEST_CODE, 4);
  b.writeInt32BE(pid, 8);
  key.copy(b, 12);
  return b;
}

interface BackendMessage {
  type: string;
  body: Buffer;
}
type ReadResult =
  | { kind: "message"; msg: BackendMessage }
  | { kind: "eof"; how: "closed" | "reset"; partial: boolean }
  | { kind: "timeout"; partial: boolean }
  | { kind: "garbage"; why: string };

class Wire {
  sock: net.Socket;
  buf: Buffer = Buffer.alloc(0);
  ended = false;
  endHow: "closed" | "reset" = "closed";
  private wake: (() => void) | null = null;
  readonly raw: RawLog;
  private readonly t0: number;
  private readonly secret: string;

  constructor(sock: net.Socket, raw: RawLog, t0: number, secret: string) {
    this.sock = sock;
    this.raw = raw;
    this.t0 = t0;
    this.secret = secret;
    this.attach(sock);
  }

  private attach(sock: net.Socket) {
    sock.on("data", (d: Buffer) => {
      this.record("in", d);
      this.buf = Buffer.concat([this.buf, d]);
      this.wake?.();
    });
    sock.on("end", () => {
      this.ended = true;
      this.wake?.();
    });
    sock.on("close", () => {
      this.ended = true;
      this.wake?.();
    });
    sock.on("error", (e: NodeJS.ErrnoException) => {
      this.ended = true;
      if (e.code === "ECONNRESET" || e.code === "EPIPE") this.endHow = "reset";
      this.lastError = e;
      this.wake?.();
    });
  }
  lastError: NodeJS.ErrnoException | null = null;

  record(d: "out" | "in", data: Uint8Array) {
    const r = this.raw;
    const room = RAW_CAP - r.bytes[d];
    if (room <= 0) {
      r.truncated[d] = true;
      return;
    }
    let slice = data;
    if (data.length > room) {
      slice = data.subarray(0, room);
      r.truncated[d] = true;
    }
    r.bytes[d] += slice.length;
    let h = hex(slice);
    // Defence in depth: the password is never put on the wire in a method we support, but if it
    // ever were, it must not reach a stored artifact.
    if (this.secret) h = h.split(hex(Buffer.from(this.secret))).join("<redacted>");
    r.events.push({ d, t: Date.now() - this.t0, hex: h });
  }

  write(b: Buffer) {
    this.record("out", b);
    this.sock.write(b);
  }

  /** Wait until the buffer holds n bytes, or the peer ended, or the idle timeout passes. */
  private async need(n: number, timeoutMs: number): Promise<"ok" | "eof" | "timeout"> {
    const deadline = Date.now() + timeoutMs;
    while (this.buf.length < n) {
      if (this.ended) return "eof";
      const left = deadline - Date.now();
      if (left <= 0) return "timeout";
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          this.wake = null;
          resolve();
        }, left);
        this.wake = () => {
          clearTimeout(timer);
          this.wake = null;
          resolve();
        };
      });
    }
    return "ok";
  }

  async readBytes(n: number, timeoutMs: number): Promise<Buffer | "eof" | "timeout"> {
    const r = await this.need(n, timeoutMs);
    if (r !== "ok") return r;
    const out = this.buf.subarray(0, n);
    this.buf = this.buf.subarray(n);
    return Buffer.from(out);
  }

  async readMessage(timeoutMs: number): Promise<ReadResult> {
    const had = this.buf.length > 0;
    let r = await this.need(5, timeoutMs);
    if (r === "eof") return { kind: "eof", how: this.endHow, partial: this.buf.length > 0 || had };
    if (r === "timeout") return { kind: "timeout", partial: this.buf.length > 0 };
    const type = String.fromCharCode(this.buf[0]!);
    const len = this.buf.readInt32BE(1);
    if (len < 4 || len > 64 * 1024 * 1024) return { kind: "garbage", why: `type 0x${this.buf[0]!.toString(16)} length ${len}` };
    r = await this.need(1 + len, timeoutMs);
    if (r === "eof") return { kind: "eof", how: this.endHow, partial: true };
    if (r === "timeout") return { kind: "timeout", partial: true };
    const body = Buffer.from(this.buf.subarray(5, 1 + len));
    this.buf = this.buf.subarray(1 + len);
    return { kind: "message", msg: { type, body } };
  }

  /** Upgrade to TLS after the server answered 'S' to SSLRequest. Certificate is NOT verified. */
  async upgradeTls(timeoutMs: number, servername?: string, verify = false): Promise<string> {
    this.sock.removeAllListeners("data");
    this.sock.removeAllListeners("end");
    this.sock.removeAllListeners("close");
    this.sock.removeAllListeners("error");
    const plain = this.sock;
    const secure = await new Promise<tls.TLSSocket>((resolve, reject) => {
      // Default: no verification (self-signed lab certificates), by design; --verify-tls turns it on.
      const s = tls.connect({ socket: plain, rejectUnauthorized: verify, ...(servername ? { servername } : {}) });
      const timer = setTimeout(() => reject(new Error("TLS handshake timeout")), timeoutMs);
      s.once("secureConnect", () => {
        clearTimeout(timer);
        resolve(s);
      });
      s.once("error", (e) => {
        clearTimeout(timer);
        reject(e);
      });
    });
    this.sock = secure;
    this.ended = false;
    this.attach(secure);
    return `${secure.getProtocol()} ${secure.getCipher().name}`;
  }

  close() {
    try {
      this.sock.destroy();
    } catch {
      /* ignore */
    }
  }
}

function connectTcp(host: string, port: number, timeoutMs: number): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const s = net.connect({ host, port });
    s.setNoDelay(true);
    const timer = setTimeout(() => {
      s.destroy();
      reject(Object.assign(new Error("connect timeout"), { code: "ETIMEDOUT" }));
    }, timeoutMs);
    s.once("connect", () => {
      clearTimeout(timer);
      resolve(s);
    });
    s.once("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

// ---------------------------------------------------------------------------------------------
// Backend message parsing
// ---------------------------------------------------------------------------------------------

export function parseNegotiate(body: Buffer): { version: number; options: string[]; ok: boolean } {
  if (body.length < 8) return { version: 0, options: [], ok: false };
  const version = body.readInt32BE(0);
  const n = body.readInt32BE(4);
  const options: string[] = [];
  let off = 8;
  for (let i = 0; i < n && off < body.length; i++) {
    const end = body.indexOf(0, off);
    if (end < 0) return { version, options, ok: false };
    options.push(body.subarray(off, end).toString("utf8"));
    off = end + 1;
  }
  return { version, options, ok: options.length === n && off === body.length };
}

export function parseError(body: Buffer): ErrorInfo {
  const f: Record<string, string> = {};
  let off = 0;
  while (off < body.length && body[off] !== 0) {
    const code = String.fromCharCode(body[off]!);
    const end = body.indexOf(0, off + 1);
    if (end < 0) break;
    f[code] = body.subarray(off + 1, end).toString("utf8");
    off = end + 1;
  }
  return { severity: f["V"] ?? f["S"] ?? "", sqlstate: f["C"] ?? "", message: f["M"] ?? "" };
}

// ---------------------------------------------------------------------------------------------
// SCRAM-SHA-256 client (RFC 5802 / RFC 7677 as used by PostgreSQL)
// ---------------------------------------------------------------------------------------------

const hmac = (key: Buffer, data: Buffer | string) => crypto.createHmac("sha256", key).update(data).digest();
const sha256 = (data: Buffer) => crypto.createHash("sha256").update(data).digest();

export class ScramClient {
  private readonly nonce = crypto.randomBytes(18).toString("base64");
  private clientFirstBare = "";
  private authMessage = "";
  private serverKey: Buffer = Buffer.alloc(0);
  constructor(private readonly password: string) {}

  clientFirst(): Buffer {
    // libpq sends an empty user name; PostgreSQL ignores it and uses the startup user.
    this.clientFirstBare = `n=,r=${this.nonce}`;
    return Buffer.from(`n,,${this.clientFirstBare}`, "utf8");
  }

  clientFinal(serverFirst: string): Buffer {
    const attrs = Object.fromEntries(serverFirst.split(",").map((kv) => [kv[0]!, kv.slice(2)]));
    const r = attrs["r"];
    const s = attrs["s"];
    const i = Number(attrs["i"]);
    if (!r || !s || !Number.isInteger(i) || i < 1) throw new Error("malformed SCRAM server-first-message");
    if (!r.startsWith(this.nonce)) throw new Error("SCRAM server nonce does not extend the client nonce");
    if (i > 10_000_000) throw new Error("SCRAM iteration count unreasonable");
    const salt = Buffer.from(s, "base64");
    const salted = crypto.pbkdf2Sync(Buffer.from(this.password, "utf8"), salt, i, 32, "sha256");
    const clientKey = hmac(salted, "Client Key");
    const storedKey = sha256(clientKey);
    const withoutProof = `c=biws,r=${r}`;
    this.authMessage = `${this.clientFirstBare},${serverFirst},${withoutProof}`;
    const clientSig = hmac(storedKey, this.authMessage);
    const proof = Buffer.alloc(32);
    for (let k = 0; k < 32; k++) proof[k] = clientKey[k]! ^ clientSig[k]!;
    this.serverKey = hmac(salted, "Server Key");
    return Buffer.from(`${withoutProof},p=${proof.toString("base64")}`, "utf8");
  }

  verifyServerFinal(serverFinal: string): boolean {
    if (!serverFinal.startsWith("v=")) return false;
    const expected = hmac(this.serverKey, this.authMessage);
    const got = Buffer.from(serverFinal.slice(2), "base64");
    return got.length === expected.length && crypto.timingSafeEqual(got, expected);
  }
}

// ---------------------------------------------------------------------------------------------
// One request = one connection (plus the cancel connection when required)
// ---------------------------------------------------------------------------------------------

function scrub(s: string, secret: string): string {
  return secret ? s.split(secret).join("<redacted>") : s;
}

export async function runRequest(opts: ProbeOptions, req: RequestSpec): Promise<Cell> {
  const t0 = Date.now();
  const raw = newRaw();
  const cell: Cell = {
    endpoint: opts.id,
    tier: opts.tls ? "B" : "A",
    request: req.id,
    requested: fmtVersion(req.version),
    startupExtra: req.extra.map(([k]) => k),
    class: "Other",
    classReason: "",
    firstMessage: "",
    messageSequence: "",
    negotiations: [],
    authOutcome: "none",
    keyBytes: null,
    versionInForce: "",
    keyValid: null,
    ready: false,
    select1: "not-run",
    cancel: "not-run",
    cancelDetail: "",
    error: null,
    serverVersion: "",
    tlsInfo: "",
    durationMs: 0,
    raw: { startup: raw, cancel: null },
  };

  let sock: net.Socket;
  try {
    sock = await connectTcp(opts.host, opts.port, opts.timeoutMs);
  } catch (e) {
    cell.class = "Unreachable";
    cell.classReason = `connect failed: ${(e as NodeJS.ErrnoException).code ?? (e as Error).message}`;
    cell.durationMs = Date.now() - t0;
    return cell;
  }
  const wire = new Wire(sock, raw, t0, opts.password);
  const seq: string[] = [];
  let pid = 0;
  let key: Buffer | null = null;
  let authOkSeen = false;
  let authRequestSeen = false;

  try {
    if (opts.tls) {
      const sslReq = Buffer.alloc(8);
      sslReq.writeInt32BE(8, 0);
      sslReq.writeInt32BE(SSL_REQUEST_CODE, 4);
      wire.write(sslReq);
      const ans = await wire.readBytes(1, opts.timeoutMs);
      if (ans === "timeout") return finish(cell, t0, wire, "Hang", "no answer to SSLRequest");
      if (ans === "eof") return finish(cell, t0, wire, "Drop", `connection ${wire.endHow} after SSLRequest`);
      const c = String.fromCharCode(ans[0]!);
      cell.tlsInfo = `SSLRequest answered '${c}'`;
      if (c !== "S") return finish(cell, t0, wire, "Other", `TLS not available (SSLRequest answered '${c}')`);
      try {
        cell.tlsInfo += `; ${await wire.upgradeTls(opts.timeoutMs, sniName(opts), opts.verifyTls === true)}`;
      } catch (e) {
        return finish(cell, t0, wire, "Other", `TLS handshake failed: ${(e as Error).message}`);
      }
    }

    const params: Array<[string, string]> = [
      ["user", opts.user],
      ["database", opts.database],
      ["application_name", opts.appName],
      ...req.extra,
    ];
    wire.write(buildStartup(req.version, params));

    const scram = new ScramClient(opts.password);
    let steps = 0;
    startup: for (;;) {
      if (++steps > 200) return finish(cell, t0, wire, "Other", "more than 200 startup messages");
      const r = await wire.readMessage(opts.timeoutMs);
      if (r.kind === "timeout") {
        return finish(cell, t0, wire, "Hang", `nothing for ${opts.timeoutMs} ms${r.partial ? " (partial message)" : ""}${seq.length ? ` after ${seq.join(" ")}` : ""}`);
      }
      if (r.kind === "eof") {
        if (seq.length === 0) {
          return finish(cell, t0, wire, "Drop", `connection ${r.how} before any backend message`);
        }
        return finish(cell, t0, wire, "Other", `connection ${r.how} after ${seq.join(" ")}`);
      }
      if (r.kind === "garbage") return finish(cell, t0, wire, "Other", `unparseable backend bytes: ${r.why}`);
      const { type, body } = r.msg;
      if (cell.firstMessage === "") cell.firstMessage = type;
      switch (type) {
        case "v": {
          seq.push("v");
          const n = parseNegotiate(body);
          cell.negotiations.push({
            version: n.ok ? fmtVersion(n.version) : `malformed(${hex(body.subarray(0, 8))})`,
            options: n.options,
            late: authOkSeen,
            afterAuthRequest: authRequestSeen,
          });
          break;
        }
        case "R": {
          const code = body.length >= 4 ? body.readInt32BE(0) : -1;
          if (code === 0) {
            seq.push("R0");
            authOkSeen = true;
            if (cell.authOutcome === "none") cell.authOutcome = "ok-trust";
            else if (cell.authOutcome === "scram-in-progress") cell.authOutcome = "ok-scram";
            break;
          }
          authRequestSeen = true;
          if (code === 10) {
            seq.push("R10");
            const mechs = body.subarray(4).toString("utf8").split("\0").filter(Boolean);
            if (!mechs.includes("SCRAM-SHA-256")) {
              cell.authOutcome = `unsupported-sasl:${mechs.join(",")}`;
              return finish(cell, t0, wire, "Other", `server offers no SCRAM-SHA-256 (${mechs.join(",")})`);
            }
            cell.authOutcome = "scram-in-progress";
            const first = scram.clientFirst();
            const mech = cstr("SCRAM-SHA-256");
            const len = Buffer.alloc(4);
            len.writeInt32BE(first.length, 0);
            wire.write(frontend("p", Buffer.concat([mech, len, first])));
          } else if (code === 11) {
            seq.push("R11");
            wire.write(frontend("p", scram.clientFinal(body.subarray(4).toString("utf8"))));
          } else if (code === 12) {
            seq.push("R12");
            if (!scram.verifyServerFinal(body.subarray(4).toString("utf8"))) {
              cell.authOutcome = "scram-server-signature-invalid";
              return finish(cell, t0, wire, "Other", "SCRAM server signature did not verify");
            }
          } else {
            seq.push(`R${code}`);
            // Never answer a cleartext or md5 request: we only ever prove SCRAM possession.
            cell.authOutcome = `unsupported-auth-request:${code}`;
            return finish(cell, t0, wire, "Other", `server requested auth method ${code}; probe only does SCRAM-SHA-256`);
          }
          break;
        }
        case "E": {
          seq.push("E");
          cell.error = parseError(body);
          if (!authOkSeen) {
            if (cell.authOutcome === "scram-in-progress") cell.authOutcome = `failed:${cell.error.sqlstate}`;
            else if (cell.authOutcome === "none") cell.authOutcome = `error-before-auth:${cell.error.sqlstate}`;
            return finish(cell, t0, wire, "Reject-clean", `ErrorResponse ${cell.error.sqlstate} before authentication`);
          }
          return finish(cell, t0, wire, "Other", `ErrorResponse ${cell.error.sqlstate} after authentication, before ReadyForQuery`);
        }
        case "S": {
          seq.push("S");
          const parts = body.toString("utf8").split("\0");
          if (parts[0] === "server_version") cell.serverVersion = parts[1] ?? "";
          break;
        }
        case "N":
          seq.push("N");
          break;
        case "K": {
          seq.push("K");
          if (body.length >= 4) {
            pid = body.readInt32BE(0);
            key = Buffer.from(body.subarray(4));
            cell.keyBytes = key.length;
          }
          break;
        }
        case "Z":
          seq.push("Z");
          cell.ready = true;
          break startup;
        default:
          seq.push(type);
          break;
      }
    }
    cell.messageSequence = seq.join(" ");

    // ---- version in force and key validity -------------------------------------------------
    const valid = cell.negotiations.filter((n) => /^\d+\.\d+$/.test(n.version));
    let inForce: number | null;
    if (cell.negotiations.length > 0) {
      inForce = valid.length > 0 ? parseVer(valid[0]!.version) : null;
    } else {
      inForce = req.version === V30 || req.version === V32 ? req.version : null;
    }
    cell.versionInForce = inForce === null ? `unknown (requested ${cell.requested})` : fmtVersion(inForce);
    if (cell.keyBytes === null) cell.keyValid = false;
    else if (inForce === V30) cell.keyValid = cell.keyBytes === 4;
    else if (inForce === V32) cell.keyValid = cell.keyBytes >= 4 && cell.keyBytes <= 256;
    else cell.keyValid = null;

    classify(cell, req);

    // ---- SELECT 1 ---------------------------------------------------------------------------
    cell.select1 = await simpleSelect1(wire, opts.timeoutMs);
    if (cell.select1 === "late-NegotiateProtocolVersion") {
      cell.class = "Bad-negotiate";
      cell.classReason = "NegotiateProtocolVersion sent after ReadyForQuery";
    }

    // ---- cancel test ------------------------------------------------------------------------
    const needCancel = key !== null && (key.length > 4 || inForce === V32);
    if (needCancel && cell.select1 === "ok") {
      const out = await cancelTest(opts, wire, pid, key!, cell);
      cell.cancel = out.result;
      cell.cancelDetail = out.detail;
    } else if (!needCancel) {
      cell.cancel = "not-applicable";
    } else {
      cell.cancel = "skipped (SELECT 1 failed)";
    }
    try {
      wire.write(frontend("X", Buffer.alloc(0)));
    } catch {
      /* ignore */
    }
  } catch (e) {
    cell.class = "Other";
    cell.classReason = scrub(`probe error: ${(e as Error).message}`, opts.password);
  } finally {
    cell.durationMs = Date.now() - t0;
    // Late NegotiateProtocolVersion seen while running queries is caught inside simpleSelect1.
    await new Promise((r) => setTimeout(r, 20));
    wire.close();
  }
  return cell;
}

function sniName(opts: ProbeOptions): string | undefined {
  if (opts.servername) return opts.servername;
  return net.isIP(opts.host) === 0 ? opts.host : undefined;
}

function parseVer(s: string): number {
  const [a, b] = s.split(".");
  return V(Number(a), Number(b));
}

function finish(cell: Cell, t0: number, wire: Wire, cls: CellClass, reason: string): Cell {
  cell.class = cls;
  cell.classReason = reason;
  cell.messageSequence = cell.messageSequence || "";
  cell.durationMs = Date.now() - t0;
  wire.close();
  return cell;
}

// ---------------------------------------------------------------------------------------------
// Classification (the classes are fixed by the FS-02 brief)
// ---------------------------------------------------------------------------------------------

export function classify(cell: Cell, req: RequestSpec): void {
  const negs = cell.negotiations;
  if (negs.length === 0) {
    if (req.id === "R0") {
      cell.class = "OK-exact";
      cell.classReason = "3.0 accepted, no negotiation";
    } else if (req.id === "R1") {
      cell.class = "OK-exact";
      cell.classReason = "3.2 accepted without negotiation";
    } else {
      cell.class = "Silent-accept";
      cell.classReason =
        req.unknownOptions.length > 0 && req.version <= V32
          ? "reached ReadyForQuery, unknown _pq_ option ignored with no NegotiateProtocolVersion"
          : `reached ReadyForQuery at requested ${cell.requested} with no NegotiateProtocolVersion`;
    }
    return;
  }
  const problems: string[] = [];
  if (negs.length > 1) problems.push(`${negs.length} NegotiateProtocolVersion messages`);
  const n = negs[0]!;
  if (n.late) problems.push("sent after AuthenticationOk");
  if (!/^\d+\.\d+$/.test(n.version)) {
    problems.push(`malformed message ${n.version}`);
  } else {
    const v = parseVer(n.version);
    if (v > req.version) problems.push(`version ${n.version} is above the requested ${cell.requested}`);
    if (v !== V30 && v !== V32) problems.push(`version ${n.version} is not a defined protocol version (3.0 and 3.2 only; 3.1 never existed)`);
    if (v === req.version && n.options.length === 0) problems.push("asks for no change (same version, no options)");
  }
  const want = [...req.unknownOptions].sort().join("|");
  const got = [...n.options].sort().join("|");
  if (want !== got) problems.push(`option list [${n.options.join(",")}] differs from the unknown options sent [${req.unknownOptions.join(",")}]`);
  if (problems.length > 0) {
    cell.class = "Bad-negotiate";
    cell.classReason = problems.join("; ");
  } else {
    cell.class = "OK-negotiated";
    cell.classReason = `negotiated to ${n.version}, options [${n.options.join(",")}]`;
  }
}

// ---------------------------------------------------------------------------------------------
// Queries and cancel
// ---------------------------------------------------------------------------------------------

async function simpleSelect1(wire: Wire, timeoutMs: number): Promise<string> {
  wire.write(frontend("Q", cstr("SELECT 1")));
  let sawRow = false;
  let value = "";
  for (let i = 0; i < 50; i++) {
    const r = await wire.readMessage(timeoutMs);
    if (r.kind === "timeout") return "hang";
    if (r.kind === "eof") return `closed (${r.how})`;
    if (r.kind === "garbage") return `garbage (${r.why})`;
    const { type, body } = r.msg;
    if (type === "D") {
      sawRow = true;
      // Int16 columns, Int32 length, bytes
      const len = body.readInt32BE(2);
      value = body.subarray(6, 6 + len).toString("utf8");
    } else if (type === "E") {
      const e = parseError(body);
      return `error:${e.sqlstate}`;
    } else if (type === "v") {
      return "late-NegotiateProtocolVersion";
    } else if (type === "Z") {
      return sawRow && value === "1" ? "ok" : `unexpected-result(${sawRow ? value : "no row"})`;
    }
  }
  return "no ReadyForQuery";
}

async function cancelTest(opts: ProbeOptions, a: Wire, pid: number, key: Buffer, cell: Cell): Promise<{ result: string; detail: string }> {
  const started = Date.now();
  a.write(frontend("Q", cstr("SELECT pg_sleep(10)")));
  await new Promise((r) => setTimeout(r, opts.cancelAfterMs));

  const craw = newRaw();
  cell.raw.cancel = craw;
  let detail = "";
  try {
    const s2 = await connectTcp(opts.host, opts.port, opts.timeoutMs);
    const b = new Wire(s2, craw, started, opts.password);
    if (opts.tls) {
      const sslReq = Buffer.alloc(8);
      sslReq.writeInt32BE(8, 0);
      sslReq.writeInt32BE(SSL_REQUEST_CODE, 4);
      b.write(sslReq);
      const ans = await b.readBytes(1, opts.timeoutMs);
      if (ans === "timeout" || ans === "eof" || String.fromCharCode(ans[0]!) !== "S") {
        detail = "cancel socket: TLS not negotiated";
        b.close();
      } else {
        await b.upgradeTls(opts.timeoutMs, sniName(opts), opts.verifyTls === true);
      }
    }
    if (!detail) {
      b.write(buildCancelRequest(pid, key));
      const resp = await b.readBytes(1, 3000);
      detail = resp === "eof" ? `cancel socket closed by server (${b.endHow})` : resp === "timeout" ? "cancel socket: no reaction in 3 s" : `cancel socket answered ${hex(resp)}`;
      b.close();
    }
  } catch (e) {
    detail = `cancel socket error: ${(e as Error).message}`;
  }

  // Now watch the first connection: cancelled (57014), ignored (query completes), closed or error.
  let result = "";
  for (let i = 0; i < 20 && !result; i++) {
    const r = await a.readMessage(12_000);
    if (r.kind === "timeout") result = "hang";
    else if (r.kind === "eof") result = `closed (${r.how})`;
    else if (r.kind === "garbage") result = "garbage";
    else if (r.msg.type === "E") {
      const e = parseError(r.msg.body);
      result = e.sqlstate === "57014" ? "cancelled" : `error:${e.sqlstate}`;
    } else if (r.msg.type === "C") result = "ignored";
    else if (r.msg.type === "Z") result = "ignored";
  }
  const took = Date.now() - started;
  // Drain to ReadyForQuery so the Terminate is orderly (best effort).
  if (result === "cancelled") {
    for (let i = 0; i < 5; i++) {
      const r = await a.readMessage(2000);
      if (r.kind !== "message" || r.msg.type === "Z") break;
    }
  }
  return { result, detail: `${detail}; first connection settled after ${took} ms` };
}

// ---------------------------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------------------------

export const CSV_HEADER = [
  "endpoint",
  "tier",
  "request",
  "requested",
  "class",
  "first_message",
  "neg_count",
  "neg_detail",
  "auth",
  "key_bytes",
  "version_in_force",
  "key_valid",
  "select1",
  "cancel",
  "server_version",
  "error",
  "class_reason",
  "duration_ms",
];

const csvEsc = (raw: string) => {
  // control bytes (a corrupt server message can put them in a reason string) are written as \xNN
  const s = raw.replace(/[\u0000-\u0009\u000b-\u001f]/g, (ch) => `\\x${ch.charCodeAt(0).toString(16).padStart(2, "0")}`);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsvRow(c: Cell): string {
  const negDetail = c.negotiations.map((n) => `${n.version}[${n.options.join("|")}]${n.late ? "(late)" : ""}`).join(";");
  const err = c.error ? `${c.error.sqlstate} ${c.error.message}` : "";
  return [
    c.endpoint,
    c.tier,
    c.request,
    c.requested,
    c.class,
    c.firstMessage || "-",
    String(c.negotiations.length),
    negDetail,
    c.authOutcome,
    c.keyBytes === null ? "" : String(c.keyBytes),
    c.versionInForce,
    c.keyValid === null ? "" : String(c.keyValid),
    c.select1,
    c.cancel,
    c.serverVersion,
    err,
    c.classReason,
    String(c.durationMs),
  ]
    .map(csvEsc)
    .join(",");
}

export function writeRaw(dir: string, cell: Cell): void {
  fs.mkdirSync(dir, { recursive: true });
  const name = `${cell.endpoint}__${cell.tier}__${cell.request}.json`;
  const body = {
    endpoint: cell.endpoint,
    tier: cell.tier,
    request: cell.request,
    note: "hex of application-layer bytes, at most 4096 bytes per direction; t is ms since the cell started; after SSLRequest the bytes are the decrypted TLS payload",
    class: cell.class,
    classReason: cell.classReason,
    messageSequence: cell.messageSequence,
    startup: cell.raw.startup,
    cancel: cell.raw.cancel,
  };
  fs.writeFileSync(path.join(dir, name), JSON.stringify(body) + "\n");
}

function parseArgs(argv: string[]) {
  const a: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i]!;
    if (!k.startsWith("--")) throw new Error(`unexpected argument ${k}`);
    const name = k.slice(2);
    if (name === "tls" || name === "json" || name === "help" || name === "verify-tls") a[name] = true;
    else a[name] = argv[++i] ?? "";
  }
  return a;
}

const HELP = `usage: FS02_PASSWORD=... bun probe.ts --host H --port P --user U --database D
  [--id label] [--tls] [--requests R0,R1,...] [--timeout ms] [--cancel-after ms]
  [--raw-dir dir] [--csv file] [--json] [--password-env NAME] [--app-name NAME]
  [--servername SNI] [--verify-tls]   (--tls: SSLRequest first; certificate not verified unless --verify-tls)
The password comes from the environment variable (default FS02_PASSWORD) and is never printed or stored.`;

export async function main(argv: string[]): Promise<number> {
  const a = parseArgs(argv);
  if (a["help"]) {
    console.log(HELP);
    return 0;
  }
  for (const k of ["host", "port", "user", "database"]) {
    if (!a[k]) {
      console.error(`missing --${k}\n${HELP}`);
      return 2;
    }
  }
  const envName = typeof a["password-env"] === "string" && a["password-env"] ? (a["password-env"] as string) : "FS02_PASSWORD";
  const password = process.env[envName];
  if (!password) {
    console.error(`environment variable ${envName} is empty`);
    return 2;
  }
  const opts: ProbeOptions = {
    host: String(a["host"]),
    port: Number(a["port"]),
    user: String(a["user"]),
    database: String(a["database"]),
    password,
    id: typeof a["id"] === "string" && a["id"] ? (a["id"] as string) : `${a["host"]}:${a["port"]}`,
    tls: a["tls"] === true,
    timeoutMs: Number(a["timeout"] ?? 10_000),
    appName: typeof a["app-name"] === "string" ? (a["app-name"] as string) : "fs02-probe",
    cancelAfterMs: Number(a["cancel-after"] ?? 1000),
    ...(typeof a["servername"] === "string" ? { servername: a["servername"] as string } : {}),
    verifyTls: a["verify-tls"] === true,
  };
  const only = typeof a["requests"] === "string" ? new Set((a["requests"] as string).split(",")) : null;
  const cells: Cell[] = [];
  for (const req of [...REQUESTS, ...DIAGNOSTICS]) {
    const diagnostic = req.id.startsWith("D");
    if (only ? !only.has(req.id) : diagnostic) continue;
    cells.push(await runRequest(opts, req));
  }
  if (typeof a["raw-dir"] === "string") for (const c of cells) writeRaw(a["raw-dir"] as string, c);
  if (typeof a["csv"] === "string") {
    const f = a["csv"] as string;
    const fresh = !fs.existsSync(f);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.appendFileSync(f, (fresh ? CSV_HEADER.join(",") + "\n" : "") + cells.map(toCsvRow).join("\n") + "\n");
  }
  if (a["json"]) {
    const slim = cells.map(({ raw: _raw, ...rest }) => rest);
    console.log(JSON.stringify(slim, null, 1));
  } else {
    for (const c of cells) {
      console.log(
        `${c.endpoint} ${c.tier} ${c.request} (${c.requested}) -> ${c.class}; neg=${c.negotiations.map((n) => `${n.version}[${n.options.join("|")}]`).join(";") || "-"} auth=${c.authOutcome} key=${c.keyBytes ?? "-"} force=${c.versionInForce || "-"} select1=${c.select1} cancel=${c.cancel}${c.error ? ` error=${c.error.sqlstate} ${c.error.message}` : ""}`,
      );
    }
  }
  return 0;
}

if (import.meta.main) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e) => {
      console.error(`probe failed: ${(e as Error).message}`);
      process.exit(1);
    },
  );
}
