// Reads Inlay's INLR format 2 (RegionalGeometry.swift; written for the web by
// tools/build-atlas-data.py): 'INLR', u32 2, then raw DEFLATE of
//   u32 ringset count, per ringset: u32 ring count, per ring u32 point count and
//   zigzag-varint x, y steps in hundredths of a map unit;
// then records that refer to ringsets by index. Strings are u16 length + UTF-8; rects f32[4].

const decoder = new TextDecoder();

export async function fetchINLR(url, signal) {
  const response = await fetch(url, { signal, cache: 'force-cache' });
  if (!response.ok) throw new Error(`Couldn't load ${url} (${response.status})`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const magic = String.fromCharCode(...bytes.subarray(0, 4));
  const version = new DataView(bytes.buffer, bytes.byteOffset).getUint32(4, true);
  if (magic !== 'INLR' || version !== 2) throw new Error(`${url} isn't an INLR 2 file`);
  const stream = new Blob([bytes.subarray(8)]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Reader(new Uint8Array(await new Response(stream).arrayBuffer()));
}

export class Reader {
  constructor(bytes) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.at = 0;
    this.ringsets = [];
    const count = this.u32();
    for (let i = 0; i < count; i++) this.ringsets.push(this.deltaRings());
  }
  get done() { return this.at >= this.bytes.length; }
  u32() { const v = this.view.getUint32(this.at, true); this.at += 4; return v; }
  f32s(n) { const out = new Array(n); for (let i = 0; i < n; i++) { out[i] = this.view.getFloat32(this.at, true); this.at += 4; } return out; }
  string() {
    const n = this.view.getUint16(this.at, true); this.at += 2;
    const s = decoder.decode(this.bytes.subarray(this.at, this.at + n)); this.at += n; return s;
  }
  varint() {
    let value = 0, shift = 0, byte;
    do { byte = this.bytes[this.at++]; value += (byte & 0x7f) * 2 ** shift; shift += 7; } while (byte >= 0x80);
    return value % 2 ? -(value + 1) / 2 : value / 2; // zigzag
  }
  /** A ringset: an array of Float32Array rings, [x0, y0, x1, y1, ...] in map units. */
  deltaRings() {
    const rings = [];
    for (let r = 0, count = this.u32(); r < count; r++) {
      const n = this.u32(), ring = new Float32Array(n * 2);
      let x = 0, y = 0;
      for (let i = 0; i < n; i++) { x += this.varint(); y += this.varint(); ring[2 * i] = x / 100; ring[2 * i + 1] = y / 100; }
      rings.push(ring);
    }
    return rings;
  }
  ringset() { return this.ringsets[this.u32()]; }
  layers() {
    const out = [];
    for (let i = 0, n = this.u32(); i < n; i++) {
      out.push({ image: this.string(), frame: this.f32s(4), crop: this.f32s(4), rings: this.ringset() });
    }
    return out;
  }
}

/** world.inlr: one record per destination until the end of the file. */
export async function readWorld(url, signal) {
  const r = await fetchINLR(url, signal);
  const places = new Map();
  while (!r.done) {
    const id = r.string();
    places.set(id, { rings: r.ringset(), plates: r.layers() });
  }
  return places;
}

/** land.inlr: one ringset. */
export async function readLand(url, signal) {
  const r = await fetchINLR(url, signal);
  return r.ringset();
}

/** regions-xx.inlr: foundation layers, then regions with their outline, layers and overlays. */
export async function readRegions(url, signal) {
  const r = await fetchINLR(url, signal);
  const foundation = r.layers();
  const regions = new Map();
  for (let i = 0, n = r.u32(); i < n; i++) {
    const id = r.string();
    regions.set(id, { rings: r.ringset(), layers: r.layers(), overlays: r.layers() });
  }
  return { foundation, regions };
}

// ---- geometry helpers ------------------------------------------------------------------------

export function boundsOf(rings) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const ring of rings) for (let i = 0; i < ring.length; i += 2) {
    const x = ring[i], y = ring[i + 1];
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return [x0, y0, x1 - x0, y1 - y0];
}

/** Even-odd point in ringset, as the app fills and hit-tests outlines. */
export function contains(rings, x, y) {
  let inside = false;
  for (const ring of rings) {
    const n = ring.length / 2;
    for (let i = 0, k = n - 1; i < n; k = i++) {
      const xi = ring[2 * i], yi = ring[2 * i + 1], xk = ring[2 * k], yk = ring[2 * k + 1];
      if ((yi > y) !== (yk > y) && x < ((xk - xi) * (y - yi)) / (yk - yi) + xi) inside = !inside;
    }
  }
  return inside;
}
