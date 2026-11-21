// Packed row-set encoding used by the worker benchmark: ONE ArrayBuffer, transferred (not cloned).
// Layout: [u32 headerLen][header JSON][pad to 8][column blocks...]. Column kinds:
//   f64: Float64Array(n)                     (integers are packed as doubles after the worker checked them safe)
//   str: Uint32Array(n+1) offsets, UTF-8 bytes
//   bin: Uint32Array(n+1) offsets, bytes
// Strings are decoded on the main thread with one TextDecoder call per column when the column is ASCII.
const enc = new TextEncoder(), dec = new TextDecoder();
const pad8 = (x) => (x + 7) & ~7;

export function pack(rows) {
  const n = rows.length;
  if (n === 0) return emptyPack();
  const names = Object.keys(rows[0]);
  const cols = [];
  let bytes = 0;
  const blocks = [];
  for (const name of names) {
    const v0 = rows[0][name];
    if (typeof v0 === 'number' || typeof v0 === 'bigint') {
      const f = new Float64Array(n);
      for (let i = 0; i < n; i++) { const v = rows[i][name]; const x = Number(v); if (typeof v === 'bigint' && BigInt(x) !== v) throw new RangeError('unsafe integer in packed column ' + name); f[i] = x; }
      cols.push({ name, kind: 'f64', off: 0, len: n * 8 }); blocks.push(f);
    } else if (typeof v0 === 'string') {
      let joined = '';
      const lens = new Uint32Array(n + 1);
      for (let i = 0; i < n; i++) { const s = rows[i][name]; joined += s; lens[i + 1] = lens[i] + s.length; }
      const ascii = /^[\x00-\x7f]*$/.test(joined);
      let offsets = lens, data;
      if (ascii) data = enc.encode(joined);
      else { offsets = new Uint32Array(n + 1); const parts = []; for (let i = 0; i < n; i++) { const b = enc.encode(rows[i][name]); parts.push(b); offsets[i + 1] = offsets[i] + b.length; } data = new Uint8Array(offsets[n]); let o = 0; for (const b of parts) { data.set(b, o); o += b.length; } }
      cols.push({ name, kind: 'str', ascii, off: 0, len: offsets.byteLength + data.byteLength }); blocks.push([offsets, data]);
    } else if (v0 instanceof Uint8Array) {
      const offsets = new Uint32Array(n + 1);
      for (let i = 0; i < n; i++) offsets[i + 1] = offsets[i] + rows[i][name].length;
      const data = new Uint8Array(offsets[n]); for (let i = 0; i < n; i++) data.set(rows[i][name], offsets[i]);
      cols.push({ name, kind: 'bin', off: 0, len: offsets.byteLength + data.byteLength }); blocks.push([offsets, data]);
    } else throw new TypeError('unsupported column value for packing: ' + typeof v0);
  }
  // header needs offsets that depend on its own length: compute with a placeholder first
  let hdr = JSON.stringify({ n, cols }); let start = pad8(4 + enc.encode(hdr).length);
  for (let pass = 0; pass < 2; pass++) { let o = start; for (const c of cols) { c.off = o; o += pad8(c.len); } hdr = JSON.stringify({ n, cols }); start = pad8(4 + enc.encode(hdr).length); }
  let o = start; for (const c of cols) { c.off = o; o += pad8(c.len); }
  hdr = JSON.stringify({ n, cols }); const hb = enc.encode(hdr);
  const total = o; const buf = new ArrayBuffer(total); const u8 = new Uint8Array(buf);
  new DataView(buf).setUint32(0, hb.length, true); u8.set(hb, 4);
  cols.forEach((c, i) => { const b = blocks[i]; if (c.kind === 'f64') new Float64Array(buf, c.off, n).set(b); else { new Uint32Array(buf, c.off, n + 1).set(b[0]); u8.set(b[1], c.off + b[0].byteLength); } });
  return buf;
}
function emptyPack() { const hb = enc.encode(JSON.stringify({ n: 0, cols: [] })); const buf = new ArrayBuffer(pad8(4 + hb.length)); new DataView(buf).setUint32(0, hb.length, true); new Uint8Array(buf).set(hb, 4); return buf; }

/** Parse the header and make typed-array views over the transferred buffer. No row objects are created. */
export function view(buf) {
  const hl = new DataView(buf).getUint32(0, true);
  const h = JSON.parse(dec.decode(new Uint8Array(buf, 4, hl)));
  const u8 = new Uint8Array(buf);
  const cols = h.cols.map((c) => {
    if (c.kind === 'f64') return { ...c, data: new Float64Array(buf, c.off, h.n) };
    const offsets = new Uint32Array(buf, c.off, h.n + 1);
    return { ...c, offsets, bytes: u8.subarray(c.off + offsets.byteLength, c.off + c.len) };
  });
  return { n: h.n, cols };
}

const factories = new Map();
/** Materialize plain row objects from a view (what a row-object consumer pays on the receiving thread). */
export function materialize(v) {
  const { n, cols } = v;
  const columns = cols.map((c) => {
    if (c.kind === 'f64') return c.data;
    if (c.kind === 'str') {
      if (c.ascii) { const s = dec.decode(c.bytes); const out = new Array(n); for (let i = 0; i < n; i++) out[i] = s.slice(c.offsets[i], c.offsets[i + 1]); return out; }
      const out = new Array(n); for (let i = 0; i < n; i++) out[i] = dec.decode(c.bytes.subarray(c.offsets[i], c.offsets[i + 1])); return out;
    }
    const out = new Array(n); for (let i = 0; i < n; i++) out[i] = c.bytes.subarray(c.offsets[i], c.offsets[i + 1]); return out;
  });
  const key = cols.map((c) => c.name).join('\u0000');
  let f = factories.get(key);
  if (!f) { f = new Function('cs', 'i', 'return {' + cols.map((c, j) => JSON.stringify(c.name) + ': cs[' + j + '][i]').join(',') + '}'); factories.set(key, f); }
  const rows = new Array(n);
  for (let i = 0; i < n; i++) rows[i] = f(columns, i);
  return rows;
}
