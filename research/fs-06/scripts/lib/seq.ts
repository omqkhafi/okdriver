// The FS-06 message sequences (S1..S7) as byte builders, result checkers and a runner that joins the client's
// own view with the two proxies' traces.
import { PgConn, nowMs, type Collected, type Timed } from './client.ts';
import { RecordingProxy, roundTrips, type MsgRec } from './proxy.ts';
import { parse, bind, describe, execute, sync, flushMsg, query, u8, decodeError, decodeDataRow, type PgError } from './wire.ts';

export const ONE_WAY_DELAY_MS = 20;
export const DEADLINE_MS = 10000;
/** Hosted targets have no injected delay: elapsed time is divided by the measured round trip of `select 1` instead of 40 ms. */
export let baselineRttMs = 40;
export const setBaselineRtt = (ms: number) => { baselineRttMs = ms; };

/** Statement used by every sequence. The server decides parameter types (ADR 015): Parse sends no OIDs. */
export const sql = (tag: string) => `SELECT $1::int AS n, pg_backend_pid() AS pid, '${tag}'::text AS tag`;

export interface Step { bytes: Uint8Array; syncs: number }
export interface SeqDef {
  id: string;
  title: string;
  /** Builds the steps for one run. `names` makes statement names unique per run and client. */
  build(x: { run: string; client: number; n: number }): Step[];
  /** Expected backend message types per ReadyForQuery-terminated step, e.g. ['1 2 T D C Z']. Each Z closes a group. */
  expect: string[];
  /** For a step ending in Flush (no ReadyForQuery): how many backend messages to read before the next step. */
  flushWant?: number;
  /** Other clients run between the steps, so a transaction pooler may hand the next step a different server connection. */
  gap?: boolean;
  /** Rows (text) expected over the whole sequence, as [n, tag]. */
  rows: [number, string][];
}

const U = (run: string, client: number, what: string) => `fs06_${run}_c${client}_${what}`;

const one = (t: string, n: number): Uint8Array => u8(parse('', sql(t)), bind('', '', [String(n)]), describe('P', ''), execute('', 0), sync());

