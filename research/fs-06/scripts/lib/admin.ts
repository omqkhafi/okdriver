// Simple-protocol query helper for admin consoles and for the control checks. Returns text rows.
import { PgConn, type ConnOptions } from './client.ts';
import { query, decodeDataRow, decodeRowDescription, decodeError } from './wire.ts';

export async function simpleQuery(o: ConnOptions, sqlText: string): Promise<{ columns: string[]; rows: (string | null)[][]; error?: string }> {
  const c = await PgConn.connect(o);
  try {
    c.write(query(sqlText));
    const r = await c.collect(1, 8000);
    const out: { columns: string[]; rows: (string | null)[][]; error?: string } = { columns: [], rows: [] };
    for (const m of r.msgs) {
      if (m.type === 'T') out.columns = decodeRowDescription(m.body).map((x) => x.name);
      else if (m.type === 'D') out.rows.push(decodeDataRow(m.body));
      else if (m.type === 'E') { const e = decodeError(m.body); out.error = `${e.code} ${e.message}`; }
    }
    if (r.end !== 'ok') out.error = (out.error ?? '') + ` [${r.end}]`;
    return out;
  } finally { c.close(); }
}

export const asObjects = (r: { columns: string[]; rows: (string | null)[][] }) => r.rows.map((row) => Object.fromEntries(r.columns.map((c, i) => [c, row[i]])));
