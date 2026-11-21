# FS-08 integer-width ground truth. Run as: python3 -I scripts/integers-truth.py
# Builds work/int/ints.db with literal SQL (no JS binding involved) and records, for every case, what
# an independent reader sees: CPython's stdlib sqlite3 reads INTEGER as an arbitrary-precision int and REAL
# as a float, and a SQL cross-check reads each cell as typeof() and CAST(x AS TEXT). The two must agree
# or this script fails. No sqlite3 CLI is installed here, so Python's sqlite3 is the independent reader.
import json, os, sqlite3, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DBDIR = os.path.join(ROOT, 'work', 'int')
OUT = os.path.join(ROOT, 'results', 'integers', 'truth.json')
os.makedirs(DBDIR, exist_ok=True)
os.makedirs(os.path.dirname(OUT), exist_ok=True)
DB = os.path.join(DBDIR, 'ints.db')
for suffix in ('', '-wal', '-shm', '-journal'):
    try: os.remove(DB + suffix)
    except FileNotFoundError: pass

VALUES = ['0', '1', '-1', '2147483647', '2147483648', '-2147483648', '-2147483649',
          '9007199254740991', '9007199254740992', '9007199254740993', '9007199254740994',
          '-9007199254740991', '-9007199254740992', '-9007199254740993',
          '9223372036854775807', '-9223372036854775808']
# (table, declared type or None, strict)
TABLES = [('n_int', 'INT', False), ('n_integer', 'INTEGER', False), ('n_bigint', 'BIGINT', False),
          ('n_int8', 'INT8', False), ('n_ubig', 'UNSIGNED BIG INT', False), ('n_smallint', 'SMALLINT', False),
          ('n_numeric', 'NUMERIC', False), ('n_decimal', 'DECIMAL(20,0)', False), ('n_real', 'REAL', False),
          ('n_none', None, False),
          ('s_int', 'INT', True), ('s_integer', 'INTEGER', True), ('s_real', 'REAL', True), ('s_any', 'ANY', True)]
MIXED = ['5', '9007199254740993', "'abc'", '1.5', "X'00FF'", 'NULL', "'12'", "'9007199254740993'"]

con = sqlite3.connect(DB)
for name, decl, strict in TABLES:
    col = 'x' if decl is None else 'x ' + decl
    con.execute('CREATE TABLE %s(%s)%s' % (name, col, ' STRICT' if strict else ''))
    for v in VALUES:
        con.execute('INSERT INTO %s VALUES (%s)' % (name, v))
for name, decl, strict in [('mixed_bigint', 'BIGINT', False), ('mixed_integer', 'INTEGER', False), ('s_mixed', 'ANY', True)]:
    con.execute('CREATE TABLE %s(x %s)%s' % (name, decl, ' STRICT' if strict else ''))
    for v in MIXED:
        con.execute('INSERT INTO %s VALUES (%s)' % (name, v))
con.execute('CREATE TABLE pk(id INTEGER PRIMARY KEY, x BIGINT)')
for i, x in [(1, 1), (9007199254740993, 2), (9223372036854775807, 3)]:
    con.execute('INSERT INTO pk VALUES (%d, %d)' % (i, x))
con.execute('CREATE VIEW v_bigint AS SELECT rowid AS k, x FROM n_bigint')
con.commit()

cases = []
def case(id, group, sql, params, ncols=1, expect_decl=None):
    cases.append({'id': id, 'group': group, 'sql': sql, 'paramSets': params, 'ncols': ncols, 'expectDecl': expect_decl})

K = [[k] for k in range(1, len(VALUES) + 1)]
for name, decl, strict in TABLES:
    case('col:' + name, 'declared-column', 'SELECT x AS c0 FROM %s WHERE rowid=?' % name, K, 1, [decl])
KM = [[k] for k in range(1, len(MIXED) + 1)]
for name, decl in [('mixed_bigint', 'BIGINT'), ('mixed_integer', 'INTEGER'), ('s_mixed', 'ANY')]:
    case('mixed:' + name, 'mixed-storage', 'SELECT x AS c0 FROM %s WHERE rowid=?' % name, KM, 1, [decl])
case('pk:rowid-alias', 'declared-column', 'SELECT id AS c0, x AS c1 FROM pk WHERE x=?', [[1], [2], [3]], 2, ['INTEGER', 'BIGINT'])
for tbl in ('n_bigint', 'n_integer', 'n_none'):
    for label, e in [('x+0', 'x + 0'), ('x+1', 'x + 1'), ('x*1', 'x * 1'), ('abs', 'abs(x)'), ('neg', '-x'), ('coalesce', 'coalesce(x, 0)'),
                     ('cast-integer', 'CAST(x AS INTEGER)'), ('cast-bigint', 'CAST(x AS BIGINT)'), ('sum-one-row', 'sum(x)'),
                     ('max-one-row', 'max(x)'), ('total-one-row', 'total(x)')]:
        case('expr:%s:%s' % (tbl, label), 'expression', 'SELECT %s AS c0 FROM %s WHERE rowid=?' % (e, tbl), K, 1, [None])
