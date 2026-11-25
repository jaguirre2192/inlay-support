// Paints places into a 2D canvas: the map's own art, masked by true borders, for page headers,
// passport pages, share cards and comparisons (the WebGL map stays the interactive view).
//
//   import { paintPlaces, frameOf } from './placeart.js';
//   await paintPlaces(ctx, world, { rect: [x, y, w, h] /* map units to fill the canvas */,
//     width, height,              // canvas pixels to fill
//     inked: Set(ids),            // drawn with their art
//     outlined: Set(ids),         // Want to go style: dashed sage outline on paper
//     tint: Map(id -> css colour),// flat washes instead of art (e.g. friend comparisons)
//     dark: false, sea: true, paperAll: true });
//
// Coordinates are the atlas's map units (world.frame). Rings are Float32Array [x0,y0,x1,y1,...].

const COLOURS = {
  light: { sea: '#D8E3E3', land: '#FCFCF9', edge: '#B4C4C4', visitedPaper: '#EEE3C9', ink: 'rgba(37,59,57,0.55)', want: '#335C4A', wantFill: '#E1EDE4' },
  dark: { sea: '#1D2C31', land: '#34494C', edge: '#607D81', visitedPaper: '#EEE3C9', ink: 'rgba(244,235,214,0.55)', want: '#A3D1B3', wantFill: '#426457' },
};

const images = new Map();
/** A decoded image for an art file (shared cache). */
export function image(url) {
  if (!images.has(url)) {
    images.set(url, (async () => {
      const blob = await (await fetch(url, { cache: 'force-cache' })).blob();
      return createImageBitmap(blob);
    })().catch((e) => { images.delete(url); throw e; }));
  }
  return images.get(url);
}

export const countryArtURL = (file) => `/print/assets/art/${file}`;

export function path(rings, transform) {
  const p = new Path2D();
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i += 2) {
      const [x, y] = transform(ring[i], ring[i + 1]);
      if (i === 0) p.moveTo(x, y); else p.lineTo(x, y);
    }
    p.closePath();
  }
  return p;
}

/** The map rect that shows `ids` together, padded; whole world when empty. */
export function frameOf(world, ids, pad = 0.12) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const id of ids) {
    const r = world.rows.get(id); if (!r) continue;
    const [x, y, w, h] = r.focus; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + w); y1 = Math.max(y1, y + h);
  }
  if (!isFinite(x0)) { const f = world.frame; return [f[0], f[1] + f[3] * 0.06, f[2], f[3] * 0.74]; }
  const w = x1 - x0, h = y1 - y0, px = w * pad, py = h * pad;
  return [x0 - px, y0 - py, w + 2 * px, h + 2 * py];
}

/** Fits `rect` into width × height (cover, centred), returning the map→canvas transform. */
export function fit(rect, width, height, mode = 'cover') {
  const [x, y, w, h] = rect;
  const s = mode === 'cover' ? Math.max(width / w, height / h) : Math.min(width / w, height / h);
  const ox = (width - w * s) / 2 - x * s, oy = (height - h * s) / 2 - y * s;
  const t = (px, py) => [px * s + ox, py * s + oy];
  t.scale = s;
  return t;
}

export async function paintPlaces(ctx, world, o) {
  const c = o.dark ? COLOURS.dark : COLOURS.light;
  const T = fit(o.rect, o.width, o.height, o.mode);
  const view = [-T(0, 0)[0] / T.scale, -T(0, 0)[1] / T.scale, o.width / T.scale, o.height / T.scale];
  const visible = (b) => b[0] < view[0] + view[2] && b[0] + b[2] > view[0] && b[1] < view[1] + view[3] && b[1] + b[3] > view[1];
  if (o.sea !== false) { ctx.fillStyle = c.sea; ctx.fillRect(0, 0, o.width, o.height); }
  if (o.paperAll !== false && world.land) { ctx.fillStyle = c.land; ctx.fill(path(world.land, T), 'evenodd'); }
  const inked = o.inked ?? new Set(), outlined = o.outlined ?? new Set(), tint = o.tint ?? new Map();
  for (const [id, p] of world.places) {
    if (!visible(p.entry?.bounds ?? p.row.bounds)) continue;
    const shape = path(p.rings, T);
    if (tint.has(id)) { ctx.fillStyle = tint.get(id); ctx.fill(shape, 'evenodd'); }
    else if (inked.has(id)) {
      ctx.save(); ctx.clip(shape, 'evenodd');
      ctx.fillStyle = c.visitedPaper; ctx.fill(shape, 'evenodd');
      for (const plate of p.plates) {
        try {
          const img = await image(countryArtURL(plate.image));
          ctx.save();
          if (plate.rings !== p.rings) ctx.clip(path(plate.rings, T), 'evenodd');
          const [fx, fy, fw, fh] = plate.frame, [cx, cy, cw, ch] = plate.crop;
          const [dx, dy] = T(fx, fy);
          ctx.drawImage(img, cx * img.width, cy * img.height, cw * img.width, ch * img.height, dx, dy, fw * T.scale, fh * T.scale);
          ctx.restore();
        } catch { /* art unavailable: paper stays */ }
      }
      ctx.restore();
    } else if (outlined.has(id)) {
      ctx.fillStyle = c.wantFill; ctx.fill(shape, 'evenodd');
    }
  }
  // Edges on top: hairlines for all, ink round inked places, dashed sage for Want to go.
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(0.5, Math.min(1.2, o.width / 1600));
  ctx.strokeStyle = c.edge;
  for (const [id, p] of world.places) if (visible(p.entry?.bounds ?? p.row.bounds) && !outlined.has(id)) ctx.stroke(path(p.rings, T));
  ctx.strokeStyle = c.ink;
  for (const id of inked) { const p = world.places.get(id); if (p && visible(p.entry?.bounds ?? p.row.bounds)) ctx.stroke(path(p.rings, T)); }
  ctx.setLineDash([4, 3]); ctx.strokeStyle = c.want; ctx.lineWidth *= 1.4;
  for (const id of outlined) { const p = world.places.get(id); if (p && visible(p.entry?.bounds ?? p.row.bounds)) ctx.stroke(path(p.rings, T)); }
  ctx.setLineDash([]);
  return T;
}
