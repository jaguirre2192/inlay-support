// Find in Photos, after PhotoDiscovery.swift: the person picks photos; their locations (read
// in the browser, never uploaded) suggest places; nothing is added until they choose.

import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
import { t, language, upper, tracking } from './i18n.js';
import { contains } from './inlr.js';
import { photoMeta } from './exif.js';

const html = htm.bind(h);
const Legend = ({ children }) => html`<span class="legend" style=${{ letterSpacing: tracking() }}>${upper(children)}</span>`;

// ---- Natural Earth I, as the atlas geometry was projected (NaturalEarthProjection) ----------
const SCALE = 39300 / (2 * Math.PI * 0.8707);
const rawY = (phi) => { const p2 = phi * phi, p4 = p2 * p2; return phi * (1.007226 + p2 * (0.015085 + p4 * (-0.044475 + 0.028874 * p2 - 0.005916 * p4))); };
export function project(latitude, longitude) {
  const lam = longitude * Math.PI / 180, phi = latitude * Math.PI / 180, p2 = phi * phi, p4 = p2 * p2;
  const x = lam * (0.8707 - 0.131979 * p2 + p4 * (-0.013791 + p4 * (0.003971 * p2 - 0.001529 * p4)));
  return [19650 + SCALE * x, SCALE * (rawY(Math.PI / 2) - rawY(phi))];
}
const WORLD_WIDTH = 2 * (project(0, 180)[0] - 19650);

function placeAt(world, x, y) {
  // Vatican City is under a map unit across: a point within ~400 m counts as the Vatican.
  for (const [id, p] of world.places) {
    const [bx, by, bw, bh] = p.row.bounds;
    if (Math.max(bw, bh) < 1 && x > bx - 0.45 && x < bx + bw + 0.45 && y > by - 0.45 && y < by + bh + 0.45) return id;
  }
  let country = null;
  for (const [id, p] of world.places) {
    const [bx, by, bw, bh] = p.row.bounds;
    if (x < bx || x > bx + bw || y < by || y > by + bh || !contains(p.rings, x, y)) continue;
    if (p.row.kind === 'territory') return id; // territories win over the country around them
    country ??= id;
  }
  return country;
}

/** The closest point of an outline, in km, within `reach`. */
function nearestEdge(rings, px, py, kmX, kmY, reach) {
  let best = null;
  for (const ring of rings) {
    const n = ring.length / 2;
    for (let i = 0; i < n; i++) {
      const k = (i + 1) % n;
      const ax = (ring[2 * i] - px) * kmX, ay = (ring[2 * i + 1] - py) * kmY, bx = (ring[2 * k] - px) * kmX, by = (ring[2 * k + 1] - py) * kmY;
      const limit = best?.km ?? reach;
      if (Math.min(ax, bx) > limit || Math.max(ax, bx) < -limit || Math.min(ay, by) > limit || Math.max(ay, by) < -limit) continue;
      const dx = bx - ax, dy = by - ay, len = dx * dx + dy * dy;
      const tt = len > 0 ? Math.min(1, Math.max(0, -(ax * dx + ay * dy) / len)) : 0;
      const km = Math.hypot(ax + tt * dx, ay + tt * dy);
      if (km < (best?.km ?? Infinity)) best = { km, x: ring[2 * i] + tt * (ring[2 * k] - ring[2 * i]), y: ring[2 * i + 1] + tt * (ring[2 * k + 1] - ring[2 * i + 1]) };
    }
  }
  return best;
}

/** The destination a GPS fix belongs to: inside an outline, or the nearest coast within 50 km
 *  (beaches, harbours, ferries, atolls), measured at the fix's latitude and across the date line. */
export function destination(world, latitude, longitude) {
  const [x, y] = project(latitude, longitude);
  const exact = placeAt(world, x, y);
  if (exact) return { id: exact, point: [x, y] };
  const reachKm = 50;
  const east = project(latitude, Math.min(180, longitude + 0.01)), north = project(Math.min(90, latitude + 0.01), longitude);
  const kmX = 111.32 * Math.max(Math.cos(latitude * Math.PI / 180), 0.01) * 0.01 / Math.max(Math.abs(east[0] - x), 1e-9);
  const kmY = 110.57 * 0.01 / Math.max(Math.abs(north[1] - y), 1e-9);
  const rx = reachKm / kmX, ry = reachKm / kmY;
  let best = null;
  for (const shift of [0, -WORLD_WIDTH, WORLD_WIDTH]) {
    const qx = x + shift;
    for (const [id, p] of world.places) {
      const [bx, by, bw, bh] = p.row.bounds;
      if (qx < bx - rx || qx > bx + bw + rx || y < by - ry || y > by + bh + ry) continue;
      const hit = nearestEdge(p.rings, qx, y, kmX, kmY, reachKm);
      if (!hit || hit.km > reachKm) continue;
      const margin = best ? (p.row.kind === 'territory' && best.kind === 'country' ? 0.5 : p.row.kind === 'country' && best.kind === 'territory' ? -0.5 : 0) : 0;
      if (!best || hit.km < best.km + margin) best = { id, km: hit.km, kind: p.row.kind, point: [hit.x - shift, hit.y] };
    }
  }
  return best && { id: best.id, point: best.point };
}

/** The markable state or region at a point, probing out to ~15 km for coastal cities. */
function subregionAt(detail, rows, x, y) {
  if (!detail) return null;
  const candidates = [...detail.regions.entries()].filter(([id, r]) => {
    if (rows.get(id)?.markable === false) return false;
    const [bx, by, bw, bh] = r.entry?.bounds ?? rows.get(id).bounds;
    return x > bx - 16 && x < bx + bw + 16 && y > by - 16 && y < by + bh + 16;
  });
  for (const radius of [0, 4, 8, 12, 16]) {
    const steps = radius === 0 ? 1 : 12;
    for (let s = 0; s < steps; s++) {
      const a = s / steps * 2 * Math.PI, px = x + radius * Math.cos(a), py = y + radius * Math.sin(a);
      const hit = candidates.find(([, r]) => contains(r.rings, px, py));
      if (hit) return hit[0];
    }
  }
  return null;
}

