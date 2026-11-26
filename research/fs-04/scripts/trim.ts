// One-off, idempotent: applies the same trace trimming as save() to result files written before the trimming existed.
import { readdirSync, readFileSync } from 'node:fs';
import { RESULTS } from './lib/paths.ts';
import { save } from './lib/harness.ts';
for (const f of readdirSync(RESULTS + 'probes')) { const r = JSON.parse(readFileSync(RESULTS + 'probes/' + f, 'utf8')); save('probes/' + f, r); }
