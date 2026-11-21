import {
  RawFailure,
  type EncodedParam,
  type Endpoint,
  type ObservedTx,
  type ServerFacts,
  type ServiceCore,
  type ServiceRequest,
  type ServiceResult,
  type ServiceStream,
  type TransportFactory,
} from "../../platform/contracts/index.ts";

export interface HranaError {
  readonly kind: "hrana";
  readonly message: string;
  readonly code: string | undefined;
}

type HranaValue = { type: string; value?: string | number; base64?: string };
const enc = new TextEncoder();

function arg(p: EncodedParam): unknown {
  if (p.tag === "null") return { type: "null" };
  if (p.data instanceof Uint8Array) return { type: "blob", base64: Buffer.from(p.data).toString("base64") };
  return { type: p.tag, value: p.data };
}

/** Hrana 3 over HTTP, through whatever Transport the entry hands in. One exchange per request. */
export class HranaCore implements ServiceCore {
  constructor(private readonly newTransport: TransportFactory, private readonly endpoint: Endpoint) {}

  private exchange(body: unknown, signal: AbortSignal): Promise<any> {
    const t = this.newTransport();
    const chunks: Uint8Array[] = [];
    return new Promise((resolve, reject) => {
      t.onData((b, l) => chunks.push(b.slice(0, l)));
      t.onClose((err) => {
        if (err !== undefined) return reject(err);
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        } catch (e) {
          reject(e);
        }
      });
      t.open({ ...this.endpoint, path: "/v3/pipeline", headers: { "content-type": "application/json" } }, signal).then(
        () => t.write([enc.encode(JSON.stringify(body))]),
        reject,
      );
    });
  }

  private static result(resp: any, closeStream: boolean): { r: ServiceResult; baton: string | null } {
    if (resp.error !== undefined && resp.results === undefined) {
      throw new RawFailure({ kind: "hrana", message: String(resp.error), code: undefined } satisfies HranaError, "unknown");
    }
    const exec = resp.results[0];
    const auto = resp.results[1];
    const observedTx: ObservedTx = auto?.type === "ok" ? (auto.response.is_autocommit ? "idle" : "in-tx") : "unknown";
    if (exec.type === "error") {
      throw new RawFailure({ kind: "hrana", message: exec.error.message, code: exec.error.code } satisfies HranaError, closeStream ? observedTx : observedTx);
    }
    const res = exec.response.result;
    const columns = res.cols.map((c: { name: string; decltype: string | null }) => ({ name: c.name, type: c.decltype ?? "dynamic", flags: 0 }));
    const rows = res.rows.map((row: HranaValue[]) => row.map((v) => (v.type === "null" ? null : v)));
    return {
      r: { columns, rows, affectedRows: res.cols.length > 0 ? rows.length : res.affected_row_count, tag: "hrana", observedTx },
      baton: resp.baton ?? null,
    };
  }

  async handshake(signal: AbortSignal): Promise<ServerFacts> {
    const resp = await this.exchange({ requests: [{ type: "execute", stmt: { sql: "select sqlite_version()", want_rows: true } }, { type: "get_autocommit" }] }, signal);
    const { r, baton } = HranaCore.result(resp, false);
    if (baton !== null) await this.exchange({ baton, requests: [{ type: "close" }] }, signal);
    const v = r.rows[0]![0] as HranaValue;
    return { version: String(v.value), params: { hrana: "v3", streams: baton !== null ? "baton" : "none" }, observedTx: r.observedTx };
  }

  async execute(req: ServiceRequest, signal: AbortSignal): Promise<ServiceResult> {
    const resp = await this.exchange(
      { requests: [{ type: "execute", stmt: { sql: req.sql, args: req.params.map(arg), want_rows: true } }, { type: "get_autocommit" }, { type: "close" }] },
      signal,
    );
    return HranaCore.result(resp, true).r;
  }

  async openStream(): Promise<ServiceStream> {
    let baton: string | null = null;
    const self = this;
    return {
      async execute(req, signal) {
        const resp = await self.exchange(
          { ...(baton === null ? {} : { baton }), requests: [{ type: "execute", stmt: { sql: req.sql, args: req.params.map(arg), want_rows: true } }, { type: "get_autocommit" }] },
          signal,
        );
        baton = resp.baton ?? baton;
        return HranaCore.result(resp, false).r;
      },
      async close(signal) {
        if (baton === null) return;
        const b = baton;
        baton = null;
        await self.exchange({ baton: b, requests: [{ type: "close" }] }, signal);
      },
    };
  }

  async close(): Promise<void> {}
}
