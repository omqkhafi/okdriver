// Protocol trace proxy for FS-14 evidence. Sits between a server under test and Postgres and records,
// per client connection, what the client sends: message types, Parse names, Bind format codes, and how many
// statements it has in flight (Syncs sent minus ReadyForQuery received). It forwards bytes untouched.
//
//   node scripts/pgtrace.ts <listen-port> <pg-port> <out.json>     (Node 24, type stripping)
//
// Writes the summary to <out.json> on SIGTERM/SIGINT. Plaintext connections only (the harness uses no TLS).
import net from 'node:net';
import { writeFileSync } from 'node:fs';

const [listenPort, pgPort, out] = [Number(process.argv[2]), Number(process.argv[3]), process.argv[4]];
if (!listenPort || !pgPort || !out) throw new Error('usage: pgtrace.ts <listen-port> <pg-port> <out.json>');

type Conn = {
  id: number;
  frontend: Record<string, number>;       // message type letter -> count
  parseNames: Record<string, number>;     // statement name ('' = unnamed) -> Parse count
  bindStmts: Record<string, number>;      // statement name -> Bind count
  resultFormats: Record<string, number>;  // "text" | "binary" | "mixed" -> Bind count
  paramFormats: Record<string, number>;   // same, for parameters
  describes: Record<string, number>;      // 'S' / 'P' -> Describe count
  syncs: number;
  ready: number;               // ReadyForQuery seen, the startup one excluded
  maxInflight: number;
  inflightAtSync: Record<number, number>; // statements in flight (this one included) when a Sync is read -> count
  writes: number;                          // TCP chunks from the client that carried at least one Sync
  syncsPerWrite: Record<number, number>;   // Syncs per such chunk
  simpleQueries: number;
};
const conns: Conn[] = [];

function cstr(b: Buffer, off: number): [string, number] {
  const e = b.indexOf(0, off);
  return [b.toString('utf8', off, e), e + 1];
}
const inc = (o: Record<string | number, number>, k: string | number) => { o[k] = (o[k] ?? 0) + 1; };
const fmtClass = (codes: number[], n: number) => {
  if (n === 0) return 'none';
  const all = codes.length === 0 ? [0] : codes;
  return all.every((c) => c === 0) ? 'text' : all.every((c) => c === 1) ? 'binary' : 'mixed';
};

