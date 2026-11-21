// Byte-forwarding packet-trace proxy for the MySQL-family protocol, with its own small parser.
// Written from the protocol documentation. It imports nothing from ../wire: the prototype's parser is
// not allowed to be the only reader of the bytes (AGENTS.md, independent evidence).
//
// The proxy forwards every byte unchanged and in both directions at once. Parsing never alters or
// delays traffic. After an SSLRequest the stream is opaque and only byte counts are kept.
import net from 'node:net';

const CMD: Record<number, string> = {
  1: 'COM_QUIT', 2: 'COM_INIT_DB', 3: 'COM_QUERY', 14: 'COM_PING', 22: 'COM_STMT_PREPARE', 23: 'COM_STMT_EXECUTE',
  24: 'COM_STMT_SEND_LONG_DATA', 25: 'COM_STMT_CLOSE', 26: 'COM_STMT_RESET', 28: 'COM_STMT_FETCH', 31: 'COM_RESET_CONNECTION',
  0xfa: 'COM_STMT_BULK_EXECUTE', 0x1b: 'COM_SET_OPTION',
};
const NO_RESPONSE = new Set([1, 24, 25]);
const OK_ONLY = new Set([2, 14, 26, 31, 0x1b]);

export interface RawPkt { t: number; dir: 'c2s' | 's2c'; seq: number; len: number; hex: string; chunk: number }
export interface Step {
  idx: number; phase: 'greeting' | 'auth' | 'cmd'; label: string; sql?: string;
  c2s: { seq: number; hex: string; chunk: number }[];
  s2c: { seq: number; kind: string; hex: string; chunk: number }[];
  outcome?: string; errno?: number; ncols?: number; nrows?: number; stmtId?: number;
}
export interface ConnTrace {
  id: number; clientCaps?: number; serverCaps?: number; serverExt?: number; clientExt?: number; tls: boolean; deprecateEof: boolean;
  version?: string; plugin?: string; charset?: number; steps: Step[]; raw: RawPkt[]; bytesC2S: number; bytesS2C: number;
  /** For each client chunk written by the client: how many packets it carried (write coalescing as seen by the proxy). */
  c2sChunkPackets: number[];
}

function u16(b: Buffer, o: number) { return b.readUInt16LE(o); }
function u32(b: Buffer, o: number) { return b.readUInt32LE(o); }
function lenenc(b: Buffer, o: number): [number, number] {
  const f = b[o]!;
  if (f < 0xfb) return [f, o + 1];
  if (f === 0xfc) return [u16(b, o + 1), o + 3];
  if (f === 0xfd) return [b.readUIntLE(o + 1, 3), o + 4];
  if (f === 0xfe) return [Number(b.readBigUInt64LE(o + 1)), o + 9];
  return [-1, o + 1];
}
function cstr(b: Buffer, o: number): [string, number] {
  let e = b.indexOf(0, o); if (e < 0) e = b.length;
  return [b.toString('utf8', o, e), e + 1];
}

class Splitter {
  private buf: Buffer = Buffer.alloc(0);
  private frags: Buffer[] = [];
  private firstSeq = 0;
  constructor(private onPacket: (seq: number, payload: Buffer, chunk: number) => void) {}
  chunkNo = 0;
  feed(c: Buffer, chunk: number) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, c]) : c;
    for (;;) {
      if (this.buf.length < 4) return;
      const len = this.buf.readUIntLE(0, 3);
      if (this.buf.length < 4 + len) return;
      const seq = this.buf[3]!;
      const body = this.buf.subarray(4, 4 + len);
      this.buf = this.buf.subarray(4 + len);
      if (this.frags.length === 0) this.firstSeq = seq;
      this.frags.push(body);
      if (len === 0xffffff) continue;
      const payload = this.frags.length === 1 ? this.frags[0]! : Buffer.concat(this.frags);
      this.frags = [];
      this.onPacket(this.firstSeq, payload, chunk);
    }
  }
}

