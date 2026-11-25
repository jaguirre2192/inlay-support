// Where and when a photo was taken, read from its EXIF in the browser (JPEG APP1, HEIC/HEIF
// 'Exif' item). Only the metadata bytes are read; the image itself is never decoded or sent.

/** { latitude, longitude, date } — any may be null. */
export async function photoMeta(file) {
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  let tiff = null;
  if (head[0] === 0xff && head[1] === 0xd8) tiff = await jpegTIFF(file);
  else if (String.fromCharCode(...head.subarray(4, 8)) === 'ftyp') tiff = await heifTIFF(file);
  if (!tiff) return { latitude: null, longitude: null, date: null };
  return readTIFF(tiff);
}

async function jpegTIFF(file) {
  // APP1 'Exif\0\0' sits in the first markers; read up to 256 KB.
  const bytes = new Uint8Array(await file.slice(0, 262144).arrayBuffer());
  let at = 2;
  while (at + 4 < bytes.length && bytes[at] === 0xff) {
    const marker = bytes[at + 1], length = (bytes[at + 2] << 8) | bytes[at + 3];
    if (marker === 0xe1 && bytes[at + 4] === 0x45 && bytes[at + 5] === 0x78 && bytes[at + 6] === 0x69 && bytes[at + 7] === 0x66) {
      return bytes.subarray(at + 10, at + 2 + length);
    }
    if (marker === 0xda) break; // start of scan: no EXIF before the image data
    at += 2 + length;
  }
  return null;
}

// ISO-BMFF: meta → iinf (item 'Exif') + iloc (its extent). Enough for iPhone HEIC files.
async function heifTIFF(file) {
  const bytes = new Uint8Array(await file.slice(0, Math.min(file.size, 1 << 20)).arrayBuffer());
  const view = new DataView(bytes.buffer);
  const boxes = (start, end) => {
    const out = [];
    for (let at = start; at + 8 <= end;) {
      let size = view.getUint32(at), header = 8;
      const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
      if (size === 1) { size = Number(view.getBigUint64(at + 8)); header = 16; }
      if (size === 0) size = end - at;
      if (size < header) break;
      out.push({ type, start: at, body: at + header, end: Math.min(at + size, end) });
      at += size;
    }
    return out;
  };
  const meta = boxes(0, bytes.length).find((b) => b.type === 'meta');
  if (!meta) return null;
  const inner = boxes(meta.body + 4, meta.end); // full box: skip version/flags
  const iinf = inner.find((b) => b.type === 'iinf'), iloc = inner.find((b) => b.type === 'iloc');
  if (!iinf || !iloc) return null;
  // iinf: entry count, then infe boxes (version 2/3: item_ID, protection, item_type).
  const v = bytes[iinf.body];
  const countSize = v === 0 ? 2 : 4;
  let exifID = null;
  for (const infe of boxes(iinf.body + 4 + countSize, iinf.end)) {
    if (infe.type !== 'infe') continue;
    const iv = bytes[infe.body];
    if (iv < 2) continue;
    const id = iv === 2 ? view.getUint16(infe.body + 4) : view.getUint32(infe.body + 4);
    const typeAt = infe.body + 4 + (iv === 2 ? 2 : 4) + 2;
    if (String.fromCharCode(...bytes.subarray(typeAt, typeAt + 4)) === 'Exif') { exifID = id; break; }
  }
  if (exifID === null) return null;
  // iloc: find the extent of exifID.
  let at = iloc.body;
  const lv = bytes[at]; at += 4;
  const sizes = bytes[at], sizes2 = bytes[at + 1]; at += 2;
  const offsetSize = sizes >> 4, lengthSize = sizes & 15, baseSize = sizes2 >> 4, indexSize = lv >= 1 ? sizes2 & 15 : 0;
  const read = (n) => { let v = 0; for (let i = 0; i < n; i++) v = v * 256 + bytes[at++]; return v; };
  const count = lv < 2 ? read(2) : read(4);
  for (let i = 0; i < count; i++) {
    const id = lv < 2 ? read(2) : read(4);
    if (lv >= 1) read(2); // construction method
    read(2); // data reference index
    const base = read(baseSize);
    const extents = read(2);
    let first = null;
    for (let e = 0; e < extents; e++) {
      if (indexSize) read(indexSize);
      const offset = read(offsetSize), length = read(lengthSize);
      if (first === null) first = [base + offset, length];
    }
    if (id === exifID && first) {
      const [offset, length] = first;
      const chunk = new Uint8Array(await file.slice(offset, offset + length).arrayBuffer());
      const skip = new DataView(chunk.buffer).getUint32(0); // exif_tiff_header_offset
      return chunk.subarray(4 + skip);
    }
  }
  return null;
}

function readTIFF(t) {
  const view = new DataView(t.buffer, t.byteOffset, t.byteLength);
  const little = t[0] === 0x49;
  const u16 = (o) => view.getUint16(o, little), u32 = (o) => view.getUint32(o, little);
  const ifd = (offset) => {
    const tags = new Map();
    if (offset + 2 > t.length) return tags;
    const n = u16(offset);
    for (let i = 0; i < n; i++) {
      const e = offset + 2 + i * 12;
      if (e + 12 > t.length) break;
      tags.set(u16(e), { type: u16(e + 2), count: u32(e + 4), value: e + 8 });
    }
    return tags;
  };
  const pointer = (tag) => u32(tag.value);
  const rationals = (tag) => {
    const at = pointer(tag);
    return Array.from({ length: tag.count }, (_, i) => u32(at + i * 8) / (u32(at + i * 8 + 4) || 1));
  };
  const ascii = (tag) => {
    const at = tag.count > 4 ? pointer(tag) : tag.value;
    return String.fromCharCode(...t.subarray(at, at + tag.count)).replace(/\0.*$/, '');
  };
  const root = ifd(u32(4));
  let latitude = null, longitude = null, date = null;
  const gps = root.get(0x8825);
  if (gps) {
    const g = ifd(pointer(gps));
    const lat = g.get(2), lon = g.get(4);
    if (lat && lon) {
      const dms = (r) => r[0] + r[1] / 60 + r[2] / 3600;
      latitude = dms(rationals(lat)) * (g.get(1) && ascii(g.get(1)) === 'S' ? -1 : 1);
      longitude = dms(rationals(lon)) * (g.get(3) && ascii(g.get(3)) === 'W' ? -1 : 1);
    }
  }
  const exif = root.get(0x8769);
  const original = exif && ifd(pointer(exif)).get(0x9003);
  const stamp = original ? ascii(original) : root.get(0x0132) ? ascii(root.get(0x0132)) : null;
  const m = stamp && /^(\d{4}):(\d{2}):(\d{2})/.exec(stamp);
  if (m) date = `${m[1]}-${m[2]}-${m[3]}`;
  return { latitude, longitude, date };
}
