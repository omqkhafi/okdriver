# Binlog table-map metadata

Size of the Table_map event for one 7-column table (int unsigned, varchar utf8mb4, enum, bit, decimal, tinyint, blob), from SHOW BINLOG EVENTS, with the default binlog_row_metadata and with FULL.

| server | default setting | Table_map bytes (default) | Table_map bytes (FULL) | image tool | row image shows column names (FULL) |
| --- | --- | --- | --- | --- | --- |
| my84 | MINIMAL | 69 | 103 | mysqlbinlog is not in the mysql:8.4 image | n/a |
| my97 | MINIMAL | 69 | 103 | mysqlbinlog is not in the mysql:9.7 image | n/a |
| my2610 | MINIMAL | 69 | 103 | mysqlbinlog is not in the mysql:26.10 image | n/a |
| ma106 | NO_LOG | 60 | 96 | mariadb-binlog | ###   @1=1 /* INT meta=0 nullable=0 is_null=0 */ |
| ma1011 | NO_LOG | 60 | 96 | mariadb-binlog | ###   @1=1 /* INT meta=0 nullable=0 is_null=0 */ |
| ma114 | NO_LOG | 60 | 100 | mariadb-binlog | ###   @1=1 /* INT meta=0 nullable=0 is_null=0 */ |
| ma118 | NO_LOG | 60 | 100 | mariadb-binlog | ###   @1=1 /* INT meta=0 nullable=0 is_null=0 */ |
| ma123 | NO_LOG | 60 | 100 | mariadb-binlog | ###   @1=1 /* INT meta=0 nullable=0 is_null=0 */ |
| ma130 | NO_LOG | 60 | 100 | mariadb-binlog | ###   @1=1 /* INT meta=0 nullable=0 is_null=0 */ |
