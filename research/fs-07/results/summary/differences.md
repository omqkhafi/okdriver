## Server facts and defaults

80 items compared; 54 differ between at least two servers.

| item | grouping (servers with the same value) |
| --- | --- |
| `collationCount` | my84, my97, my2610: 286n<br>ma106: 322n<br>ma1011: 506n<br>ma114: 550n<br>ma118, ma123, ma130: 552n |
| `connectionCollationWithCharset45.1` | my84, my97, my2610, ma106, ma1011: utf8mb4_general_ci<br>ma114, ma118, ma123, ma130: utf8mb4_uca1400_ai_ci |
| `defaultAuthPluginsLoaded.0.0` | my84, my97, my2610: caching_sha2_password<br>ma106, ma1011, ma114, ma118, ma123, ma130: mysql_native_password |
| `defaultAuthPluginsLoaded.1.0` | my84: mysql_native_password<br>my97, my2610: sha256_password<br>ma106, ma1011, ma114, ma118, ma123, ma130: mysql_old_password |
| `defaultAuthPluginsLoaded.1.1` | my84: DISABLED<br>my97, my2610, ma106, ma1011, ma114, ma118, ma123, ma130: ACTIVE |
| `defaultAuthPluginsLoaded.2.0` | my84: sha256_password<br>my97, my2610: (absent)<br>ma106, ma1011, ma114, ma118, ma123, ma130: unix_socket |
| `defaultAuthPluginsLoaded.2.1` | my84, ma106, ma1011, ma114, ma118, ma123, ma130: ACTIVE<br>my97, my2610: (absent) |
| `greeting.authPlugin` | my84, my97, my2610: caching_sha2_password<br>ma106, ma1011, ma114, ma118, ma123, ma130: mysql_native_password |
| `greeting.bit0LongPassword` | my84, my97, my2610: true<br>ma106, ma1011, ma114, ma118, ma123, ma130: false |
| `greeting.capabilities` | my84, my97, my2610: 0xdfffffff<br>ma106, ma1011: 0x81fff7fe<br>ma114, ma118, ma123, ma130: 0x81fffffe |
| `greeting.charset` | my84, my97, my2610: 255<br>ma106, ma1011, ma114, ma118, ma123, ma130: 45 |
| `greeting.detected` | my84, my97, my2610: mysql<br>ma106, ma1011, ma114, ma118, ma123, ma130: mariadb |
| `greeting.mariadbExtNames.0` | my84, my97, my2610: (absent)<br>ma106, ma1011, ma114, ma118, ma123, ma130: PROGRESS |
| `greeting.mariadbExtNames.1` | my84, my97, my2610: (absent)<br>ma106, ma1011, ma114, ma118, ma123, ma130: STMT_BULK_OPERATIONS |
| `greeting.mariadbExtNames.2` | my84, my97, my2610: (absent)<br>ma106, ma1011, ma114, ma118, ma123, ma130: EXTENDED_METADATA |
| `greeting.mariadbExtNames.3` | my84, my97, my2610: (absent)<br>ma106, ma1011, ma114, ma118, ma123, ma130: CACHE_METADATA |
| `greeting.mariadbExtNames.4` | my84, my97, my2610, ma106, ma1011, ma114: (absent)<br>ma118, ma123, ma130: BULK_UNIT_RESULTS |
| `greeting.mariadbExtWord` | my84, my97, my2610: 0<br>ma106, ma1011, ma114: 29<br>ma118, ma123, ma130: 61 |
| `greeting.profile` | my84, my97, my2610: mysql<br>ma106, ma1011, ma114, ma118, ma123, ma130: mariadb |
| `handshakeCharsetIds.255` | my84, my97, my2610, ma114, ma118, ma123, ma130: utf8mb4_0900_ai_ci<br>ma106, ma1011: utf8mb4_general_ci |
| `handshakeCharsetIds.33` | my84, my97, my2610, ma106, ma1011, ma114: utf8mb3_general_ci<br>ma118, ma123, ma130: utf8mb3_uca1400_ai_ci |
| `handshakeCharsetIds.45` | my84, my97, my2610, ma106, ma1011: utf8mb4_general_ci<br>ma114, ma118, ma123, ma130: utf8mb4_uca1400_ai_ci |
| `newUserWithPasswordGetsPlugin` | my84, my97, my2610: caching_sha2_password<br>ma106, ma1011, ma114, ma118, ma123, ma130: mysql_native_password |
| `variables.authentication_policy` | my84, my97, my2610: *,,<br>ma106, ma1011, ma114, ma118, ma123, ma130: (absent) |
| `variables.binlog_format` | my84, my97, my2610, ma123, ma130: ROW<br>ma106, ma1011, ma114, ma118: MIXED |
| `variables.binlog_row_metadata` | my84, my97, my2610: MINIMAL<br>ma106, ma1011, ma114, ma118, ma123, ma130: NO_LOG |
| `variables.collation_connection` | my84, my97, my2610, ma106, ma1011: utf8mb4_general_ci<br>ma114, ma118, ma123, ma130: utf8mb4_uca1400_ai_ci |
| `variables.collation_server` | my84, my97, my2610: utf8mb4_0900_ai_ci<br>ma106, ma1011: utf8mb4_general_ci<br>ma114, ma118, ma123, ma130: utf8mb4_uca1400_ai_ci |
| `variables.cte_max_recursion_depth` | my84, my97, my2610: 1000<br>ma106, ma1011, ma114, ma118, ma123, ma130: (absent) |
| `variables.default_collation_for_utf8mb4` | my84, my97, my2610: utf8mb4_0900_ai_ci<br>ma106, ma1011, ma114, ma118, ma123, ma130: (absent) |
| `variables.explicit_defaults_for_timestamp` | my84, my97, my2610, ma1011, ma114, ma118, ma123, ma130: ON<br>ma106: OFF |
| `variables.gtid_mode` | my84: OFF<br>my97, my2610: ON<br>ma106, ma1011, ma114, ma118, ma123, ma130: (absent) |
| `variables.gtid_strict_mode` | my84, my97, my2610: (absent)<br>ma106, ma1011, ma114, ma118, ma123, ma130: OFF |
| `variables.have_ssl` | my84, my97, my2610: (absent)<br>ma106, ma1011: DISABLED<br>ma114, ma118, ma123, ma130: YES |
| `variables.histogram_type` | my84, my97, my2610: (absent)<br>ma106, ma1011: DOUBLE_PREC_HB<br>ma114, ma118, ma123, ma130: JSON_HB |
| `variables.local_infile` | my84, my97, my2610: OFF<br>ma106, ma1011, ma114, ma118, ma123, ma130: ON |
| `variables.log_bin` | my84, my97, my2610: ON<br>ma106, ma1011, ma114, ma118, ma123, ma130: OFF |
| `variables.max_allowed_packet` | my84, my97, my2610: 67108864<br>ma106, ma1011, ma114, ma118, ma123, ma130: 16777216 |
| `variables.max_recursive_iterations` | my84, my97, my2610: (absent)<br>ma106, ma1011, ma114, ma118, ma123, ma130: 1000 |
| `variables.old_mode` | my84, my97, my2610: (absent)<br>ma106, ma1011, ma114, ma118, ma123, ma130: UTF8_IS_UTF8MB3 |
| `variables.old_passwords` | my84, my97, my2610: (absent)<br>ma106, ma1011, ma114, ma118, ma123, ma130: OFF |
| `variables.protocol_compression_algorithms` | my84, my97, my2610: zlib,zstd,uncompressed<br>ma106, ma1011, ma114, ma118, ma123, ma130: (absent) |
| `variables.redirect_url` | my84, my97, my2610, ma106, ma1011: (absent)<br>ma114, ma118, ma123, ma130:  |
| `variables.resultset_metadata` | my84, my97, my2610: FULL<br>ma106, ma1011, ma114, ma118, ma123, ma130: (absent) |
| `variables.secure_auth` | my84, my97, my2610, ma130: (absent)<br>ma106, ma1011, ma114, ma118, ma123: ON |
| `variables.session_track_gtids` | my84, my97, my2610: OFF<br>ma106, ma1011, ma114, ma118, ma123, ma130: (absent) |
| `variables.session_track_system_variables` | my84, my97, my2610: time_zone,autocommit,character_set_client,character_set_results,character_set_connection<br>ma106, ma1011: autocommit,character_set_client,character_set_connection,character_set_results,time_zone<br>ma114, ma118, ma123, ma130: autocommit,character_set_client,character_set_connection,character_set_results,redirect_url,time_zone |
| `variables.sql_mode` | my84, my97, my2610: ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION<br>ma106, ma1011, ma114, ma118, ma123, ma130: STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION |
| `variables.ssl_cert` | my84, my97, my2610: server-cert.pem<br>ma106, ma1011, ma114, ma118, ma123, ma130:  |
| `variables.super_read_only` | my84, my97, my2610: OFF<br>ma106, ma1011, ma114, ma118, ma123, ma130: (absent) |
| `variables.transaction_isolation` | my84, my97, my2610, ma114, ma118, ma123, ma130: REPEATABLE-READ<br>ma106, ma1011: (absent) |
| `variables.tx_isolation` | my84, my97, my2610: (absent)<br>ma106, ma1011, ma114, ma118, ma123, ma130: REPEATABLE-READ |
| `variables.version` | my84: 8.4.13<br>my97: 9.7.4<br>my2610: 26.10.0<br>ma106: 10.6.28-MariaDB-ubu2204-log<br>ma1011: 10.11.19-MariaDB-ubu2204-log<br>ma114: 11.4.13-MariaDB-ubu2404-log<br>ma118: 11.8.9-MariaDB-ubu2404-log<br>ma123: 12.3.3-MariaDB-ubu2404-log<br>ma130: 13.0.2-MariaDB-ubu2604-log |
| `variables.version_comment` | my84, my97, my2610: MySQL Community Server - GPL<br>ma106, ma1011, ma114, ma118, ma123, ma130: mariadb.org binary distribution |

