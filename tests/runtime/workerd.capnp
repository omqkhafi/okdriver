using Workerd = import "/workerd/workerd.capnp";

const config :Workerd.Config = (
  services = [
    (name = "main", worker = .mainWorker),
  ],
);

const mainWorker :Workerd.Worker = (
  modules = [
    (name = "worker", esModule = embed "worker.mjs"),
    (name = "smoke.mjs", esModule = embed "smoke.mjs"),
  ],
  # Fixed and no later than the pinned workerd release (see package.json).
  compatibilityDate = "2026-11-01",
  bindings = [
    (name = "EXPECT_RUNTIME", fromEnvironment = "EXPECT_RUNTIME"),
  ],
);
