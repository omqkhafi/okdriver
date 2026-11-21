// One connection: socket, framing, handshake, authentication loop, commands and responses.
// Family differences arrive only through the FamilyProfile passed in at connect time.
import net from 'node:net';
import tls from 'node:tls';
import { Reader, Writer } from './bytes.ts';
import { CAP, COM, MAX_PACKET, STATUS } from './constants.ts';
import { ConnectionClosedError, ProtocolError, ServerError, UnsupportedAuthPlugin } from './errors.ts';
import { parseGreeting, type Greeting } from './greeting.ts';
import { frame, PacketParser, type Packet } from './packet.ts';
import type { AuthExchange, FamilyProfile, Negotiated } from './profile.ts';
import {
  decodeBinaryRow, decodeTextRow, isTerminator, parseColumn, parseErr, parseOk, parseTerminator,
  type Column, type ErrPacket, type OkPacket, type PrepareOk, type Response, type Rows, type Value,
} from './result.ts';

export type Param = null | boolean | number | bigint | string | Buffer;
export type Chooser = (g: Greeting) => FamilyProfile;
export interface ConnectOptions {
  host: string; port: number; user: string; password: string; database?: string;
  /** Collation id sent in the handshake response. Default 45 (utf8mb4_general_ci). */
  charset?: number;
  multiStatements?: boolean;
  deprecateEof?: boolean;
  tls?: { rejectUnauthorized?: boolean; ca?: string; servername?: string };
  attrs?: Record<string, string>;
  /** Capability bits (standard word) to add or remove, for probes. */
  addCaps?: number; removeCaps?: number;
  /** Extended capability bits to request (family decides which exist). */
  extCaps?: number;
  connectTimeoutMs?: number;
}

export type PendingKind = 'query' | 'execute' | 'prepare' | 'ok' | 'fetch';
/** respSeq: sequence id of the first response packet = the id after the command's last packet (1 unless the command was split). */
interface Pending { kind: PendingKind; stmt?: Statement; respSeq: number }

const BASE_CAPS = CAP.LONG_PASSWORD | CAP.LONG_FLAG | CAP.PROTOCOL_41 | CAP.TRANSACTIONS | CAP.SECURE_CONNECTION |
  CAP.MULTI_RESULTS | CAP.PS_MULTI_RESULTS | CAP.PLUGIN_AUTH | CAP.CONNECT_ATTRS | CAP.PLUGIN_AUTH_LENENC_CLIENT_DATA |
  CAP.SESSION_TRACK | CAP.DEPRECATE_EOF | CAP.CAN_HANDLE_EXPIRED_PASSWORDS;

export class Connection {
  greeting!: Greeting;
  profile!: FamilyProfile;
  neg: Negotiated = { caps: 0, ext: 0 };
  status = 0;
  secure = false;
  bytesIn = 0;
  bytesOut = 0;
  /** Probes can turn the sequence-id check into a counter, to study intermediaries that renumber packets. */
  /** The OK packet that ended authentication (carries session-state tracking data such as a redirect). */
  handshakeOk: OkPacket | null = null;
  strictSeq = true;
  seqMismatches = 0;
  private sock!: net.Socket | tls.TLSSocket;
  private parser = new PacketParser();
  private inbox: Packet[] = [];
  private waiter: { resolve: (p: Packet) => void; reject: (e: Error) => void } | null = null;
  private closedWith: Error | null = null;
  private rseq = 0;
  private wseq = 0;
  private pending: Pending[] = [];

  private constructor(private opts: ConnectOptions) {}

  static async connect(opts: ConnectOptions, choose: Chooser): Promise<Connection> {
    const c = new Connection(opts);
    await c.open();
    try { await c.handshake(choose); } catch (e) { c.sock.destroy(); throw e; }
    return c;
  }

  // ---------------------------------------------------------------- transport
  private attach(sock: net.Socket | tls.TLSSocket): void {
    this.sock = sock;
    sock.on('data', (chunk: Buffer) => {
      this.bytesIn += chunk.length;
      this.parser.push(chunk);
      for (let p = this.parser.next(); p; p = this.parser.next()) {
        if (this.waiter) { const w = this.waiter; this.waiter = null; w.resolve(p); } else this.inbox.push(p);
      }
    });
    const fail = (e: Error) => { this.closedWith ??= e; if (this.waiter) { const w = this.waiter; this.waiter = null; w.reject(e); } };
    sock.on('error', fail);
    sock.on('close', () => fail(new ConnectionClosedError()));
  }

