// Summarise results/ladder-runs.json into medians, spreads and the measurable / inconclusive decision.
// Usage: bun run scripts/ladder/summary.ts <runs.json> <out-prefix>
import { readFileSync, writeFileSync } from "node:fs";

const [inFile, outPrefix] = [process.argv[2] ?? "results/ladder-runs.json", process.argv[3] ?? "results/ladder"];
const d = JSON.parse(readFileSync(inFile, "utf8")) as { runtime: string; vcpu: number; repeats: number; warmup: number; runs: { repeat: number; scenario: 1 | 2; rung: string; queries: number; wallUsPerQuery: number; cpuUsPerQuery: number }[] };
const RUNGS = ["1-direct", "2-wirecore", "3-transport", "4-coord-pool", "5-full"];
const METRICS = [["wallUsPerQuery", "wall"], ["cpuUsPerQuery", "cpu"]] as const;
const median = (a: number[]): number => { const s = a.slice().sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2; };

interface Cell { scenario: number; metric: string; rung: string; n: number; median: number; min: number; max: number; spread: number; vsDirectPct: number; vsPreviousPct: number; threshold: number; measurable: boolean; inconclusive: boolean }
const cells: Cell[] = [];
for (const scenario of [1, 2] as const) {
  for (const [key, metric] of METRICS) {
    const stat = (rung: string) => { const v = d.runs.filter((r) => r.scenario === scenario && r.rung === rung).map((r) => r[key]); return { v, med: median(v), min: Math.min(...v), max: Math.max(...v) }; };
    const direct = stat("1-direct");
    const directSpread = (direct.max - direct.min) / direct.med;
    const threshold = Math.max(0.03, directSpread);
    const inconclusive = directSpread > 0.15;
    let prev = direct.med;
    for (const rung of RUNGS) {
      const s = stat(rung);
      cells.push({
        scenario, metric, rung, n: s.v.length, median: s.med, min: s.min, max: s.max, spread: (s.max - s.min) / s.med,
        vsDirectPct: (s.med / direct.med - 1) * 100, vsPreviousPct: (s.med / prev - 1) * 100, threshold: threshold * 100,
        measurable: rung !== "1-direct" && s.med > direct.med * (1 + threshold), inconclusive,
      });
      prev = s.med;
    }
  }
}
// per rung: measurable on any (metric, scenario); inconclusive on any
const perRung = RUNGS.map((rung) => {
  const cs = cells.filter((c) => c.rung === rung);
  return { rung, measurable: cs.some((c) => c.measurable), inconclusive: cs.some((c) => c.inconclusive), cells: cs.map((c) => `s${c.scenario}/${c.metric}: ${c.measurable ? "measurable" : "not measurable"}${c.inconclusive ? " (inconclusive)" : ""}`) };
});
writeFileSync(`${outPrefix}-summary.json`, JSON.stringify({ runtime: d.runtime, vcpu: d.vcpu, repeats: d.repeats, warmup: d.warmup, cells, perRung }, null, 2));
const fmt = (x: number, p = 1): string => x.toFixed(p);
const lines: string[] = [`Runtime: ${d.runtime}; ${d.vcpu} vCPU; ${d.repeats} repeats per rung and scenario; warm-up ${d.warmup} queries discarded.`, ""];
for (const scenario of [1, 2] as const) {
  lines.push(`### Scenario ${scenario} (${scenario === 1 ? "one caller, one connection, 20,000 queries" : "64 callers over a pool of 8, 50,000 queries"})`, "");
  lines.push("| rung | wall median us/q | wall min..max | wall vs direct | wall vs previous | cpu median us/q | cpu min..max | cpu vs direct | cpu vs previous | measurable |");
  lines.push("|---|---|---|---|---|---|---|---|---|---|");
  for (const rung of RUNGS) {
    const w = cells.find((c) => c.scenario === scenario && c.metric === "wall" && c.rung === rung)!;
    const c = cells.find((x) => x.scenario === scenario && x.metric === "cpu" && x.rung === rung)!;
    const base = `${w.measurable ? "wall" : ""}${w.measurable && c.measurable ? "+" : ""}${c.measurable ? "cpu" : ""}` || "no";
    const verdict = rung === "1-direct" ? "(direct)" : w.inconclusive || c.inconclusive ? `${base} above threshold, **inconclusive**` : base;
    lines.push(`| ${rung} | ${fmt(w.median)} | ${fmt(w.min)}..${fmt(w.max)} | ${rung === "1-direct" ? "-" : `${w.vsDirectPct >= 0 ? "+" : ""}${fmt(w.vsDirectPct)}%`} | ${rung === "1-direct" ? "-" : `${w.vsPreviousPct >= 0 ? "+" : ""}${fmt(w.vsPreviousPct)}%`} | ${fmt(c.median)} | ${fmt(c.min)}..${fmt(c.max)} | ${rung === "1-direct" ? "-" : `${c.vsDirectPct >= 0 ? "+" : ""}${fmt(c.vsDirectPct)}%`} | ${rung === "1-direct" ? "-" : `${c.vsPreviousPct >= 0 ? "+" : ""}${fmt(c.vsPreviousPct)}%`} | ${verdict} |`);
  }
  const dw = cells.find((c) => c.scenario === scenario && c.metric === "wall" && c.rung === "1-direct")!;
  const dc = cells.find((c) => c.scenario === scenario && c.metric === "cpu" && c.rung === "1-direct")!;
  lines.push("", `Direct rung spread (max-min)/median: wall ${fmt(dw.spread * 100)}%, cpu ${fmt(dc.spread * 100)}%. Threshold: max(3%, spread) = wall ${fmt(dw.threshold)}%, cpu ${fmt(dc.threshold)}%. ${dw.inconclusive || dc.inconclusive ? "**Direct spread above 15%: inconclusive in this scenario.**" : "Direct spread at or below 15%: conclusive."}`, "");
}
writeFileSync(`${outPrefix}-summary.md`, lines.join("\n") + "\n");
console.log(lines.join("\n"));
