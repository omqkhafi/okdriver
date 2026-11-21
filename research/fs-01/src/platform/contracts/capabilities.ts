// A5, verbatim.
export interface CapabilitySet {
  pipelining: boolean;
  protocolPrepared: boolean;
  interactiveTransactions: boolean;
  savepoints: boolean;
  returning: boolean;
  streamingResults: boolean;
  bulkLoad: false | { formats: readonly ("text" | "csv" | "binary")[] };
  notifications: boolean;
  changeStream: boolean;
  cancel: "server" | "local-only" | "none";
  int64: "bigint";
  multiResult: boolean;
}