## Behaviour

546 items compared; 129 differ between at least two servers.

| item | grouping (servers with the same value) |
| --- | --- |
| `failures.E01 syntax error.message` | my84, my97, my2610: You have an error in your SQL syntax; check the manual that corresponds to your MySQL server version for the r<br>ma106, ma1011, ma114, ma118, ma123, ma130: You have an error in your SQL syntax; check the manual that corresponds to your MariaDB server version for the |
| `failures.E03 unknown column.message` | my84, my97, my2610: Unknown column 'nope' in 'field list'<br>ma106, ma1011, ma114, ma118, ma123, ma130: Unknown column 'nope' in 'SELECT' |
| `failures.E04 duplicate key.message` | my84, my97, my2610: Duplicate entry '1' for key 'pk.PRIMARY'<br>ma106, ma1011, ma114, ma118, ma123, ma130: Duplicate entry '1' for key 'PRIMARY' |
| `failures.E09 invalid JSON value.errno` | my84, my97, my2610: 3140<br>ma106, ma1011, ma114, ma118, ma123, ma130: 4025 |
| `failures.E09 invalid JSON value.message` | my84, my97, my2610: Invalid JSON text: "Missing a name for object member." at position 1 in value for column 'js.j'.<br>ma106, ma1011, ma114, ma118, ma123, ma130: CONSTRAINT `js.j` failed for `fs07`.`js` |
| `failures.E09 invalid JSON value.sqlState` | my84, my97, my2610: 22032<br>ma106, ma1011, ma114, ma118, ma123, ma130: 23000 |
| `failures.E10 foreign key violation.message` | my84, my97, my2610, ma106, ma1011, ma114, ma118: Cannot add or update a child row: a foreign key constraint fails (`fs07`.`child`, CONSTRAINT `child_ibfk_1` FO<br>ma123, ma130: Cannot add or update a child row: a foreign key constraint fails (`fs07`.`child`, CONSTRAINT `1` FOREIGN KEY ( |
| `failures.E11 CHECK constraint violation.errno` | my84, my97, my2610: 3819<br>ma106, ma1011, ma114, ma118, ma123, ma130: 4025 |
| `failures.E11 CHECK constraint violation.message` | my84, my97, my2610: Check constraint 'nn_chk_1' is violated.<br>ma106, ma1011, ma114, ma118, ma123, ma130: CONSTRAINT `CONSTRAINT_1` failed for `fs07`.`nn` |
| `failures.E11 CHECK constraint violation.sqlState` | my84, my97, my2610: HY000<br>ma106, ma1011, ma114, ma118, ma123, ma130: 23000 |
| `failures.E18 invalid cast / bad argument` | my84, my97, my2610: (absent)<br>ma106, ma1011, ma114, ma118, ma123, ma130: NO ERROR (statement succeeded) |
| `failures.E18 invalid cast / bad argument.errno` | my84, my97, my2610: 3141<br>ma106, ma1011, ma114, ma118, ma123, ma130: (absent) |
| `failures.E18 invalid cast / bad argument.message` | my84, my97, my2610: Invalid JSON text in argument 1 to function json_extract: "Missing a name for object member." at position 1.<br>ma106, ma1011, ma114, ma118, ma123, ma130: (absent) |
| `failures.E18 invalid cast / bad argument.sqlState` | my84, my97, my2610: 22032<br>ma106, ma1011, ma114, ma118, ma123, ma130: (absent) |
| `failures.E19 RETURNING on INSERT` | my84, my97, my2610: (absent)<br>ma106, ma1011, ma114, ma118, ma123, ma130: NO ERROR (statement succeeded) |
| `failures.E19 RETURNING on INSERT.errno` | my84, my97, my2610: 1064<br>ma106, ma1011, ma114, ma118, ma123, ma130: (absent) |
| `failures.E19 RETURNING on INSERT.message` | my84, my97, my2610: You have an error in your SQL syntax; check the manual that corresponds to your MySQL server version for the r<br>ma106, ma1011, ma114, ma118, ma123, ma130: (absent) |
| `failures.E19 RETURNING on INSERT.sqlState` | my84, my97, my2610: 42000<br>ma106, ma1011, ma114, ma118, ma123, ma130: (absent) |
| `failures.E20 create sequence` | my84, my97, my2610: (absent)<br>ma106, ma1011, ma114, ma118, ma123, ma130: NO ERROR (statement succeeded) |
| `failures.E20 create sequence.errno` | my84, my97, my2610: 1064<br>ma106, ma1011, ma114, ma118, ma123, ma130: (absent) |
| `failures.E20 create sequence.message` | my84, my97, my2610: You have an error in your SQL syntax; check the manual that corresponds to your MySQL server version for the r<br>ma106, ma1011, ma114, ma118, ma123, ma130: (absent) |
| `failures.E20 create sequence.sqlState` | my84, my97, my2610: 42000<br>ma106, ma1011, ma114, ma118, ma123, ma130: (absent) |
| `failures.E22 execute unknown statement id.message` | my84, my97, my2610: Unknown prepared statement handler (4660) given to mysql_stmt_precheck<br>ma106, ma1011, ma114, ma118, ma123, ma130: Unknown prepared statement handler (4660) given to mysqld_stmt_execute |
| `lifecycle.B12_cursor.openedStatusFlags.1` | my84, my97, my2610: CURSOR_EXISTS<br>ma106, ma1011, ma114, ma118, ma123, ma130: NO_INDEX_USED |
| `lifecycle.B12_cursor.openedStatusFlags.2` | my84, my97, my2610: (absent)<br>ma106, ma1011, ma114, ma118, ma123, ma130: CURSOR_EXISTS |
| `lifecycle.B13_loadDataLocalInfile.clientWithLocalFilesCapability.0` | my84, my97, my2610: ERR 3948: Loading local data is disabled; this must be enabled on both the client and server sides<br>ma106, ma1011, ma114, ma118, ma123, ma130: ERR -1: server requested a local file (LOCAL INFILE is not enabled by this client) |
| `lifecycle.B13_loadDataLocalInfile.clientWithoutLocalFilesCapability.0` | my84, my97, my2610: ERR 3948: Loading local data is disabled; this must be enabled on both the client and serv<br>ma106, ma1011, ma114, ma118, ma123, ma130: ERR 4166: The used command is not allowed because the MariaDB server or client has disable |
| `lifecycle.B13_loadDataLocalInfile.serverVariable_local_infile` | my84, my97, my2610: OFF<br>ma106, ma1011, ma114, ma118, ma123, ma130: ON |
| `lifecycle.B14_failoverAndReplicationSignals.groupReplicationMembersTable` | my84, my97, my2610: exists<br>ma106, ma1011, ma114, ma118, ma123, ma130: absent |
| `lifecycle.B14_failoverAndReplicationSignals.gtid_current_pos` | my84, my97, my2610: unknown variable<br>ma106, ma1011, ma114, ma118, ma123, ma130:  |
| `lifecycle.B14_failoverAndReplicationSignals.gtid_domain_id` | my84, my97, my2610: unknown variable<br>ma106, ma1011, ma114, ma118, ma123, ma130: 0 |
| `lifecycle.B14_failoverAndReplicationSignals.gtid_executed` | my84: <br>my97: f2be7bfa-e5e6-11f1-a398-4ab8681fc9dd:1-53<br>my2610: f2fc00d3-e5e6-11f1-9300-3255b682f61c:1-53<br>ma106, ma1011, ma114, ma118, ma123, ma130: unknown variable |
| `lifecycle.B14_failoverAndReplicationSignals.gtid_mode` | my84: OFF<br>my97, my2610: ON<br>ma106, ma1011, ma114, ma118, ma123, ma130: unknown variable |
| `lifecycle.B14_failoverAndReplicationSignals.read_only` | my84, my97, my2610, ma106, ma1011, ma114, ma118: 0<br>ma123, ma130: OFF |
| `lifecycle.B14_failoverAndReplicationSignals.redirect_url` | my84, my97, my2610, ma106, ma1011: unknown variable<br>ma114, ma118, ma123, ma130:  |
| `lifecycle.B14_failoverAndReplicationSignals.relevantPlugins.0` | my84, my97, my2610: (absent)<br>ma106, ma1011, ma114, ma118, ma123, ma130: wsrep:ACTIVE |
| `lifecycle.B14_failoverAndReplicationSignals.super_read_only` | my84, my97, my2610: 0<br>ma106, ma1011, ma114, ma118, ma123, ma130: unknown variable |
| `lifecycle.B14_failoverAndReplicationSignals.wsrep_on` | my84, my97, my2610: unknown variable<br>ma106, ma1011, ma114, ma118, ma123, ma130: 0 |
| `lifecycle.B9_resetConnection.after.2` | my84, my97, my2610: ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION<br>ma106, ma1011, ma114, ma118, ma123, ma130: STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION |
| `lifecycle.B9_resetConnection.after.5` | my84, my97, my2610: utf8mb4_0900_ai_ci<br>ma106, ma1011: utf8mb4_general_ci<br>ma114, ma118, ma123, ma130: utf8mb4_uca1400_ai_ci |
| `misc.B5_isolationVariable.transaction_isolation` | my84, my97, my2610, ma114, ma118, ma123, ma130: REPEATABLE-READ<br>ma106, ma1011: unknown variable |
| `misc.B5_isolationVariable.tx_isolation` | my84, my97, my2610: unknown variable<br>ma106, ma1011, ma114, ma118, ma123, ma130: REPEATABLE-READ |
| `misc.B6_returning.delete` | my84, my97, my2610: ERR 1064: You have an error in your SQL syntax; check the ma<br>ma106, ma1011, ma114, ma118, ma123: rows [["1","2"]]<br>ma130: rows [["1","3"]] |
| `misc.B6_returning.insert` | my84, my97, my2610: ERR 1064: You have an error in your SQL syntax; check the ma<br>ma106, ma1011, ma114, ma118, ma123, ma130: rows [["1","1"]] |
| `misc.B6_returning.replace` | my84, my97, my2610: ERR 1064: You have an error in your SQL syntax; check the ma<br>ma106, ma1011, ma114, ma118, ma123, ma130: rows [["1","2"]] |
| `misc.B6_returning.update` | my84, my97, my2610, ma106, ma1011, ma114, ma118, ma123: ERR 1064: You have an error in your SQL syntax; check the ma<br>ma130: rows [["1","3"]] |
| `misc.B7_json.castAsJson` | my84, my97, my2610: supported<br>ma106, ma1011, ma114, ma118, ma123, ma130: [1064] (42000) You have an error in your SQL syntax; check the manual that corre |
| `misc.B7_json.informationSchemaDataType.0` | my84, my97, my2610: json<br>ma106, ma1011, ma114, ma118, ma123, ma130: longtext |
| `misc.B7_json.informationSchemaDataType.1` | my84, my97, my2610: json<br>ma106, ma1011, ma114, ma118, ma123, ma130: longtext |
| `misc.B7_json.jsonFunctionResultColumns.0` | my84, my97, my2610: j: JSON/cs45/flags128/null<br>ma106, ma1011: j: VAR_STRING/cs45/flags0/{"format":"json"}<br>ma114, ma118, ma123, ma130: j: VAR_STRING/cs224/flags0/{"format":"json"} |
| `misc.B7_json.jsonFunctionResultColumns.1` | my84, my97, my2610: k: JSON/cs45/flags128/null<br>ma106, ma1011: k: VAR_STRING/cs45/flags0/{"format":"json"}<br>ma114, ma118, ma123, ma130: k: VAR_STRING/cs224/flags0/{"format":"json"} |
| `misc.B7_json.showCreateTable` | my84, my97, my2610: CREATE TABLE `jt` ( `j` json DEFAULT NULL ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci<br>ma106, ma1011: CREATE TABLE `jt` ( `j` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`j`)) ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=…<br>ma114, ma118, ma123, ma130: CREATE TABLE `jt` ( `j` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`j`)) ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=… |
| `types.columns.11.charset` | my84, my97, my2610, ma106, ma1011: 45<br>ma114, ma118, ma123, ma130: 224 |
| `types.columns.13.charset` | my84, my97, my2610, ma106, ma1011: 45<br>ma114, ma118, ma123, ma130: 224 |
| `types.columns.19.flags` | my84, my97, my2610: 128<br>ma106, ma1011, ma114, ma118, ma123, ma130: 160 |
| `types.columns.21.binary` | my84, my97, my2610: {"a": [1, 2, {"c": null}], "b": 1}<br>ma106, ma1011, ma114, ma118, ma123, ma130: {"b": 1, "a": [1, 2, {"c": null}]} |
| `types.columns.21.charset` | my84, my97, my2610: 63<br>ma106, ma1011: 45<br>ma114, ma118, ma123, ma130: 224 |
| `types.columns.21.extra` | my84, my97, my2610: null<br>ma106, ma1011, ma114, ma118, ma123, ma130: (absent) |
| `types.columns.21.extra.format` | my84, my97, my2610: (absent)<br>ma106, ma1011, ma114, ma118, ma123, ma130: json |
| `types.columns.21.serverSays` | my84, my97, my2610: {"a": [1, 2, {"c": null}], "b": 1}<br>ma106, ma1011, ma114, ma118, ma123, ma130: {"b": 1, "a": [1, 2, {"c": null}]} |
| `types.columns.21.text` | my84, my97, my2610: {"a": [1, 2, {"c": null}], "b": 1}<br>ma106, ma1011, ma114, ma118, ma123, ma130: {"b": 1, "a": [1, 2, {"c": null}]} |
| `types.columns.21.wireType` | my84, my97, my2610: 245 JSON<br>ma106, ma1011, ma114, ma118, ma123, ma130: 252 BLOB |
| `types.columns.22.charset` | my84, my97, my2610, ma106, ma1011: 45<br>ma114, ma118, ma123, ma130: 224 |
| `types.columns.23.charset` | my84, my97, my2610, ma106, ma1011: 45<br>ma114, ma118, ma123, ma130: 224 |
| `types.columns.25.agreesWithServerFormatting` | my84: (absent)<br>my97, my2610, ma106, ma1011, ma114, ma118, ma123, ma130: true |
| `types.columns.25.binary` | my84: (absent)<br>my97, my2610: hex:0000803f0000004000004040<br>ma106: ::ffff:192.168.0.1<br>ma1011, ma114, ma118, ma123, ma130: 123e4567-e89b-12d3-a456-426614174000 |
| `types.columns.25.charset` | my84: (absent)<br>my97, my2610: 63<br>ma106, ma1011: 45<br>ma114, ma118, ma123, ma130: 224 |
| `types.columns.25.column` | my84: (absent)<br>my97, my2610: c_vec<br>ma106: c_inet6<br>ma1011, ma114, ma118, ma123, ma130: c_uuid |
| `types.columns.25.decimals` | my84: (absent)<br>my97, my2610: 31<br>ma106, ma1011, ma114, ma118, ma123, ma130: 0 |
| `types.columns.25.extra` | my84, ma106, ma1011, ma114, ma118, ma123, ma130: (absent)<br>my97, my2610: null |
| `types.columns.25.extra.typeName` | my84, my97, my2610: (absent)<br>ma106: inet6<br>ma1011, ma114, ma118, ma123, ma130: uuid |
| `types.columns.25.flags` | my84: (absent)<br>my97, my2610: 144<br>ma106, ma1011, ma114, ma118, ma123, ma130: 160 |
| `types.columns.25.jsType` | my84: (absent)<br>my97, my2610: Buffer<br>ma106, ma1011, ma114, ma118, ma123, ma130: string |
| `types.columns.25.length` | my84: (absent)<br>my97, my2610: 12<br>ma106: 156<br>ma1011, ma114, ma118, ma123, ma130: 144 |
| `types.columns.25.serverSays` | my84: (absent)<br>my97, my2610: 0000803F0000004000004040<br>ma106: ::ffff:192.168.0.1<br>ma1011, ma114, ma118, ma123, ma130: 123e4567-e89b-12d3-a456-426614174000 |
| `types.columns.25.text` | my84: (absent)<br>my97, my2610: hex:0000803f0000004000004040<br>ma106: ::ffff:192.168.0.1<br>ma1011, ma114, ma118, ma123, ma130: 123e4567-e89b-12d3-a456-426614174000 |
| `types.columns.25.textEqualsBinary` | my84: (absent)<br>my97, my2610, ma106, ma1011, ma114, ma118, ma123, ma130: true |
| `types.columns.25.wireType` | my84: (absent)<br>my97, my2610: 242 VECTOR<br>ma106, ma1011, ma114, ma118, ma123, ma130: 254 STRING |
| `types.columns.26.agreesWithServerFormatting` | my84, my97, my2610, ma106: (absent)<br>ma1011, ma114, ma118, ma123, ma130: true |
| `types.columns.26.binary` | my84, my97, my2610, ma106: (absent)<br>ma1011, ma114, ma118, ma123, ma130: 192.168.0.1 |
| `types.columns.26.charset` | my84, my97, my2610, ma106: (absent)<br>ma1011: 45<br>ma114, ma118, ma123, ma130: 224 |
| `types.columns.26.column` | my84, my97, my2610, ma106: (absent)<br>ma1011, ma114, ma118, ma123, ma130: c_inet4 |
| `types.columns.26.decimals` | my84, my97, my2610, ma106: (absent)<br>ma1011, ma114, ma118, ma123, ma130: 0 |
| `types.columns.26.extra.typeName` | my84, my97, my2610, ma106: (absent)<br>ma1011, ma114, ma118, ma123, ma130: inet4 |
| `types.columns.26.flags` | my84, my97, my2610, ma106: (absent)<br>ma1011, ma114, ma118, ma123, ma130: 160 |
| `types.columns.26.jsType` | my84, my97, my2610, ma106: (absent)<br>ma1011, ma114, ma118, ma123, ma130: string |
| `types.columns.26.length` | my84, my97, my2610, ma106: (absent)<br>ma1011, ma114, ma118, ma123, ma130: 60 |
| `types.columns.26.serverSays` | my84, my97, my2610, ma106: (absent)<br>ma1011, ma114, ma118, ma123, ma130: 192.168.0.1 |
| `types.columns.26.text` | my84, my97, my2610, ma106: (absent)<br>ma1011, ma114, ma118, ma123, ma130: 192.168.0.1 |
| `types.columns.26.textEqualsBinary` | my84, my97, my2610, ma106: (absent)<br>ma1011, ma114, ma118, ma123, ma130: true |
| `types.columns.26.wireType` | my84, my97, my2610, ma106: (absent)<br>ma1011, ma114, ma118, ma123, ma130: 254 STRING |
| `types.columns.27.agreesWithServerFormatting` | my84, my97, my2610, ma106: (absent)<br>ma1011, ma114, ma118, ma123, ma130: true |
| `types.columns.27.binary` | my84, my97, my2610, ma106: (absent)<br>ma1011, ma114, ma118, ma123, ma130: ::ffff:192.168.0.1 |
| `types.columns.27.charset` | my84, my97, my2610, ma106: (absent)<br>ma1011: 45<br>ma114, ma118, ma123, ma130: 224 |
| `types.columns.27.column` | my84, my97, my2610, ma106: (absent)<br>ma1011, ma114, ma118, ma123, ma130: c_inet6 |
| `types.columns.27.decimals` | my84, my97, my2610, ma106: (absent)<br>ma1011, ma114, ma118, ma123, ma130: 0 |
| `types.columns.27.extra.typeName` | my84, my97, my2610, ma106: (absent)<br>ma1011, ma114, ma118, ma123, ma130: inet6 |
| `types.columns.27.flags` | my84, my97, my2610, ma106: (absent)<br>ma1011, ma114, ma118, ma123, ma130: 160 |
| `types.columns.27.jsType` | my84, my97, my2610, ma106: (absent)<br>ma1011, ma114, ma118, ma123, ma130: string |
| `types.columns.27.length` | my84, my97, my2610, ma106: (absent)<br>ma1011, ma114, ma118, ma123, ma130: 156 |
| `types.columns.27.serverSays` | my84, my97, my2610, ma106: (absent)<br>ma1011, ma114, ma118, ma123, ma130: ::ffff:192.168.0.1 |
| `types.columns.27.text` | my84, my97, my2610, ma106: (absent)<br>ma1011, ma114, ma118, ma123, ma130: ::ffff:192.168.0.1 |
| `types.columns.27.textEqualsBinary` | my84, my97, my2610, ma106: (absent)<br>ma1011, ma114, ma118, ma123, ma130: true |
| `types.columns.27.wireType` | my84, my97, my2610, ma106: (absent)<br>ma1011, ma114, ma118, ma123, ma130: 254 STRING |
| `types.columns.28.agreesWithServerFormatting` | my84, my97, my2610, ma106, ma1011, ma114: (absent)<br>ma118, ma123, ma130: true |
| `types.columns.28.binary` | my84, my97, my2610, ma106, ma1011, ma114: (absent)<br>ma118, ma123, ma130: hex:0000803f0000004000004040 |
| `types.columns.28.charset` | my84, my97, my2610, ma106, ma1011, ma114: (absent)<br>ma118, ma123, ma130: 63 |
| `types.columns.28.column` | my84, my97, my2610, ma106, ma1011, ma114: (absent)<br>ma118, ma123, ma130: c_vec |
| `types.columns.28.decimals` | my84, my97, my2610, ma106, ma1011, ma114: (absent)<br>ma118, ma123, ma130: 0 |
| `types.columns.28.extra` | my84, my97, my2610, ma106, ma1011, ma114: (absent)<br>ma118, ma123, ma130: null |
| `types.columns.28.flags` | my84, my97, my2610, ma106, ma1011, ma114: (absent)<br>ma118, ma123, ma130: 128 |
| `types.columns.28.jsType` | my84, my97, my2610, ma106, ma1011, ma114: (absent)<br>ma118, ma123, ma130: Buffer |
| `types.columns.28.length` | my84, my97, my2610, ma106, ma1011, ma114: (absent)<br>ma118, ma123, ma130: 12 |
| `types.columns.28.serverSays` | my84, my97, my2610, ma106, ma1011, ma114: (absent)<br>ma118, ma123, ma130: 0000803F0000004000004040 |
| `types.columns.28.text` | my84, my97, my2610, ma106, ma1011, ma114: (absent)<br>ma118, ma123, ma130: hex:0000803f0000004000004040 |
| `types.columns.28.textEqualsBinary` | my84, my97, my2610, ma106, ma1011, ma114: (absent)<br>ma118, ma123, ma130: true |
| `types.columns.28.wireType` | my84, my97, my2610, ma106, ma1011, ma114: (absent)<br>ma118, ma123, ma130: 253 VAR_STRING |
| `types.literalAndExpressionTypes.0` | my84, my97, my2610: a:LONGLONG/cs63/flags129<br>ma106, ma1011, ma114, ma118, ma123, ma130: a:LONG/cs63/flags129 |
| `types.literalAndExpressionTypes.10` | my84, my97, my2610, ma106, ma1011: k:VAR_STRING/cs45/flags1<br>ma114, ma118, ma123, ma130: k:VAR_STRING/cs224/flags1 |
| `types.literalAndExpressionTypes.11` | my84, my97, my2610, ma106, ma1011: l:VAR_STRING/cs45/flags0<br>ma114, ma118, ma123, ma130: l:VAR_STRING/cs224/flags0 |
| `types.literalAndExpressionTypes.12` | my84, my97, my2610: m:JSON/cs45/flags128<br>ma106, ma1011: m:VAR_STRING/cs45/flags0<br>ma114, ma118, ma123, ma130: m:VAR_STRING/cs224/flags0 |
| `types.literalAndExpressionTypes.2` | my84, my97, my2610: c:LONGLONG/cs63/flags129<br>ma106, ma1011, ma114, ma118, ma123, ma130: c:LONG/cs63/flags129 |
| `types.literalAndExpressionTypes.6` | my84, my97, my2610: g:LONGLONG/cs63/flags128<br>ma106, ma1011, ma114, ma118, ma123, ma130: g:LONG/cs63/flags128 |
| `types.literalAndExpressionTypes.8` | my84, my97, my2610: i:LONGLONG/cs63/flags129<br>ma106, ma1011, ma114, ma118, ma123, ma130: i:LONG/cs63/flags129 |
| `types.literalAndExpressionTypes.9` | my84, my97, my2610: j:LONGLONG/cs63/flags129<br>ma106, ma1011, ma114, ma118, ma123, ma130: j:LONG/cs63/flags129 |
| `types.optionalTypes.c_inet4` | my84, my97, my2610: [1064] (42000) You have an error in your SQL syntax; check the manual that corresponds to <br>ma106: [4161] (HY000) Unknown data type: 'inet4'<br>ma1011, ma114, ma118, ma123, ma130: supported |
| `types.optionalTypes.c_inet6` | my84, my97, my2610: [1064] (42000) You have an error in your SQL syntax; check the manual that corresponds to <br>ma106, ma1011, ma114, ma118, ma123, ma130: supported |
| `types.optionalTypes.c_uuid` | my84, my97, my2610: [1064] (42000) You have an error in your SQL syntax; check the manual that corresponds to <br>ma106: [4161] (HY000) Unknown data type: 'uuid'<br>ma1011, ma114, ma118, ma123, ma130: supported |
| `types.optionalTypes.c_vec` | my84: [1064] (42000) You have an error in your SQL syntax; check the manual that corresponds to <br>my97, my2610, ma118, ma123, ma130: supported<br>ma106, ma1011, ma114: [4161] (HY000) Unknown data type: 'vector' |