  private open(): Promise<void> {
    return new Promise((resolve, reject) => {
      const s = net.connect({ host: this.opts.host, port: this.opts.port });
      s.setNoDelay(true);
      const t = setTimeout(() => { s.destroy(); reject(new Error('connect timeout')); }, this.opts.connectTimeoutMs ?? 10000);
      s.once('connect', () => { clearTimeout(t); resolve(); });
      s.once('error', (e) => { clearTimeout(t); reject(e); });
      this.attach(s);
    });
  }

  get socket(): net.Socket | tls.TLSSocket { return this.sock; }
  get closed(): boolean { return this.closedWith !== null; }
  pauseReading(): void { this.sock.pause(); }
  resumeReading(): void { this.sock.resume(); }

  /** For probes that read raw packets of a response themselves: the next packet is sequence 1. */
  beginRawResponse(): void { this.rseq = 1; }

  /** Next logical packet; checks the sequence id. */
  async readPacket(): Promise<Packet> {
    let p = this.inbox.shift();
    if (!p) {
      if (this.closedWith) throw this.closedWith;
      p = await new Promise<Packet>((resolve, reject) => { this.waiter = { resolve, reject }; });
    }
    if (p.firstSeq !== this.rseq) { if (this.strictSeq) throw new ProtocolError(`sequence id ${p.firstSeq}, expected ${this.rseq}`); this.seqMismatches++; }
    this.rseq = (p.lastSeq + 1) & 0xff;
    return p;
  }

  /** Write one logical payload with the given first sequence id. Returns the promise of the flush. */
  writeRaw(payload: Buffer, seq: number): Promise<void> {
    if (this.closedWith) return Promise.reject(this.closedWith);
    const { bytes, nextSeq } = frame(payload, seq);
    this.wseq = nextSeq;
    this.bytesOut += bytes.length;
    return new Promise((resolve, reject) => this.sock.write(bytes, (e) => (e ? reject(e) : resolve())));
  }

  // ---------------------------------------------------------------- handshake
  /** Handshake packets alternate on one sequence: write at the next id, then expect the one after it. */
  private async writeHandshake(payload: Buffer): Promise<void> {
    const done = this.writeRaw(payload, this.rseq);
    this.rseq = this.wseq;
    await done;
  }

  private async handshake(choose: Chooser): Promise<void> {
    const first = await this.readPacket();
    if (first.payload[0] === 0xff) { const e = parseErr(first.payload); throw new ServerError(e.errno, e.sqlState, e.message); }
    const g = (this.greeting = parseGreeting(first.payload));
    const profile = (this.profile = choose(g));
    const o = this.opts;
    let caps = (BASE_CAPS | profile.extraCapabilities(g) | (o.addCaps ?? 0)) & ~profile.clearCapabilities(g) & ~(o.removeCaps ?? 0);
    if (o.deprecateEof === false) caps &= ~CAP.DEPRECATE_EOF;
    if (o.database) caps |= CAP.CONNECT_WITH_DB;
    if (o.multiStatements) caps |= CAP.MULTI_STATEMENTS;
    if (o.tls) caps |= CAP.SSL;
    caps = (caps & g.capabilities) >>> 0;
    const ext = (profile.extendedCapabilities(g) | (o.extCaps ?? 0)) >>> 0;
    this.neg = { caps, ext };
    const charset = o.charset ?? 45;
    const filler = Buffer.alloc(23);
    filler.writeUInt32LE(ext, 19);
    const head = new Writer().u32(caps).u32(MAX_PACKET).u8(charset).bytes(filler).toBuffer();
    if (o.tls) {
      if (!(g.capabilities & CAP.SSL)) throw new Error('server does not offer TLS');
      await this.writeHandshake(head);
      await this.upgradeTls();
      this.secure = true;
    }
    const pluginName = profile.authPlugins.has(g.authPluginName) ? g.authPluginName : [...profile.authPlugins.keys()][0]!;
    let exchange: AuthExchange = profile.authPlugins.get(pluginName)!({ user: o.user, password: o.password, secureTransport: this.secure });
    const authResp = exchange.start(g.salt);
    const w = new Writer().bytes(head).nul(o.user).lenencBytes(authResp);
    if (caps & CAP.CONNECT_WITH_DB) w.nul(o.database!);
    w.nul(pluginName);
    if (caps & CAP.CONNECT_ATTRS) {
      const attrs = new Writer();
      const all = { _client_name: 'okdriver-fs07', _client_version: '0', _os: process.platform, _pid: String(process.pid), ...(o.attrs ?? {}) };
      for (const [k, v] of Object.entries(all)) attrs.lenencBytes(Buffer.from(k)).lenencBytes(Buffer.from(v));
      w.lenencBytes(attrs.toBuffer());
    }
    await this.writeHandshake(w.toBuffer());
    // Authentication loop: OK, ERR, auth switch (0xfe) and more-data (0x01).
    for (;;) {
      const p = await this.readPacket();
      const h = p.payload[0];
      if (h === 0x00) { this.handshakeOk = parseOk(p.payload, !!(caps & CAP.SESSION_TRACK)); this.status = this.handshakeOk.status; return; }
      if (h === 0xff) { const e = parseErr(p.payload); throw new ServerError(e.errno, e.sqlState, e.message); }
      if (h === 0xfe) {
        const r = new Reader(p.payload, 1);
        if (r.eof()) throw new UnsupportedAuthPlugin('mysql_old_password (legacy auth switch)');
        const name = r.nulString();
        const factory = profile.authPlugins.get(name);
        if (!factory) throw new UnsupportedAuthPlugin(name);
        exchange = factory({ user: o.user, password: o.password, secureTransport: this.secure });
        await this.writeHandshake(exchange.start(Buffer.from(r.rest())));
      } else if (h === 0x01) {
        const resp = exchange.more(p.payload.subarray(1));
        if (resp) await this.writeHandshake(resp);
      } else throw new ProtocolError(`unexpected packet 0x${h?.toString(16)} during authentication`);
    }
  }

