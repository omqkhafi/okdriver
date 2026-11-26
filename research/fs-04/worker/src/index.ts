/// <reference path="./sockets.d.ts" />
// FS-04 probe Worker. Web APIs only (no nodejs_compat). POST /run {probe, params} with `Authorization: Bearer <PROBE_TOKEN>`.
// The database URL comes from a binding: `DATABASE_URL` (a Worker secret in production, target "main") or `DB_<TARGET>` locally.
// Every response is passed through a redactor that removes host, user, password and database name of every configured URL.
import { connect } from 'cloudflare:sockets';
import * as socketsModule from 'cloudflare:sockets';
import { PROBES, type Ctx } from './probes.ts';
import { parseUrl, type Target } from './pg.ts';
import { errInfo } from './sock.ts';

// A socket at global scope: the platform decides. Recorded once, at module evaluation.
const globalScope: Record<string, unknown> = {};
try {
  const s = connect({ hostname: '192.0.2.1', port: 5432 }, { secureTransport: 'off' });
  globalScope.threw = false;
  s.close().catch(() => { /* ignore */ });
} catch (e) { globalScope.threw = true; globalScope.error = errInfo(e); }

const globals: Record<string, any> = {};
interface Env { PROBE_TOKEN: string; DATABASE_URL?: string; [k: string]: string | undefined }

const envKey = (name: string) => (name === 'main' ? 'DATABASE_URL' : 'DB_' + name.toUpperCase().replace(/-/g, '_'));
const secretsOf = (env: Env): string[] => {
  const out = new Set<string>();
  for (const [k, v] of Object.entries(env)) {
    if (!v || !(k === 'DATABASE_URL' || k.startsWith('DB_'))) continue;
    out.add(v);
    try { const t = parseUrl(v); for (const x of [t.host, t.user, t.password, t.database, encodeURIComponent(t.password)]) if (x) out.add(x); } catch { /* not a URL */ }
  }
  return [...out].sort((a, b) => b.length - a.length);
};
const redactor = (env: Env) => {
  const list = secretsOf(env);
  return (s: string) => { for (const x of list) s = s.split(x).join('<redacted>'); return s; };
};
const json = (v: unknown, red: (s: string) => string, status = 200) => new Response(red(JSON.stringify(v)), { status, headers: { 'content-type': 'application/json' } });

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const red = redactor(env);
    const url = new URL(req.url);
    if (url.pathname === '/health') return new Response('ok');
    const auth = req.headers.get('authorization') ?? '';
    if (!env.PROBE_TOKEN || auth !== `Bearer ${env.PROBE_TOKEN}`) return new Response('unauthorized', { status: 401 });
    if (url.pathname === '/state') return json({ globalScope, moduleExports: Object.keys(socketsModule), cached: Object.keys(globals) }, red);
    if (url.pathname !== '/run' || req.method !== 'POST') return new Response('not found', { status: 404 });
    const { probe, params = {}, runId = 'x' } = (await req.json()) as { probe: string; params?: Record<string, any>; runId?: string };
    const fn = PROBES[probe];
    if (!fn) return json({ error: 'unknown probe' }, red, 400);
    const ctx: Ctx = {
      connect: (a, o) => connect(a, o as any) as any,
      target(name: string): Target { const u = env[envKey(name)]; if (!u) throw new Error(`target ${name} is not configured`); return parseUrl(u); },
      runId, globals, moduleKeys: Object.keys(socketsModule),
    };
    const t0 = performance.now();
    try {
      const observations = await fn(ctx, { ...params, target: params.target ?? 'main' });
      return json({ ok: true, probe, runId, ms: Math.round(performance.now() - t0), observations }, red);
    } catch (e) {
      return json({ ok: false, probe, runId, ms: Math.round(performance.now() - t0), error: errInfo(e) }, red);
    }
  },
};