case('plan:subquery', 'plan-shape', 'SELECT x AS c0 FROM (SELECT x FROM n_bigint WHERE rowid=?)', K, 1)
case('plan:view', 'plan-shape', 'SELECT x AS c0 FROM v_bigint WHERE k=?', K, 1)
case('plan:cte', 'plan-shape', 'WITH c AS (SELECT x FROM n_bigint WHERE rowid=?) SELECT x AS c0 FROM c', K, 1)
case('plan:union-bigint-first', 'plan-shape', 'SELECT x AS c0 FROM n_bigint WHERE rowid=? UNION ALL SELECT x FROM n_integer WHERE rowid=?', [[k, k] for k in range(1, len(VALUES) + 1)], 1)
case('plan:union-integer-first', 'plan-shape', 'SELECT x AS c0 FROM n_integer WHERE rowid=? UNION ALL SELECT x FROM n_bigint WHERE rowid=?', [[k, k] for k in range(1, len(VALUES) + 1)], 1)
case('plan:join', 'plan-shape', 'SELECT b.x AS c0, i.x AS c1 FROM n_bigint b JOIN n_integer i ON i.rowid = b.rowid WHERE b.rowid=?', K, 2)
case('agg:max-all', 'expression', 'SELECT max(x) AS c0 FROM n_bigint', [[]], 1, [None])
case('agg:min-all', 'expression', 'SELECT min(x) AS c0 FROM n_bigint', [[]], 1, [None])
case('agg:count', 'expression', 'SELECT count(*) AS c0 FROM n_bigint', [[]], 1, [None])
case('agg:sum-overflow', 'expression', 'SELECT sum(x) AS c0 FROM n_bigint WHERE x > 9007199254740993', [[]], 1, [None])
case('lit:2^53+1', 'expression', 'SELECT 9007199254740993 AS c0', [[]], 1, [None])
case('lit:2^63-1', 'expression', 'SELECT 9223372036854775807 AS c0', [[]], 1, [None])
case('lit:-2^63', 'expression', 'SELECT -9223372036854775808 AS c0', [[]], 1, [None])

def pycell(v):
    if v is None: return {'t': 'null', 'v': ''}
    if isinstance(v, bool): raise SystemExit('unexpected bool')
    if isinstance(v, int): return {'t': 'integer', 'v': str(v)}
    if isinstance(v, float): return {'t': 'real', 'v': repr(v)}
    if isinstance(v, str): return {'t': 'text', 'v': v}
    if isinstance(v, (bytes, bytearray)): return {'t': 'blob', 'v': bytes(v).hex()}
    raise SystemExit('unexpected type %r' % type(v))

mismatches = 0
for c in cases:
    c['rows'] = []
    for ps in c['paramSets']:
        try:
            rows = [[pycell(v) for v in r] for r in con.execute(c['sql'], ps).fetchall()]
        except sqlite3.Error as e:
            # SQLite itself refuses (for example abs(-2^63) or an integer-overflowing sum): every binding must refuse too
            c['rows'].append({'sqliteError': str(e)})
            continue
        # SQL-side cross-check: typeof() and CAST(... AS TEXT) of the same cells
        wrap = 'SELECT ' + ', '.join("typeof(c%d), CASE typeof(c%d) WHEN 'blob' THEN lower(hex(c%d)) ELSE CAST(c%d AS TEXT) END" % (i, i, i, i) for i in range(c['ncols'])) + ' FROM (' + c['sql'] + ')'
        sq = con.execute(wrap, ps).fetchall()
        for r, s in zip(rows, sq):
            for i, cell in enumerate(r):
                t, txt = s[2 * i], s[2 * i + 1]
                if t != cell['t'] or (cell['t'] == 'integer' and txt != cell['v']) or (cell['t'] in ('text', 'blob') and txt != cell['v']):
                    mismatches += 1; print('MISMATCH', c['id'], ps, cell, t, txt, file=sys.stderr)
        if len(sq) != len(rows): mismatches += 1
        c['rows'].append(rows)
con.close()
if mismatches: raise SystemExit('truth cross-check failed: %d mismatches' % mismatches)
json.dump({'reader': 'CPython %s sqlite3 module' % sys.version.split()[0], 'sqlite_version': sqlite3.sqlite_version, 'values': VALUES,
           'mixed': MIXED, 'cases': cases}, open(OUT, 'w'), indent=1)
print('truth: %d cases, SQLite %s, cross-check mismatches: 0' % (len(cases), sqlite3.sqlite_version))