  private async upgradeTls(): Promise<void> {
    const raw = this.sock as net.Socket;
    raw.removeAllListeners('data');
    raw.removeAllListeners('error');
    raw.removeAllListeners('close');
    const t = this.opts.tls!;
    const sec = tls.connect({ socket: raw, rejectUnauthorized: t.rejectUnauthorized ?? true, ca: t.ca, servername: t.servername ?? (net.isIP(this.opts.host) ? undefined : this.opts.host) });
    await new Promise<void>((res, rej) => { sec.once('secureConnect', () => res()); sec.once('error', rej); });
    this.attach(sec);
  }

  get tlsInfo(): { protocol: string | null; cipher: string } | null {
    const s = this.sock as tls.TLSSocket;
    return this.secure ? { protocol: s.getProtocol(), cipher: s.getCipher().name } : null;
  }

  // ---------------------------------------------------------------- commands
  /** Write one command without reading anything. Each command starts a new sequence at 0. */
  send(payload: Buffer, kind: PendingKind | 'none', stmt?: Statement): Promise<void> {
    const done = this.writeRaw(payload, 0);
    if (kind !== 'none') this.pending.push({ kind, stmt, respSeq: this.wseq });
    return done;
  }
  /** Write several commands in ONE socket write, without reading anything (pipelining probes). */
  sendMany(items: { payload: Buffer; kind: PendingKind | 'none'; stmt?: Statement }[]): Promise<void> {
    const frames: Buffer[] = [];
    for (const it of items) {
      const f = frame(it.payload, 0);
      if (it.kind !== 'none') this.pending.push({ kind: it.kind, stmt: it.stmt, respSeq: f.nextSeq });
      frames.push(f.bytes);
    }
    const all = Buffer.concat(frames);
    this.bytesOut += all.length;
    return new Promise((resolve, reject) => this.sock.write(all, (e) => (e ? reject(e) : resolve())));
  }
  get inFlight(): number { return this.pending.length; }

  /** Read the response of the oldest unanswered command. ERR packets come back as values. */
  async receive(): Promise<Response[]> {
    const cmd = this.pending.shift();
    if (!cmd) throw new ProtocolError('receive() with no command in flight');
    this.rseq = cmd.respSeq;
    switch (cmd.kind) {
      case 'ok': {
        const p = await this.readPacket();
        if (p.payload[0] === 0xff) return [parseErr(p.payload)];
        const ok = parseOk(p.payload, !!(this.neg.caps & CAP.SESSION_TRACK));
        this.status = ok.status;
        return [ok];
      }
      case 'prepare': return [await this.readPrepareOk()];
      case 'query': return this.readResultSets(false);
      case 'execute': return this.readResultSets(true, cmd.stmt?.columns);
      case 'fetch': return this.readResultSets(true, cmd.stmt?.columns, true);
    }
  }

