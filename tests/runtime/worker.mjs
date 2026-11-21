// Entry for workerd: run through `workerd test tests/runtime/workerd.capnp`.
// env.EXPECT_RUNTIME comes from the EXPECT_RUNTIME environment variable of the workerd process.
import { runSmoke } from "./smoke.mjs";

export default {
  async test(_controller, env) {
    const { runtime } = await runSmoke(env.EXPECT_RUNTIME);
    console.log(`runtime smoke ok: ${runtime}`);
  },
};
