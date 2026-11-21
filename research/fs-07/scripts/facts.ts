// Per-server facts: greeting, capability bits, defaults, plugins, collation ids, connection attributes.
import { save, pick, root, tryErr, cli, PW } from './lib.ts';
import { chooseProfile, detectFamily, connect } from '../wire/connect.ts';
import { CAP } from '../wire/shared/constants.ts';
import { MARIADB_EXT } from '../wire/mariadb/profile.ts';

const VARS = ['version', 'version_comment', 'character_set_server', 'collation_server', 'character_set_client', 'character_set_connection',
  'character_set_results', 'collation_connection', 'sql_mode', 'max_prepared_stmt_count', 'local_infile', 'autocommit', 'transaction_isolation', 'tx_isolation',
  'max_allowed_packet', 'net_write_timeout', 'net_read_timeout', 'wait_timeout', 'session_track_system_variables', 'session_track_schema',
  'session_track_state_change', 'session_track_gtids', 'session_track_transaction_info', 'performance_schema', 'binlog_format', 'binlog_row_metadata',
  'log_bin', 'read_only', 'super_read_only', 'default_authentication_plugin', 'authentication_policy', 'secure_auth', 'have_ssl', 'ssl_cert', 'require_secure_transport',
  'explicit_defaults_for_timestamp', 'lower_case_table_names', 'cte_max_recursion_depth', 'max_recursive_iterations', 'old_passwords', 'mysql_native_password',
  'protocol_compression_algorithms', 'default_collation_for_utf8mb4', 'gtid_mode', 'gtid_strict_mode', 'histogram_type', 'resultset_metadata', 'redirect_url', 'old_mode', 'sql_notes'];
const capNames = Object.fromEntries(Object.entries(CAP).map(([k, v]) => [v, k]));
const extNames = Object.fromEntries(Object.entries(MARIADB_EXT).map(([k, v]) => [v, k]));

for (const s of pick()) {
  const out: Record<string, unknown> = { id: s.id, image: s.image };
  // greeting as the prototype reads it
  const c = await root(s);
  const g = c.greeting;
  const bits = (v: number, names: Record<number, string>) => Object.entries(names).filter(([b]) => v & Number(b)).map(([, n]) => n);
  out.greeting = {
    serverVersion: g.serverVersion, protocolVersion: g.protocolVersion, authPlugin: g.authPluginName, charset: g.charset, status: g.status,
    capabilities: '0x' + g.capabilities.toString(16), capabilityNames: bits(g.capabilities, capNames),
    bit0LongPassword: !!(g.capabilities & 1), reserved: g.reserved.toString('hex'),
    mariadbExtWord: g.reserved.readUInt32LE(6), mariadbExtNames: bits(g.reserved.readUInt32LE(6), extNames),
    detected: detectFamily(g), profile: chooseProfile(g).family, saltLength: g.salt.length,
  };
  out.negotiated = { caps: '0x' + c.neg.caps.toString(16), ext: c.neg.ext };
  const vars: Record<string, string> = {};
  for (const [k, v] of (await c.rows('show variables')) as string[][]) if (VARS.includes(k!)) vars[k!] = String(v);
  out.variables = vars;
  out.connectionCollationWithCharset45 = (await c.rows('select @@character_set_client, @@collation_connection, @@character_set_results'))[0];
  // collation ids accepted in the handshake
  const ids: Record<string, string> = {};
  for (const id of [8, 33, 45, 46, 63, 224, 255]) {
    const r = await tryErr(async () => { const x = await root(s, { charset: id }); const v = (await x.rows('select @@collation_connection'))[0]![0]; await x.close(); return String(v); });
    ids[id] = r.ok ? r.v : `refused: ${r.error}`;
  }
  out.handshakeCharsetIds = ids;
  out.collationIds = await c.rows("select id, collation_name from information_schema.collations where collation_name in ('utf8mb4_general_ci','utf8mb4_0900_ai_ci','utf8mb4_unicode_ci','utf8mb4_bin','utf8mb4_uca1400_ai_ci','utf8mb3_general_ci','utf8_general_ci','binary','latin1_swedish_ci') order by id");
  const nColl = await c.rows('select count(*) from information_schema.collations');
  out.collationCount = nColl[0]![0];
  out.defaultAuthPluginsLoaded = await c.rows("select plugin_name, plugin_status from information_schema.plugins where plugin_type='AUTHENTICATION' order by 1");
  out.rootUsers = await c.rows("select user, host, plugin from mysql.user where user='root' order by host");
  await c.queryAll("drop user if exists 'fs07_new'@'%'");
  await c.query("create user 'fs07_new'@'%' identified by 'pw-new'");
  out.newUserWithPasswordGetsPlugin = (await c.rows("select plugin from mysql.user where user='fs07_new'"))[0]![0];
  await c.query("drop user 'fs07_new'@'%'");
  // library files present for authentication plugins (MariaDB lists them in all_plugins)
  if (s.family === 'mariadb') out.authPluginsAvailable = await c.rows("select plugin_name, plugin_status, plugin_library from information_schema.all_plugins where plugin_type='AUTHENTICATION' order by 1");
  // connection attributes as the server stored them (performance_schema)
  const attrs = await tryErr(() => c.rows("select attr_name, attr_value from performance_schema.session_connect_attrs where processlist_id = connection_id() order by ordinal_position"));
  out.connectAttrsSeenByServer = attrs.ok ? attrs.v : attrs;
  await c.close();
  save(`facts/${s.id}.json`, out);
  console.log(s.id, 'done');
}