/** Groups photo locations by destination (and state), keeping each one's count and first date. */
export async function findVisits(world, samples, loadRegions) {
  const found = new Map(), cache = new Map();
  const record = (id, date) => {
    const v = found.get(id) ?? { id, count: 0, first: null };
    v.count++; if (date && (!v.first || date < v.first)) v.first = date;
    found.set(id, v);
  };
  for (const s of samples) {
    const { latitude: la, longitude: lo, date } = s;
    if (la == null || lo == null || la < -90 || la > 90 || lo < -180 || lo > 180 || (la === 0 && lo === 0)) continue;
    const [px, py] = project(la, lo), key = `${Math.floor(px)},${Math.floor(py)}`;
    let place = cache.get(key);
    if (place === undefined) {
      const d = destination(world, la, lo);
      place = null;
      if (d) {
        const detail = world.regions.files[d.id] ? await loadRegions(d.id) : null;
        place = { id: d.id, state: subregionAt(detail, world.regions.rows, d.point[0], d.point[1]) };
      }
      cache.set(key, place);
    }
    if (!place) continue;
    if (place.state) record(place.state, date);
    record(place.id, date);
  }
  return [...found.values()].sort((a, b) => (a.first ?? '9999').localeCompare(b.first ?? '9999'));
}

// ---- the sheet -----------------------------------------------------------------------------

/**
 * Props: Sheet, world, atlas, update, name (id -> display name), regionName (id -> display name),
 * visited (Set), loadRegions(countryID) -> Promise(detail), onClose.
 */
export function PhotosSheet({ Sheet, world, update, name, regionName, visited, loadRegions, onClose }) {
  const [phase, setPhase] = useState('intro'), [progress, setProgress] = useState(0);
  const [found, setFound] = useState([]), [chosen, setChosen] = useState(new Set());
  const label = (id) => {
    const row = world.regions.rows.get(id);
    return row ? t('%@, %@', regionName(id), name(row.countryID)) : name(id);
  };
  const pick = async (e) => {
    const files = [...(e.target.files ?? [])]; e.target.value = '';
    if (!files.length) return;
    setPhase('reading'); setProgress(0);
    const samples = [];
    for (let i = 0; i < files.length; i++) {
      try { samples.push(await photoMeta(files[i])); } catch { /* unreadable file: skipped */ }
      if (i % 8 === 0) setProgress((i + 1) / files.length);
    }
    const visits = await findVisits(world, samples, loadRegions);
    setFound(visits);
    setChosen(new Set(visits.filter((v) => !visited.has(v.id)).map((v) => v.id)));
    setPhase(visits.length ? 'review' : 'none');
  };
  const toggle = (id) => setChosen((c) => { const n = new Set(c); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const add = () => {
    update((a) => {
      for (const v of found) {
        if (!chosen.has(v.id)) continue;
        a.visits[v.id] = a.visits[v.id] ?? {};
        const row = world.regions.rows.get(v.id);
        if (row) a.visits[row.countryID] = a.visits[row.countryID] ?? {};
        // First-visit dates already set are kept; a photo gives the month.
        if (!a.visits[v.id].date && v.first) a.visits[v.id].date = v.first.slice(0, 7);
      }
      return a;
    });
    onClose();
  };
  const month = (d) => new Intl.DateTimeFormat(language(), { month: 'long', year: 'numeric' }).format(new Date(d + 'T12:00:00'));
  const input = html`<input id="photo-files" type="file" accept="image/jpeg,image/heic,image/heif,.heic,.heif,.jpg,.jpeg" multiple hidden onChange=${pick} />`;
  return html`<${Sheet} title=${t('Find in Photos')} onClose=${onClose} class="photos">
    ${phase === 'intro' && html`<div class="photos-intro">
      <h3>${t('Find places in your photos')}</h3>
      <p class="sheet-line">${t('Inlay reads where your photos were taken to suggest countries you’ve been. It never uploads or copies them, and nothing is added until you choose.')}</p>
      <div class="actions"><label class="ink" for="photo-files">${t('Choose photos')}</label>${input}</div>
    </div>`}
    ${phase === 'reading' && html`<div class="photos-reading" role="status"><span class="bar"><i style=${{ width: progress * 100 + '%' }}></i></span></div>`}
    ${phase === 'none' && html`<div class="photos-intro">
      <h3>${t('No places found')}</h3>
      <p class="sheet-line">${t('Inlay can only see the photos you selected, and none of them were taken inside the atlas.')}</p>
      <div class="actions"><label class="outline" for="photo-files">${t('Choose photos')}</label>${input}</div>
    </div>`}
    ${phase === 'review' && html`<div class="list">
      ${found.map((v) => html`<label class="row photo-row">
        <input type="checkbox" checked=${chosen.has(v.id)} onChange=${() => toggle(v.id)} />
        <span class="row-name">${label(v.id)}<small>${[t('%lld photos', v.count), v.first ? t('from %@', month(v.first)) : null,
          visited.has(v.id) ? t('already in your atlas') : null].filter(Boolean).join(' · ')}</small></span>
      </label>`)}
    </div>
    <div class="actions"><button class="ink" disabled=${!chosen.size} onClick=${add}>${t('Add %lld', chosen.size)}</button>
      <button class="quiet" onClick=${onClose}>${t('Cancel')}</button></div>`}
  <//>`;
}
