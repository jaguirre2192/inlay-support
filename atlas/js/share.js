// The share card studio, ported from the app's ShareCards.swift (with AtlasPostcard.swift for map
// areas, PassportView.swift for entry stamps and OverlapMap.swift for the Together map).
//
//   import { ShareSheet } from './share.js';
//   html`<${ShareSheet} Sheet=${Sheet} world=${world} atlas=${atlas} update=${update} name=${name}
//          visited=${visited} wanted=${wanted} onChoose=${choose} onClose=${close}
//          friend=${{ name: 'Sam', visited: new Set(['IT', 'FR']) }}   // optional: enables Together
//          design="passport" placeID="JP" />`                          // optional: where to open
//
// Five designs (Atlas, Stamps, Passport, Year, Together), two formats (Story 1080 × 1920, Post
// 1080 × 1350) and two tones (Paper, Night). Cards are drawn at the app's point sizes (360 wide)
// times three into a <canvas>, with the map art from placeart.js. Fixed palette colours, so a card
// looks the same wherever it's posted. Shares a PNG File with the Web Share API, or downloads it.
//
// Pure pieces, for tests and harnesses: drawCard(canvas, source, choice) → { label, title, file },
// cardDesigns(source), passportOrder(source), cardYears(source).
//   source = { world, atlas, visited: Set, friend?, name?(id), shortName?(id) }
//   choice = { design, format: 'story'|'post', tone: 'paper'|'night', area?: null|'world'|group,
//              placeID?, year?, now?: Date }

import { h } from 'preact';
import { useState, useEffect, useRef, useMemo } from 'preact/hooks';
import htm from 'htm';
import { t, language, upper, countryName } from './i18n.js';
import { paintPlaces, path as ringPath } from './placeart.js';

const html = htm.bind(h);

// ---- model -----------------------------------------------------------------------------------

export const DESIGNS = ['atlas', 'stamps', 'passport', 'year', 'together'];
const DESIGN_TITLE = { atlas: 'Atlas', stamps: 'Stamps', passport: 'Passport', year: 'Year', together: 'Together' };
const SHARE_TITLE = { atlas: 'My Inlay atlas card', stamps: 'My Inlay stamps card', passport: 'My Inlay passport card',
  year: 'My Inlay year card', together: 'My Inlay together card' };
const FORMATS = { story: { title: 'Story', w: 360, h: 640, tall: true }, post: { title: 'Post', w: 360, h: 450, tall: false } };
const TONES = { paper: 'Paper', night: 'Night' };
const GROUPS = ['europe', 'north-america', 'south-america', 'asia', 'africa', 'oceania'];
const GROUP_TITLE = { europe: 'Europe', asia: 'Asia', africa: 'Africa', 'north-america': 'North America', 'south-america': 'South America', oceania: 'Oceania' };
const AREA_TITLE = { world: 'World', ...GROUP_TITLE };
/** Points to pixels: the app renders its 360-point cards at 3x. */
const PX = 3;

/** CardPalette: fixed colours per tone. */
const PALETTE = {
  paper: { paper: '#FBF8F1', ink: '#1F2B27', pencil: '#6B746F', sage: '#335C4A', rule: 'rgba(31,43,39,0.14)' },
  night: { paper: '#172120', ink: '#EFE8D8', pencil: '#9AA49F', sage: '#A3D1B3', rule: 'rgba(239,232,216,0.16)' },
};
/** OverlapMap's inks: yours is the sage, theirs a terracotta. */
const yourInk = (dark) => (dark ? '#A3D1B3' : '#335C4A');
const theirInk = (dark) => (dark ? '#E59A7E' : '#B4593C');

const WEB = { // Strings the app doesn't have.
  'Download PNG': { ja: 'PNGをダウンロード', ko: 'PNG 다운로드', de: 'PNG herunterladen', 'pt-BR': 'Baixar PNG', it: 'Scarica PNG', fr: 'Télécharger le PNG' },
};
const tw = (key) => WEB[key]?.[language()] ?? key;

// ---- helpers: places, dates, frames -----------------------------------------------------------

const parseDate = (d) => {
  if (!d) return null;
  const [y, m] = String(d).split('-').map(Number);
  return Number.isInteger(y) ? { year: y, month: m >= 1 && m <= 12 ? m : null } : null;
};
const dateKey = (d) => d.year * 100 + (d.month ?? 0);
/** VisitDate.text: "May 2024", or the year alone. */
const dateText = (d) => d.month
  ? new Intl.DateTimeFormat(language(), { month: 'long', year: 'numeric' }).format(new Date(d.year, d.month - 1, 1))
  : String(d.year);

function names(source) {
  const { world } = source;
  return {
    name: source.name ?? ((id) => { const r = world.rows.get(id); return r ? countryName(id, r.name) : id; }),
    short: source.shortName ?? ((id) => { const r = world.rows.get(id); return r ? countryName(id, r.short ?? r.name) : id; }),
  };
}
const dates = (source) => {
  const out = new Map();
  for (const [id, v] of Object.entries(source.atlas.visits ?? {})) {
    if (!source.visited.has(id) || !source.world.rows.has(id)) continue;
    const d = parseDate(v?.date); if (d) out.set(id, d);
  }
  return out;
};

/** PassportView.order: dated places by date (then name), then the undated by name. */
export function passportOrder(source) {
  const { name } = names(source), d = dates(source);
  const collator = new Intl.Collator(language(), { numeric: true });
  return [...source.visited].filter((id) => source.world.rows.has(id)).sort((a, b) => {
    const da = d.get(a), db = d.get(b);
    if (da && db) return dateKey(da) === dateKey(db) ? (name(a) < name(b) ? -1 : name(a) > name(b) ? 1 : 0) : dateKey(da) - dateKey(db);
    if (da) return -1;
    if (db) return 1;
    return collator.compare(name(a), name(b));
  });
}

/** YearInReview.years: years with a first visit, newest first. */
export const cardYears = (source) => [...new Set([...dates(source).values()].map((d) => d.year))].sort((a, b) => b - a);

/** Which designs have something to show. */
export function cardDesigns(source) {
  const list = [];
  if (source.visited.size) list.push('atlas', 'stamps');
  if (passportOrder(source).length) list.push('passport');
  if (cardYears(source).length) list.push('year');
  if (source.friend) list.push('together');
  return list;
}

const ownerTitle = (owner) => (owner ? t('%@’s atlas', owner) : t('My atlas'));

/** Grows `rect` around its centre until it has the given width-to-height ratio. */
function fitAspect([x, y, w, h], aspect) {
  if (w / h < aspect) { const nw = h * aspect; return [x + w / 2 - nw / 2, y, nw, h]; }
  const nh = w / aspect; return [x, y + h / 2 - nh / 2, w, nh];
}
/** AtlasPostcard.frame(for:). */
const areaFrame = (world, area) => (area === 'world' ? [600, 1500, world.frame[2] - 1200, 14600] : world.overviews?.[area] ?? world.groups[area]);
/** The world frame that holds a set of places, padded, never closer than a small country. */
function frameAround(world, ids, aspect) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const id of ids) {
    const r = world.rows.get(id); if (!r) continue;
    const [x, y, w, h] = r.focus ?? r.bounds;
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + w); y1 = Math.max(y1, y + h);
  }
  if (!isFinite(x0)) return null;
  const pad = Math.max(x1 - x0, y1 - y0) * 0.14;
  let rect = [x0 - pad, y0 - pad, x1 - x0 + 2 * pad, y1 - y0 + 2 * pad];
  if (rect[2] < 2600) rect = [rect[0] - (2600 - rect[2]) / 2, rect[1], 2600, rect[3]];
  return fitAspect(rect, aspect);
}
/** AtlasPostcard.suggestedArea: the continent when every place is on one, else the world. */
function suggestedArea(world, ids) {
  const groups = new Set([...ids].map((id) => world.rows.get(id)?.group).filter(Boolean));
  return groups.size === 1 ? [...groups][0] : 'world';
}
/** Where most of the places are, when one continent holds at least 70% of them. */
function mainCluster(world, ids) {
  const byGroup = new Map();
  let total = 0;
  for (const id of ids) {
    const g = world.rows.get(id)?.group; if (!g) continue;
    total++; if (!byGroup.has(g)) byGroup.set(g, []); byGroup.get(g).push(id);
  }
  let best = null;
  for (const [g, members] of byGroup) if (!best || members.length > best[1].length) best = [g, members];
  if (!best || byGroup.size < 2 || best[1].length < total * 0.7) return null;
  return { ids: new Set(best[1]), title: t(GROUP_TITLE[best[0]]), others: total - best[1].length };
}

