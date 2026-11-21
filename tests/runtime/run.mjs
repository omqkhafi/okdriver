// Entry for Node and Bun: `node tests/runtime/run.mjs` or `bun tests/runtime/run.mjs`.
// EXPECT_RUNTIME is "node:<major>" or "bun".
import { runSmoke } from "./smoke.mjs";

const { runtime, version } = await runSmoke(process.env.EXPECT_RUNTIME);
console.log(`runtime smoke ok: ${runtime} ${version}`);
