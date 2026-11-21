import type { Endpoint, Transport, TransportCaps } from "../platform/contracts/index.ts";

/**
 * One HTTP exchange dressed as a Transport: `open` records the target, `write` sends the body as
 * a POST, `onData` receives the response body once, `onClose` fires when the exchange ends.
 * The HTTP status is not visible through the contract. This adapter is a shim (see shims.json).
 */
export class HttpTransport implements Transport {
  readonly kind = "http" as const;
  readonly caps: TransportCaps = {
    streaming: false,
    startTls: false,
    channelBinding: "none",
    keepalive: false,
    halfOpenDetection: false,
    secondConnectionForCancel: false,
  };
  private url = "";
  private headers: Record<string, string> = {};
  private signal: AbortSignal | undefined;
  private dataCb: ((buf: Uint8Array, len: number) => void) | undefined;
  private closeCb: ((err?: Error) => void) | undefined;

  open(target: Endpoint, signal: AbortSignal): Promise<void> {
    this.url = `http://${target.host}:${target.port}${target.path ?? "/"}`;
    this.headers = { ...(target.headers ?? {}) };
    this.signal = signal;
    return Promise.resolve(); // nothing is connected yet: connection failures surface at write()
  }
  write(chunks: readonly Uint8Array[]): void {
    const body = chunks.length === 1 ? chunks[0]! : Buffer.concat(chunks);
    fetch(this.url, { method: "POST", headers: this.headers, body, signal: this.signal ?? null })
      .then(async (r) => {
        const b = new Uint8Array(await r.arrayBuffer());
        this.dataCb?.(b, b.length);
        this.closeCb?.(undefined);
      })
      .catch((e: unknown) => this.closeCb?.(e instanceof Error ? e : new Error(String(e))));
  }
  onData(cb: (buf: Uint8Array, len: number) => void): void {
    this.dataCb = cb;
  }
  onClose(cb: (err?: Error) => void): void {
    this.closeCb = cb;
  }
  close(): void {}
}
