import net from "node:net";
import type { Endpoint, Transport, TransportCaps } from "../platform/contracts/index.ts";

/** Plain TCP. Bytes in, bytes out; it knows no protocol. */
export class TcpTransport implements Transport {
  readonly kind = "tcp" as const;
  readonly caps: TransportCaps = {
    streaming: true,
    startTls: false,
    channelBinding: "none",
    keepalive: false,
    halfOpenDetection: false,
    secondConnectionForCancel: false,
  };
  private sock: net.Socket | undefined;
  private dataCb: ((buf: Uint8Array, len: number) => void) | undefined;
  private closeCb: ((err?: Error) => void) | undefined;
  private closedReported = false;

  open(target: Endpoint, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      if (signal.aborted) return reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
      const s = net.connect({ host: target.host, port: target.port });
      this.sock = s;
      s.setNoDelay(true);
      let connected = false;
      const onAbort = (): void => {
        s.destroy(Object.assign(new Error("aborted"), { name: "AbortError" }));
      };
      signal.addEventListener("abort", onAbort, { once: true });
      s.once("connect", () => {
        connected = true;
        signal.removeEventListener("abort", onAbort);
        resolve();
      });
      s.on("data", (b: Buffer) => this.dataCb?.(b, b.length));
      s.on("error", (e) => {
        if (!connected) {
          signal.removeEventListener("abort", onAbort);
          reject(e);
        } else this.report(e);
      });
      s.on("close", () => this.report(undefined));
    });
  }
  private report(err: Error | undefined): void {
    if (this.closedReported) return;
    this.closedReported = true;
    this.closeCb?.(err);
  }
  write(chunks: readonly Uint8Array[]): void {
    const s = this.sock;
    if (s === undefined) return;
    if (chunks.length === 1) s.write(chunks[0]!);
    else s.write(Buffer.concat(chunks));
  }
  onData(cb: (buf: Uint8Array, len: number) => void): void {
    this.dataCb = cb;
  }
  onClose(cb: (err?: Error) => void): void {
    this.closeCb = cb;
  }
  close(reason?: Error): void {
    this.closedReported = true;
    this.sock?.destroy(reason);
  }
}
