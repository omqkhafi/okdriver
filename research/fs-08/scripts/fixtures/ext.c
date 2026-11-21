/* FS-08 fixture: a one-function SQLite loadable extension, compiled into work/ (gitignored). */
#include <sqlite3ext.h>
SQLITE_EXTENSION_INIT1

static void answer(sqlite3_context *c, int n, sqlite3_value **v) {
  (void)n; (void)v;
  sqlite3_result_int(c, 42);
}

int sqlite3_extension_init(sqlite3 *db, char **err, const sqlite3_api_routines *api) {
  SQLITE_EXTENSION_INIT2(api)
  (void)err;
  return sqlite3_create_function(db, "okfs08_answer", 0, SQLITE_UTF8, 0, answer, 0, 0);
}