const server = net.createServer((client) => {
  const c: Conn = { id: conns.length + 1, frontend: {}, parseNames: {}, bindStmts: {}, resultFormats: {}, paramFormats: {}, describes: {},
    syncs: 0, ready: -1, maxInflight: 0, inflightAtSync: {}, writes: 0, syncsPerWrite: {}, simpleQueries: 0 };
  conns.push(c);
  const upstream = net.connect(pgPort, '127.0.0.1');
  client.setNoDelay(true); upstream.setNoDelay(true);
  let started = false;           // startup packet seen (no type byte); ssl/cancel requests are not expected
  let fbuf: Buffer = Buffer.alloc(0);
  let bbuf: Buffer = Buffer.alloc(0);

  client.on('data', (chunk) => {
    upstream.write(chunk);
    fbuf = fbuf.length ? Buffer.concat([fbuf, chunk]) : chunk;
    let syncsHere = 0;
    for (;;) {
      if (!started) {
        if (fbuf.length < 4) break;
        const len = fbuf.readInt32BE(0);
        if (fbuf.length < len) break;
        fbuf = fbuf.subarray(len); started = true; continue;
      }
      if (fbuf.length < 5) break;
      const len = fbuf.readInt32BE(1);
      if (fbuf.length < len + 1) break;
      const t = String.fromCharCode(fbuf[0]);
      const body = fbuf.subarray(5, len + 1);
      inc(c.frontend, t);
      if (t === 'P') { const [name] = cstr(body, 0); inc(c.parseNames, name); }
      else if (t === 'B') {
        let [, o] = cstr(body, 0); let stmt: string; [stmt, o] = cstr(body, o);
        inc(c.bindStmts, stmt);
        const nf = body.readInt16BE(o); o += 2; const pf: number[] = [];
        for (let i = 0; i < nf; i++, o += 2) pf.push(body.readInt16BE(o));
        const np = body.readInt16BE(o); o += 2;
        for (let i = 0; i < np; i++) { const l = body.readInt32BE(o); o += 4 + (l > 0 ? l : 0); }
        const nr = body.readInt16BE(o); o += 2; const rf: number[] = [];
        for (let i = 0; i < nr; i++, o += 2) rf.push(body.readInt16BE(o));
        inc(c.paramFormats, fmtClass(pf, np)); inc(c.resultFormats, rf.length === 0 ? 'text' : fmtClass(rf, 1));
      } else if (t === 'D') inc(c.describes, String.fromCharCode(body[0]));
      else if (t === 'Q') { c.simpleQueries++; c.syncs++; syncsHere++; }
      else if (t === 'S') {
        c.syncs++; syncsHere++;
        const inflight = c.syncs - c.ready;
        c.maxInflight = Math.max(c.maxInflight, inflight); inc(c.inflightAtSync, inflight);
      }
      fbuf = fbuf.subarray(len + 1);
    }
    if (syncsHere) { c.writes++; inc(c.syncsPerWrite, syncsHere); }
  });
  upstream.on('data', (chunk) => {
    client.write(chunk);
    bbuf = bbuf.length ? Buffer.concat([bbuf, chunk]) : chunk;
    if (!started) { bbuf = Buffer.alloc(0); return; }
    for (;;) {
      if (bbuf.length < 5) break;
      const t = bbuf[0];
      const len = bbuf.readInt32BE(1);
      if (bbuf.length < len + 1) break;
      if (t === 0x5a) c.ready++; // ReadyForQuery
      bbuf = bbuf.subarray(len + 1);
    }
  });
  const end = () => { client.destroy(); upstream.destroy(); };
  client.on('error', end); upstream.on('error', end); client.on('close', end); upstream.on('close', end);
}).listen(listenPort, '127.0.0.1');

function summary() {
  const used = conns.filter((c) => c.syncs > 0);
  const sum = (f: (c: Conn) => Record<string | number, number>) => {
    const r: Record<string, number> = {};
    for (const c of used) for (const [k, v] of Object.entries(f(c))) r[k] = (r[k] ?? 0) + v;
    return r;
  };
  const parseTotal = Object.values(sum((c) => c.parseNames)).reduce((a, b) => a + b, 0);
  const bindTotal = Object.values(sum((c) => c.bindStmts)).reduce((a, b) => a + b, 0);
  return {
    connections: used.length,
    statements: used.reduce((a, c) => a + c.syncs, 0),
    frontendMessages: sum((c) => c.frontend),
    parseTotal, bindTotal,
    parseUnnamed: sum((c) => c.parseNames)[''] ?? 0,
    distinctParseNamesPerConnection: used.map((c) => Object.keys(c.parseNames).length),
    maxParsesOfOneNameOnOneConnection: Math.max(0, ...used.flatMap((c) => Object.entries(c.parseNames).filter(([n]) => n !== '').map(([, v]) => v))),
    describes: sum((c) => c.describes),
    resultFormats: sum((c) => c.resultFormats),
    paramFormats: sum((c) => c.paramFormats),
    maxInflightPerConnection: used.map((c) => c.maxInflight),
    inflightAtSync: sum((c) => c.inflightAtSync),
    syncsPerClientWrite: sum((c) => c.syncsPerWrite),
    simpleQueries: used.reduce((a, c) => a + c.simpleQueries, 0),
  };
}
const finish = () => { writeFileSync(out, JSON.stringify(summary(), null, 2)); process.exit(0); };
process.on('SIGTERM', finish); process.on('SIGINT', finish);
