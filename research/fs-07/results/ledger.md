# Claim ledger

31 claims from the roadmap appendix, one row each. Verdicts: Confirmed 9, Corrected 19, Not verifiable here 3.

Rule used throughout: when the documentation and a live server disagree, the server wins and the disagreement is recorded in the row.

| ID | area | verdict | in one line |
| --- | --- | --- | --- |
| M-01 | Wire protocol | Confirmed | All parts hold on the nine servers; one sequence-id detail the claim does not state is worth recording. |
| M-02 | Authentication plugins | Corrected | Fast and full caching_sha2 paths, auth switch and the native-password rule are confirmed; the plugin availability and the clear-password condition are not as written. |
| M-03 | Text protocol | Confirmed | Multi-statements are refused unless the client sets the flag, on all 9; result sets from CALL need MULTI_RESULTS. |
| M-04 | Binary protocol | Corrected | All listed commands work on all 9; the statement cache bound is a server-wide limit, not a per-driver one. |
| M-05 | Result decoding | Confirmed | Text and binary decoding agrees with the servers' own formatting for every tested column on all 9; collation ids are server-specific. |
| M-06 | Type contract | Corrected | The numeric, string, BIT, YEAR, TIME and geometry rules hold on all 9; JSON and vector are different wire types per family and zero-date behaviour differs by default. |
| M-07 | Transactions | Confirmed | Autocommit and in-transaction state are visible in the OK status flags and an implicit commit by DDL shows up as the flag clearing, identically on all 9; only the isolation variable name differs. |
| M-08 | Streaming | Corrected | Cursors through COM_STMT_FETCH work on all 9; the connection is not busy between fetches. |
| M-09 | Pooling and lifecycle | Corrected | Reset and ping behave as claimed; the 'no pipelining is assumed' premise is a design choice, not a MySQL limit. |
| M-10 | TLS | Corrected | TLS upgrade inside the handshake works where the server offers TLS, which is not every matrix server; a verify-full default cannot connect to any stock server. |
| M-11 | Bulk load | Confirmed | LOAD DATA LOCAL INFILE is refused without the client capability on all 9, and the server really asks the client for the file when both sides agree; the server-side default differs. |
| M-12 | Replication and CDC | Corrected | Not exercised on the wire (FS-11 owns the reader); the defaults the claim relies on differ: MariaDB does not log ROW by default before 12.3. |
| M-13 | Failover | Corrected | read_only exists on both; super_read_only and Group Replication views exist only on MySQL; no server has a target_session_attrs equivalent. |
| M-14 | Proxies and platforms | Not verifiable here | Hosted services cannot be tested; ProxySQL 3.0.12 was, and shows pipelining and MariaDB extensions behave differently behind it. |
| M-15 | Performance | Corrected | Compression: zlib is offered by all 9, zstd only by MySQL; the other items are performance claims with nothing to verify here. |
| M-16 | Hyperdrive constraint | Not verifiable here | Cloudflare's page lists all four named limits (and two more); Hyperdrive itself cannot be run here. |
| M-Q1 | Open question | Confirmed | Answered: MySQL 8.4 loads caching_sha2_password and sha256_password and ships native disabled; 9.7 and 26.10 load only the first two. |
| M-Q2 | Open question | Confirmed | Answered: yes under the stated definition, with the exceptions in the pipelining tables; MySQL has no prepare-and-execute without waiting. |
| M-Q3 | Open question | Not verifiable here | Vitess and RDS Proxy are not runnable here; the documentation position is recorded, ProxySQL was tested. |
| M-Q4 | Open question | Confirmed | Answered from the documentation and the sizes of the servers' own Table_map events; contents were not decoded here. |
| D-01 | Handshake and server identity | Corrected | Family and extended capabilities are read from the greeting as claimed, but the '5.5.5-' prefix is gone from 11.x and must not be the detector. |
| D-02 | Protocol capabilities | Corrected | Extended metadata, metadata caching, bulk and progress all exist and work; the flag is called EXTENDED_METADATA, JSON is marked through a format name, and MySQL has its own, riskier, metadata skip. |
| D-03 | Authentication plugins | Corrected | Native stays the default and ed25519, PARSEC, caching_sha2 and PAM libraries exist, but availability depends on the series and none except native is loaded by default. |
| D-04 | Prepared statements | Confirmed | Bulk execute and the placeholder-id prepare-and-execute both work on all six MariaDB servers and do not exist on MySQL. |
| D-05 | Pipelining | Corrected | Generic pipelining works on MariaDB exactly as on MySQL; the documented support is for the two special forms only. |
| D-06 | Data types and codecs | Corrected | JSON, UUID, INET4, INET6, vector and sequences are as claimed except that availability depends on the series and MySQL 9.x has a vector type too. |
| D-07 | SQL surface affecting the driver | Corrected | RETURNING exists for INSERT, REPLACE and DELETE on all six; UPDATE ... RETURNING exists on 13.0 only. |
| D-08 | Replication and CDC | Corrected | Event set differences (annotate rows, GTID form) are visible; the replica negotiation was not run, and the claim's 'default' context needs binlog settings. |
| D-09 | Error codes | Corrected | MariaDB-only numbers exist, but above 4000 the numbers collide with different meanings in MySQL. |
| D-10 | Connection behaviour | Corrected | Server-initiated redirection exists, is carried in the session-state tracker, and works from 11.8 in the matrix (11.4.13 accepted the variable but sent nothing); Galera and MaxScale were not run. |
| D-11 | Version compatibility | Corrected | The long-term set at the time of the study is 10.11, 11.4, 11.8 and 12.3; 10.6 is past end of life and 13.0 is a rolling series. |

## M-01 Wire protocol: Confirmed

**Claim.** Handshake v10, capability negotiation, packet framing with 16 MB splitting, sequence ids, CLIENT_DEPRECATE_EOF, session tracking, connection attributes

**Documentation.** MySQL protocol pages `page_protocol_connection_phase`, `page_protocol_basic_packets` (dev.mysql.com/doc/dev/mysql-server/latest/), `include/mysql_com.h` at tags 8.4.13, 9.7.4, 26.10.0; refman 26.10 session-state-tracking and performance-schema-connection-attribute-tables. The packet page says a payload of 2^24-1 bytes or more is split, so a reader must expect a zero-length final packet. Nothing documents flow control at the packet layer.

