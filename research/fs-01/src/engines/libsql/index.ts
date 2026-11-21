import type { CapabilitySet, ConnectContext, EngineDescriptor, Endpoint, ServiceCore, TransportFactory } from "../../platform/contracts/index.ts";
import { libsqlCodecs } from "./codecs.ts";
import { HranaCore } from "./core.ts";
import { libsqlErrors } from "./errors.ts";

export const libsqlDescriptor: EngineDescriptor = {
  id: "libsql",
  class: "service",
  contractVersion: "fs01-provisional",
  transactions: { begin: "BEGIN", commit: "COMMIT", rollback: "ROLLBACK" },
  errors: libsqlErrors,
  codecs: libsqlCodecs,
  capabilities(ctx: ConnectContext): CapabilitySet {
    return {
      pipelining: false,
      // The server accepted typed arguments on the Hrana 3 pipeline.
      protocolPrepared: ctx.facts.params.hrana === "v3",
      // The server returned a baton: the stream is stateful.
      interactiveTransactions: ctx.facts.params.streams === "baton",
      savepoints: false,
      returning: false,
      streamingResults: false,
      bulkLoad: false,
      notifications: false,
      changeStream: false,
      cancel: "none",
      int64: "bigint",
      multiResult: false,
    };
  },
};

export const newHranaCore = (t: TransportFactory, e: Endpoint): ServiceCore => new HranaCore(t, e);