const HEX_LIMIT = 8192;
const hex = (b: Buffer) => b.subarray(0, HEX_LIMIT).toString('hex') + (b.length > HEX_LIMIT ? `…(+${b.length - HEX_LIMIT}B)` : '');

class ConnParser {
  t: ConnTrace;
  private t0 = process.hrtime.bigint();
  private phase: 'greeting' | 'auth' | 'cmd' | 'opaque' = 'greeting';
  private cmdQueue: { code: number; step: Step }[] = [];
  private cur: { code: number; step: Step; stage: string; left: number; rows: number; ncols: number; psParams?: number; psCols?: number } | null = null;
  private authStep: Step;
  private c = new Splitter((s, p, ch) => this.onClient(s, p, ch));
  private s = new Splitter((s, p, ch) => this.onServer(s, p, ch));
  private nChunkC = 0; private nChunkS = 0;
  private curChunkPkts = 0;
  constructor(id: number) {
    this.t = { id, tls: false, deprecateEof: false, steps: [], raw: [], bytesC2S: 0, bytesS2C: 0, c2sChunkPackets: [] };
    this.authStep = { idx: 0, phase: 'greeting', label: 'greeting+auth', c2s: [], s2c: [] };
    this.t.steps.push(this.authStep);
  }
  feedClient(c: Buffer) { this.t.bytesC2S += c.length; this.nChunkC++; this.curChunkPkts = 0; if (this.phase !== 'opaque') this.c.feed(c, this.nChunkC); if (this.curChunkPkts) this.t.c2sChunkPackets.push(this.curChunkPkts); }
  feedServer(c: Buffer) { this.t.bytesS2C += c.length; this.nChunkS++; if (this.phase !== 'opaque') this.s.feed(c, this.nChunkS); }
  private now() { return Number(process.hrtime.bigint() - this.t0) / 1e6; }
  private raw(dir: 'c2s' | 's2c', seq: number, p: Buffer, chunk: number) { this.t.raw.push({ t: +this.now().toFixed(3), dir, seq, len: p.length, hex: hex(p), chunk }); }

  private onServer(seq: number, p: Buffer, chunk: number) {
    this.raw('s2c', seq, p, chunk);
    if (this.phase === 'greeting') {
      // protocol 10: version NUL, conn id 4, scramble 8, filler 1, caps lo 2, charset 1, status 2, caps hi 2, auth len 1, reserved 10, ...
      if (p[0] === 0xff) { this.authStep.s2c.push({ seq, kind: 'ERR', hex: hex(p), chunk }); this.authStep.outcome = 'err'; return; }
      const [ver, o] = cstr(p, 1);
      // layout after the version NUL (offset o): id 4, scramble 8, filler 1, caps lo 2 (o+13), charset 1 (o+15), status 2, caps hi 2 (o+18), auth len 1, reserved 10 (o+21)
      const caps = u16(p, o + 13) | (u16(p, o + 18) << 16);
      this.t.version = ver; this.t.serverCaps = caps >>> 0; this.t.charset = p[o + 15];
      this.t.serverExt = p.readUInt32LE(o + 21 + 6); // last four of the ten reserved bytes
      this.authStep.s2c.push({ seq, kind: 'GREETING', hex: hex(p), chunk });
      this.phase = 'auth';
      return;
    }
    if (this.phase === 'auth') {
      const h = p[0]!;
      const kind = h === 0x00 ? 'OK' : h === 0xff ? 'ERR' : h === 0xfe ? 'AUTH_SWITCH' : h === 0x01 ? 'AUTH_MORE' : '?';
      this.authStep.s2c.push({ seq, kind, hex: hex(p), chunk });
      if (h === 0x00) { this.phase = 'cmd'; this.authStep.outcome = 'ok'; }
      else if (h === 0xff) { this.authStep.outcome = 'err'; this.authStep.errno = u16(p, 1); }
      if (h === 0xfe && p.length > 1) this.t.plugin = cstr(p, 1)[0];
      return;
    }
    if (this.phase === 'cmd') this.serverCmd(seq, p, chunk);
  }

