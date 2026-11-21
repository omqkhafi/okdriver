// Dispatch layer: the only place that reads the server family out of the greeting and picks a profile.
// Deliberately outside shared/, mysql/ and mariadb/ so the boundary check can measure it separately.
import { Connection, type ConnectOptions } from './shared/connection.ts';
import type { Greeting } from './shared/greeting.ts';
import type { FamilyProfile } from './shared/profile.ts';
import { mariadbProfile } from './mariadb/profile.ts';
import { mysqlProfile } from './mysql/profile.ts';

export function detectFamily(g: Greeting): 'mysql' | 'mariadb' {
  // MariaDB servers prefix the version with "5.5.5-" for old clients, and keep "MariaDB" in the string.
  return /mariadb/i.test(g.serverVersion) ? 'mariadb' : 'mysql';
}
export const chooseProfile = (g: Greeting): FamilyProfile => (detectFamily(g) === 'mariadb' ? mariadbProfile : mysqlProfile);
export const connect = (o: ConnectOptions): Promise<Connection> => Connection.connect(o, chooseProfile);
export { Connection };
export type { ConnectOptions };