export const SEQUENCES: SeqDef[] = [
  { id: 'S1', title: 'unnamed: Parse, Bind, Describe(portal), Execute, Sync', expect: ['1 2 T D C Z'], rows: [[1, 's1']],
    build: () => [{ bytes: one('s1', 1), syncs: 1 }] },
  { id: 'S2', title: 'named first use: Parse(name), Bind, Describe(portal), Execute, Sync', expect: ['1 2 T D C Z'], rows: [[2, 's2']],
    build: ({ run, client }) => { const nm = U(run, client, 's2'); return [{ bytes: u8(parse(nm, sql('s2')), bind('', nm, ['2']), describe('P', ''), execute('', 0), sync()), syncs: 1 }]; } },
  { id: 'S2b', title: 'named later use: Bind, Describe(portal), Execute, Sync, no Parse (after S2 and other clients)', expect: ['2 T D C Z'], rows: [[3, 's2']],
    build: ({ run, client }) => { const nm = U(run, client, 's2'); return [{ bytes: u8(bind('', nm, ['3']), describe('P', ''), execute('', 0), sync()), syncs: 1 }]; } },
  { id: 'S3', title: 'fallback, named: Parse, Describe(statement), Sync; then Bind, Execute, Sync', expect: ['1 t T Z', '2 D C Z'], rows: [[4, 's3']],
    build: ({ run, client }) => { const nm = U(run, client, 's3'); return [
      { bytes: u8(parse(nm, sql('s3')), describe('S', nm), sync()), syncs: 1 },
      { bytes: u8(bind('', nm, ['4']), execute('', 0), sync()), syncs: 1 }]; } },
  { id: 'S3u', title: 'fallback, unnamed statement across the first Sync', expect: ['1 t T Z', '2 D C Z'], rows: [[5, 's3u']],
    build: () => [
      { bytes: u8(parse('', sql('s3u')), describe('S', ''), sync()), syncs: 1 },
      { bytes: u8(bind('', '', ['5']), execute('', 0), sync()), syncs: 1 }] },
  { id: 'S3i', title: 'S3 named, with other clients running between the two flushes', expect: ['1 t T Z', '2 D C Z'], rows: [[12, 's3i']], gap: true,
    build: ({ run, client }) => { const nm = U(run, client, 's3i'); return [
      { bytes: u8(parse(nm, sql('s3i')), describe('S', nm), sync()), syncs: 1 },
      { bytes: u8(bind('', nm, ['12']), execute('', 0), sync()), syncs: 1 }]; } },
  { id: 'S3ui', title: 'S3 unnamed, with other clients running between the two flushes', expect: ['1 t T Z', '2 D C Z'], rows: [[13, 's3ui']], gap: true,
    build: () => [
      { bytes: u8(parse('', sql('s3ui')), describe('S', ''), sync()), syncs: 1 },
      { bytes: u8(bind('', '', ['13']), execute('', 0), sync()), syncs: 1 }] },
  { id: 'S3f', title: 'fallback with Flush: Parse, Describe(statement), Flush; then Bind, Execute, Sync (no Sync between)', expect: ['1 t T 2 D C Z'], flushWant: 3, rows: [[6, 's3f']],
    build: () => [
      { bytes: u8(parse('', sql('s3f')), describe('S', ''), flushMsg()), syncs: 0 },
      { bytes: u8(bind('', '', ['6']), execute('', 0), sync()), syncs: 1 }] },
  { id: 'S5', title: 'batch: two statements, one flush, one Sync', expect: ['1 2 T D C 1 2 T D C Z'], rows: [[7, 's5a'], [8, 's5b']],
    build: () => [{ bytes: u8(parse('', sql('s5a')), bind('', '', ['7']), describe('P', ''), execute('', 0), parse('', sql('s5b')), bind('', '', ['8']), describe('P', ''), execute('', 0), sync()), syncs: 1 }] },
  ...[2, 10, 100].map((d): SeqDef => ({
    id: `S6-${d}`, title: `pipeline: a Sync per statement, depth ${d}, one flush`,
    expect: Array.from({ length: d }, () => '1 2 T D C Z'), rows: Array.from({ length: d }, (_, i) => [100 + i, 's6'] as [number, string]),
    build: () => [{ bytes: u8(...Array.from({ length: d }, (_, i) => one('s6', 100 + i))), syncs: d }],
  })),
  { id: 'S7', title: 'inside a transaction: Query(BEGIN), S1, Query(COMMIT) in one flush', expect: ['C Z', '1 2 T D C Z', 'C Z'], rows: [[9, 's7']],
    build: () => [{ bytes: u8(query('BEGIN'), one('s7', 9), query('COMMIT')), syncs: 3 }] },
  { id: 'S7b', title: 'inside a transaction, BEGIN and COMMIT as extended messages with their own Sync', expect: ['1 2 C Z', '1 2 T D C Z', '1 2 C Z'], rows: [[10, 's7b']],
    build: () => [{ bytes: u8(parse('', 'BEGIN'), bind('', '', []), execute('', 0), sync(), one('s7b', 10), parse('', 'COMMIT'), bind('', '', []), execute('', 0), sync()), syncs: 3 }] },
];

export interface Analysis {
  groups: string[];            // backend type letters per ReadyForQuery group
  errors: { code: string; message: string; severity: string }[];
  rows: [string | null, ...(string | null)[]][];
  pids: number[];
}

export function analyse(msgs: Timed[]): Analysis {
  const groups: string[] = []; let cur: string[] = [];
  const errors: Analysis['errors'] = []; const rows: Analysis['rows'] = []; const pids: number[] = [];
  for (const m of msgs) {
    if (m.type === 'N' || m.type === 'S') continue; // notices and ParameterStatus are not part of the contract
    if (m.type === 'E') { const e: PgError = decodeError(m.body); errors.push({ code: e.code ?? '', message: e.message ?? '', severity: e.severity ?? '' }); }
    if (m.type === 'D') { const r = decodeDataRow(m.body) as any; rows.push(r); const p = parseInt(r[1], 10); if (Number.isFinite(p)) pids.push(p); }
    cur.push(m.type);
    if (m.type === 'Z') { groups.push(cur.join(' ')); cur = []; }
  }
  if (cur.length) groups.push(cur.join(' ') + ' …');
  return { groups, errors, rows, pids };
}

