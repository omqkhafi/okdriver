import { familyDescriptor, newMysqlFamilyCore } from "../mysql-family/index.ts";

// MySQL: "8.4.13".
export const mysqlDescriptor = familyDescriptor("mysql", (v) => parseInt(v, 10));
export const newMysqlCore = newMysqlFamilyCore;
