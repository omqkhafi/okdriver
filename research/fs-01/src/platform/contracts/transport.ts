export interface TransportCaps {
  streaming: boolean;
  startTls: boolean;
  channelBinding: "tls-server-end-point" | "none";
  keepalive: boolean;
  halfOpenDetection: boolean;
  secondConnectionForCancel: boolean;
}

/** R7: the sketch names `Endpoint` without a shape. `path` and `headers` exist only because an HTTP service needs them. */
export interface Endpoint {
  readonly host: string;
  readonly port: number;
  readonly path?: string;
  readonly headers?: Readonly<Record<string, string>>;
}

export interface TlsOptions {
  readonly serverName?: string;
}
export interface TlsInfo {
  readonly endpointHash: Uint8Array;
}

export interface Transport {
  readonly kind: "tcp" | "tls" | "unix" | "websocket" | "http";
  readonly caps: TransportCaps;
  open(target: Endpoint, signal: AbortSignal): Promise<void>;
  write(chunks: readonly Uint8Array[]): void;
  onData(cb: (buf: Uint8Array, len: number) => void): void;
  /** R8: the sketch has no way to learn that the peer closed or the socket failed. */
  onClose(cb: (err?: Error) => void): void;
  upgradeTls?(opts: TlsOptions): Promise<TlsInfo>;
  close(reason?: Error): void;
}

export type TransportFactory = () => Transport;