// ---- drawing primitives ----------------------------------------------------------------------

const ASC = 0.952, LH = 1.193; // SF's ascender and line height, as fractions of the size
const HAS_SPACING = typeof CanvasRenderingContext2D !== 'undefined' && 'letterSpacing' in CanvasRenderingContext2D.prototype;
let FONTS = null;
function fonts() {
  if (FONTS) return FONTS;
  const s = getComputedStyle(document.documentElement);
  const v = (name, fallback) => s.getPropertyValue(name).trim() || fallback;
  FONTS = {
    text: v('--font', '-apple-system, BlinkMacSystemFont, system-ui, sans-serif'),
    display: v('--display', '-apple-system, BlinkMacSystemFont, system-ui, sans-serif'),
    rounded: v('--rounded', 'ui-rounded, -apple-system, system-ui, sans-serif'),
    mono: 'ui-monospace, "SF Mono", SFMono-Regular, Menlo, monospace',
  };
  return FONTS;
}
/** A text style: size in points, weight, family ('text' | 'rounded' | 'mono'), tracking, colour. */
const S = (size, weight, family = 'text', track = 0, color) => ({ size, weight, family, track, color });
function apply(ctx, st) {
  const f = fonts();
  const family = st.family === 'rounded' ? f.rounded : st.family === 'mono' ? f.mono : st.size >= 20 ? f.display : f.text;
  ctx.font = `${st.weight} ${st.size}px ${family}`;
  if (HAS_SPACING) ctx.letterSpacing = `${st.track}px`;
  if (st.color) ctx.fillStyle = st.color;
}
function widthOf(ctx, s, st) {
  apply(ctx, st);
  return ctx.measureText(s).width + (HAS_SPACING ? 0 : st.track * [...s].length);
}
function put(ctx, s, x, y, st) {
  apply(ctx, st);
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  if (HAS_SPACING || !st.track) { ctx.fillText(s, x, y); return; }
  for (const ch of s) { ctx.fillText(ch, x, y); x += ctx.measureText(ch).width + st.track; }
}
const scaled = (st, k) => ({ ...st, size: st.size * k, track: st.track * k });
/** One line: shrinks to `minScale` to fit `maxWidth`, then truncates (lineLimit 1, minimumScaleFactor). */
function fitLine(ctx, s, st, maxWidth = Infinity, minScale = 1) {
  let w = widthOf(ctx, s, st);
  if (w <= maxWidth) return { s, st, w };
  // Glyph widths don't scale exactly linearly, so step down until it fits.
  const base = st;
  for (let k = Math.max(minScale, maxWidth / w); ; k = Math.max(minScale, k * 0.985)) {
    st = scaled(base, k); w = widthOf(ctx, s, st);
    if (w <= maxWidth + 0.01) return { s, st, w };
    if (k <= minScale) break;
  }
  const chars = [...s];
  while (chars.length > 1 && widthOf(ctx, chars.join('').trimEnd() + '…', st) > maxWidth) chars.pop();
  s = chars.join('').trimEnd() + '…';
  return { s, st, w: widthOf(ctx, s, st) };
}
/** Draws a line at a baseline; align 'left' | 'right' | 'center' about x. Returns its width. */
function line(ctx, s, x, baseline, st, { maxWidth, minScale = 1, align = 'left' } = {}) {
  const fitted = fitLine(ctx, s, st, maxWidth, minScale);
  const left = align === 'right' ? x - fitted.w : align === 'center' ? x - fitted.w / 2 : x;
  put(ctx, fitted.s, left, baseline, fitted.st);
  return fitted;
}
/** Word-wraps a paragraph (CJK breaks between characters). */
function wrap(ctx, text, st, maxWidth) {
  const lines = [];
  for (const para of String(text).split('\n')) {
    const tokens = para.match(/\S+\s*|\s+/g) ?? [''];
    let current = '';
    for (const token of tokens) {
      const pieces = widthOf(ctx, token.trim(), st) > maxWidth ? [...token] : [token];
      for (const piece of pieces) {
        if (current && widthOf(ctx, (current + piece).trimEnd(), st) > maxWidth) { lines.push(current.trimEnd()); current = piece.trimStart(); }
        else current += piece;
      }
    }
    lines.push(current.trimEnd());
  }
  return lines;
}
/** Lines that fit `maxLines`, shrinking down to `minScale` first (lineLimit + minimumScaleFactor). */
function fitLines(ctx, text, st, maxWidth, maxLines, minScale) {
  for (let k = 1; k >= minScale - 1e-6; k -= 0.025) {
    const s = scaled(st, k), lines = wrap(ctx, text, s, maxWidth);
    if (lines.length <= maxLines && lines.every((l) => widthOf(ctx, l, s) <= maxWidth + 0.01)) return { lines, st: s };
  }
  const s = scaled(st, minScale), lines = wrap(ctx, text, s, maxWidth);
  const kept = lines.slice(0, maxLines);
  if (lines.length > maxLines) kept[maxLines - 1] = fitLine(ctx, kept[maxLines - 1] + ' ' + lines[maxLines], s, maxWidth).s;
  return { lines: kept.map((l) => fitLine(ctx, l, s, maxWidth).s), st: s };
}

function rgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
}
const rgb = (r, g, b, a = 1) => `rgba(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)},${a})`;

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h));
  return c;
}

/** A map of `rect` (map units, already the canvas's aspect) at `w` × `h` points. */
async function mapImage(world, rect, w, h, { inked, dark, overlay }) {
  const c = canvas(w * PX, h * PX), ctx = c.getContext('2d');
  const T = await paintPlaces(ctx, world, { rect, width: c.width, height: c.height, inked, dark });
  overlay?.(ctx, T);
  return c;
}
/** ShareCards.art(of:): a place's art filling a frame, cropped in but never losing most of it. */
async function artImage(world, id, w, h, { focus = [0.5, 0.5], zoom = 1.35, dark }) {
  const row = world.rows.get(id); if (!row) return null;
  const [x, y, rw, rh] = row.focus ?? row.bounds;
  const fitScale = Math.min(w / rw, h / rh), fillScale = Math.max(w / rw, h / rh);
  const scale = Math.min(fillScale, fitScale * zoom) * 0.94;
  const cx = x + rw / 2, cy = y + rh / 2;
  const rect = [cx - (w * focus[0]) / scale, cy - (h * focus[1]) / scale, w / scale, h / scale];
  return mapImage(world, rect, w, h, { inked: new Set([id]), dark });
}

/** Paper fading in over art, so type can sit on it. `top` puts the paper at the top edge. */
function fade(ctx, p, x, y, w, h, top = false) {
  const g = top ? ctx.createLinearGradient(0, y + h, 0, y) : ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, rgba(p.paper, 0)); g.addColorStop(0.55, rgba(p.paper, 0.82)); g.addColorStop(1, p.paper);
  ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
}

/** A VStack's spacers: equal shares of the height the fixed items leave. */
function stack(height, items) {
  const fixed = items.reduce((a, it) => a + (it === null ? 0 : it), 0);
  const spacers = items.filter((it) => it === null).length;
  const share = spacers ? Math.max(0, (height - fixed) / spacers) : 0;
  let y = 0;
  return items.map((it) => { const at = y; y += it === null ? share : it; return at; });
}

// ---- entry stamps (PassportView.swift) -------------------------------------------------------

