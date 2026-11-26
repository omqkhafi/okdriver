// Capability probes. Usage: taskset -c 1,2 node scripts/caps.ts <build> <adapter> [outfile]
// Required (gate): tls_upgrade, pause_resume_bounded, write_backpressure, terminal_once. Reported: the rest. Also the lifetime probe.
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createHash, X509Certificate } from 'node:crypto';
import { FakePg } from './servers/fakepg.ts';
import { CapServers } from './servers/capsrv.ts';
import { startClient, exited } from './lib/proc.ts';
import { runtimeFor, describeBuild, readCert, certDir, resultsDir } from './lib/builds.ts';

const MiB = 1 << 20;
export const PARAMS = { streamBytes: 256 * MiB, settleMs: 100, windowMs: 2000, maxDeliveredAfterSettle: 1 * MiB, maxRssGrowthKB: 64 * 1024, writeBytes: 64 * MiB, stallMs: 1000, halfBytes: 100_000 };

export async function runCaps(build: string, adapter: string): Promise<Record<string, any>> {
  const runtime = runtimeFor(build);
  const ca = join(certDir, 'ca.crt');
  const cert = readCert('server.crt'), key = readCert('server.key');
  const serverDerSha = createHash('sha256').update(new X509Certificate(cert).raw).digest('hex');
  const caps = await new CapServers().start({ streamBytes: PARAMS.streamBytes, stallMs: PARAMS.stallMs, halfBytes: PARAMS.halfBytes });
  const tlsPg = await new FakePg({ tls: { key, cert } }).listen();
  const directPg = await new FakePg({ directTls: { key, cert, alpn: ['postgresql'] } }).listen();
  const run = async (args: Record<string, unknown>, timeoutMs = 90000): Promise<any> => {
    const c = startClient({ runtime, cpu: '0', args: { adapter, ...args }, timeoutMs });
    try { return await c.result; } catch (e) { return { status: 'crash', error: String(e).slice(0, 300), stderr: c.stderr().slice(0, 300) }; }
  };
  const out: Record<string, any> = { build: describeBuild(build), adapter, params: PARAMS };

  // tls_upgrade (required)
  const tl = await run({ task: 'tls_upgrade', port: tlsPg.port, ca });
  out.tls_upgrade = { raw: tl, pass: tl.good?.ok === true && tl.good?.rows === 1 && tl.mismatch?.ok === false, peerCertMatchesServer: tl.good?.certSha === serverDerSha };

  // pause_resume_bounded (required)
  caps.results.stream!.length = 0;
  const pr = await run({ task: 'pause_resume', port: caps.ports.stream, total: PARAMS.streamBytes, settleMs: PARAMS.settleMs, windowMs: PARAMS.windowMs });
  await new Promise((r) => setTimeout(r, 200));
  const srvStream = caps.results.stream![0];
  out.pause_resume_bounded = {
    raw: pr, server: srvStream,
    pass: pr.bytes === PARAMS.streamBytes && pr.sha === srvStream?.sha && pr.deliveredWhilePaused <= PARAMS.maxDeliveredAfterSettle && pr.rssGrowthKB <= PARAMS.maxRssGrowthKB,
  };

  // write_backpressure (required)
  caps.results.stall!.length = 0;
  const wb = await run({ task: 'write_backpressure', port: caps.ports.stall, size: PARAMS.writeBytes });
  const srvStall = caps.results.stall![0];
  out.write_backpressure = { raw: wb, server: srvStall, pass: wb.signal === true && wb.drainAfterMs !== null && wb.drainAfterMs >= PARAMS.stallMs * 0.5 && srvStall?.bytes === PARAMS.writeBytes && srvStall?.sha === wb.sha };

  // terminal_once (required): server RST, server FIN, local destroy
  const t1 = await run({ task: 'terminal', port: caps.ports.rst });
  const t2 = await run({ task: 'terminal', port: caps.ports.fin });
  const t3 = await run({ task: 'terminal', port: caps.ports.hold, local: true });
  const one = (t: any): boolean => t.terminalCalls === 1 && t.dataAfterTerminal === 0;
  out.terminal_once = { rst: t1, fin: t2, localDestroy: t3, pass: one(t1) && one(t2) && one(t3) };

  // lifetime probe
  const lf = await run({ task: 'lifetime', port: caps.ports.lifetime, waitMs: 60 * 4 + 600 });
  out.lifetime = lf;

  // reported only
  const d = await run({ task: 'direct_tls', port: directPg.port, ca });
  out.direct_tls_alpn = { raw: d, alpnNegotiated: d.alpn === 'postgresql', serverSawAlpn: directPg.conns[0]?.alpn ?? null };
  out.peer_certificate_bytes = { upgrade: tl.good?.certSha ?? null, direct: d.certSha ?? null, server: serverDerSha, matches: tl.good?.certSha === serverDerSha && d.certSha === serverDerSha };
  caps.results.half!.length = 0;
  const hc = await run({ task: 'half_close', port: caps.ports.half });
  out.half_close = { raw: hc, server: caps.results.half![0], pass: hc.bytes === PARAMS.halfBytes && hc.sha === caps.results.half![0]?.sha && hc.terminalCalls === 1 };

  for (const [name, port] of [['keepalive', caps.ports.hold!], ['nodelay', caps.ports.hold!]] as const) {
    const c = startClient({ runtime, cpu: '0', args: { adapter, task: name, port } });
    await c.waitFor('READY');
    // /proc/net/tcp: the timer column is tr:tm->when; tr 2 is the keepalive timer. Independent of the runtime under test.
    const hex = port.toString(16).toUpperCase().padStart(4, '0');
    const rows = readFileSync('/proc/net/tcp', 'utf8').trim().split('\n').slice(1).map((l) => l.trim().split(/\s+/)).filter((f) => f[2]!.endsWith(`:${hex}`) && f[3] === '01');
    const ss = rows.map((f) => `local ${f[1]} remote ${f[2]} timer ${f[5]}`).join(' | ');
    const timerKind = rows.length ? rows[0]![5]!.split(':')[0] : '';
    c.send('GO');
    const r = await c.result;
    out[name] = { raw: r, procNetTcp: ss, keepaliveTimer: timerKind === '02' };
  }

  // connect timeout: a listener whose accept queue is full, so SYNs are dropped
  const py = spawn('python3', ['-c', `
import socket,sys,time
s=socket.socket(); s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR,1); s.bind(('127.0.0.1',0)); s.listen(0)
port=s.getsockname()[1]
fillers=[]
for i in range(4):
    c=socket.socket(); c.setblocking(False)
    try: c.connect(('127.0.0.1',port))
    except BlockingIOError: pass
    fillers.append(c)
print(port, flush=True)
time.sleep(60)
`], { stdio: ['ignore', 'pipe', 'ignore'] });
  const bport = await new Promise<number>((res) => py.stdout!.once('data', (d) => res(Number(String(d).trim()))));
  await new Promise((r) => setTimeout(r, 300));
  const ct = await run({ task: 'connect_timeout', port: bport, timeoutMs: 1500 });
  out.connect_timeout = { raw: ct };
  py.kill();

  caps.close(); tlsPg.close(); directPg.close();
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [build, adapter, outName] = process.argv.slice(2);
  const res = await runCaps(build!, adapter!);
  mkdirSync(resultsDir, { recursive: true });
  writeFileSync(join(resultsDir, outName ?? `capabilities.${build}.${adapter}.json`), JSON.stringify(res, null, 2) + '\n');
  const gate = ['tls_upgrade', 'pause_resume_bounded', 'write_backpressure', 'terminal_once'].map((k) => `${k}=${res[k].pass}`).join(' ');
  console.log(`${build} ${adapter}: ${gate}`);
  void exited;
  process.exit(0);
}