export type Outcome = 'ok' | 'error' | 'timeout' | 'closed' | 'wrong-result';
export interface SeqRun {
  seq: string; run: number; outcome: Outcome; why: string;
  /** Window of the sequence on the shared clock (ms since epoch), for trace excerpts. */
  t0: number; t1: number; connId: number;
  errors: Analysis['errors'];
  elapsedMs: number; impliedRoundTrips: number; traceRoundTrips: number;
  c2sChunks: number; s2cChunks: number;
  groups: string[]; pids: number[];
  client: { types: string };
  server: { types: string; parse: string[]; bind: string[]; trips: number; conns: number[]; pids: number[]; chunks: number; forwardedAsSent: boolean; notes: string[]; poolerQueries: string[] };
  wrongRow?: boolean;
}

const typesOf = (ms: MsgRec[]) => ms.map((m) => m.type).join(' ');

export function judge(def: SeqDef, an: Analysis, end: 'ok' | 'timeout' | 'closed', reason: string): { outcome: Outcome; why: string } {
  if (end === 'timeout') return { outcome: 'timeout', why: `no ReadyForQuery within ${DEADLINE_MS} ms` };
  if (an.errors.length) {
    const e = an.errors[0]!; return { outcome: end === 'closed' ? 'closed' : 'error', why: `${e.severity} ${e.code} ${e.message}` };
  }
  if (end === 'closed') return { outcome: 'closed', why: reason || 'connection closed' };
  if (an.groups.length !== def.expect.length || an.groups.some((g, i) => g !== def.expect[i])) return { outcome: 'wrong-result', why: `message types ${JSON.stringify(an.groups)} expected ${JSON.stringify(def.expect)}` };
  if (an.rows.length !== def.rows.length) return { outcome: 'wrong-result', why: `${an.rows.length} rows, expected ${def.rows.length}` };
  for (let i = 0; i < def.rows.length; i++) {
    const [n, tag] = def.rows[i]!; const r = an.rows[i]!;
    if (r[0] !== String(n) || r[2] !== tag) return { outcome: 'wrong-result', why: `row ${i} is ${JSON.stringify(r)}, expected n=${n} tag=${tag}` };
  }
  return { outcome: 'ok', why: '' };
}

export interface RunCtx { cproxy: RecordingProxy | null; sproxy: RecordingProxy | null }