const hashOf = (seed, start, mul, mod) => [...seed].reduce((a, ch) => (a * mul + ch.codePointAt(0)) % mod, start);
/** SeededRandom: a 64-bit LCG, as the app's. */
function seeded(seed) {
  const M = (1n << 64n) - 1n, A = 6364136223846793005n, C = 1442695040888963407n;
  let state = (BigInt(seed) * A + C) & M;
  return () => { state = (state * A + C) & M; return Number((state >> 33n) & 0x7fffffffn); };
}
function groupInk(group, dark) {
  if (group === 'europe') return dark ? rgb(0.93, 0.55, 0.52) : rgb(0.55, 0.18, 0.20);
  if (group === 'north-america') return dark ? rgb(0.60, 0.72, 0.95) : rgb(0.16, 0.27, 0.50);
  return dark ? rgb(0.64, 0.82, 0.70) : rgb(0.20, 0.36, 0.29);
}
const stampDate = (d) => (d ? upper(dateText(d)) : t('UNDATED'));

function roundRect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }
/** strokeBorder: the stroke sits inside the shape's frame. */
function borderRect(ctx, x, y, w, h, r, lw, dash) {
  ctx.lineWidth = lw; ctx.setLineDash(dash ?? []);
  roundRect(ctx, x + lw / 2, y + lw / 2, w - lw, h - lw, Math.max(0, r - lw / 2)); ctx.stroke();
  ctx.setLineDash([]);
}
function borderEllipse(ctx, x, y, w, h, lw, dash) {
  ctx.lineWidth = lw; ctx.setLineDash(dash ?? []);
  ctx.beginPath(); ctx.ellipse(x + w / 2, y + h / 2, Math.max(0, w / 2 - lw / 2), Math.max(0, h / 2 - lw / 2), 0, 0, Math.PI * 2); ctx.stroke();
  ctx.setLineDash([]);
}
function octagon(ctx, x, y, w, h, lw) {
  const cx = w * 0.29, cy = h * 0.29;
  ctx.lineWidth = lw; ctx.beginPath();
  ctx.moveTo(x + cx, y); ctx.lineTo(x + w - cx, y); ctx.lineTo(x + w, y + cy); ctx.lineTo(x + w, y + h - cy);
  ctx.lineTo(x + w - cx, y + h); ctx.lineTo(x + cx, y + h); ctx.lineTo(x, y + h - cy); ctx.lineTo(x, y + cy); ctx.closePath(); ctx.stroke();
}
/** The "airplane" symbol, drawn small: nose to the right. */
function airplane(ctx, cx, cy, size) {
  const k = size / 20;
  ctx.save(); ctx.translate(cx, cy); ctx.scale(k, k); ctx.beginPath();
  ctx.moveTo(10, 0); ctx.bezierCurveTo(10, -1.3, 8.6, -1.6, 7.4, -1.6); ctx.lineTo(3, -1.6);
  ctx.lineTo(-2.2, -9.4); ctx.lineTo(-4.4, -9.4); ctx.lineTo(-1.4, -1.6); ctx.lineTo(-6.2, -1.6);
  ctx.lineTo(-8.2, -4.4); ctx.lineTo(-9.8, -4.4); ctx.lineTo(-8.6, 0);
  ctx.lineTo(-9.8, 4.4); ctx.lineTo(-8.2, 4.4); ctx.lineTo(-6.2, 1.6); ctx.lineTo(-1.4, 1.6);
  ctx.lineTo(-4.4, 9.4); ctx.lineTo(-2.2, 9.4); ctx.lineTo(3, 1.6); ctx.lineTo(7.4, 1.6);
  ctx.bezierCurveTo(8.6, 1.6, 10, 1.3, 10, 0); ctx.closePath(); ctx.fill(); ctx.restore();
}

/** Draws a VStack of centred lines into a frame; each line is [text, style, gapBefore, maxWidth, minScale] or ['rule', width, height]. */
function centredLines(ctx, lines, cx, top, height) {
  const heights = lines.map((l) => (l[0] === 'rule' ? l[2] : l[0] === 'icon' ? l[1] * LH : l[1].size * LH));
  const total = heights.reduce((a, b) => a + b, 0) + lines.reduce((a, l) => a + (l[0] === 'rule' || l[0] === 'icon' ? l[3] : l[2]) , 0);
  let y = top + (height - total) / 2;
  lines.forEach((l, i) => {
    if (l[0] === 'rule') { y += l[3]; ctx.fillRect(cx - l[1] / 2, y, l[1], l[2]); y += l[2]; return; }
    if (l[0] === 'icon') { y += l[3]; airplane(ctx, cx, y + heights[i] / 2, l[1]); y += heights[i]; return; }
    const [text, st, gap, maxWidth, minScale] = l;
    y += gap;
    // A shrunk line stays centred in its slot.
    const fitted = fitLine(ctx, text, st, maxWidth, minScale);
    const size = fitted.st.size;
    put(ctx, fitted.s, cx - fitted.w / 2, y + (heights[i] - size * LH) / 2 + size * ASC, fitted.st);
    y += heights[i];
  });
}

/**
 * MessyStamp: a border stamp as it lands, its shape, ink, angle and coverage fixed by the place's
 * seed. Returns { image, w, h, angle, opacity } with the frame in points.
 */
