| step | command | result shape | identical on all servers | classes |
| --- | --- | --- | --- | --- |
| 0 | greeting+auth | GREETING,AUTH_MORE,OK | NO | my84+my97+my2610 / ma106+ma1011 / ma114 / ma118+ma123+ma130 |
| 1 | COM_QUERY `do 1` | OK | yes |  |
| 2 | COM_QUERY `select 1 as a, 'x' as b, null as c` | COLCOUNT=3,COL_DEF,COL_DEF,COL_DEF,ROW,OK_EOF | NO | my84+my97+my2610 / ma106+ma1011 / ma114+ma118+ma123+ma130 |
| 3 | COM_QUERY `select cast(7 as signed) i, cast(7 as unsigned) u,` | COLCOUNT=11,COL_DEF,COL_DEF,COL_DEF,COL_DEF,COL_DEF,COL_DEF, | NO | my84+my97+my2610 / ma106+ma1011 / ma114+ma118+ma123+ma130 |
| 4 | COM_QUERY `drop table if exists fs07.t1` | OK | yes |  |
| 5 | COM_QUERY `create table fs07.t1 (id bigint unsigned primary k` | OK | yes |  |
| 6 | COM_QUERY `insert into fs07.t1 (v, d, ts, j) values ('a', 1.2` | OK | yes |  |
| 7 | COM_QUERY `select * from fs07.t1 order by id` | COLCOUNT=5,COL_DEF,COL_DEF,COL_DEF,COL_DEF,COL_DEF,ROW,ROW,O | NO | my84+my97+my2610 / ma106+ma1011 / ma114+ma118+ma123+ma130 |
| 8 | COM_QUERY `update fs07.t1 set v = 'z' where id = 1` | OK | yes |  |
| 9 | COM_STMT_PREPARE `select id, v, d, ts, j from fs07.t1 where id > ? a` | PREPARE_OK,PARAM_DEF,PARAM_DEF,COL_DEF,COL_DEF,COL_DEF,COL_D | NO | my84+my97+my2610 / ma106+ma1011 / ma114+ma130 / ma118+ma123 |
| 10 | COM_STMT_EXECUTE | COLCOUNT=5,COL_DEF,COL_DEF,COL_DEF,COL_DEF,COL_DEF,ROW,ROW,O | NO | my84+my97+my2610 / ma106+ma1011 / ma114+ma130 / ma118+ma123 |
| 11 | COM_STMT_RESET | OK | NO | my84+my97+my2610 / ma106+ma1011+ma114+ma130 / ma118+ma123 |
| 12 | COM_STMT_EXECUTE | COLCOUNT=5,COL_DEF,COL_DEF,COL_DEF,COL_DEF,COL_DEF,ROW,ROW,O | NO | my84+my97+my2610 / ma106+ma1011 / ma114+ma130 / ma118+ma123 |
| 13 | COM_STMT_CLOSE |  | NO | my84+my97+my2610 / ma106+ma1011+ma114+ma130 / ma118+ma123 |
| 14 | COM_STMT_PREPARE `insert into fs07.t1 (v) values (?)` | PREPARE_OK,PARAM_DEF | NO | my84+my97+my2610 / ma106+ma1011+ma114+ma130 / ma118+ma123 |
| 15 | COM_STMT_EXECUTE | OK | NO | my84+my97+my2610 / ma106+ma1011+ma114+ma130 / ma118+ma123 |
| 16 | COM_STMT_RESET | OK | NO | my84+my97+my2610 / ma106+ma1011+ma114+ma130 / ma118+ma123 |
| 17 | COM_STMT_EXECUTE | OK | NO | my84+my97+my2610 / ma106+ma1011+ma114+ma130 / ma118+ma123 |
| 18 | COM_STMT_CLOSE |  | NO | my84+my97+my2610 / ma106+ma1011+ma114+ma130 / ma118+ma123 |
| 19 | COM_PING | OK | yes |  |
| 20 | COM_RESET_CONNECTION | OK | yes |  |
| 21 | COM_QUERY `use fs07` | OK | yes |  |
| 22 | COM_QUERY `select * from fs07.no_such_table` | ERR | yes |  |
| 23 | COM_QUERY `selec 1` | ERR | NO | my84+my97+my2610 / ma106+ma1011+ma114+ma118+ma123+ma130 |
| 24 | COM_QUERY `set autocommit = 0` | OK | yes |  |
| 25 | COM_QUERY `select @@autocommit` | COLCOUNT=1,COL_DEF,ROW,OK_EOF | NO | my84+my97+my2610 / ma106+ma1011+ma114+ma118+ma123+ma130 |
| 26 | COM_QUIT |  | yes |  |