  private onClient(seq: number, p: Buffer, chunk: number) {
    this.curChunkPkts++;
    this.raw('c2s', seq, p, chunk);
    if (this.phase === 'greeting') return;
    if (this.phase === 'auth') {
      if (seq === 1 && p.length >= 32) {
        const caps = u32(p, 0);
        this.t.clientCaps = caps; this.t.clientExt = p.readUInt32LE(28);
        this.t.deprecateEof = !!(caps & (1 << 24)) && !!((this.t.serverCaps ?? 0) & (1 << 24));
        this.authStep.c2s.push({ seq, hex: hex(p), chunk });
        if (p.length === 32 && caps & (1 << 11)) { this.t.tls = true; this.phase = 'opaque'; this.authStep.outcome = 'tls'; }
        return;
      }
      this.authStep.c2s.push({ seq, hex: hex(p), chunk });
      return;
    }
    // command phase: every client packet with seq 0 starts a command
    const code = p[0]!;
    const step: Step = { idx: this.t.steps.length, phase: 'cmd', label: CMD[code] ?? `COM_0x${code.toString(16)}`, c2s: [{ seq, hex: hex(p), chunk }], s2c: [] };
    if (code === 3 || code === 22) step.sql = p.toString('utf8', 1, Math.min(p.length, 400));
    if (code === 23 || code === 25 || code === 26 || code === 28) step.stmtId = u32(p, 1);
    this.t.steps.push(step);
    if (NO_RESPONSE.has(code)) { step.outcome = 'none'; return; }
    this.cmdQueue.push({ code, step });
  }

  private serverCmd(seq: number, p: Buffer, chunk: number) {
    if (!this.cur) {
      const q = this.cmdQueue.shift();
      if (!q) return; // unsolicited packet
      this.cur = { ...q, stage: 'header', left: 0, rows: 0, ncols: 0 };
    }
    const c = this.cur, step = c.step, h = p[0]!, code = c.code;
    const push = (kind: string) => step.s2c.push({ seq, kind, hex: hex(p), chunk });
    const finish = (outcome: string) => { step.outcome = outcome; this.cur = null; };
    if (c.stage === 'header') {
      if (h === 0xff) { push('ERR'); step.errno = u16(p, 1); return finish('err'); }
      if (OK_ONLY.has(code)) { push('OK'); return finish('ok'); }
      if (code === 22) { // COM_STMT_PREPARE_OK
        push('PREPARE_OK'); step.stmtId = u32(p, 1);
        c.psCols = u16(p, 5); c.psParams = u16(p, 7);
        c.left = c.psParams; c.stage = c.psParams ? 'ps_params' : c.psCols ? 'ps_cols' : 'done';
        if (c.stage === 'done') return finish('prepare-ok');
        return;
      }
      if (h === 0x00) { push('OK'); const [, o1] = lenenc(p, 1); const [, o2] = lenenc(p, o1); const st = u16(p, o2); if (st & 8) return; return finish('ok'); }
      if (h === 0xfb) { push('LOCAL_INFILE_REQUEST'); return finish('local-infile'); }
      const [n, after] = lenenc(p, 0);
      // MariaDB MARIADB_CLIENT_CACHE_METADATA (ext bit 16), when both sides agreed: one flag byte follows the
      // column count; 0 means the column definitions are not sent for this result.
      const cacheMeta = ((this.t.clientExt ?? 0) & (this.t.serverExt ?? 0) & 16) !== 0;
      const skipped = cacheMeta && p[after] === 0;
      push(`COLCOUNT=${n}${cacheMeta ? (skipped ? ' METADATA_SKIPPED' : ' METADATA_FOLLOWS') : ''}`); c.ncols = n; step.ncols = n; c.left = n;
      c.stage = skipped ? 'rows' : 'cols';
      return;
    }
    if (c.stage === 'ps_params' || c.stage === 'ps_cols' || c.stage === 'cols') {
      push(c.stage === 'ps_params' ? 'PARAM_DEF' : 'COL_DEF');
      if (--c.left > 0) return;
      if (c.stage === 'ps_params') { c.stage = this.t.deprecateEof ? (c.psCols ? 'ps_cols' : 'done') : 'ps_params_eof'; if (c.stage === 'ps_cols') c.left = c.psCols!; if (c.stage === 'done') return finish('prepare-ok'); return; }
      if (c.stage === 'ps_cols') { if (this.t.deprecateEof) return finish('prepare-ok'); c.stage = 'ps_cols_eof'; return; }
      c.stage = this.t.deprecateEof ? 'rows' : 'cols_eof';
      return;
    }
    if (c.stage === 'ps_params_eof') { push('EOF'); if (c.psCols) { c.stage = 'ps_cols'; c.left = c.psCols; return; } return finish('prepare-ok'); }
    if (c.stage === 'ps_cols_eof') { push('EOF'); return finish('prepare-ok'); }
    if (c.stage === 'cols_eof') { push('EOF'); c.stage = 'rows'; return; }
    if (c.stage === 'rows') {
      if (h === 0xff) { push('ERR'); step.errno = u16(p, 1); step.nrows = c.rows; return finish('err-after-rows'); }
      if (h === 0xfe && p.length < 0xffffff) {
        push(this.t.deprecateEof ? 'OK_EOF' : 'EOF');
        step.nrows = c.rows;
        let status: number;
        if (this.t.deprecateEof) { const [, o1] = lenenc(p, 1); const [, o2] = lenenc(p, o1); status = u16(p, o2); } else status = u16(p, 3);
        if (status & 8) { c.stage = 'header'; c.rows = 0; return; }
        return finish('resultset');
      }
      c.rows++;
      if (c.rows <= 3) push('ROW'); else if (c.rows === 4) push('ROW…');
    }
  }
}