**Live servers.** Handshake v10 and capability negotiation: all 9 greet with protocol 10; MySQL offers 0xdfffffff, MariaDB 0x81fff7fe (10.6, 10.11) or 0x81fffffe (11.4 and later). CLIENT_DEPRECATE_EOF: negotiated on all 9, result sets end with an OK packet with header 0xfe in the independent trace. 16 MB splitting: a COM_QUERY of exactly 0xFFFFFF, 0xFFFFFF+1 and 2x0xFFFFFF payload bytes, and server rows of 0xFFFFFF+5 and exactly 0xFFFFFF bytes, all round-trip on all 9 (the proxy's own splitter saw logical packets of 16,777,215 and 16,777,229 bytes). Sequence ids: the prototype checks every id; for a command split into n packets the response starts at id n, not at 1, on all 9 (the first version of the prototype assumed 1 and failed on the exact-multiple case). Session tracking: OK packets carry state-change entries on all 9 (system variables, schema); the default tracked variable list differs (see M-07, D-10). Connection attributes: the attributes the prototype sent are visible in performance_schema.session_connect_attrs on all 9 (performance_schema switched on in the MariaDB containers).

**Evidence files.** `results/bigpacket/*.json`, `results/facts/*.json`, `results/wire/matrix.md`, `results/behaviour/*.json`

## M-02 Authentication plugins: Corrected

**Claim.** caching_sha2_password (fast path and full path over TLS or RSA key exchange), auth-switch flow, mysql_clear_password only over verified TLS for IAM tokens, mysql_native_password only when explicitly allowed

**Documentation.** Connection-phase and caching-SHA2 exchange pages (dev docs), refman 8.4, 9.7, 26.10 `caching-sha2-pluggable-authentication` and `cleartext-pluggable-authentication`; release notes 8.1.0, 8.2.0 and 9.0.0 (native password deprecated, disabled by default in 8.4.0, removed in 9.0.0); source `sql/auth/sha2_password.cc` at tag mysql-26.10.0 for the marker bytes (3 fast success, 4 full authentication, 2 key request). The manual requires only an explicit client opt-in for mysql_clear_password and recommends a protected channel; it never says the certificate must be verified and never mentions IAM tokens. AWS's IAM example passes a CA file plus the opt-in flag.

**Live servers.** caching_sha2_password on MySQL 8.4, 9.7, 26.10: first login of an account on plain TCP is AUTH_MORE 0x04, key request, RSA reply, OK; the second login is AUTH_MORE 0x03 then OK (fast path); after FLUSH PRIVILEGES the full path returns. Over TLS the prototype sends the password in clear inside the tunnel and the first (cold-cache) login succeeds. mysql2 and Connector/Node.js behave the same. Auth switch: accounts of other plugins on a caching_sha2 greeting produce AUTH_SWITCH (sha256_password: switch, more-data, OK; native: switch, OK). mysql_native_password: 8.4 loads it as DISABLED, an account cannot be created until the server starts with --mysql-native-password=ON (second 8.4 container, then it works for all three clients). On 9.7 and 26.10 the plugin does not exist; `INSTALL PLUGIN ... SONAME 'mysql_native_password.so'` fails with 'Can't find symbol' (the .so in those images is not a server plugin). mysql_clear_password: no matrix server has a server-side plugin that uses it; not exercised. caching_sha2_password also works on MariaDB 11.4+ (auth_mysql_sha2, not loaded by default) but only over TLS: without TLS the server answers the key request with error 1045; there is no RSA exchange.

**Evidence files.** `results/auth/summary.md`, `results/auth/*.json`, `results/sha2tls/*.json`

**Corrected sentence.** caching_sha2_password has a fast path (server byte 0x03) and a full path (0x04): the full path sends the password in clear over TLS, or encrypted with the server's RSA key that the client requests with 0x02 on plain TCP; MariaDB 11.4+ offers the plugin only after INSTALL SONAME auth_mysql_sha2 and only supports the TLS form. mysql_native_password is opt-in on MySQL 8.4 (--mysql-native-password=ON) and does not exist on 9.7 and 26.10, but it is the default plugin on every MariaDB. mysql_clear_password has no server-side counterpart on any matrix server; the MySQL manual requires a client opt-in, not verified TLS, so that condition is an OKDriver policy rather than a documented MySQL rule.

## M-03 Text protocol: Confirmed

**Claim.** COM_QUERY, multi-statements off by default, multi-result sets

**Documentation.** `page_protocol_com_query` and the C API multiple-queries page. The capability-flag page says CLIENT_MULTI_STATEMENTS is 'currently not checked anywhere', which contradicts the stored-program and COM_SET_OPTION pages; the server wins (see live column). 'Off by default' is client behaviour: a client that never sets the flag never gets multi-statements.

**Live servers.** `select 1; select 2` without the flag: error 1064 on all 9. With CLIENT_MULTI_STATEMENTS: results rows(1), rows(2), OK on all 9 (SERVER_MORE_RESULTS_EXISTS chains them). `CALL` of a procedure with two result sets: two result sets plus OK with MULTI_RESULTS; without MULTI_RESULTS and PS_MULTI_RESULTS error 1312 on all 9. So the flag is enforced on every matrix server, whatever the capability page says.

**Evidence files.** `results/behaviour/*.json (misc.B1, misc.B2)`

## M-04 Binary protocol: Corrected

**Claim.** COM_STMT_PREPARE, EXECUTE, FETCH, RESET, CLOSE, SEND_LONG_DATA, cursors; statement cache bounded by the server's max_prepared_stmt_count

**Documentation.** `page_protocol_com_stmt_prepare` and the other COM_STMT_* pages; refman 26.10 statement-caching. The variable max_prepared_stmt_count is a ceiling summed over every session (default 16382), enforced when a statement is prepared. COM_STMT_CLOSE and COM_STMT_SEND_LONG_DATA return nothing, so an error shows only at the next command that answers. The FETCH page has a copy-paste error (calls the id 'the statement to close').

**Live servers.** PREPARE, EXECUTE, RESET, CLOSE: byte-identical requests from the prototype, mysql2 and Connector/Node.js apart from parameter types and statement ids (golden traces). CLOSE and SEND_LONG_DATA produce no response in the trace. SEND_LONG_DATA: two 100,000-byte chunks followed by an execute with no inline value stores 200,000 bytes on all 9. Cursors: COM_STMT_EXECUTE with flag 1 returns no rows and status CURSOR_EXISTS; three FETCH calls return 4, 4 and 2 rows, the last with LAST_ROW_SENT, on all 9. Limit: with max_prepared_stmt_count set to 3, the third and fourth prepare across two different connections fail with error 1461 on all 9, so the cap is global; default value 16382 on all 9.

**Evidence files.** `results/behaviour/*.json (lifecycle.B10, B11, B12)`, `results/wire/golden.json`, `results/wire/matrix.md`

**Corrected sentence.** COM_STMT_PREPARE, EXECUTE, FETCH, RESET, CLOSE, SEND_LONG_DATA and read-only cursors work on all nine servers; max_prepared_stmt_count (default 16382) is one ceiling shared by every connection of the server, exceeded at PREPARE with error 1461, so a driver's statement cache needs headroom below it rather than being 'bounded by' it.

## M-05 Result decoding: Confirmed

**Claim.** Text and binary rows, NULL bitmap, per-column charset and collation

**Documentation.** Dev pages for text result-set rows and binary result-set rows. The NULL bitmap offset of 2 applies to binary rows only. `column_length` is a maximum, not a character count.

**Live servers.** Per server, 25 to 29 columns (integers, DECIMAL, float, double, varchar utf8mb4, varbinary, text, blob, BIT, YEAR, date, datetime(6), timestamp(6), time(6), JSON, enum, set, geometry, plus uuid/inet4/inet6/vector where present) were decoded from text and from binary rows and compared with the server's own CAST AS CHAR or HEX output: 0 mismatches on all 9. Per-column charset ids come from the column definition and differ by server: the same utf8mb4 column reports 45 on MySQL and MariaDB 10.6/10.11 but 224 on MariaDB 11.4 and later (the handshake charset 45 is remapped by the server to its default utf8mb4 collation, see M-06 and the facts).

**Evidence files.** `results/behaviour/*.json (types)`, `results/facts/*.json (handshakeCharsetIds)`

## M-06 Type contract: Corrected

**Claim.** DECIMAL as string, BIGINT and BIGINT UNSIGNED as bigint, TINYINT(1) stays numeric unless a plan says boolean, BIT, YEAR, TIME beyond 24 hours, zero dates as error or null by explicit option, JSON, geometry, vector

**Documentation.** C API prepared-statement type-code table (lists only classic types; JSON, GEOMETRY and VECTOR are absent), numeric-type syntax page (display width and ZEROFILL deprecated, relevant to TINYINT(1)). The MySQL VECTOR wire encoding is not in the protocol docs.

**Live servers.** DECIMAL(20,6) arrives as a string and round-trips on all 9. BIGINT and BIGINT UNSIGNED arrive as LONGLONG with the unsigned flag; -9223372036854775808 and 18446744073709551615 round-trip as bigint on all 9. TINYINT(1) is wire type TINY with no boolean marker on both families. BIT(10) arrives as the raw bytes (0x02aa) in both protocols. YEAR 2155 and TIME 838:59:58.123456 round-trip. JSON: MySQL sends type 245 (JSON) and normalises key order and whitespace ({"a": ..., "b": 1}); MariaDB sends BLOB (252) with charset utf8mb4 and the extended-metadata format name 'json' and keeps the text as inserted ({"b": 1, "a": ...}). VECTOR: MySQL 9.7 and 26.10 send type 242; MariaDB 11.8, 12.3, 13.0 send VAR_STRING with the binary charset and no marker; 10.6, 10.11, 11.4 and MySQL 8.4 have no such column type. The raw bytes (float32 little-endian) are identical. Geometry: type 255, same WKB bytes on all 9. Zero dates under each server's own default sql_mode: rejected with error 1292 on all MySQL, accepted on all MariaDB; with sql_mode empty both decode as 0000-00-00 in text and binary. A TIME with a fraction beyond 838:59:59 (838:59:59.5) is rejected by MySQL (1292) and accepted by MariaDB.

**Evidence files.** `results/behaviour/*.json (types)`, `results/zerodate/*.json`, `results/summary/behaviour-diff.json`

**Corrected sentence.** DECIMAL as string, BIGINT and BIGINT UNSIGNED as bigint, TINYINT(1) as a plain TINY integer, BIT as raw bytes, YEAR, TIME to 838:59:59 and geometry have identical decoding on all nine servers; JSON (MySQL type 245 versus MariaDB BLOB with extended format 'json') and VECTOR (MySQL type 242 versus MariaDB plain binary VAR_STRING) are different wire types, and zero dates and TIME fractions beyond 838:59:59 are accepted by default on MariaDB and rejected on MySQL, so those need per-family contract entries.

## M-07 Transactions: Confirmed

**Claim.** Autocommit tracking from server status flags, savepoints, isolation levels, detection of implicit commit by DDL

**Documentation.** Refman 15.3.3 (implicit commit) and C API session-track pages. The docs never say that an implicit commit is signalled; it is observable through the IN_TRANS flag. Savepoints have no protocol representation.

**Live servers.** `set autocommit=1/0` toggles status bit 0x0002; BEGIN sets IN_TRANS (0x0001); `CREATE TABLE` inside the transaction clears IN_TRANS on the OK packet, on all 9 (the implicit commit); START TRANSACTION READ ONLY adds IN_TRANS_READONLY. Savepoint statements return plain OK packets with no flag. Isolation: `transaction_isolation` exists on MySQL and MariaDB 11.4 and later; `tx_isolation` exists on MariaDB only (all six); MariaDB 10.6 and 10.11 have no `transaction_isolation`. MySQL OK packets always carry a session-state entry named statement_id; MariaDB does not.

**Evidence files.** `results/behaviour/*.json (misc.B3, B4, B5)`

## M-08 Streaming: Corrected

**Claim.** Row streaming with backpressure, server-side cursors through COM_STMT_FETCH; the connection is busy until the result is drained

**Documentation.** Cursor pages and the C API. 'Busy until drained' is documented for unbuffered text results; for cursors the docs describe FETCH but do not say whether other commands may run between fetches.

**Live servers.** Cursor opened, FETCH 3 rows, `select 99` on the same connection (answered), FETCH 3 more rows (rows 4 to 6, correct) on all 9. Without a cursor the server keeps sending: a reader that stops makes the server sit in 'Sending to client' (MySQL) or 'Writing to net' (MariaDB) and no further statement of that connection starts (pipelining probe P8). After net_write_timeout the server closes the connection (P8b).

**Evidence files.** `results/behaviour/*.json (lifecycle.B12, B12b)`, `results/pipeline/summary.md`

**Corrected sentence.** Without a cursor the connection is busy until the whole result set has been read, and a reader that stops reading stalls the server until the reader resumes or net_write_timeout expires; with a read-only COM_STMT_FETCH cursor the execute returns no rows and other commands may run between fetches on all nine servers (observed; undocumented).

## M-09 Pooling and lifecycle: Corrected

**Claim.** Session reset with COM_RESET_CONNECTION; health checks with COM_PING; no query pipelining is assumed for MySQL

**Documentation.** C API mysql_reset_connection page (COM_RESET_CONNECTION does not re-authenticate; changing user needs COM_CHANGE_USER). The classic-protocol pages never mention sending commands before reading responses; only the X Protocol docs allow it. The claim is consistent with silence, not a prohibition.

**Live servers.** COM_RESET_CONNECTION on all 9: user variable gone, temporary table gone, prepared statement invalid (error 1243), sql_mode, autocommit and charset/collation back to the server defaults (a latin1 session becomes utf8mb4 with the family's default collation), the current database kept. COM_PING returns OK on all 9. Pipelining on stock MySQL 8.4, 9.7, 26.10: 50 COM_QUERY and 50 COM_STMT_EXECUTE written in one write came back in order with the server's log and table effects matching, 5 of 5 runs on each; an error in the middle belonged to exactly one statement and the connection stayed usable (see M-Q2).

**Evidence files.** `results/behaviour/*.json (lifecycle.B9)`, `results/pipeline/summary.md`

**Corrected sentence.** COM_RESET_CONNECTION clears user variables, temporary tables and prepared statements and restores session defaults but keeps the selected database; COM_PING and reset behave identically on all nine. Stock MySQL does execute commands written back to back in order with per-statement errors (the pipelining premise is a driver decision), but offers no prepare-and-execute without waiting.

## M-10 TLS: Corrected

**Claim.** TLS upgrade inside the handshake, verify-full default, client certificates

**Documentation.** Refman 26.10 post-quantum TLS page; defaults: require_secure_transport is OFF in 8.4, 9.7 and 26.10, tls mode PREFERRED. A driver that wants verified TLS must implement its own verification mode.

**Live servers.** SSLRequest then TLS inside the handshake, then the normal response: works on MySQL 8.4, 9.7, 26.10 (auto-generated certificate) and MariaDB 11.4, 11.8, 12.3, 13.0 (auto-generated certificate; TLS 1.3). MariaDB 10.6 and 10.11: have_ssl is DISABLED, the greeting has no SSL capability bit, so an upgrade is impossible without server configuration. With certificate verification on (the verify-full style default) every TLS-capable server is refused: 'self signed certificate in chain' (MySQL) and 'self signed certificate' (MariaDB), so a verify-full default needs a CA or a pinned certificate. Client certificates: not verified here.

**Evidence files.** `results/tls/*.json`, `results/auth/*.json (overTls)`

**Corrected sentence.** A TLS upgrade inside the handshake is available on MySQL 8.4/9.7/26.10 and MariaDB 11.4 and later with auto-generated self-signed certificates, and not at all on MariaDB 10.6 and 10.11 unless configured; a verify-full default therefore fails against stock servers until a CA is supplied.

## M-11 Bulk load: Confirmed

**Claim.** LOAD DATA LOCAL INFILE disabled by default and gated behind an explicit allowlist of sources; a hostile server can request arbitrary local files

**Documentation.** Refman 8.4 and 26.10 LOAD DATA and security pages; local_infile and CLIENT_LOCAL_FILES. The protocol lets the server answer a statement with a request naming a file; the client must refuse unless the caller opted in. The docs support that design without prescribing it.

**Live servers.** Without CLIENT_LOCAL_FILES the statement fails: error 3948 on MySQL, error 4166 on MariaDB (all 9). Server variable local_infile: OFF on MySQL, ON on MariaDB (all six). With the capability set: MySQL still refuses (3948, server variable off); MariaDB answers with the 0xFB LOCAL INFILE request packet (the prototype refuses by raising a protocol error), seen on all six. So the attack surface exists by default on MariaDB at the server side and is closed only by the client not setting the capability.

**Evidence files.** `results/behaviour/*.json (lifecycle.B13)`

## M-12 Replication and CDC: Corrected

**Claim.** Binlog stream in ROW format through COM_BINLOG_DUMP_GTID, table-map and row events, checksums, GTID sets, resumable position

**Documentation.** Dev replication pages and refman: COM_BINLOG_DUMP_GTID has no dev protocol page (404), its layout comes from `rpl_source.cc`; binlog_format is ROW and binlog_row_metadata is MINIMAL in 8.4, 9.7 and 26.10; gtid_mode and enforce_gtid_consistency default OFF in 8.4 and ON in 9.7 and 26.10 (9.5.0 release notes). See M-Q4 for the table-map contents.

**Live servers.** Defaults read from the fresh servers: binlog_format ROW on MySQL 8.4/9.7/26.10 and MariaDB 12.3/13.0, MIXED on MariaDB 10.6, 10.11, 11.4, 11.8; log_bin ON on MySQL and OFF on MariaDB; gtid_mode OFF on 8.4, ON on 9.7 and 26.10 (executed set 'uuid:1-53'); MariaDB has no gtid_mode (strict mode OFF). The binlog dump command, checksums and GTID-set exchange were not run.

**Evidence files.** `results/facts/*.json (variables)`, `results/binlog/summary.md`

**Corrected sentence.** A ROW-format change stream needs binlog_format=ROW and log_bin switched on explicitly on MariaDB (default MIXED up to 11.8, binary log off); on MySQL both are the default, and gtid_mode is ON by default only from 9.7. The dump command layout was not verified here.

## M-13 Failover: Corrected

**Claim.** Multi-host, primary detection through read_only state, Group Replication and Aurora topologies; no server-side equivalent of target_session_attrs

**Documentation.** Refman: replication_group_members.MEMBER_ROLE is the documented Group Replication primary signal; read_only=ON does not prove a replica and super_read_only is the stricter indicator. AWS: the Aurora writer check in the user guide is `innodb_read_only` (ON means reader); the aurora_server_id join came only from a search snippet (page returned 403). No target_session_attrs equivalent exists in MySQL 8.4 or MariaDB; MySQL Router access_mode is router-side.

**Live servers.** @@read_only exists on all 9 (value 0 or OFF); super_read_only and the performance_schema.replication_group_members table exist on MySQL only (empty here, no group); MariaDB has no super_read_only variable, and lists the wsrep (Galera) plugin as inactive; `show variables like '%session_attrs%'` returns nothing on all 9. Aurora and Group Replication topologies themselves: not verifiable here.

**Evidence files.** `results/behaviour/*.json (lifecycle.B14)`

**Corrected sentence.** Primary detection through read_only works on both families, but only MySQL has super_read_only and replication_group_members; MariaDB signals Galera through the wsrep plugin and variables; neither family offers a server-side target_session_attrs equivalent, so the driver probes. Aurora behaviour was not verified.

## M-14 Proxies and platforms: Not verifiable here

**Claim.** ProxySQL, RDS Proxy, Vitess and PlanetScale, TiDB, SingleStore, Cloudflare Hyperdrive

**Documentation.** ProxySQL multiplexing and prepared-statement pages: pinning on open binary statements, text PREPARE disables multiplexing, mysql-max_stmts_per_connection default 20, global cache 10000; caching_sha2_password supported from 2.6.0. RDS Proxy pins the session on any prepared statement, has no MySQL compression, and does not support caching_sha2_password for MariaDB. SingleStore docs warn server-side prepared statements are unsupported on older versions; PlanetScale docs are silent on them; TiDB lacks the replication protocol. Nothing found on COM_RESET_CONNECTION behind RDS Proxy, Vitess, PlanetScale or TiDB.

**Live servers.** ProxySQL 3.0.12 (image proxysql/proxysql:3.0.12) in front of MySQL 8.4 and MariaDB 13.0: it greets as 5.5.30 with plain native password and no MariaDB extended capabilities; prepare, execute, reset, close and ping work on both backends; 50 pipelined executes all ran in order on the backend (50 of 50) and an error in the middle of 20 queries belonged to one statement, but the proxy does not restart sequence ids per command, so 49 of 50 (and 19 of 20) responses carried unexpected ids and a client that validates them strictly aborts; the 0xFFFFFFFF placeholder execute fails with error 1243 even against MariaDB; a COM_STMT_BULK_EXECUTE byte closes the connection. RDS Proxy, Vitess, PlanetScale, TiDB, SingleStore, Aurora: no account, not run.

**Evidence files.** `results/proxysql.json`

## M-15 Performance: Corrected

**Claim.** Statement and metadata caching, coalesced writes, compiled codecs, optional zstd or zlib compression

**Documentation.** C API optional-metadata page (CLIENT_OPTIONAL_RESULTSET_METADATA plus resultset_metadata, default FULL); dev text for CLIENT_ZSTD_COMPRESSION_ALGORITHM (the server sets it when the variable lists zstd). Optional metadata only helps prepared statements if the driver kept the layout from PREPARE.

**Live servers.** Greeting capability bits: CLIENT_COMPRESS (bit 5) is offered by all 9; CLIENT_ZSTD_COMPRESSION_ALGORITHM (bit 26) only by MySQL 8.4, 9.7, 26.10; `protocol_compression_algorithms` exists on MySQL only (zlib,zstd,uncompressed). Compression itself was not exercised. Metadata caching exists in both families with different mechanisms (see D-02). Statement caching, coalesced writes and compiled codecs are design or performance claims: no benchmark was run and none is claimed.

**Evidence files.** `results/facts/*.json (greeting.capabilityNames, variables)`

**Corrected sentence.** Protocol compression with zlib is offered by all nine servers and zstd by MySQL only (capability bit 26, variable protocol_compression_algorithms); MariaDB has no zstd. Compression was not exercised.

## M-16 Hyperdrive constraint: Not verifiable here

**Claim.** Cloudflare documented that Hyperdrive for MySQL does not support COM_STMT_PREPARE, multi-statement queries, USE, or non-UTF-8 text

**Documentation.** developers.cloudflare.com/hyperdrive/reference/supported-databases-and-features/ (JSON-LD dateModified 2026-11-03): unsupported are SQL-level and protocol-level prepared statements, multi-statement queries, USE and non-UTF8 characters in queries. The literal string COM_STMT_PREPARE is not on the page, which also lists COM_INIT_DB and authentication plugins other than the native and caching_sha2 ones as unsupported. The changelog (beta 2025-04-08, GA 2026-08-07) has no entry that changed the list, so what it said 'at the time of the research rounds' could not be recovered. Cloudflare recommends mysql2 3.13.0 or later with disableEval, and mysql 2.18.0 or later; the driver pages say nothing about execute() versus query().

**Live servers.** Hosted service, no sign-up: not run.

## M-Q1 Open question: Confirmed

**Claim.** Which authentication plugins MySQL 8.4 and 9.x enable by default

**Documentation.** Release notes 8.1.0 to 9.0.0, refman 8.4/9.7/26.10 pluggable-authentication pages: authentication_policy default '*,,' in all three; native password deprecated 8.0.34, disabled by default 8.4.0, removed 9.0.0; sha256_password present but deprecated through 26.10. The 9.7 and 26.10 manuals have no native-password page (302 to the 8.4 page).

**Live servers.** Loaded plugins read from fresh servers: 8.4: caching_sha2_password ACTIVE, sha256_password ACTIVE, mysql_native_password DISABLED; 9.7 and 26.10: caching_sha2_password and sha256_password ACTIVE, no native plugin. authentication_policy is '*,,' on all three; a new user with a password gets caching_sha2_password (greeting default plugin the same).

**Evidence files.** `results/facts/*.json`, `results/auth/summary.md`

## M-Q2 Open question: Confirmed

**Claim.** Whether any safe form of pipelining exists on stock MySQL

**Documentation.** Classic protocol docs are silent on pipelining. ProxySQL 3.0.12 release notes describe in-order queueing of commands sent before the previous response (the only pipelining statement found).

**Live servers.** Definition of safe (written before the runs): responses in command order; every error belongs to exactly one statement; nothing stalls; nothing skipped silently, checked against the server's own log (performance_schema or the general log) and table effects. On MySQL 8.4, 9.7, 26.10, 5 runs each: 50 COM_QUERY in one write, 50 COM_STMT_EXECUTE inserts in one write, an error at #10 of 20 queries, a duplicate-key error at #5 of 8 executes: 5 of 5 safe in every case; the 20 MB middle result with a slow reader came back in order 5 of 5. Unsafe edges: a client that stops reading while writing makes the server stall ('Sending to client', no statement started) until it resumes; after net_write_timeout the server closes the connection and the later statements never run; killing the connection leaves a prefix of the batch committed and the client one response short of the server (one statement of unknown fate). A guessed next statement id was right in every run, but a PREPARE followed by EXECUTE with the placeholder id fails with 1243 on all three (the prepare still succeeds).

**Evidence files.** `results/pipeline/summary.md`, `results/kill/summary.md`

## M-Q3 Open question: Not verifiable here

**Claim.** Exact behaviour of prepared statements behind Vitess and RDS Proxy

**Documentation.** RDS Proxy: any prepared statement, text or binary, pins the session (multiplexing lost) but PREPARE works. Vitess: the docs describe vtgate planning of prepared statements; the PlanetScale docs are silent and the page on prepared statements returned 404. Hyperdrive: protocol-level prepared statements unsupported (M-16).

**Live servers.** Vitess if it needs more than a plain docker run, RDS Proxy: not run. ProxySQL results are in M-14.

**Evidence files.** `results/proxysql.json`

## M-Q4 Open question: Confirmed

**Claim.** Binlog metadata needed to decode rows without a schema lookup

**Documentation.** Dev `Table_map_event` page and refman: with MINIMAL the event carries column types, per-type metadata, the NULL bitmap, signedness, column charsets and geometry types (plus vector dimension from 9.7); column names, enum and set strings and the primary key need FULL. Doc inconsistency: the class page says geometry types are FULL-only and its type table omits JSON, TIME2, TIMESTAMP2, DATETIME2 and VECTOR; the source (init_metadata_fields at 8.4.13 and 26.10.0) puts geometry in MINIMAL and handles those types. binlog_row_metadata defaults to MINIMAL on MySQL and NO_LOG on MariaDB (introduced 10.5.0); from MariaDB 12.3 FULL maps row events to columns by name.

**Live servers.** Table_map event for a 7-column table, from SHOW BINLOG EVENTS: MySQL 8.4, 9.7, 26.10: 69 bytes with the default MINIMAL, 103 with FULL; MariaDB: 60 bytes with the default NO_LOG, 96 (10.6, 10.11) or 100 (11.4 and later) with FULL. mariadb-binlog -vv prints @n positions even with FULL (it does not show names); the MySQL images contain no mysqlbinlog.

**Evidence files.** `results/binlog/summary.md`, `results/binlog/*.json`

## D-01 Handshake and server identity: Corrected

**Claim.** Version string conventions and MariaDB-specific extended capability bits carried in the handshake

**Documentation.** mariadb.com/kb/en/connection/ and docs 'MariaDB vs. MySQL Protocol Differences'; source `include/mysql_com.h` and `sql/sql_acl.cc` at tags 10.6.20 and 11.8.2 (greeting writer and response parser). The 'MariaDB' version prefix '5.5.5-' is gone from 11.0 onward (source and docs agree). The extended capability word is 32 bits: in the greeting it occupies the last four of the ten reserved bytes, in the client response the last four of the 23 filler bytes (packet bytes 28 to 31); MariaDB does not set CLIENT_MYSQL (bit 0). Flag names: MARIADB_CLIENT_PROGRESS, COM_MULTI, STMT_BULK_OPERATIONS, EXTENDED_METADATA, CACHE_METADATA, BULK_UNIT_RESULTS (bits 32 to 37 of the 64-bit mask).

**Live servers.** Greeting version string: '5.5.5-10.6.28-MariaDB-...' and '5.5.5-10.11.19-...' on 10.6 and 10.11, no prefix from 11.4 ('11.4.13-MariaDB-ubu2404-log' and later); every MariaDB string contains 'MariaDB' and none of the MySQL ones does (all 9 detected correctly by the dispatcher). Capability bit 0 is clear on all six MariaDB greetings and set on all three MySQL ones. Extended word in reserved bytes 6 to 9: 0x1d on 10.6, 10.11, 11.4 (PROGRESS, BULK, EXTENDED_METADATA, CACHE_METADATA); 0x3d on 11.8, 12.3, 13.0 (adds BULK_UNIT_RESULTS); 0 on MySQL. The prototype's client response carries its extended request in filler bytes 19 to 22; the independent proxy parser reads the same word at response bytes 28 to 31.

**Evidence files.** `results/facts/*.json (greeting)`, `results/wire/matrix.md (step 0)`

**Corrected sentence.** Server family is read from the greeting: MariaDB when the version string contains 'MariaDB' (a '5.5.5-' prefix is present on 10.6 and 10.11 only), confirmed by capability bit 0 being clear; the extended capability word is the last four of the ten reserved greeting bytes (0x1d on 10.6 to 11.4, 0x3d from 11.8) and is echoed in the last four filler bytes of the client response.

## D-02 Protocol capabilities: Corrected

**Claim.** Extended metadata (real type names for JSON, UUID, INET), metadata caching that skips column definitions on re-execute, bulk operations, progress reporting

**Documentation.** mariadb.com/kb/en/result-set-packets/ (column definition extended metadata), /progress-reporting/, /com_stmt_prepare/, /com_stmt_execute/, /com_stmt_bulk_execute/, and the MariaDB protocol-differences page; source tags 10.6.20 and 11.8.2. MARIADB_CLIENT_EXTENDED_TYPE_INFO does not exist: the name is MARIADB_CLIENT_EXTENDED_METADATA (first in 10.5.2). Type names arrive as attribute 0 (data type name: uuid, inet4, inet6, geometry subtype) and attribute 1 (format name: 'json'). CACHE_METADATA is since 10.6.0; unit results since 11.5.1; progress was capability bit 29 before 10.2 and is bit 32 since. MariaDB does not support MySQL's CLIENT_OPTIONAL_RESULTSET_METADATA.

**Live servers.** Extended metadata (negotiated by the prototype on all six): UUID, INET4 and INET6 columns come as wire type STRING (254) with attribute 'typeName' uuid, inet4 or inet6; a JSON column as BLOB (252) with format 'json'. Metadata caching (prototype with extended bit 16): the result header is the column count plus one flag byte; on all six, an execute right after PREPARE and a repeated execute come without column definitions, a text query still gets them, and after ALTER TABLE ADD COLUMN the next execute carries them again (also for SELECT *, decoded correctly with 4 columns) and the one after skips again. The reference Connector/Node.js negotiates ext 0x3c and sends the placeholder execute (golden trace). Bulk: see D-04. Progress: with extended bit 1 negotiated, an ALTER TABLE emitted 2 progress packets (errno 65535) on 10.6 and 10.11 and 4 on 11.4 to 13.0 with progress_report_time=1; none on MySQL. MySQL's own mechanism (CLIENT_OPTIONAL_RESULTSET_METADATA, bit 25, plus resultset_metadata=NONE): works on all three MySQL servers (prepare tail byte 1 means metadata follows, 0 means skipped) but after ALTER TABLE the server kept skipping and a cached `select *` decoded three columns from rows that now have four, silently (MariaDB re-sent the metadata).

**Evidence files.** `results/metadata/*.json`, `results/progress/*.json`, `results/behaviour/*.json (types.columns)`, `results/wire/golden.json`

**Corrected sentence.** MariaDB's extended-metadata capability is MARIADB_CLIENT_EXTENDED_METADATA (extended bit 3): UUID, INET4 and INET6 report their name as data-type attribute 0 on a STRING column, JSON as format attribute 1 on a BLOB column. MARIADB_CLIENT_CACHE_METADATA (bit 4) adds a flag byte after the column count and the server re-sends the definitions after a table changes shape; MySQL's optional result-set metadata (bit 25) does not re-send them and silently misdecodes a cached SELECT * after ALTER TABLE.

## D-03 Authentication plugins: Corrected

**Claim.** mysql_native_password remains common, plus ed25519, PARSEC in recent versions, GSSAPI and PAM dialog; caching_sha2_password support differs by version

**Documentation.** mariadb.com/docs authentication plugin pages (pluggable-authentication-overview, authentication-plugin-caching_sha2_password); Jira and source tags. caching_sha2_password server plugin (library auth_mysql_sha2): Community 11.4.9, 11.8.4, 12.1 and later, not earlier patches; PARSEC from 11.6 (plugin page 11.6, protocol-differences page 11.6.1, source tag 11.6.2); default plugin is still mysql_native_password in the 13.0.1 source; mysql_old_password still present; the overview page contradicts itself on unix_socket being installed by default.

**Live servers.** Plugins loaded by default on a fresh server, all six: mysql_native_password, mysql_old_password, unix_socket. Libraries present in the image: ed25519 on all six (INSTALL SONAME auth_ed25519 works, login works with the prototype and Connector/Node.js, not mysql2); caching_sha2_password (auth_mysql_sha2.so) on 11.4.13, 11.8.9, 12.3.3, 13.0.2 and absent on 10.6.28 and 10.11.19; PARSEC (auth_parsec.so) on 11.8.9, 12.3.3, 13.0.2 and absent on 10.6, 10.11 and 11.4.13 (login works with the prototype and Connector/Node.js, not mysql2: 'unknown plugin parsec'); auth_pam.so on all six (not configured, not tested); GSSAPI: no library was present in the 10.6, 12.3 and 13.0 images (the other images were not listed); dialog.so is present in 12.3 and 13.0 and absent from the 10.6 image; neither was tested. mysql_old_password accounts can be created but every login is refused with 1275 (secure_auth) on all six. unix_socket accounts are refused over TCP (1698). A new account with a password gets mysql_native_password on all six.

**Evidence files.** `results/auth/summary.md`, `results/facts/*.json (authPluginsAvailable, defaultAuthPluginsLoaded)`

**Corrected sentence.** On the six matrix series mysql_native_password is the only password plugin loaded by default (with mysql_old_password, which cannot log in, and unix_socket); ed25519 is available on all six after INSTALL SONAME; caching_sha2_password (auth_mysql_sha2, TLS only) from 11.4.13; PARSEC from 11.8; PAM and dialog libraries exist but need configuration; GSSAPI was not available in the images.

## D-04 Prepared statements: Confirmed

**Claim.** COM_STMT_BULK_EXECUTE for array binding; prepare-and-execute pipelining with a placeholder statement id

**Documentation.** mariadb.com/kb/en/com_stmt_bulk_execute/ and /com_stmt_execute/; source `sql/sql_prepare.cc`. Bulk first appears in 10.2.7, unit results in 11.5.1. The placeholder id 0xFFFFFFFF dates from 10.2.0 (built for COM_MULTI, removed in 10.6.0, the id outlived it); the docs say it needs the bulk capability, the source does not check it; a failed prepare makes the execute fail with 'unknown statement id'.

**Live servers.** COM_STMT_BULK_EXECUTE with 100 rows: OK affecting 100 rows, 100 rows in the table, 5 of 5 runs on all six. With a duplicate key at row 50 of 100: ERR 1062 and none of the 100 rows inserted (the batch is atomic), all six. PREPARE followed immediately by EXECUTE with 0xFFFFFFFF in one write: prepare ok and execute answered with the right value (42), 5 of 5 on all six including 10.6; PREPARE plus a bulk execute against the placeholder: 10 of 10 rows inserted, all six. A failing PREPARE followed by the placeholder execute: ERR 1064 then ERR 1243, connection still usable, 5 of 5. On MySQL: the 0xFA byte is error 1047 (unknown command) and the placeholder execute is 1243; both leave the connection usable. Connector/Node.js sends the placeholder execute behind its prepare on MariaDB (golden trace).

**Evidence files.** `results/pipeline/summary.md (P5, P6, P9)`, `results/wire/golden.json`

## D-05 Pipelining: Corrected

**Claim.** Documented as supported by the server

**Documentation.** No MariaDB page found promising that a client may send arbitrary commands without waiting, or describing error propagation for such sequences; support is documented only for prepare-and-execute with the placeholder id and for bulk.

**Live servers.** The same four generic probes as on MySQL (50 COM_QUERY, 50 COM_STMT_EXECUTE, error at #10 of 20 queries, duplicate key at #5 of 8 executes) were safe 5 of 5 on all six MariaDB servers by the stated definition, and the 20 MB middle result with a slow reader came back in order 5 of 5. The stall when a client stops reading, the server closing the connection after net_write_timeout, and the kill-mid-batch outcome are the same as on MySQL.

**Evidence files.** `results/pipeline/summary.md`, `results/kill/summary.md`

**Corrected sentence.** Pipelined COM_QUERY and COM_STMT_EXECUTE behave identically on all nine servers (in order, per-statement errors, a stall if the client stops reading); the MariaDB-only part is limited to prepare-and-execute with the placeholder id and bulk execute, so a pipeline scheduler is not MariaDB-specific.

## D-06 Data types and codecs: Corrected

**Claim.** JSON is an alias of a text type with a validity check; native UUID, INET4, INET6; vector type in recent versions; sequences

**Documentation.** KB data-type pages and source: JSON is LONGTEXT with CHARACTER SET utf8mb4 COLLATE utf8mb4_bin plus a JSON_VALID check; INET6 since 10.5, UUID since 10.7, INET4 since 10.10; sequences since 10.3; the wire type of VECTOR is not documented.

**Live servers.** SHOW CREATE TABLE of a JSON column on all six: longtext, utf8mb4_bin, CHECK (json_valid(...)); information_schema reports longtext; text stored as inserted. UUID: supported on 10.11 and later, 'Unknown data type' error 4161 on 10.6; INET4 likewise (10.11 and later); INET6 on all six; VECTOR(3) on 11.8, 12.3, 13.0 only (error 4161 on 10.6, 10.11, 11.4), wire type VAR_STRING with the binary charset; CREATE SEQUENCE works on all six and is a syntax error (1064) on MySQL. MySQL 9.7 and 26.10 also accept VECTOR(3), as wire type 242. Decoded values: UUID '123e4567-...', INET6 '::ffff:192.168.0.1', INET4 '192.168.0.1' as strings, identical in text and binary rows. The JSON-invalid insert error is 4025 on MariaDB (a CHECK constraint) versus 3140 on MySQL.

**Evidence files.** `results/behaviour/*.json (types, misc.B7)`, `results/summary/behaviour-diff.json`

**Corrected sentence.** On MariaDB JSON is LONGTEXT utf8mb4_bin with a JSON_VALID check (wire type BLOB plus format 'json'), UUID and INET4 exist from 10.11 in the matrix, INET6 on all six, VECTOR from 11.8 (plain binary on the wire), sequences on all six; MySQL 9.7 and 26.10 also have a VECTOR type, with its own wire type 242.

## D-07 SQL surface affecting the driver: Corrected

**Claim.** RETURNING on INSERT, DELETE and REPLACE

**Documentation.** KB RETURNING pages and source: INSERT ... RETURNING and REPLACE ... RETURNING since 10.5.0, DELETE ... RETURNING in the 10.0.5 parser, UPDATE ... RETURNING (single table, with OLD_VALUE()) from 13.0 only.

**Live servers.** On all six MariaDB servers INSERT, REPLACE and DELETE with RETURNING returned the row; UPDATE ... RETURNING returned a row on 13.0 and was a syntax error (1064) on 10.6, 10.11, 11.4, 11.8, 12.3. MySQL 8.4, 9.7, 26.10: all four forms are syntax error 1064.

**Evidence files.** `results/behaviour/*.json (misc.B6_returning)`

**Corrected sentence.** The returning capability is true on MariaDB for INSERT, REPLACE and DELETE (all six series) and for UPDATE only from 13.0; it is false on MySQL for every statement kind.

## D-08 Replication and CDC: Corrected

**Claim.** GTID format is domain-server-sequence; binlog event set and replica capability negotiation differ; annotate-rows events

**Documentation.** Replica capability negotiation (@mariadb_slave_capability, @slave_connect_state with COM_BINLOG_DUMP) is not in the fetched KB pages; confirmed only in source `sql/sql_repl.cc` at 11.8.2. MariaDB event numbers 160 to 171 are not used by MySQL. binlog_row_metadata default NO_LOG since 10.5.0.

**Live servers.** Event types seen in the binary log (SHOW BINLOG EVENTS) of a one-row insert: MariaDB: Gtid_list, Binlog_checkpoint, Gtid, Query, Annotate_rows, Table_map, Write_rows_v1, Xid; MySQL: Previous_gtids, Gtid, Query, Table_map, Write_rows, Xid (no annotate-rows). GTID form: MariaDB's Gtid event shows 'GTID 0-1-1' (domain 0, server 1, sequence 1); MySQL 9.7 and 26.10: SET @@SESSION.GTID_NEXT='uuid:sequence'. The dump handshake and capability negotiation were not run.

**Evidence files.** `results/binlog/*.json (eventTypesSeen, gtidEventInfo)`, `results/binlog/summary.md`

**Corrected sentence.** MariaDB's binary log has Annotate_rows and a domain-server-sequence GTID event where MySQL has neither; the replica capability negotiation was not verified here.

## D-09 Error codes: Corrected

**Claim.** A MariaDB-only error range beside the shared range

**Documentation.** KB error-code list and `sql/share/errmsg-utf8.txt`: MariaDB-only numbers 1900 to 1982; 3000 to 3159 aligned with MySQL (98 ER_MYSQL_xxxx placeholders); MariaDB's own range resumes at 4000 (to about 4182 in 10.6, 4208 in 11.8, 4255 in 12.3, 4264 in 13.0) and collides with MySQL 8.0's 4000 to 4166; scattered collisions exist below 1900. The MySQL-side counts come from `messages_to_clients.txt`.

**Live servers.** A fixed set of 25 failing statements and protocol errors (results/behaviour): 20 give the same number and SQLSTATE on all 9 (1064, 1146, 1054, 1062, 1048, 1406, 1365, 1264, 1452, 1049, 1193, 1231, 1050, 1051, 1242, 1047, 1243, 1045, 1205, 1213). The five that differ: invalid JSON value 3140 (MySQL) versus 4025 (MariaDB), CHECK constraint violation 3819 versus 4025, and three statements MariaDB accepts and MySQL rejects with 1064 or 3141 (RETURNING, CREATE SEQUENCE, json_extract on invalid text). Outside that set: LOAD DATA LOCAL refusal 3948 versus 4166, and MariaDB 4161 (unknown data type) for uuid and inet4 on 10.6. Error message wording differs for 1064 ('MySQL server' versus 'MariaDB server'), 1054 ('field list' versus 'SELECT') and 1062 ('pk.PRIMARY' versus 'PRIMARY').

**Evidence files.** `results/behaviour/*.json (failures)`, `results/summary/behaviour-diff.json`

**Corrected sentence.** Error numbers up to the shared range match on all nine for the common failures (syntax, unknown object, duplicate key, NOT NULL, truncation, division by zero, range, lock timeout, deadlock, unknown command and statement id), while MariaDB-only numbers (1900 to 1982, 4000 and above) mean different things from MySQL's 4000 range and a few shared conditions have different numbers (CHECK 3819 versus 4025, invalid JSON 3140 versus 4025, local infile 3948 versus 4166), so the driver needs a per-family error map.

## D-10 Connection behaviour: Corrected

**Claim.** Server-initiated redirection in recent versions; Galera cluster and MaxScale topologies

**Documentation.** Redirection: 11.3.1 (MDEV-15935), advisory only, carried as redirect_url in the OK packet's system-variables tracker; MaxScale ignored backend redirect_url before 25.10.0 (MXS-5240). Nothing Galera-specific found on connection behaviour.

**Live servers.** Variable redirect_url: absent on 10.6 and 10.11, present from 11.4. With `SET GLOBAL redirect_url='mariadb://127.0.0.1:34001'`, the OK packet that ends authentication carried the entry redirect_url=mariadb://127.0.0.1:34001 on 11.8, 12.3 and 13.0; on 11.4.13 the variable accepted the setting but the login OK carried no entry. The default tracked variable list includes redirect_url from 11.4. The wsrep plugin is listed (inactive) on all six; no Galera cluster was started; MaxScale not run.

**Evidence files.** `results/redirect/*.json`, `results/facts/*.json (variables.redirect_url)`

**Corrected sentence.** Server-initiated redirection is advisory, carried as a redirect_url entry in the session-state tracker of the OK packet that ends authentication, and was observed on MariaDB 11.8, 12.3 and 13.0 (the variable exists from 11.4 but 11.4.13 sent no entry); it does not exist on 10.6 and 10.11.

## D-11 Version compatibility: Corrected

**Claim.** Long-term series 10.6, 10.11, 11.4 and the current rolling series

**Documentation.** mariadb.org release and maintenance policy as fetched: 10.6 end of life 2026-07-06 (past); 10.11 2028-02-16; 11.4 2029-05-29; 11.8 2028-06-04; 12.3 general availability 2026-05-28, end of life 2029-06-12; 13.0 rolling, announced 2026-09-15, end of life expected in the fourth quarter of 2026, next long-term 13.3. The policy table and the GA post disagree on the 13.0 release date.

**Live servers.** All six series pull from Docker Hub, start and pass the whole probe set: 10.6.28, 10.11.19, 11.4.13, 11.8.9, 12.3.3, 13.0.2 (digests in the README).

**Evidence files.** `README.md (version matrix)`, `results/facts/*.json`

**Corrected sentence.** Long-term series: 10.11, 11.4, 11.8 and 12.3 (10.6 reached end of life on 2026-07-06 and is kept only as the floor), plus the 13.0 rolling series; the CI matrix needs one entry per series.