/** Executes steps on one client connection and joins the client-side and server-side traces. */
export async function runSteps(ctx: RunCtx, def: SeqDef, conn: PgConn, connId: number, steps: Step[], runNo: number, gap?: () => Promise<void>): Promise<SeqRun> {
  const all: Timed[] = [];
  let end: Collected['end'] = 'ok'; let reason = '';
  const t0 = nowMs();
  let activeMs = 0; let stepStart = t0;
  const windows: [number, number][] = [];
  const deadline = performance.now() + DEADLINE_MS + (gap ? 5000 : 0);
  let stepNo = 0;
  for (const s of steps) {
    if (stepNo++ > 0 && gap) { const e = nowMs(); activeMs += e - stepStart; windows.push([stepStart, e]); await gap(); stepStart = nowMs(); }
    conn.write(s.bytes);
    if (s.syncs === 0) {
      // Flush step: no ReadyForQuery will arrive. Read until the expected messages of this group are in, or time out.
      const want = def.flushWant ?? 1;
      let got = 0;
      while (got < want) {
        const r = await conn.collectAny(want - got, Math.max(1, deadline - performance.now()));
        all.push(...r.msgs); got += r.msgs.length;
        if (r.end !== 'ok') { end = r.end; reason = r.reason; break; }
        if (r.msgs.some((m) => m.type === 'E')) break;
      }
      if (end !== 'ok' || all.some((m) => m.type === 'E')) break;
      continue;
    }
    const r = await conn.collect(s.syncs, Math.max(1, deadline - performance.now()));
    all.push(...r.msgs);
    if (r.end !== 'ok') { end = r.end; reason = r.reason; break; }
    if (r.msgs.some((m) => m.type === 'E')) break; // a client stops on error
  }
  const t1 = all.length ? all[all.length - 1]!.t : nowMs();
  activeMs += t1 - stepStart;
  windows.push([stepStart, t1]);
  const an = analyse(all);
  const j = judge(def, an, end, reason);
  const elapsedMs = gap ? activeMs : t1 - t0;
  // Without a client-side proxy (hosted targets, TLS to the server) the client's own read/write trace is the record.
  const viaProxy = !!ctx.cproxy && connId >= 0; // a TLS connection cannot be mapped to a proxy connection (no startup message is visible)
  const clientChunks = viaProxy ? ctx.cproxy!.chunks : conn.trace.map((e) => ({ t: e.t, conn: 0, dir: (e.dir === 'w' ? 'c2s' : 's2c') as 'c2s' | 's2c', n: e.bytes }));
  const rt = roundTrips(clientChunks, viaProxy ? connId : 0, t0 - 2, t1 + 2);
  // Client-sent frontend messages (from the client-side proxy) and what reached Postgres (server-side proxy).
  const sent = !ctx.cproxy ? [] : ctx.cproxy.msgs.filter((m) => m.conn === connId && m.dir === 'c2s' && m.t >= t0 - 2 && m.t <= t1 + 2 && m.type !== 'p');
  const srvAll = ctx.sproxy ? ctx.sproxy.msgs.filter((m) => m.dir === 'c2s' && windows.some(([a, b]) => m.t >= a && m.t <= b + 60) && !['p', 'Startup', 'SSLRequest', 'X'].includes(m.type)) : [];
  // Simple queries the pooler sent on its own (application_name, resets, ...) are reported apart from the client's messages.
  const clientQ = new Set(sent.filter((m) => m.type === 'Q').map((m) => String((m.d as any).sql)));
  const poolerQ = srvAll.filter((m) => m.type === 'Q' && !clientQ.has(String((m.d as any).sql))).map((m) => String((m.d as any).sql));
  const srv = srvAll.filter((m) => !(m.type === 'Q' && !clientQ.has(String((m.d as any).sql))));
  const srvConns = [...new Set(srvAll.map((m) => m.conn))];
  let strips = 0, schunks = 0;
  if (ctx.sproxy) for (const c of srvConns) { for (const [a, b] of windows) { const x = roundTrips(ctx.sproxy.chunks, c, a, b + 60); strips += x.trips; schunks += x.c2sChunks; } }
  const sPids = [...new Set(srvConns.map((c) => ctx.sproxy!.conns.get(c)?.pid ?? 0))];
  const cP = sent.filter((m) => m.type === 'P').map((m) => `${(m.d as any).name}|${(m.d as any).sql}`);
  const sP = srv.filter((m) => m.type === 'P').map((m) => `${(m.d as any).name}|${(m.d as any).sql}`);
  const sB = srv.filter((m) => m.type === 'B').map((m) => `${(m.d as any).stmt}`);
  const notes: string[] = [];
  if (ctx.sproxy) {
    if (cP.length && !sP.length) notes.push('Parse not forwarded');
    else if (!cP.length && sP.length) notes.push('Parse added by pooler');
    else if (cP.length !== sP.length) notes.push(`${cP.length} Parse sent, ${sP.length} forwarded`);
    if (cP.length && sP.length && cP.some((p, i) => p.split('|')[0] !== sP[i]?.split('|')[0])) notes.push('statement name rewritten');
    if (cP.length && sP.length && cP.some((p, i) => p.split('|')[1] !== sP[i]?.split('|')[1])) notes.push('SQL text changed');
    if (typesOf(sent) !== typesOf(srv)) notes.push('message types differ from what the client sent');
    if (poolerQ.length) notes.push('pooler sent its own simple queries');
    if (srvConns.length > 1) notes.push('more than one server connection used');
  }
  const forwardedAsSent = !!ctx.sproxy && !notes.some((n) => n !== 'pooler sent its own simple queries');
  const wrongRow = j.outcome === 'wrong-result' && an.errors.length === 0 && an.rows.length > 0 && j.why.startsWith('row ');
  return {
    seq: def.id, run: runNo, outcome: j.outcome, why: j.why, errors: an.errors, t0, t1, connId,
    elapsedMs: Math.round(elapsedMs * 10) / 10, impliedRoundTrips: Math.round((elapsedMs / (ctx.cproxy ? 2 * ONE_WAY_DELAY_MS : baselineRttMs)) * 100) / 100,
    traceRoundTrips: rt.trips, c2sChunks: rt.c2sChunks, s2cChunks: rt.s2cChunks,
    groups: an.groups, pids: an.pids,
    client: { types: typesOf(sent) },
    server: { types: typesOf(srv), parse: sP, bind: sB, trips: strips, conns: srvConns, pids: sPids, chunks: schunks, forwardedAsSent, notes, poolerQueries: [...new Set(poolerQ)].map((q) => q.slice(0, 80)) },
    ...(wrongRow ? { wrongRow: true } : {}),
  };
}