export interface Proxy { port: number; conns: ConnParser[]; traces(): ConnTrace[]; close(): Promise<void> }

export async function startProxy(target: { host: string; port: number }, listenPort = 0): Promise<Proxy> {
  const conns: ConnParser[] = [];
  const socks = new Set<net.Socket>();
  const server = net.createServer((down) => {
    const parser = new ConnParser(conns.length + 1);
    conns.push(parser);
    const up = net.connect(target.port, target.host);
    socks.add(down); socks.add(up);
    down.setNoDelay(true); up.setNoDelay(true);
    // Forward with backpressure in both directions, so the proxy never hides a stall by buffering for the client.
    const fwd = (from: net.Socket, to: net.Socket, feed: (d: Buffer) => void) => from.on('data', (d: Buffer) => {
      if (!to.write(d)) { from.pause(); to.once('drain', () => from.resume()); }
      feed(d);
    });
    fwd(down, up, (d) => parser.feedClient(d));
    fwd(up, down, (d) => parser.feedServer(d));
    const end = () => { down.destroy(); up.destroy(); socks.delete(down); socks.delete(up); };
    down.on('close', end); up.on('close', end); down.on('error', end); up.on('error', end);
  });
  await new Promise<void>((r) => server.listen(listenPort, '127.0.0.1', () => r()));
  return {
    port: (server.address() as net.AddressInfo).port,
    conns,
    traces: () => conns.map((c) => c.t),
    close: () => new Promise<void>((r) => { for (const s of socks) s.destroy(); server.close(() => r()); }),
  };
}

if (import.meta.main) {
  const [listen, host, port] = process.argv.slice(2);
  if (!listen || !host || !port) { console.error('usage: bun mytrace.ts <listenPort> <host> <port>  (writes JSON traces on SIGINT)'); process.exit(2); }
  const p = await startProxy({ host, port: Number(port) }, Number(listen));
  console.error(`mytrace listening on ${p.port} -> ${host}:${port}`);
  process.on('SIGINT', async () => { console.log(JSON.stringify(p.traces())); await p.close(); process.exit(0); });
}
