// A bare Node raw-socket client used only to measure the servers' own ceilings (never a candidate). Usage: node rawclient.ts <json>
import net from 'node:net';
const a = JSON.parse(process.argv[2]!) as { mode: 'pipeline' | 'drain' | 'push'; port: number; seconds?: number; sql?: string; bytes?: number; depth?: number };
const be32 = (v: number): Buffer => { const b = Buffer.allocUnsafe(4); b.writeInt32BE(v); return b; };
const msg = (t: string, body: Buffer): Buffer => Buffer.concat([Buffer.from(t), be32(body.length + 4), body]);
const cs = (s: string): Buffer => Buffer.from(s + '\0');
const startup = (): Buffer => { const body = Buffer.concat([be32(196608), cs('user'), cs('x'), cs('database'), cs('x'), Buffer.from([0])]); return Buffer.concat([be32(body.length + 4), body]); };
const stmt = (sql: string): Buffer => Buffer.concat([msg('P', Buffer.concat([cs(''), cs(sql), Buffer.alloc(2)])), msg('B', Buffer.concat([cs(''), cs(''), Buffer.alloc(6)])), msg('D', Buffer.concat([Buffer.from('P'), cs('')])), msg('E', Buffer.concat([cs(''), be32(0)])), msg('S', Buffer.alloc(0))]);
const s = net.connect({ host: '127.0.0.1', port: a.port, noDelay: true });
let pushing = false, pumpCopy: () => void = () => {};
let ready = false, buf = Buffer.alloc(0), zs = 0, bytes = 0, t0 = 0;
const finish = (extra: Record<string, number>): void => { console.log(JSON.stringify({ seconds: (performance.now() - t0) / 1000, ...extra })); process.exit(0); };
s.on('connect', () => s.write(startup()));
s.on('data', (d: Buffer) => {
  if (!ready) {
    buf = Buffer.concat([buf, d]);
    // wait for ReadyForQuery: the login reply ends with Z (6 bytes: 'Z' 0 0 0 5 'I')
    if (buf.length >= 6 && buf[buf.length - 6] === 0x5a) { ready = true; buf = Buffer.alloc(0); t0 = performance.now(); go(); }
    return;
  }
  if (a.mode === 'drain') { bytes += d.length; if (bytes >= (a.bytes ?? 0)) finish({ bytes }); return; }
  if (a.mode === 'pipeline') {
    // count ReadyForQuery by scanning for the fixed 6-byte tail of each reply (reply ends 'Z\0\0\0\5I')
    buf = Buffer.concat([buf, d]);
    let i = 0;
    for (; ;) { const j = buf.indexOf(Buffer.from([0x5a, 0, 0, 0, 5, 0x49]), i); if (j < 0) break; zs++; i = j + 6; }
    buf = buf.subarray(Math.max(i, buf.length - 5));
    if (performance.now() - t0 > (a.seconds ?? 2) * 1000) finish({ statements: zs });
    else inflight();
  }
  if (a.mode === 'push') {
    buf = Buffer.concat([buf, d]);
    if (!pushing && buf.includes(Buffer.from('G'))) { pushing = true; t0 = performance.now(); pumpCopy(); }
    if (buf.includes(Buffer.from('COPY 1'))) finish({ bytes: a.bytes ?? 0 });
  }
});
let sent = 0;
const one = stmt(a.sql ?? 'SELECT 1');
const inflight = (): void => { while (sent - zs < (a.depth ?? 200)) { s.write(one); sent++; } };
function go(): void {
  if (a.mode === 'pipeline') inflight();
  else if (a.mode === 'drain') { s.write(stmt(a.sql!)); t0 = performance.now(); }
  else if (a.mode === 'push') {
    s.write(msg('Q', cs('COPY x FROM STDIN -- fs03 rate=0')));
    const frame = msg('d', Buffer.alloc(65531, 1)); const block = Buffer.concat(Array.from({ length: 16 }, () => frame));
    let left = a.bytes ?? 0;
    pumpCopy = (): void => { while (left > 0) { left -= block.length; if (!s.write(block)) { s.once('drain', pumpCopy); return; } } s.write(msg('c', Buffer.alloc(0))); };
  }
}
