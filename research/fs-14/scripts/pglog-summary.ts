// Summarise a Postgres server log captured with log_min_duration_statement=0 and log_line_prefix='%p|'.
// With that setting the server logs every extended-protocol phase on its own line: "parse <name>", "bind <name>",
// "execute <name>". Counting them per backend shows which statements are named, how often each is parsed, and
// how often it is re-executed. Reads the log on stdin.  usage: node pglog-summary.ts < pg.log > summary.json
import { readFileSync } from 'node:fs';
const text = readFileSync(0, 'utf8');
const re = /^(\d+)\|LOG:\s+duration: [\d.]+ ms\s+(parse|bind|execute)\s+(<unnamed>|[^\s:]+)(?:: |:)/;
const phases: Record<string, Record<string, Record<string, number>>> = { parse: {}, bind: {}, execute: {} }; // phase -> pid -> name -> n
const pids = new Set<string>();
for (const line of text.split('\n')) {
  const m = re.exec(line);
  if (!m) continue;
  const [, pid, phase, name] = m;
  pids.add(pid);
  const p = ((phases[phase] ??= {})[pid] ??= {});
  p[name] = (p[name] ?? 0) + 1;
}
const total = (phase: string, pick?: (n: string) => boolean) =>
  Object.values(phases[phase]).reduce((a, byName) => a + Object.entries(byName).filter(([n]) => !pick || pick(n)).reduce((s, [, v]) => s + v, 0), 0);
const named = (n: string) => n !== '<unnamed>';
const parsesPerNamePerBackend = Object.values(phases.parse).flatMap((byName) => Object.entries(byName).filter(([n]) => named(n)).map(([, v]) => v));
const out = {
  backends: pids.size,
  parse: { total: total('parse'), named: total('parse', named), unnamed: total('parse', (n) => !named(n)) },
  bind: { total: total('bind'), named: total('bind', named), unnamed: total('bind', (n) => !named(n)) },
  execute: { total: total('execute'), named: total('execute', named), unnamed: total('execute', (n) => !named(n)) },
  distinctNamedStatements: new Set(Object.values(phases.parse).flatMap((b) => Object.keys(b).filter(named))).size,
  maxParsesOfOneNamedStatementOnOneBackend: Math.max(0, ...parsesPerNamePerBackend),
  executesPerNamedParse: parsesPerNamePerBackend.length ? +(total('execute', named) / total('parse', named)).toFixed(1) : null,
};
console.log(JSON.stringify(out, null, 2));
