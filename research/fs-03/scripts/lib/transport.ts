// The contract between the shared core/driver and one socket API. One small adapter per API implements it.
// Contract: onData chunks are valid only during the call (the core copies what it keeps); onClose fires exactly once and nothing
// is delivered after it; write() returning false means "stop until onDrain".
export interface TransportHandlers {
  onData(chunk: Uint8Array): void;
  onDrain(): void;
  /** the peer sent FIN */
  onEnd(): void;
  /** terminal event, once; err is set when the connection ended with an error */
  onClose(err?: Error): void;
}
export interface TlsOptions { servername: string; ca?: string; rejectUnauthorized?: boolean; alpn?: string[] }
export interface RawStats { dataCalls: number; bytes: number; errorEvents: number; closeEvents: number; endEvents: number; drainEvents: number; dataAfterClose: number }
export interface Transport {
  readonly name: string;
  readonly stats: RawStats;
  /** direct TLS when `tls` is given */
  connect(host: string, port: number, h: TransportHandlers, tls?: TlsOptions): Promise<void>;
  write(data: Uint8Array): boolean;
  pause(): void;
  resume(): void;
  /** TLS handshake on the open socket, after SSLRequest was answered S and nothing else is in flight */
  upgradeTLS(o: TlsOptions): Promise<void>;
  /** half-close: send FIN, keep reading */
  endWrite(): void;
  destroy(): void;
  setNoDelay(on: boolean): void;
  setKeepAlive(on: boolean, initialDelayMs: number): void;
  /** DER bytes of the server certificate, TLS only */
  peerCertificate(): Uint8Array | null;
  alpnProtocol(): string | null;
}
export const newStats = (): RawStats => ({ dataCalls: 0, bytes: 0, errorEvents: 0, closeEvents: 0, endEvents: 0, drainEvents: 0, dataAfterClose: 0 });