  private async readPrepareOk(): Promise<PrepareOk | ErrPacket> {
    const p = await this.readPacket();
    if (p.payload[0] === 0xff) return parseErr(p.payload);
    const r = new Reader(p.payload, 1);
    const id = r.u32(), ncols = r.u16(), nparams = r.u16();
    r.skip(1);
    const warnings = r.u16();
    const tail = this.profile.prepareOkTail(r, this.neg);
    const skip = this.profile.prepareMetadataSkipped(tail, this.neg);
    const params = skip ? [] : await this.readColumns(nparams), columns = skip ? [] : await this.readColumns(ncols);
    return { kind: 'prepare', id, params, columns, warnings, tail };
  }

  private get deprecateEof(): boolean { return !!(this.neg.caps & CAP.DEPRECATE_EOF); }

  private async readColumns(n: number): Promise<Column[]> {
    const cols: Column[] = [];
    for (let i = 0; i < n; i++) cols.push(parseColumn((await this.readPacket()).payload, (r) => this.profile.columnExtra(r, this.neg)));
    if (n > 0 && !this.deprecateEof) await this.readPacket(); // EOF after the definitions
    return cols;
  }

  private async readResultSets(binary: boolean, cached?: Column[], fetchOnly = false): Promise<Response[]> {
    const out: Response[] = [];
    const sessionTrack = !!(this.neg.caps & CAP.SESSION_TRACK);
    for (;;) {
      let columns: Column[] | undefined;
      let skipped = false;
      if (fetchOnly) columns = cached;
      else {
        const first = await this.readPacket();
        const h = first.payload[0];
        if (h === 0xff) { out.push(parseErr(first.payload)); return out; }
        if (h === 0xfb) throw new ProtocolError('server requested a local file (LOCAL INFILE is not enabled by this client)');
        if (h === 0x00) {
          const ok = parseOk(first.payload, sessionTrack);
          this.status = ok.status;
          out.push(ok);
          if (ok.status & STATUS.MORE_RESULTS_EXISTS) continue;
          return out;
        }
        const r = new Reader(first.payload);
        const ncols = r.lenenc()!;
        skipped = this.profile.resultsetHeaderTail(r, this.neg);
        if (skipped) {
          if (!cached) throw new ProtocolError('metadata skipped but no cached column definitions');
          columns = cached;
        } else columns = await this.readColumns(ncols);
      }
      const rows: Value[][] = [];
      for (;;) {
        const p = await this.readPacket();
        const pl = p.payload;
        if (pl[0] === 0xff) { out.push(parseErr(pl)); return out; }
        if (isTerminator(pl)) {
          const t = parseTerminator(pl, this.deprecateEof, sessionTrack);
          this.status = t.status;
          out.push({ kind: 'rows', columns: columns!, rows, status: t.status, warnings: t.warnings, metadataSkipped: skipped } satisfies Rows);
          if (t.status & STATUS.MORE_RESULTS_EXISTS) break;
          return out;
        }
        rows.push(binary ? decodeBinaryRow(columns!, pl) : decodeTextRow(columns!, pl));
      }
    }
  }

  // ---------------------------------------------------------------- high level
  private static first(res: Response[]): Response {
    const e = res.find((x): x is ErrPacket => x.kind === 'err');
    if (e) throw new ServerError(e.errno, e.sqlState, e.message);
    return res[0]!;
  }

  async queryAll(sql: string): Promise<Response[]> {
    await this.send(Buffer.concat([Buffer.from([COM.QUERY]), Buffer.from(sql, 'utf8')]), 'query');
    return this.receive();
  }
  /** Text protocol query; throws ServerError on ERR. Returns the first result (Rows or OK). */
  async query(sql: string): Promise<Rows | OkPacket> {
    const r = Connection.first(await this.queryAll(sql));
    return r as Rows | OkPacket;
  }
  async rows(sql: string): Promise<Value[][]> {
    const r = await this.query(sql);
    if (r.kind !== 'rows') throw new ProtocolError('statement returned no result set');
    return r.rows;
  }

  async prepare(sql: string): Promise<Statement> {
    await this.send(Buffer.concat([Buffer.from([COM.STMT_PREPARE]), Buffer.from(sql, 'utf8')]), 'prepare');
    const r = Connection.first(await this.receive()) as PrepareOk;
    return new Statement(this, r);
  }

