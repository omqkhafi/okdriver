export class ServerError extends Error {
  constructor(public errno: number, public sqlState: string, message: string) {
    super(`[${errno}] ${sqlState ? `(${sqlState}) ` : ''}${message}`);
    this.name = 'ServerError';
  }
}
export class ProtocolError extends Error { constructor(m: string) { super(m); this.name = 'ProtocolError'; } }
export class ConnectionClosedError extends Error { constructor(m = 'connection closed') { super(m); this.name = 'ConnectionClosedError'; } }
export class UnsupportedAuthPlugin extends Error { constructor(public plugin: string) { super(`no client implementation of auth plugin ${plugin}`); this.name = 'UnsupportedAuthPlugin'; } }
