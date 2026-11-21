// Which contract a file or a declaration belongs to. Used by the branch count and the verdict script.
export const CONTRACTS = [
  "Engine descriptor + capability model",
  "WireCore",
  "EmbeddedCore",
  "ServiceCore",
  "ExecutionCoordinator",
  "ConnectionPool",
  "Transport",
  "Error taxonomy + ErrorMapper",
  "CodecRegistry",
] as const;
export type ContractName = (typeof CONTRACTS)[number];
export const ADDED = ["Session (added in this study)"] as const;
export type AnyContract = ContractName | (typeof ADDED)[number];

/** Platform files that implement or drive one contract. Anything not listed is general platform code. */
export const FILE_CONTRACT: Record<string, AnyContract | "general"> = {
  "platform/contracts/engine.ts": CONTRACTS[0],
  "platform/contracts/capabilities.ts": CONTRACTS[0],
  "platform/contracts/core.ts": "general", // holds three contracts; declarations are mapped by interface name below
  "platform/contracts/coordinator.ts": "ExecutionCoordinator",
  "platform/coordinator.ts": "ExecutionCoordinator",
  "platform/contracts/pool.ts": "ConnectionPool",
  "platform/pool.ts": "ConnectionPool",
  "platform/contracts/transport.ts": "Transport",
  "platform/contracts/errors.ts": CONTRACTS[7],
  "platform/contracts/codec.ts": "CodecRegistry",
  "platform/wire-session.ts": "WireCore",
  "platform/embedded-session.ts": "EmbeddedCore",
  "platform/service-session.ts": "ServiceCore",
  "platform/contracts/session.ts": ADDED[0],
  "platform/client.ts": "general",
  "platform/session-common.ts": "general",
  "platform/failures.ts": "general",
  "platform/contracts/types.ts": "general",
  "platform/contracts/bytes.ts": "WireCore", // Writer is the `out` of WireCore.encode
  "platform/contracts/index.ts": "general",
  "platform/index.ts": "general",
};

/** Interfaces and types in contracts/core.ts, by contract. */
export const CORE_DECL: Record<string, AnyContract> = {
  WireCore: "WireCore",
  CoreCommand: "WireCore",
  CoreEvent: "WireCore",
  EmbeddedCore: "EmbeddedCore",
  EmbeddedStatement: "EmbeddedCore",
  ServiceCore: "ServiceCore",
  ServiceRequest: "ServiceCore",
  ServiceResult: "ServiceCore",
  ServiceStream: "ServiceCore",
};