  async ping(): Promise<OkPacket> {
    await this.send(Buffer.from([COM.PING]), 'ok');
    return Connection.first(await this.receive()) as OkPacket;
  }
  async resetConnection(): Promise<OkPacket> {
    await this.send(Buffer.from([COM.RESET_CONNECTION]), 'ok');
    return Connection.first(await this.receive()) as OkPacket;
  }
  async close(): Promise<void> {
    try { await this.send(Buffer.from([COM.QUIT]), 'none'); } catch { /* already closed */ }
    this.sock.end();
    await new Promise<void>((r) => { if (this.sock.destroyed) r(); else this.sock.once('close', () => r()); });
  }
  destroy(): void { this.sock.destroy(); }
}

// ------------------------------------------------------------------ prepared statements
export function encodeExecute(id: number, params: Param[], flags = 0): Buffer {
  const w = new Writer().u8(COM.STMT_EXECUTE).u32(id).u8(flags).u32(1);
  if (params.length) {
    const bitmap = Buffer.alloc((params.length + 7) >> 3);
    const types = new Writer(), values = new Writer();
    params.forEach((v, i) => {
      if (v === null) { bitmap[i >> 3]! |= 1 << (i & 7); types.u8(6).u8(0); return; }
      switch (typeof v) {
        case 'boolean': types.u8(1).u8(0); values.u8(v ? 1 : 0); break;
        case 'number':
          if (Number.isInteger(v) && Number.isSafeInteger(v)) { types.u8(8).u8(0); values.u64(BigInt(v)); }
          else { types.u8(5).u8(0); const b = Buffer.alloc(8); b.writeDoubleLE(v); values.bytes(b); }
          break;
        case 'bigint': types.u8(8).u8(v >= 2n ** 63n ? 0x80 : 0); values.u64(v); break;
        case 'string': types.u8(253).u8(0); values.lenencBytes(Buffer.from(v, 'utf8')); break;
        default: types.u8(252).u8(0); values.lenencBytes(v);
      }
    });
    w.bytes(bitmap).u8(1).bytes(types.toBuffer()).bytes(values.toBuffer());
  }
  return w.toBuffer();
}

export class Statement {
  readonly id: number; readonly params: Column[]; readonly columns: Column[]; readonly tail: Buffer;
  constructor(readonly conn: Connection, ok: PrepareOk) { this.id = ok.id; this.params = ok.params; this.columns = ok.columns; this.tail = ok.tail; }

  /** Write COM_STMT_EXECUTE without reading the response. */
  sendExecute(params: Param[], flags = 0): Promise<void> { return this.conn.send(encodeExecute(this.id, params, flags), 'execute', this); }

  async executeAll(params: Param[], cursor = false): Promise<Response[]> {
    await this.sendExecute(params, cursor ? 1 : 0);
    return this.conn.receive();
  }
  async execute(params: Param[] = []): Promise<Rows | OkPacket> {
    const res = await this.executeAll(params);
    const e = res.find((x): x is ErrPacket => x.kind === 'err');
    if (e) throw new ServerError(e.errno, e.sqlState, e.message);
    return res[0] as Rows | OkPacket;
  }
  /** Open a read-only cursor; rows come with fetch(). */
  async openCursor(params: Param[] = []): Promise<Rows | OkPacket> {
    const res = await this.executeAll(params, true);
    const e = res.find((x): x is ErrPacket => x.kind === 'err');
    if (e) throw new ServerError(e.errno, e.sqlState, e.message);
    return res[0] as Rows | OkPacket;
  }
  async fetch(n: number): Promise<Response[]> {
    await this.conn.send(new Writer().u8(COM.STMT_FETCH).u32(this.id).u32(n).toBuffer(), 'fetch', this);
    return this.conn.receive();
  }
  async reset(): Promise<OkPacket> {
    await this.conn.send(new Writer().u8(COM.STMT_RESET).u32(this.id).toBuffer(), 'ok');
    const r = (await this.conn.receive())[0]!;
    if (r.kind === 'err') throw new ServerError(r.errno, r.sqlState, r.message);
    return r as OkPacket;
  }
  /** COM_STMT_CLOSE has no response. */
  close(): Promise<void> { return this.conn.send(new Writer().u8(COM.STMT_CLOSE).u32(this.id).toBuffer(), 'none'); }
  /** COM_STMT_SEND_LONG_DATA: no response. */
  sendLongData(paramIndex: number, data: Buffer): Promise<void> {
    return this.conn.send(new Writer().u8(COM.STMT_SEND_LONG_DATA).u32(this.id).u16(paramIndex).bytes(data).toBuffer(), 'none');
  }
}
