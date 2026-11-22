// SCRAM-SHA-256 client side (RFC 5802 / RFC 7677) with node:crypto. No channel binding ("n,,").
import { createHash, createHmac, pbkdf2Sync, randomBytes, timingSafeEqual } from 'node:crypto';

const hmac = (k: Buffer, d: string | Buffer) => createHmac('sha256', k).update(d).digest();
const sha256 = (d: Buffer) => createHash('sha256').update(d).digest();

export class ScramClient {
  private nonce = randomBytes(18).toString('base64');
  private clientFirstBare = '';
  private serverSignature: Buffer | null = null;
  constructor(private user: string, private password: string) {}

  first(): string {
    // PostgreSQL ignores the username in the SCRAM message when the startup message already carries it.
    this.clientFirstBare = `n=,r=${this.nonce}`;
    return `n,,${this.clientFirstBare}`;
  }

  final(serverFirst: string): string {
    const a = Object.fromEntries(serverFirst.split(',').map((p) => [p[0]!, p.slice(2)]));
    const r = a.r!, s = Buffer.from(a.s!, 'base64'), i = parseInt(a.i!, 10);
    if (!r.startsWith(this.nonce)) throw new Error('SCRAM: server nonce does not extend client nonce');
    const salted = pbkdf2Sync(this.password, s, i, 32, 'sha256');
    const clientKey = hmac(salted, 'Client Key');
    const storedKey = sha256(clientKey);
    const withoutProof = `c=biws,r=${r}`;
    const authMessage = `${this.clientFirstBare},${serverFirst},${withoutProof}`;
    const sig = hmac(storedKey, authMessage);
    const proof = Buffer.from(clientKey.map((b, idx) => b ^ sig[idx]!));
    this.serverSignature = hmac(hmac(salted, 'Server Key'), authMessage);
    return `${withoutProof},p=${proof.toString('base64')}`;
  }

  verify(serverFinal: string): void {
    const v = serverFinal.split(',').find((p) => p.startsWith('v='));
    if (!v || !this.serverSignature) throw new Error('SCRAM: no server signature');
    const got = Buffer.from(v.slice(2), 'base64');
    if (got.length !== this.serverSignature.length || !timingSafeEqual(got, this.serverSignature)) throw new Error('SCRAM: server signature mismatch');
  }
}
