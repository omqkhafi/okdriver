import { familyDescriptor, newMysqlFamilyCore } from "../mysql-family/index.ts";

// Some MariaDB versions announce themselves as "5.5.5-<version>-MariaDB" (a replication compatibility
// prefix). The server run here (11.8.9) announced "11.8.9-MariaDB-ubu2404-log", so the strip below is
// code that no run of this study exercised.
const mariaMajor = (v: string): number => parseInt(v.replace(/^5\.5\.5-/, ""), 10);
export const mariadbDescriptor = familyDescriptor("mariadb", mariaMajor);
export const newMariadbCore = newMysqlFamilyCore;