function messyStamp({ name, date, seed, dark, scale: s }) {
  const hash = hashOf(seed, 17, 131, 1000003);
  const kinds = ['box', 'round', 'oval', 'octagon', 'ticket'];
  const kind = kinds[hash % 5];
  const angle = (Math.floor(hash / 5) % 37) - 18;
  const inks = [[0.58, 0.16, 0.19], [0.15, 0.26, 0.52], [0.18, 0.38, 0.28], [0.38, 0.22, 0.50], [0.16, 0.17, 0.20], [0.10, 0.40, 0.45]];
  const [r, g, b] = inks[Math.floor(hash / 191) % inks.length];
  const ink = dark ? rgb(0.55 + r * 0.45, 0.55 + g * 0.45, 0.55 + b * 0.45) : rgb(r, g, b);
  const words = kind === 'ticket' ? ['ENTRY', 'ENTRADA', 'ARRIVAL', 'VISA'] : ['ENTRY', 'ADMITTED', 'ARRIVAL', 'ENTRADA', 'IMMIGRATION'];
  const label = words[Math.floor(hash / 7) % words.length];
  const when = stampDate(date), title = upper(name);
  const mono = (size, weight) => S(size, weight, 'mono');
  let w, h;
  const draw = (ctx) => {
    ctx.fillStyle = ink; ctx.strokeStyle = ink;
    if (kind === 'box') {
      const lines = [[label, S(9 * s, 800, 'text', 3 * s), 0], [title, S(15 * s, 800, 'text', 1.2 * s), 3 * s, 112 * s, 0.55],
        ['rule', 112 * s, Math.max(0.5, s), 3 * s], [when, mono(10 * s, 700), 3 * s, 112 * s, 0.7]];
      centredLines(ctx, lines, w / 2, 10 * s, h - 20 * s);
      borderRect(ctx, 0, 0, w, h, 6 * s, 2.2 * s);
      borderRect(ctx, 4 * s, 4 * s, w - 8 * s, h - 8 * s, 3 * s, 0.8 * s);
    } else if (kind === 'round') {
      borderEllipse(ctx, 0, 0, w, h, 2.4 * s);
      borderEllipse(ctx, 6 * s, 6 * s, w - 12 * s, h - 12 * s, 0.9 * s, [2 * s, 1.6 * s]);
      centredLines(ctx, [['icon', 10 * s, 0, 0], [title, S(13 * s, 800, 'text', 0.6 * s), 2 * s, w - 30 * s, 0.5],
        [when, mono(8.5 * s, 700), 2 * s, w - 30 * s, 0.6], [label, S(7 * s, 800, 'text', 1.5 * s), 2 * s]], w / 2, 0, h);
    } else if (kind === 'oval') {
      borderEllipse(ctx, 0, 0, w, h, 2.2 * s);
      borderEllipse(ctx, 5 * s, 5 * s, w - 10 * s, h - 10 * s, 0.8 * s);
      centredLines(ctx, [[label, S(8 * s, 800, 'text', 2.4 * s), 0], [title, S(14 * s, 900), 2 * s, w - 44 * s, 0.5],
        [when, mono(9 * s, 600), 2 * s, w - 44 * s, 0.6]], w / 2, 0, h);
    } else if (kind === 'octagon') {
      octagon(ctx, 1.1 * s, 1.1 * s, w - 2.2 * s, h - 2.2 * s, 2.2 * s);
      octagon(ctx, 5 * s, 5 * s, w - 10 * s, h - 10 * s, 0.8 * s);
      centredLines(ctx, [[title, S(13 * s, 800), 0, w - 32 * s, 0.5], ['rule', 58 * s, Math.max(0.5, s), 3 * s],
        [when, mono(9 * s, 700), 3 * s, w - 32 * s, 0.6], [label, S(7 * s, 800, 'text', 2 * s), 3 * s]], w / 2, 0, h);
    } else {
      const pad = 8 * s, inner = h - 2 * pad;
      const st = S(7.5 * s, 800, 'text', 1.6 * s);
      ctx.save(); ctx.translate(pad + 6 * s, h / 2); ctx.rotate(-Math.PI / 2);
      line(ctx, label, 0, st.size * ASC - (st.size * LH) / 2, st, { align: 'center' });
      ctx.restore();
      const ruleX = pad + 12 * s + 6 * s;
      ctx.fillRect(ruleX, pad, Math.max(0.5, s * 0.9), inner);
      const x = ruleX + Math.max(0.5, s * 0.9) + 6 * s, avail = w - pad - x;
      const a = S(14 * s, 800), d = mono(9.5 * s, 700);
      const block = a.size * LH + 2 * s + d.size * LH, top = h / 2 - block / 2;
      line(ctx, title, x, top + a.size * ASC, a, { maxWidth: avail, minScale: 0.5 });
      line(ctx, when, x, top + a.size * LH + 2 * s + d.size * ASC, d, { maxWidth: avail, minScale: 0.6 });
      borderRect(ctx, 0, 0, w, h, 0, 1.8 * s);
      borderRect(ctx, 3.5 * s, 3.5 * s, w - 7 * s, h - 7 * s, 0, 0.8 * s, [3 * s, 2 * s]);
    }
  };
  if (kind === 'box') w = 140 * s, h = 20 * s + (9 + 15 + 10) * s * LH + 9 * s + Math.max(0.5, s);
  else if (kind === 'round') w = h = 108 * s;
  else if (kind === 'oval') w = 152 * s, h = 84 * s;
  else if (kind === 'octagon') w = 118 * s, h = 98 * s;
  else w = 144 * s, h = 70 * s;

  const c = canvas(w * PX, h * PX), ctx = c.getContext('2d');
  ctx.scale(PX, PX);
  draw(ctx);
  // InkCoverage: one side pressed harder than the other, with small dry gaps.
  const rng = seeded(hash);
  const a = ((rng() % 360) * Math.PI) / 180;
  const fadeTo = 0.5 + (rng() % 20) / 100;
  const grad = ctx.createLinearGradient(w * (0.5 - Math.cos(a) / 2), h * (0.5 - Math.sin(a) / 2), w * (0.5 + Math.cos(a) / 2), h * (0.5 + Math.sin(a) / 2));
  grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(1, `rgba(255,255,255,${fadeTo})`);
  ctx.globalCompositeOperation = 'destination-in'; ctx.fillStyle = grad; ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = 'destination-out'; ctx.fillStyle = '#000';
  const gaps = Math.floor((w * h) / 140);
  for (let i = 0; i < gaps; i++) {
    const x = ((rng() % 1000) / 1000) * w, y = ((rng() % 1000) / 1000) * h;
    const r2 = 0.4 + ((rng() % 100) / 100) * 1.3;
    ctx.globalAlpha = 0.25 + (rng() % 75) / 100;
    ctx.beginPath(); ctx.ellipse(x, y - r2 + 0.8 * r2, r2, 0.8 * r2, 0, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  return { image: c, w, h, angle, opacity: dark ? 0.95 : 0.86 };
}

/** EntryStamp's classic face: the passport card's stamp, on a paper ground. */
function classicStamp(ctx, { name, date, group, seed, dark, scale: s, background }, x, bottom) {
  const ink = groupInk(group, dark);
  const angle = (hashOf(seed, 0, 31, 997) % 17) - 8;
  const w = 140 * s, h = 20 * s + (9 + 15 + 10) * s * LH + 9 * s + Math.max(0.5, s);
  const y = bottom - h;
  ctx.save();
  ctx.translate(x + w / 2, y + h / 2); ctx.rotate((angle * Math.PI) / 180); ctx.translate(-w / 2, -h / 2);
  ctx.fillStyle = background; roundRect(ctx, 0, 0, w, h, 8 * s); ctx.fill();
  ctx.globalAlpha = 0.8; ctx.strokeStyle = ink; borderRect(ctx, 0, 0, w, h, 8 * s, 2 * s);
  ctx.globalAlpha = 0.6; borderRect(ctx, 4 * s, 4 * s, w - 8 * s, h - 8 * s, 5 * s, 0.8 * s);
  ctx.globalAlpha = 0.82; ctx.fillStyle = ink;
  centredLines(ctx, [['ENTRY', S(9 * s, 800, 'text', 3 * s), 0], [upper(name), S(15 * s, 800, 'text', 1.2 * s), 3 * s, 112 * s, 0.6],
    ['rule', 112 * s, Math.max(0.5, s), 3 * s], [stampDate(date), S(10 * s, 700, 'mono'), 3 * s, 112 * s, 0.7]], w / 2, 10 * s, h - 20 * s);
  ctx.restore();
  return h;
}

/** Where a stamp lands across the page: alternate rows shift inward, never off the page edge. */
function stampX(index, columns, step, jitter) {
  const column = index % columns, last = column === columns - 1;
  const shift = Math.floor(index / columns) % 2 === 1 ? step * (last ? -0.12 : column === 0 ? 0.12 : 0) : 0;
  // Stamps overlap like a used page, but never so far that one hides its neighbour's name.
  const nudge = Math.max(-step * 0.12, Math.min(step * 0.12, jitter));
  return column * step + shift + (last ? -Math.abs(nudge) : nudge);
}
/** A fixed, place-specific nudge so the page looks stamped by hand. */
function jitter(seed) {
  const value = hashOf(seed, 7, 131, 10007);
  return { x: (value % 21) / 10 - 1, y: (Math.floor(value / 21) % 21) / 10 - 1 };
}

// ---- the card --------------------------------------------------------------------------------

/**
 * Draws one card into `target` at full size (1080 wide). Returns what the app's describe() says
 * for screen readers, the share title and a file name.
 */
export async function drawCard(target, source, choice) {
  await document.fonts?.ready;
  const { world, atlas, visited, friend } = source;
  const { name, short } = names(source);
  const design = choice.design, f = FORMATS[choice.format] ?? FORMATS.story, tone = choice.tone === 'night' ? 'night' : 'paper';
  const dark = tone === 'night', p = PALETTE[tone], tall = f.tall, W = f.w, H = f.h, area = choice.area ?? null;
  const owner = (atlas.name ?? '').trim();
  const edition = new Intl.DateTimeFormat(language(), { month: 'long', year: 'numeric' }).format(choice.now ?? new Date());
  const d = dates(source);
  const order = passportOrder(source);
  const since = [...d.values()].reduce((m, v) => Math.min(m, v.year), Infinity);
  const frameFor = (ids, w, h) => (area ? fitAspect(areaFrame(world, area), w / h)
    : frameAround(world, ids, w / h) ?? fitAspect(areaFrame(world, 'world'), w / h));
  const titleFor = (ids) => t(AREA_TITLE[area ?? suggestedArea(world, ids)]);

  target.width = W * PX; target.height = H * PX;
  const ctx = target.getContext('2d');
  ctx.setTransform(PX, 0, 0, PX, 0, 0);
  const draw = []; // painting is collected, then run once the images are in, so the card never shows half-drawn

  // Shared pieces.
  const ks = tall ? 10 : 9;
  const kicker = (text, x, baseline, color, opts) => line(ctx, upper(text), x, baseline, S(ks, 600, 'text', 2.2, color ?? p.pencil), opts);
  const headerHeight = (tall ? 30 : 22) + ks * LH;
  const header = (left, right) => {
    const base = (tall ? 30 : 22) + ks * ASC, room = W - 48 - 12;
    const st = S(ks, 600, 'text', 2.2);
    const lw = widthOf(ctx, upper(left), st), rw = widthOf(ctx, upper(right), st);
    const lmax = lw + rw <= room ? lw : Math.max(room / 2, room - rw), rmax = room - Math.min(lw, lmax);
    kicker(left, 24, base, p.sage, { maxWidth: lmax });
    kicker(right, W - 24, base, p.pencil, { maxWidth: rmax, align: 'right' });
  };
  const footerHeight = 13 * LH + (tall ? 28 : 20);
  const footer = () => {
    const top = H - (tall ? 28 : 20) - 13 * LH, base = top + 13 * ASC;
    const brand = line(ctx, t('Inlay'), 24, base, S(13, 700, 'text', -0.3, p.ink));
    const ed = line(ctx, edition, W - 24, base, S(11, 500, 'text', 0, p.pencil), { align: 'right' });
    line(ctx, t('· %@', ownerTitle(owner).toLocaleLowerCase(language())), 24 + brand.w + 5, base, S(11, 500, 'text', 0, p.pencil),
      { maxWidth: W - 48 - brand.w - ed.w - 15 });
  };
  const figure = (value, caption, x, top, width) => {
    const vs = tall ? 24 : 20;
    line(ctx, value, x, top + vs * ASC, S(vs, 600, 'rounded', 0, p.ink), { maxWidth: width, minScale: 0.6 });
    line(ctx, caption, x, top + vs * LH + 2 + 11 * ASC, S(11, 500, 'text', 0, p.pencil), { maxWidth: width });
  };
  const image = (img, x, y, w, h) => img && ctx.drawImage(img, x, y, w, h);
  /** A number and its caption side by side, the caption's last line on the number's baseline. */
  const bigFigure = (value, caption, x, top, numberStyle, captionStyle, gap) => {
    const base = top + numberStyle.size * ASC;
    const nw = line(ctx, value, x, base, numberStyle).w;
    const cx = x + nw + gap, lines = wrap(ctx, caption, captionStyle, W - 22 - cx);
    lines.forEach((l, i) => line(ctx, l, cx, base - (lines.length - 1 - i) * captionStyle.size * LH, captionStyle));
  };

  let label = '';
  if (design === 'atlas') {
    const countries = [...visited].filter((id) => world.rows.get(id)?.kind === 'country').length;
    const territories = [...visited].filter((id) => world.rows.get(id)?.kind === 'territory').length;
    const share = Math.min(1, countries / (world.countryCount || 1));
    const worldShare = countries > 0 && share < 0.005 ? '<1%'
      : new Intl.NumberFormat(language(), { style: 'percent', maximumFractionDigits: 0 }).format(share);
    const focus = area ? null : mainCluster(world, visited);
    const areaTitle = focus ? (focus.others > 0 ? t('%@ + %lld more', focus.title, focus.others) : focus.title) : titleFor(visited);
    const mapH = tall ? 400 : 236;
    const map = await mapImage(world, frameFor(focus?.ids ?? visited, W, mapH), W, mapH, { inked: visited, dark });
    label = t('Atlas card: %lld countries, %lld territories, %@ of the world', countries, territories, worldShare);
    draw.push(() => {
      image(map, 0, 0, W, mapH);
      fade(ctx, p, 0, 0, W, tall ? 110 : 70, true);
      fade(ctx, p, 0, mapH - (tall ? 150 : 96), W, tall ? 150 : 96);
      header(ownerTitle(owner), areaTitle);
      const N = tall ? 120 : 76, lift = tall ? -70 : -44;
      const fig = tall ? 24 : 20, figH = fig * LH + 2 + 11 * LH;
      const [, figuresTop] = stack(H - mapH - (N * LH + lift), [null, figH, null, footerHeight]);
      bigFigure(String(countries), t('shareCard.caption.countriesSoFar', countries), 22, mapH + lift,
        S(N, 700, 'rounded', tall ? -6 : -4, p.ink), S(tall ? 20 : 16, 600, 'text', -0.3, p.ink), 10);
      const top = mapH + N * LH + lift + figuresTop, col = (W - 48) / 3;
      figure(String(territories), t('shareCard.caption.territories', territories), 24, top, col);
      figure(worldShare, t('of the world'), 24 + col, top, col);
      figure(Number.isFinite(since) ? String(since) : '—', t('since'), 24 + 2 * col, top, col);
      footer();
    });
  } else if (design === 'stamps') {
    const capacity = tall ? 15 : 9;
    const shown = order.length > capacity ? capacity - 1 : order.length;
    const stamps = order.slice(0, shown).map((id) => ({ id, name: short(id), date: d.get(id) }));
    const more = order.length - shown, count = stamps.length + (more > 0 ? 1 : 0);
    const columns = count <= (tall ? 6 : 4) ? 2 : 3;
    // Larger than their spacing, so stamps land on top of each other like a used passport page.
    const scale = columns === 2 ? (tall ? 1.18 : 0.96) : (tall ? 0.92 : 0.8);
    const cell = { w: 140 * scale, h: 84 * scale };
    const rows = Math.ceil(count / columns);
    const areaW = W - 40, areaH = tall ? 440 : 262;
    const stepX = (areaW - cell.w) / Math.max(columns - 1, 1);
    const stepY = rows > 1 ? Math.min(cell.h * (tall ? 1.3 : 1.0), (areaH - cell.h) / (rows - 1)) : 0;
    const gridH = stepY * Math.max(rows - 1, 0) + cell.h;
    label = t('Stamps card: %lld stamps', order.length);
    const pressed = stamps.map((st, index) => {
      const j = jitter(st.id), o = jitter(st.id + '#');
      const x = stampX(index, columns, stepX, j.x * (tall ? 26 : 18));
      const y = Math.floor(index / columns) * stepY + (index < columns ? Math.abs(j.y) : j.y) * (tall ? 30 : 16);
      return { ...messyStamp({ name: st.name, date: st.date, seed: st.id, dark, scale }), x, y, z: o.x, index };
    }).sort((a, b) => a.z - b.z || a.index - b.index);
    draw.push(() => {
      guilloche(ctx, W, H, rgba(p.sage, dark ? 0.10 : 0.08));
      header(t('Passport'), Number.isFinite(since) ? t('Since %@', String(since)) : t('Visas & entries'));
      const gridPad = tall ? 34 : 18, N = tall ? 72 : 52, ruleH = 0.5 + 2 * (tall ? 14 : 10);
      const [, , gridTop, , figureTop, ruleTop] = stack(H, [headerHeight, null, gridH + gridPad, null, N * LH, ruleH, footerHeight]);
      const ox = 20, oy = gridTop + gridPad;
      for (const st of pressed) {
        ctx.save();
        ctx.globalCompositeOperation = dark ? 'screen' : 'multiply';
        ctx.globalAlpha = st.opacity;
        ctx.translate(ox + st.x + st.w / 2, oy + st.y + st.h / 2); ctx.rotate((st.angle * Math.PI) / 180);
        ctx.drawImage(st.image, -st.w / 2, -st.h / 2, st.w, st.h);
        ctx.restore();
      }
      if (more > 0) {
        const index = stamps.length, x = ox + (index % columns) * stepX, y = oy + Math.floor(index / columns) * stepY;
        const st = S(15 * scale + 4, 700, 'rounded', 0, p.pencil);
        const lines = t('+%lld\nmore', more).split('\n');
        const top = y + cell.h / 2 - (lines.length * st.size * LH) / 2;
        lines.forEach((l, i) => line(ctx, l, x + cell.w / 2, top + i * st.size * LH + st.size * ASC, st, { align: 'center' }));
        const r = (cell.h * 1.1) / 2;
        ctx.strokeStyle = rgba(p.pencil, 0.5); ctx.lineWidth = 1.2; ctx.setLineDash([3, 2.5]);
        ctx.beginPath(); ctx.arc(x + cell.w / 2, y + cell.h / 2, r - 0.6, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
      }
      bigFigure(String(order.length), t('shareCard.caption.stamps', order.length), 22, figureTop,
        S(N, 700, 'rounded', -3, p.ink), S(tall ? 17 : 14, 600, 'text', -0.2, p.ink), 8);
      ctx.fillStyle = p.rule; ctx.fillRect(24, ruleTop + (tall ? 14 : 10), W - 48, 0.5);
      footer();
    });
  } else if (design === 'passport') {
    const id = order.includes(choice.placeID) ? choice.placeID : order.at(-1);
    const row = world.rows.get(id);
    if (row) {
      const number = order.indexOf(id) + 1, date = d.get(id);
      const kindTitle = row.kind === 'territory' ? t('Territory') : t(GROUP_TITLE[row.group]);
      const placeName = name(id);
      const firstVisit = date ? t('First visited %@', dateText(date)) : t('Visited');
      const trips = (atlas.trips ?? []).filter((tr) => tr.places?.includes(id)).sort((a, b) => String(a.start).localeCompare(String(b.start)));
      const tripLine = trips.length
        ? t('%lld trips · %@', trips.length, new Intl.ListFormat(language(), { type: 'conjunction', style: 'narrow' }).format(trips.slice(0, 2).map((tr) => tr.name)))
        : '';
      // The art fills the whole card; the name sits on a paper fade below it.
      const art = await artImage(world, id, W, H, { focus: [0.5, tall ? 0.4 : 0.38], zoom: tall ? 1.5 : 1.3, dark });
      label = t('Passport card: %@, %@', placeName, firstVisit);
      draw.push(() => {
        image(art, 0, 0, W, H);
        fade(ctx, p, 0, 0, W, tall ? 120 : 80, true);
        fade(ctx, p, 0, H - (tall ? 330 : 210), W, tall ? 330 : 210);
        header(t('Passport'), t('No. %@ of %lld', String(number).padStart(2, '0'), order.length));
        // From the foot up: footer, the name block, then the stamp.
        const nameStyle = S(tall ? 46 : 32, 700, 'text', -1.4, p.ink);
        const fitted = fitLines(ctx, placeName, nameStyle, W - 48, 2, 0.55);
        const gap = tall ? 5 : 2, visitSize = tall ? 15 : 13, withTrip = tall && tripLine;
        const blockH = ks * LH + gap + fitted.lines.length * fitted.st.size * LH + gap + visitSize * LH + (withTrip ? gap + 4 + 13 * LH : 0);
        const blockBottom = H - footerHeight - (tall ? 22 : 12), blockTop = blockBottom - blockH;
        let y = blockTop;
        kicker(kindTitle, 24, y + ks * ASC, p.pencil, { maxWidth: W - 48 }); y += ks * LH + gap;
        for (const l of fitted.lines) { line(ctx, l, 24, y + fitted.st.size * ASC, fitted.st); y += fitted.st.size * LH; }
        y += gap;
        line(ctx, firstVisit, 24, y + visitSize * ASC, S(visitSize, 500, 'text', 0, p.pencil), { maxWidth: W - 48 }); y += visitSize * LH;
        if (withTrip) line(ctx, tripLine, 24, y + gap + 4 + 13 * ASC, S(13, 600, 'text', 0, p.sage), { maxWidth: W - 48 });
        const s = tall ? 1.05 : 0.8;
        classicStamp(ctx, { name: short(id), date, group: row.group, seed: id, dark, scale: s, background: rgba(p.paper, 0.92) },
          W - (tall ? 26 : 22) - 140 * s, blockTop - (tall ? 18 : 10) - (tall ? 6 : 2));
        footer();
      });
    }
  } else if (design === 'year') {
    const years = cardYears(source);
    const year = years.includes(choice.year) ? choice.year : years[0] ?? new Date().getFullYear();
    const places = [...visited].filter((id) => d.get(id)?.year === year)
      .sort((a, b) => dateKey(d.get(a)) - dateKey(d.get(b)) || (name(a) < name(b) ? -1 : name(a) > name(b) ? 1 : 0));
    const yearTrips = (atlas.trips ?? []).filter((tr) => tr.start && new Date(tr.start).getFullYear() === year).length;
    const limit = tall ? 9 : 6;
    const shown = places.length > limit ? limit - 1 : places.length, more = places.length - shown;
    const grid = yearGrid(shown + (more > 0 ? 1 : 0), f);
    const month = new Intl.DateTimeFormat(language(), { month: 'short' });
    const tiles = await Promise.all(places.slice(0, shown).map(async (id) => ({
      id, name: short(id), when: d.get(id)?.month ? month.format(new Date(year, d.get(id).month - 1, 1)) : '',
      art: await artImage(world, id, grid.tile.w, grid.tile.h, { zoom: 1.6, dark }),
    })));
    label = t('Year card: %lld new places in %@', places.length, String(year));
    draw.push(() => {
      header(t('A year in places'), ownerTitle(owner));
      const Y = tall ? 104 : 58, sub = tall ? 18 : 14, padTop = tall ? 4 : 0;
      const yearH = padTop + Y * LH + (tall ? 0 : -2) + sub * LH;
      const nameSize = grid.columns === 3 ? 11 : 13;
      const rowH = (i) => grid.tile.h + (i * grid.columns < tiles.length ? 4 + nameSize * LH : 0);
      const rowsN = Math.ceil((tiles.length + (more > 0 ? 1 : 0)) / grid.columns);
      const gridH = Array.from({ length: rowsN }, (_, i) => rowH(i)).reduce((a, b) => a + b, 0) + 10 * Math.max(0, rowsN - 1);
      const [, , , gridTop] = stack(H, [headerHeight, yearH, null, gridH, null, footerHeight]);
      let y = headerHeight + padTop;
      line(ctx, String(year), 20, y + Y * ASC, S(Y, 700, 'rounded', tall ? -5 : -3, p.ink)); y += Y * LH + (tall ? 0 : -2);
      line(ctx, yearTrips > 0 ? t('%lld new places · %lld trips', places.length, yearTrips) : t('%lld new places', places.length),
        23, y + sub * ASC, S(sub, 600, 'text', -0.2, p.ink), { maxWidth: W - 43 });
      const radius = grid.columns === 1 ? 18 : 10;
      let rowTop = gridTop;
      for (let r = 0; r < rowsN; r++) {
        for (let c = 0; c < grid.columns; c++) {
          const i = r * grid.columns + c, x = 24 + c * (grid.tile.w + 8);
          if (i < tiles.length) {
            const tile = tiles[i];
            ctx.save(); roundRect(ctx, x, rowTop, grid.tile.w, grid.tile.h, radius); ctx.clip();
            image(tile.art, x, rowTop, grid.tile.w, grid.tile.h); ctx.restore();
            const base = rowTop + grid.tile.h + 4 + nameSize * ASC;
            const when = tile.when ? line(ctx, upper(tile.when), x + grid.tile.w, base, S(9, 600, 'text', 1.2, p.pencil), { align: 'right' }).w : 0;
            line(ctx, tile.name, x, base, S(nameSize, 600, 'text', 0, p.ink), { maxWidth: grid.tile.w - when - (when ? 2 : 0) });
          } else if (i === tiles.length && more > 0) {
            ctx.strokeStyle = rgba(p.pencil, 0.5); borderRect(ctx, x, rowTop, grid.tile.w, grid.tile.h, 10, 1, [3, 2.5]);
            const st = S(22, 700, 'rounded', 0, p.pencil);
            line(ctx, `+${more}`, x + grid.tile.w / 2, rowTop + grid.tile.h / 2 - (st.size * LH) / 2 + st.size * ASC, st, { align: 'center' });
          }
        }
        rowTop += rowH(r) + 10;
      }
      footer();
    });
  } else if (design === 'together' && friend) {
    const known = [...world.rows.keys()];
    const theirs = friend.visited instanceof Set ? friend.visited : new Set(friend.visited ?? []);
    const both = known.filter((id) => visited.has(id) && theirs.has(id));
    const onlyMine = new Set(known.filter((id) => visited.has(id) && !theirs.has(id)));
    const onlyTheirs = new Set(known.filter((id) => !visited.has(id) && theirs.has(id)));
    const all = new Set([...both, ...onlyMine, ...onlyTheirs]);
    const areaTitle = titleFor(all), friendName = friend.name ?? '';
    const mapH = tall ? 330 : 200;
    const map = await mapImage(world, frameFor(all, W, mapH), W, mapH, {
      inked: new Set(both), dark, overlay: (c, T) => overlap(c, world, T, onlyMine, onlyTheirs, dark),
    });
    label = t('Together card with %@: %lld both, %lld only you, %lld only %@', friendName, both.length, onlyMine.size, onlyTheirs.size, friendName);
    draw.push(() => {
      header(t('Two atlases'), areaTitle);
      const me = owner || t('You');
      const titleStyle = S(tall ? 52 : 32, 700, 'text', -1.8, p.ink);
      const text = t('%@\n& %@', me, friendName).split('\n');
      // lineLimit(2) with minimumScaleFactor(0.5): the whole title shrinks together.
      let k = 1;
      for (const l of text) k = Math.min(k, (W - 44) / Math.max(1, widthOf(ctx, l, titleStyle)));
      const st = scaled(titleStyle, Math.max(0.5, Math.min(1, k)));
      const titleH = (tall ? 14 : 4) + text.length * st.size * LH - 6 * (text.length - 1);
      const val = tall ? 34 : 24, legendH = (tall ? 4 : 0) + val * LH + 4 + 11 * LH;
      const [, , , mapTop, legendTop] = stack(H, [headerHeight, titleH, null, mapH, legendH, null, footerHeight]);
      text.forEach((l, i) => line(ctx, l, 22, headerHeight + (tall ? 14 : 4) + i * (st.size * LH - 6) + st.size * ASC, st, { maxWidth: W - 44 }));
      image(map, 0, mapTop, W, mapH);
      fade(ctx, p, 0, mapTop, W, 36, true);
      fade(ctx, p, 0, mapTop + mapH - 48, W, 48);
      const col = (W - 48) / 3, top = legendTop + (tall ? 4 : 0);
      const legend = (i, value, caption, swatch) => {
        const x = 24 + i * col;
        line(ctx, String(value), x, top + val * ASC, S(val, 700, 'rounded', 0, p.ink));
        const sy = top + val * LH + 4, cs = S(11, 500, 'text', 0, p.pencil);
        ctx.save(); roundRect(ctx, x, sy + (11 * LH - 11) / 2, 11, 11, 3); swatch(x, sy + (11 * LH - 11) / 2); ctx.restore();
        line(ctx, caption, x + 16, sy + 11 * ASC, cs, { maxWidth: col - 16, minScale: 0.8 });
      };
      legend(0, both.length, t('both of us'), (x, y) => {
        const g = ctx.createLinearGradient(x, y, x + 11, y + 11);
        g.addColorStop(0, '#E7C98F'); g.addColorStop(1, '#9FC3A2'); ctx.fillStyle = g; ctx.fill();
      });
      legend(1, onlyMine.size, owner ? t('only %@', owner) : t('only me'), () => { ctx.fillStyle = rgba(yourInk(dark), 0.65); ctx.fill(); });
      legend(2, onlyTheirs.size, t('only %@', friendName), (x, y) => {
        ctx.fillStyle = rgba(theirInk(dark), 0.25); ctx.fill(); ctx.clip();
        ctx.strokeStyle = theirInk(dark); ctx.lineWidth = 1; ctx.beginPath();
        for (let hx = x - 11; hx < x + 11; hx += 3.5) { ctx.moveTo(hx, y + 11); ctx.lineTo(hx + 11, y); }
        ctx.stroke();
      });
      footer();
    });
  }

  ctx.fillStyle = p.paper; ctx.fillRect(0, 0, W, H);
  for (const step of draw) step();
  // No hairline trim: the app dropped it when the cards were re-authored around the artwork (4e68c08a).
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return { label, title: t(SHARE_TITLE[design] ?? SHARE_TITLE.atlas), file: `${t(SHARE_TITLE[design] ?? SHARE_TITLE.atlas)}.png` };
}

/** Columns and tile size for a year's contact sheet. */
function yearGrid(count, f) {
  const columns = count <= 1 ? 1 : count <= 4 ? 2 : 3;
  const gap = 8, inner = f.w - 48;
  const width = Math.floor((inner - gap * (columns - 1)) / columns);
  const rows = Math.ceil(count / columns);
  const room = f.tall ? 360 : 200;
  const height = Math.min(width * (columns === 1 ? 0.9 : 1.08), (room - gap * (rows - 1)) / Math.max(rows, 1) - 18);
  return { columns, tile: { w: width, h: Math.max(60, Math.floor(height)) } };
}

/** Fine engraved lines, like the security print on a passport page. */
function guilloche(ctx, w, h, color) {
  ctx.strokeStyle = color; ctx.lineWidth = 0.6;
  for (let band = 0; band < 26; band++) {
    const base = (band * h) / 24 - 10;
    ctx.beginPath();
    for (let step = 0; step <= 90; step++) {
      const x = (step / 90) * w, y = base + Math.sin(x / 23 + band * 0.55) * 7 + Math.sin(x / 61 + band) * 4;
      if (step === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

/** OverlapMap: a sage wash on places only you've been, hatched terracotta on places only they have. */
function overlap(ctx, world, T, onlyMine, onlyTheirs, dark) {
  const mine = yourInk(dark), theirs = theirInk(dark);
  for (const [id, place] of world.places) {
    const isMine = onlyMine.has(id), isTheirs = onlyTheirs.has(id);
    if (!isMine && !isTheirs) continue;
    const shape = ringPath(place.rings, T);
    if (isMine) { ctx.fillStyle = rgba(mine, dark ? 0.5 : 0.42); ctx.fill(shape, 'evenodd'); }
    else {
      ctx.save(); ctx.clip(shape, 'evenodd');
      const [bx, by, bw, bh] = place.row?.bounds ?? place.entry?.bounds ?? [0, 0, 0, 0];
      const [x0, y0] = T(bx, by), [x1, y1] = T(bx + bw, by + bh);
      ctx.fillStyle = rgba(theirs, dark ? 0.28 : 0.2); ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
      // Diagonal hatching about 3 points apart, whatever the zoom.
      const gap = 3.2 * PX, hh = y1 - y0;
      ctx.strokeStyle = rgba(theirs, 0.85); ctx.lineWidth = 0.9 * PX; ctx.beginPath();
      for (let x = x0 - hh; x < x1; x += gap) { ctx.moveTo(x, y1); ctx.lineTo(x + hh, y0); }
      ctx.stroke(); ctx.restore();
    }
    ctx.strokeStyle = isMine ? mine : theirs; ctx.lineWidth = 0.8 * PX; ctx.stroke(shape);
  }
}

// ---- the studio ------------------------------------------------------------------------------

const ICONS = {
  atlas: html`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4 3.5 6v14L9 18l6 2 5.5-2V4L15 6 9 4Z"/><path d="M9 4v14M15 6v14"/></svg>`,
  stamps: html`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.1 1.6 2.6-.3 1 2.4 2.4 1-.3 2.6L21 12l-1.6 2.1.3 2.6-2.4 1-1 2.4-2.6-.3L12 21l-2.1-1.6-2.6.3-1-2.4-2.4-1 .3-2.6L3 12l1.6-2.1-.3-2.6 2.4-1 1-2.4 2.6.3L12 3Z"/></svg>`,
  passport: html`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3.5h11a1.5 1.5 0 0 1 1.5 1.5v14a1.5 1.5 0 0 1-1.5 1.5H6Z"/><path d="M6 3.5v17M10 8h5"/></svg>`,
  year: html`<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>`,
  together: html`<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8.5" r="3.2"/><path d="M3.5 19c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5"/><circle cx="16.5" cy="9" r="2.6"/><path d="M15.5 14.2c2.6-.3 4.6 1.3 5 4.3"/></svg>`,
};
const SHARE_ICON = html`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5v11M8 7.5l4-4 4 4"/><path d="M7.5 10.5H6a1.5 1.5 0 0 0-1.5 1.5v7A1.5 1.5 0 0 0 6 20.5h12a1.5 1.5 0 0 0 1.5-1.5v-7a1.5 1.5 0 0 0-1.5-1.5h-1.5"/></svg>`;
const DOWNLOAD_ICON = html`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5v12M8 11.5l4 4 4-4M5 20.5h14"/></svg>`;

const pageDark = () => {
  const theme = document.documentElement.dataset.theme;
  return theme === 'dark' || (theme !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
};

function toBlob(c) { return new Promise((resolve) => c.toBlob(resolve, 'image/png')); }

/** Choose a card design, size and tone, preview it and share it. */
export function ShareSheet({ Sheet, world, atlas, name, visited, onClose, friend = null, design: initialDesign, placeID: initialPlace }) {
  const source = useMemo(() => ({ world, atlas, visited, friend, name }), [world, atlas, visited, friend, name]);
  const designs = useMemo(() => cardDesigns(source), [source]);
  const [design, setDesign] = useState(() => (designs.includes(initialDesign) ? initialDesign : designs[0] ?? 'atlas'));
  const [format, setFormat] = useState('story');
  const [tone, setTone] = useState('paper');
  const [area, setArea] = useState(null); // null frames the places themselves
  const [placeID, setPlaceID] = useState(initialPlace ?? null);
  const [year, setYear] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState({ ready: null, failed: false, label: '' });
  const [shareError, setShareError] = useState(false);
  const shown = useRef(null), finished = useRef(null), ghost = useRef(null), token = useRef(0);
  const key = [design, format, tone, area, placeID, year, attempt, language()].join('|');
  const order = useMemo(() => passportOrder(source), [source]);
  const years = useMemo(() => cardYears(source), [source]);
  const canShareFiles = useMemo(() => {
    try { return !!navigator.canShare?.({ files: [new File([new Blob()], 'card.png', { type: 'image/png' })] }); } catch { return false; }
  }, []);

  useEffect(() => { if (!designs.includes(design) && designs.length) setDesign(designs[0]); }, [designs]);

  // Draw off screen, then swap in, so the preview never shows a half-finished card.
  useEffect(() => {
    const mine = ++token.current;
    setState((s) => ({ ...s, failed: false }));
    const watchdog = setTimeout(() => { if (token.current === mine) { token.current++; setState((s) => ({ ...s, failed: true })); } }, 30000);
    const off = document.createElement('canvas');
    drawCard(off, source, { design, format, tone, area, placeID, year }).then((info) => {
      if (token.current !== mine) return;
      const view = shown.current;
      view.width = off.width; view.height = off.height;
      view.getContext('2d').drawImage(off, 0, 0);
      finished.current = { canvas: off, ...info };
      setState({ ready: key, failed: false, label: info.label });
    }).catch((e) => {
      console.error(e);
      if (token.current === mine) setState((s) => ({ ...s, failed: true }));
    }).finally(() => clearTimeout(watchdog));
    return () => clearTimeout(watchdog);
  }, [key, source]);

  // The card sits on a faint print of the atlas it was made from.
  useEffect(() => {
    const c = ghost.current; if (!c) return;
    const box = c.parentElement.getBoundingClientRect();
    const scale = Math.min(2, devicePixelRatio || 1);
    c.width = Math.max(1, Math.round(box.width * scale)); c.height = Math.max(1, Math.round(box.height * scale));
    const f = world.frame;
    paintPlaces(c.getContext('2d'), world, { rect: [f[0], f[1] + f[3] * 0.04, f[2], f[3] * 0.82], width: c.width, height: c.height,
      inked: visited, dark: pageDark() }).catch(() => {});
  }, [world, visited]);

  const ready = state.ready === key && !state.failed;
  const share = async (download) => {
    const card = finished.current; if (!card) return;
    setShareError(false);
    const blob = await toBlob(card.canvas);
    if (!blob) { setShareError(true); return; }
    const file = new File([blob], card.file, { type: 'image/png' });
    if (!download && canShareFiles) {
      try { await navigator.share({ files: [file], title: card.title }); return; }
      catch (e) { if (e?.name === 'AbortError') return; }
    }
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), { href: url, download: card.file });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  };

  const segments = (label, value, set, options) => html`
    <div class="segments share-seg" role="radiogroup" aria-label=${label}>
      ${Object.entries(options).map(([k, title]) => html`<button role="radio" aria-checked=${value === k} class=${value === k ? 'on' : ''}
        onClick=${() => set(k)}>${t(title)}</button>`)}
    </div>`;
  const areas = ['world', ...GROUPS.filter((g) => world.byGroup?.[g]?.length)];
  let menu = null;
  if (design === 'atlas' || design === 'together') {
    menu = html`<label class="share-menu"><span class="share-hidden">${t('Map')}</span>
      <select aria-label=${t('Map, %@', area ? t(AREA_TITLE[area]) : t('fit my places'))} value=${area ?? ''} onChange=${(e) => setArea(e.target.value || null)}>
        <option value="">${t('Fit my places')}</option>
        ${areas.map((a) => html`<option value=${a}>${t(AREA_TITLE[a])}</option>`)}
      </select></label>`;
  } else if (design === 'passport') {
    menu = html`<label class="share-menu"><span class="share-hidden">${t('Place')}</span>
      <select aria-label=${t('Place')} value=${order.includes(placeID) ? placeID : order.at(-1)} onChange=${(e) => setPlaceID(e.target.value)}>
        ${order.map((id) => html`<option value=${id}>${name ? name(id) : id}</option>`)}
      </select></label>`;
  } else if (design === 'year') {
    menu = html`<label class="share-menu"><span class="share-hidden">${t('Year')}</span>
      <select aria-label=${t('Year')} value=${years.includes(year) ? year : years[0]} onChange=${(e) => setYear(Number(e.target.value))}>
        ${years.map((y) => html`<option value=${y}>${String(y)}</option>`)}
      </select></label>`;
  }

  return html`<${Sheet} title=${t('Share')} onClose=${onClose} class="share-studio">
    <div class="share-stage">
      <canvas class="share-ghost" ref=${ghost} aria-hidden="true"></canvas>
      <div class="share-preview">
        <canvas ref=${shown} class=${'share-card ' + (state.ready ? 'shown' : '') + (ready ? '' : ' updating')}
          role="img" aria-label=${state.label} data-ready=${ready ? 'true' : 'false'}></canvas>
        ${!state.ready && !state.failed && html`<p class="share-status">${t('Drawing your card…')}</p>`}
        ${!state.ready && state.failed && html`<p class="share-status">${t('Card unavailable')}</p>`}
      </div>
    </div>
    <div class="share-designs" role="radiogroup" aria-label=${t('Share')}>
      ${(designs.length ? designs : ['atlas']).map((item) => html`<button role="radio" aria-checked=${design === item}
        class=${'outline share-design' + (design === item ? ' on' : '')} onClick=${() => setDesign(item)}>${ICONS[item]}${t(DESIGN_TITLE[item])}</button>`)}
    </div>
    <div class="share-options">
      ${segments(t('Size'), format, setFormat, { story: FORMATS.story.title, post: FORMATS.post.title })}
      ${segments(t('Tone'), tone, setTone, TONES)}
      ${menu}
    </div>
    <div class="share-actions" aria-live="polite">
      ${ready && canShareFiles && html`<button class="ink" onClick=${() => share(false)}>${SHARE_ICON}${t('Share')}</button>
        <button class="outline" onClick=${() => share(true)}>${DOWNLOAD_ICON}${tw('Download PNG')}</button>`}
      ${ready && !canShareFiles && html`<button class="ink" onClick=${() => share(true)}>${DOWNLOAD_ICON}${tw('Download PNG')}</button>`}
      ${state.failed && html`<span class="share-note">${t('Couldn’t finish this card. Your choices are kept.')}</span>
        <button class="outline" onClick=${() => setAttempt((n) => n + 1)}>${t('Try again')}</button>`}
      ${!ready && !state.failed && state.ready && html`<span class="share-note">${t('Updating your card…')}</span>`}
      ${shareError && html`<span class="share-note">${t('Couldn’t finish this card. Your choices are kept.')}</span>`}
    </div>
  <//>`;
}
