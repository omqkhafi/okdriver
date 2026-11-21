import { newPgCore, postgresDescriptor } from "../engines/postgres/index.ts";
import type { EnginePackage, Target } from "./compose.ts";

export const postgresPackage: EnginePackage = { class: "wire", descriptor: postgresDescriptor, newCore: newPgCore };
export const postgresTarget: Target = { endpoint: { host: "127.0.0.1", port: 55432 }, user: "postgres", database: "fs01" };
import { mariadbDescriptor, newMariadbCore } from "../engines/mariadb/index.ts";
import { mysqlDescriptor, newMysqlCore } from "../engines/mysql/index.ts";

export const mysqlPackage: EnginePackage = { class: "wire", descriptor: mysqlDescriptor, newCore: newMysqlCore };
export const mysqlTarget: Target = { endpoint: { host: "127.0.0.1", port: 53306 }, user: "root", database: "fs01" };
export const mariadbPackage: EnginePackage = { class: "wire", descriptor: mariadbDescriptor, newCore: newMariadbCore };
export const mariadbTarget: Target = { endpoint: { host: "127.0.0.1", port: 53307 }, user: "root", database: "fs01" };
import { libsqlDescriptor, newHranaCore } from "../engines/libsql/index.ts";
import { openSqliteCore, sqliteDescriptor } from "../engines/sqlite/index.ts";

export const sqlitePackage: EnginePackage = { class: "embedded", descriptor: sqliteDescriptor, open: openSqliteCore };
export const libsqlPackage: EnginePackage = { class: "service", descriptor: libsqlDescriptor, newCore: newHranaCore };
export const libsqlTarget: Target = { endpoint: { host: "127.0.0.1", port: 58080 }, user: "", database: "" };
