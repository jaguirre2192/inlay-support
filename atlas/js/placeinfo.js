// The place sheet and the print handoff, ported from the iPhone app (PlaceInfo.swift, the place
// sheet in AtlasScreen.swift, PrintSnapshot.swift and PrintOrderSheet.swift).
//
//   import { PlaceSheet, PrintSheet, PrintButton, printURL } from './placeinfo.js';
//   <link rel="stylesheet" href="./css/placeinfo.css">
//
// PlaceSheet { Sheet, world, atlas, id, name, visited, wanted, onMark(id), onUnmark(id), onClose, dark? }
//   A country, territory or region (`id`): headed by that place on the map edge to edge (460 px,
//   painted with paintPlaces, inked once visited) with its name over the foot; the visit status
//   and the visited control; then About: the Wikipedia introduction, a link to the article and
//   the CC BY-SA credit. `name(id)` is the app's display name for countries and territories;
//   `dark` defaults to <html data-theme>.
//
// PrintSheet { Sheet, world, atlas, name?, onClose }
//   PrintOrderSheet: what goes to the print shop (your name and the countries and territories
//   visited, nothing else), a preview, and Continue to the print shop at /print/.
// PrintButton { world, atlas, name?, Sheet?, class? }
//   Framed print · Print shop. With `Sheet` it opens PrintSheet first, as the app does;
//   without it, it opens the print studio directly.
// printURL(world, atlas, name?, shop?) -> Promise<string | null>
//   The link the app opens: shop + '#INLAYP1-' + raw DEFLATE, base64url JSON (PrintSnapshot).
//   `name` is the name printed (a string); otherwise atlas.name, else the app's "Me". Null when
//   the code would be longer than the studio reads. The code stays in the fragment, which the
//   browser never sends to a server.
//
// Summary loading follows PlaceInfoStore / WikipediaSummaryFetcher: English reads the bundled
// data/summaries.json first; other languages find the local article through English Wikipedia's
// langlinks, fetch its REST summary, and fall back to the bundled English. Only the article
// title is sent. Rate limits (HTTP 429) pause requests for a minute; summaries are cached in
// sessionStorage per language.

import { h } from 'preact';
import { useState, useEffect, useRef, useMemo } from 'preact/hooks';
import htm from 'htm';
import { t, language, upper, tracking, placeName } from './i18n.js';
import { paintPlaces } from './placeart.js';
import { readRegions } from './inlr.js';

const html = htm.bind(h);

const DATA = (path) => new URL(`../data/${path}`, import.meta.url).href;
const REGION_ART = (image) => new URL(`../art/regions/${image}`, import.meta.url).href;
const GROUP_TITLE = { europe: 'Europe', asia: 'Asia', africa: 'Africa', 'north-america': 'North America', 'south-america': 'South America', oceania: 'Oceania' };

// ---- titles (PlaceInfo) ----------------------------------------------------------------------

/** Titles checked against Wikipedia (the app's list, 2026-11-08) where the name leads elsewhere. */
export const COUNTRY_TITLES = { IE: 'Republic of Ireland', GE: 'Georgia (country)', MF: 'Collectivity of Saint Martin' };

const unique = (list) => [...new Set(list.filter(Boolean))];

/** Article titles to try in order for a country or territory (English names). */
export function countryTitles(id, name) {
  return unique([COUNTRY_TITLES[id], name, `${name} (country)`]);
}

/** Article titles to try in order for a state, province or region. `kind` is the English plural. */
export function subregionTitles(name, countryID, countryName, kind = 'regions') {
  const first = kind.split(' ')[0] || 'region';
  const singular = first.endsWith('s') ? first.slice(0, -1) : first;
  if (countryID === 'US') return unique([`${name} (state)`, `${name} (U.S. state)`, name]);
  return unique([name, `${name}, ${countryName}`, `${name} (${singular})`, `${name} (${countryName})`]);
}

/** The titles for any place id in `world`. */
export function titlesFor(world, id) {
  const region = world.regions?.rows.get(id);
  if (region) {
    const parent = world.rows.get(region.countryID);
    return subregionTitles(region.name, region.countryID, parent?.name ?? region.countryID, world.regions.kinds[region.countryID] ?? 'regions');
  }
  const row = world.rows.get(id);
  return row ? countryTitles(id, row.name) : [];
}

const lastPathComponent = (url) => { try { return decodeURIComponent(new URL(url).pathname.split('/').pop() ?? ''); } catch { return ''; } };

/** Whether a lead image is a flag, seal or coat of arms rather than a photograph. */
export function isEmblem(url) {
  const name = lastPathComponent(url).toLowerCase();
  return ['flag_of', 'seal_of', 'coat_of_arms', 'emblem_of', 'coat-of-arms'].some((s) => name.includes(s)) || name.endsWith('.svg.png');
}

// ---- Wikipedia (WikipediaSummaryFetcher) -------------------------------------------------------

class RateLimited extends Error {}
class Offline extends Error {}

/** The Wikipedia to read: the language's base (Brazilian Portuguese reads pt.wikipedia). */
export const wikipediaLanguage = () => language().split('-')[0];

async function get(url) {
  let response;
  try { response = await fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout?.(12000) }); }
  catch { throw new Offline(); }
  if (response.status === 429) throw new RateLimited();
  return response.ok ? response : null;
}

/** The title of the same article in `lang`, from English Wikipedia's language links. */
async function localTitle(title, lang) {
  const url = new URL('https://en.wikipedia.org/w/api.php');
  for (const [k, v] of [['action', 'query'], ['format', 'json'], ['formatversion', '2'], ['redirects', '1'],
                        ['prop', 'langlinks'], ['lllang', lang], ['titles', title], ['origin', '*']]) url.searchParams.set(k, v);
  const response = await get(url);
  if (!response) return null;
  try { return (await response.json())?.query?.pages?.[0]?.langlinks?.[0]?.title ?? null; } catch { return null; }
}

/** Reads a REST page summary; null for a missing article or a disambiguation page. */
export function parseSummary(raw, now = Date.now()) {
  if (!raw || raw.type !== 'standard') return null;
  const extract = raw.extract?.trim();
  const page = raw.content_urls?.mobile?.page ?? raw.content_urls?.desktop?.page;
  if (!extract || !page) return null;
  return { title: raw.title, description: raw.description ?? null, extract, thumbnail: raw.thumbnail?.source ?? null,
           image: raw.originalimage?.source ?? raw.thumbnail?.source ?? null, page, fetched: now };
}

async function summaryIn(title, lang) {
  const path = encodeURIComponent(title.replaceAll(' ', '_'));
  const response = await get(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${path}?redirect=true`);
  if (!response) return null;
  try { return parseSummary(await response.json()); } catch { return null; }
}

/** `title` is the English article title; in another language the local article, else English. */
async function fetchSummary(title, lang) {
  if (lang === 'en') return summaryIn(title, 'en');
  const local = await localTitle(title, lang);
  if (local) { const s = await summaryIn(local, lang); if (s) return s; }
  return summaryIn(title, 'en');
}

// ---- the store (PlaceInfoStore) --------------------------------------------------------------

let bundled = null;
/** Introductions shipped with the atlas (Wikipedia, CC BY-SA 4.0), so most places need no request. */
export function loadBundled() {
  bundled ??= fetch(DATA('summaries.json'), { cache: 'force-cache' }).then((r) => r.json()).then((file) => {
    const out = new Map();
    for (const [id, e] of Object.entries(file.places ?? {})) {
      out.set(id, { title: e.title, description: e.description ?? null, extract: e.extract, thumbnail: e.thumbnail ?? null,
                    image: e.thumbnail ?? null, page: e.page ?? `https://en.wikipedia.org/wiki/${encodeURIComponent(e.title.replaceAll(' ', '_'))}`,
                    fetched: Date.parse(file.fetched) || 0, bundled: true });
    }
    return out;
  }).catch(() => { bundled = null; return new Map(); });
  return bundled;
}

const FRESH_FOR = 30 * 24 * 3600 * 1000;
const states = new Map();          // `${lang}:${id}` -> { kind: 'loading'|'loaded'|'unavailable'|'offline', summary? }
const listeners = new Set();
let pausedUntil = 0, bundle = new Map();
const emit = () => listeners.forEach((f) => f());
const key = (id) => `${wikipediaLanguage()}:${id}`;
const cacheKey = (id) => `inlay.placeinfo.${key(id)}`;

function readCache(id) {
  try { const s = JSON.parse(sessionStorage.getItem(cacheKey(id))); return s?.extract ? s : null; } catch { return null; }
}
function writeCache(id, summary) {
  try { sessionStorage.setItem(cacheKey(id), JSON.stringify(summary)); } catch { /* full or unavailable */ }
}

/** What the sheet shows for `id`, as PlaceInfoStore.state does. */
export function summaryState(id) {
  const current = states.get(key(id)), english = bundle.get(id);
  if (wikipediaLanguage() === 'en') return current ?? (english ? { kind: 'loaded', summary: english } : undefined);
  // Not found in this language, or offline: the English introduction rather than nothing.
  if (!current || current.kind === 'unavailable' || current.kind === 'offline') return english ? { kind: 'loaded', summary: english } : current;
  return current;
}

function set(id, state) { states.set(key(id), state); emit(); }

/** Loads a place's summary: the bundle (English), the session cache, then Wikipedia. */
export async function loadSummary(id, titles, now = Date.now()) {
  bundle = await loadBundled();
  const lang = wikipediaLanguage(), k = key(id);
  if (lang === 'en' && bundle.has(id)) { emit(); return; }
  const current = states.get(k);
  if (current?.kind === 'loaded' && now - current.summary.fetched < FRESH_FOR) return;
  if (current?.kind === 'loading') return;
  const cached = readCache(id);
  if (cached) set(id, { kind: 'loaded', summary: cached });
  if (cached && now - cached.fetched < FRESH_FOR) return;
  if (!cached) set(id, { kind: 'loading' });
  if (now < pausedUntil) { if (!cached) set(id, { kind: 'offline' }); return; }
  try {
    for (const title of titles) {
      const summary = await fetchSummary(title, lang);
      if (summary) { if (key(id) === k) set(id, { kind: 'loaded', summary }); writeCache(id, summary); return; }
    }
    if (!cached) set(id, { kind: 'unavailable' });
  } catch (e) {
    if (e instanceof RateLimited) pausedUntil = now + 60_000; // Back off; try again in a minute.
    if (!cached) set(id, { kind: 'offline' });
  }
}

export function retrySummary(id, titles) {
  states.delete(key(id)); pausedUntil = 0; emit();
  return loadSummary(id, titles);
}

function useSummary(id, titles) {
  const [, tick] = useState(0);
  useEffect(() => { const f = () => tick((n) => n + 1); listeners.add(f); return () => listeners.delete(f); }, []);
  useEffect(() => { loadSummary(id, titles); }, [id, language()]);
  return summaryState(id);
}

// ---- image credits (ImageCredit.swift) -------------------------------------------------------

/** The File page for a Wikimedia image URL, thumbnail or original, and its imageinfo API URL. */
export function filePage(image) {
  let u; try { u = new URL(image); } catch { return null; }
  if (u.hostname !== 'upload.wikimedia.org' && u.hostname !== 'thumb.wikimedia.org') return null;
  let parts = u.pathname.split('/').filter(Boolean);
  if (parts.length < 5 || parts[0] !== 'wikipedia') return null;
  const project = parts[1];
  parts = parts.slice(2);
  if (parts[0] === 'thumb') parts = parts.slice(1);
  if (parts.length < 3 || parts[0].length !== 1 || parts[1].length !== 2) return null;
  const name = decodeURIComponent(parts[2]);
  const host = project === 'commons' ? 'commons.wikimedia.org' : `${project}.wikipedia.org`;
  const title = 'File:' + name;
  const page = `https://${host}/wiki/${encodeURIComponent(title.replaceAll(' ', '_')).replace('%3A', ':')}`;
  const api = new URL(`https://${host}/w/api.php`);
  for (const [k, v] of [['action', 'query'], ['format', 'json'], ['prop', 'imageinfo'], ['iiprop', 'extmetadata'],
                        ['iiextmetadatafilter', 'Artist|LicenseShortName'], ['titles', title], ['origin', '*']]) api.searchParams.set(k, v);
  return { page, api: api.href, title };
}

const plainText = (s) => {
  const el = document.createElement('div'); el.innerHTML = s.replace(/<[^>]+>/g, ' ');
  return (el.textContent ?? '').replace(/\s+/g, ' ').trim();
};
const credits = new Map();

function ImageCreditLine({ image }) {
  const file = useMemo(() => filePage(image), [image]);
  const [credit, setCredit] = useState(file ? credits.get(file.api) ?? null : null);
  useEffect(() => {
    if (!file || credits.has(file.api) || !navigator.onLine) return;
    let live = true;
    get(file.api).then((r) => r?.json()).then((data) => {
      const info = Object.values(data?.query?.pages ?? {})[0]?.imageinfo?.[0]?.extmetadata;
      const value = { artist: info?.Artist ? plainText(info.Artist.value) || null : null,
                      license: info?.LicenseShortName ? plainText(info.LicenseShortName.value) || null : null };
      credits.set(file.api, value);
      if (live) setCredit(value);
    }).catch(() => {});
    return () => { live = false; };
  }, [file?.api]);
  if (!file) return null;
  const details = [credit?.artist, credit?.license].filter(Boolean).join(' · ');
  const caption = details ? t('Photo: %@', details) : t('Photo: Wikimedia Commons, see file page');
  return html`<a class="pi-credit" href=${file.page} target="_blank" rel="noopener noreferrer"
      aria-label=${t('%@. Opens the image\'s file page.', caption)}>
    <span>${caption}</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 16 16 8M9 8h7v7"/></svg></a>`;
}

/** A Wikipedia image, loaded only while online; nothing is drawn offline or if it fails. */
function WebImage({ src, class: cls, onFail }) {
  const [online, setOnline] = useState(navigator.onLine);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const f = () => setOnline(navigator.onLine);
    addEventListener('online', f); addEventListener('offline', f);
    return () => { removeEventListener('online', f); removeEventListener('offline', f); };
  }, []);
  if (!online || failed) return null;
  return html`<img class=${cls} src=${src} alt="" aria-hidden="true" loading="lazy" decoding="async" referrerpolicy="no-referrer"
    onError=${() => { setFailed(true); onFail?.(); }} />`;
}

// ---- the hero (AtlasBackdrop: .place / .subregion, wash .footer, band 0.86) --------------------

const regionDetail = new Map();
function regionsOf(world, countryID) {
  const file = world.regions?.files[countryID];
  if (!file) return Promise.resolve(null);
  if (!regionDetail.has(countryID)) {
    regionDetail.set(countryID, readRegions(DATA(`regions/${file}`)).catch((e) => { regionDetail.delete(countryID); throw e; }));
  }
  return regionDetail.get(countryID);
}

const artImages = new Map();
function artImage(url) {
  if (!artImages.has(url)) {
    artImages.set(url, fetch(url, { cache: 'force-cache' }).then((r) => r.blob()).then(createImageBitmap)
      .catch((e) => { artImages.delete(url); throw e; }));
  }
  return artImages.get(url);
}

/** The map units to draw: the subject's main piece of art, padded, fitted into the upper band. */
export function heroRect(world, id, width, height, band = 0.86) {
  let frame;
  const region = world.regions?.rows.get(id);
  if (region) frame = region.focusFrame ?? region.bounds;
  else {
    const place = world.places.get(id), row = world.rows.get(id);
    if (!place || !row) return null;
    if (id === 'IT' && place.plates.length) {
      // Italy is composed from its pieces: their union, as italyBounds.
      const fs = place.plates.map((p) => p.frame);
      const x0 = Math.min(...fs.map((f) => f[0])), y0 = Math.min(...fs.map((f) => f[1]));
      frame = [x0, y0, Math.max(...fs.map((f) => f[0] + f[2])) - x0, Math.max(...fs.map((f) => f[1] + f[3])) - y0];
    } else {
      // The main piece of its art where there is one, so far islands don't shrink it.
      frame = place.plates.find((p) => p.rings === place.rings)?.frame ?? row.focus;
    }
  }
  if (!frame || frame[2] <= 0 || frame[3] <= 0) return null;
  const [x, y, w, h] = frame, pw = w * 1.12, ph = h * 1.12, cx = x + w / 2, cy = y + h / 2;
  const target = height * Math.min(1, Math.max(0.2, band));
  const s = Math.min(width / pw, target / ph);
  return [cx - width / 2 / s, cy - target / 2 / s, width / s, height / s];
}

const ringPath = (rings, T) => {
  const p = new Path2D();
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i += 2) { const [x, y] = T(ring[i], ring[i + 1]); i ? p.lineTo(x, y) : p.moveTo(x, y); }
    p.closePath();
  }
  return p;
};

/** A region's own art over its country, as the map shows it closed in (drawRegional). */
async function paintRegions(ctx, world, region, T, o) {
  const detail = await regionsOf(world, region.countryID).catch(() => null);
  if (!detail) return;
  const regions = [...detail.regions.entries()];
  const parentVisited = o.inked.has(region.countryID);
  const marked = regions.some(([rid]) => o.visitedAll.has(rid));
  const draw = async (layer) => {
    try {
      const img = await artImage(REGION_ART(layer.image));
      ctx.save(); ctx.clip(ringPath(layer.rings, T), 'evenodd');
      const [fx, fy, fw, fh] = layer.frame, [cx, cy, cw, ch] = layer.crop, [dx, dy] = T(fx, fy);
      ctx.drawImage(img, cx * img.width, cy * img.height, cw * img.width, ch * img.height, dx, dy, fw * T.scale, fh * T.scale);
      ctx.restore();
    } catch { /* art unavailable: the country's own art stays */ }
  };
  if (parentVisited && regions.some(([, r]) => r.layers.length || detail.foundation.length)) {
    for (const [, r] of regions) {
      ctx.save(); ctx.clip(ringPath(r.rings, T), 'evenodd');
      ctx.fillStyle = 'rgba(238,230,211,0.88)'; ctx.fillRect(0, 0, o.width, o.height);
      for (const l of detail.foundation) await draw(l);
      for (const l of r.layers) await draw(l);
      ctx.restore();
    }
    for (const [rid, r] of regions) {
      if (marked && !o.visitedAll.has(rid)) continue;
      for (const l of r.overlays) await draw(l);
    }
  }
  // Marked regions: the rest fade back to paper, unless whole countries light up.
  if (parentVisited && marked && !o.wholeCountries && region.countryID !== 'IT') {
    ctx.fillStyle = 'rgba(238,230,211,0.72)';
    for (const [rid, r] of regions) if (!o.visitedAll.has(rid) && world.regions.rows.get(rid)?.markable !== false) ctx.fill(ringPath(r.rings, T), 'evenodd');
  }
  ctx.lineJoin = 'round';
  ctx.lineWidth = 0.75 * o.dpr;
  ctx.strokeStyle = parentVisited ? 'rgba(255,249,234,0.75)' : (o.dark ? 'rgba(96,125,129,0.8)' : 'rgba(180,196,196,0.9)');
  for (const [, r] of regions) ctx.stroke(ringPath(r.rings, T));
  const own = detail.regions.get(region.id);
  if (own) {
    ctx.lineWidth = 1.6 * o.dpr;
    ctx.strokeStyle = o.dark ? 'rgba(244,235,214,0.85)' : 'rgba(31,43,39,0.7)';
    ctx.stroke(ringPath(own.rings, T));
  }
}

async function paintHero(canvas, world, id, o) {
  const dpr = Math.min(2, devicePixelRatio || 1);
  const width = Math.round(o.width * dpr), height = Math.round(o.height * dpr);
  const rect = heroRect(world, id, width, height);
  if (!rect) return false;
  const off = document.createElement('canvas'); off.width = width; off.height = height;
  const ctx = off.getContext('2d');
  const T = await paintPlaces(ctx, world, { rect, width, height, inked: o.inked, outlined: o.outlined, dark: o.dark });
  const region = world.regions?.rows.get(id);
  if (region) await paintRegions(ctx, world, region, T, { ...o, width, height, dpr });
  if (o.cancelled()) return false;
  canvas.width = width; canvas.height = height;
  canvas.getContext('2d').drawImage(off, 0, 0);
  return true;
}

function Hero({ world, id, inked, outlined, visitedAll, wholeCountries, dark, children }) {
  const host = useRef(null), paper = useRef(null), art = useRef(null);
  const [width, setWidth] = useState(0);
  const [stage, setStage] = useState(0); // 0 nothing, 1 paper, 2 art revealed
  useEffect(() => {
    const el = host.current; if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e.contentRect.width)));
    ro.observe(el); return () => ro.disconnect();
  }, []);
  const inkKey = [...inked].sort().join(',');
  useEffect(() => {
    if (!width) return;
    let cancelled = false;
    const o = { width, height: 460, dark, wholeCountries, visitedAll, cancelled: () => cancelled };
    (async () => {
      // The page's paper first, then the art comes down over it once (AtlasBackdrop's reveal).
      if (stage === 0 && await paintHero(paper.current, world, id, { ...o, inked: new Set(), outlined: new Set() }) && !cancelled) setStage(1);
      if (await paintHero(art.current, world, id, { ...o, inked, outlined }) && !cancelled) requestAnimationFrame(() => !cancelled && setStage(2));
    })();
    return () => { cancelled = true; };
  }, [width, id, dark, inkKey, wholeCountries]);
  // Where the slow settle is anchored, fixed per place so pages differ.
  const anchors = ['0% 0%', '50% 0%', '100% 0%', '0% 50%', '100% 50%', '0% 100%'];
  const seed = [...id].reduce((s, c) => (s * 31 + c.codePointAt(0)) % 9973, 7);
  return html`<div class=${'pi-hero' + (stage >= 1 ? ' pi-ready' : '') + (stage >= 2 ? ' pi-shown' : '')} ref=${host} aria-hidden="true">
      <div class="pi-drift" style=${{ transformOrigin: anchors[seed % anchors.length] }}>
        <canvas class="pi-paper" ref=${paper}></canvas>
        <canvas class="pi-art" ref=${art}></canvas>
      </div>
      <div class="pi-wash"></div>
    </div>
    <div class="pi-heading">${children}</div>`;
}

// ---- the place sheet -------------------------------------------------------------------------

function Legend({ children, color, class: cls = '' }) {
  return html`<span class=${'legend ' + cls} style=${{ color, letterSpacing: tracking() }}>${upper(children)}</span>`;
}

/** A visit date as VisitDate.text: "May 2024", or the year alone. */
export function visitDateText(d) {
  if (!d) return '';
  const [y, m] = String(d).split('-').map(Number);
  return m >= 1 && m <= 12 ? new Intl.DateTimeFormat(language(), { month: 'long', year: 'numeric' }).format(new Date(y, m - 1, 1)) : String(y);
}

function About({ id, title, titles }) {
  const state = useSummary(id, titles);
  const [imageFailed, setImageFailed] = useState(false);
  let body;
  if (!state || state.kind === 'loading') {
    // Still, not a spinner: a quiet outline of the text to come.
    body = html`<div class="pi-placeholder" role="status" aria-label=${t('About')}><i></i><i></i><i></i></div>`;
  } else if (state.kind === 'offline') {
    body = html`<div class="pi-note">
      <p>${t('Can’t reach Wikipedia right now. Places you’ve read about stay available offline.')}</p>
      <button class="link" onClick=${() => retrySummary(id, titles)}>${t('Try again')}</button></div>`;
  } else if (state.kind === 'unavailable') {
    body = html`<p class="pi-note">${t('Wikipedia doesn’t have an introduction for %@.', title)}</p>`;
  } else {
    const s = state.summary, image = s.image ?? s.thumbnail, emblem = image ? isEmblem(image) : false;
    const badge = emblem ? s.thumbnail ?? image : null;
    body = html`
      ${image && !emblem && !imageFailed && html`<${WebImage} class="pi-photo" src=${image} onFail=${() => setImageFailed(true)} />
        ${navigator.onLine && html`<${ImageCreditLine} image=${image} />`}`}
      ${(badge || s.description) && html`<div class="pi-describe">
        ${badge && html`<${WebImage} class="pi-badge" src=${badge} />`}
        ${s.description && html`<span>${s.description}</span>`}
      </div>`}
      <p class="pi-extract" lang=${s.bundled ? 'en' : undefined}>${s.extract}</p>
      <div><a class="outline pi-read" href=${s.page} target="_blank" rel="noopener noreferrer">
        ${t('Read on Wikipedia')}<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 16 16 8M9 8h7v7"/></svg></a></div>
      <p class="pi-license">${t('Text from Wikipedia’s article “%@”, available under CC BY-SA 4.0.', s.title)}</p>
      ${badge && navigator.onLine && html`<${ImageCreditLine} image=${badge} />`}`;
  }
  return html`<section class="pi-about">
    <hr class="pi-rule" />
    <${Legend}>${t('About')}<//>
    ${body}
  </section>`;
}

export function PlaceSheet({ Sheet, world, atlas, id, name, visited, wanted, onMark, onUnmark, onClose, dark }) {
  const region = world.regions?.rows.get(id) ?? null;
  const row = region ? world.rows.get(region.countryID) : world.rows.get(id);
  const displayName = (cid) => (name ? name(cid) : world.rows.get(cid)?.name ?? cid);
  const title = region ? placeName(region.name) : displayName(id);
  const kind = region ? displayName(region.countryID) : row?.kind === 'territory' ? t('Territory') : t(GROUP_TITLE[row?.group] ?? '');
  const visitedSet = visited ?? new Set(Object.keys(atlas.visits));
  const wantedSet = wanted ?? new Set(Object.keys(atlas.wanted ?? {}));
  const isVisited = visitedSet.has(id);
  const date = atlas.visits[id]?.date;
  // The visited control below already says whether it's marked.
  const status = isVisited ? (date ? t('First visited %@', visitDateText(date)) : '') : wantedSet.has(id) ? t('On your Want to go list') : '';
  const markable = !region || region.markable !== false;
  const titles = useMemo(() => titlesFor(world, id), [world, id]);
  const isDark = dark ?? document.documentElement.dataset.theme === 'dark';
  // The map inks every place you've visited, as the app's hero does (mapVisits).
  const inked = useMemo(() => new Set([...visitedSet].filter((v) => world.places.has(v))), [visitedSet]);
  const outlined = useMemo(() => new Set([...wantedSet].filter((v) => world.places.has(v) && !visitedSet.has(v))), [wantedSet, visitedSet]);

  return html`<${Sheet} title=${title} onClose=${onClose} class="pi-sheet">
    <div class="pi-scroll">
      <${Hero} world=${world} id=${id} inked=${inked} outlined=${outlined} visitedAll=${visitedSet}
          wholeCountries=${!!atlas.prefs?.wholeCountries} dark=${isDark}>
        ${kind && html`<${Legend} color="var(--sage)">${kind}<//>`}
        <h3 class="pi-title">${title}</h3>
        ${status && html`<p class="pi-status">${status}</p>`}
      <//>
      <div class="pi-body">
        ${markable && html`<div><button class=${'outline pi-visited' + (isVisited ? ' on' : '')} aria-pressed=${isVisited}
            onClick=${() => (isVisited ? onUnmark?.(id) : onMark?.(id))}>
          ${isVisited
            ? html`<svg viewBox="0 0 24 24" aria-hidden="true"><circle class="pi-fill" cx="12" cy="12" r="9"/><path class="pi-check" d="m8 12.3 2.8 2.8L16.2 9.6"/></svg>${t('Visited')}`
            : html`<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/></svg>${t('Mark as visited')}`}
        </button></div>`}
        <${About} id=${id} title=${title} titles=${titles} />
      </div>
    </div>
  <//>`;
}

// ---- the print handoff (PrintSnapshot.swift) -------------------------------------------------

export const PRINT_PREFIX = 'INLAYP1-';
const MAX_CODE = 24_000, MAX_NAME = 40;

/** The 249 country and territory ids the print studio knows. */
export const catalogIDs = (world) => [...world.rows.values()].filter((r) => r.kind === 'country' || r.kind === 'territory').map((r) => r.id);

/** First 16 hex digits of SHA-256 over the sorted ids joined by commas. */
export async function catalogVersion(ids) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode([...ids].sort().join(',')));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

/** A name as the shop shows it: no control characters or surrounding space, at most 40 characters. */
export function cleanName(name) {
  const s = String(name ?? '').replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim();
  const parts = typeof Intl.Segmenter === 'function' ? [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(s)].map((x) => x.segment) : Array.from(s);
  return parts.slice(0, MAX_NAME).join('').trim();
}

const iso = (ms) => new Date(Math.floor(ms / 1000) * 1000).toISOString().replace('.000Z', 'Z');
const sortKeys = (v) => Array.isArray(v) ? v.map(sortKeys)
  : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])) : v;

/** The places the print is made from: your name and visited countries and territories, sorted. */
export async function printSnapshot(world, atlas, name, now = Date.now()) {
  const ids = catalogIDs(world), known = new Set(ids);
  const own = cleanName(typeof name === 'string' ? name : atlas.name);
  return {
    schema: 1, purpose: 'print', snapshotID: crypto.randomUUID().toUpperCase(), createdAt: iso(now),
    catalog: await catalogVersion(ids), policy: 'countries+territories',
    people: [{ name: own || t('Me'), ids: Object.keys(atlas.visits ?? {}).filter((id) => known.has(id)).sort(), source: 'own', updatedAt: iso(now) }],
  };
}

const webSafe = (bytes) => {
  let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
};

/** JSON (sorted keys) → raw DEFLATE → base64url, with the prefix; null past the studio's limit. */
export async function printCode(snapshot) {
  const json = new TextEncoder().encode(JSON.stringify(sortKeys(snapshot)));
  const stream = new Blob([json]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  const text = webSafe(new Uint8Array(await new Response(stream).arrayBuffer()));
  return text.length <= MAX_CODE ? PRINT_PREFIX + text : null;
}

export const printShop = () => new URL('/print/', location.href).href;

export async function printURL(world, atlas, name, shop = printShop()) {
  try {
    const code = await printCode(await printSnapshot(world, atlas, name));
    if (!code) return null;
    const url = new URL(shop); url.hash = code;
    return url.href;
  } catch { return null; }
}

// ---- the print sheet (PrintOrderSheet.swift) -------------------------------------------------

const LAST_SENT = 'inlay.print.lastSent';
const readLastSent = () => { try { return Number(localStorage.getItem(LAST_SENT)) || 0; } catch { return 0; } };

function countsLine(world, ids) {
  const countries = ids.filter((id) => world.rows.get(id)?.kind === 'country').length, territories = ids.length - countries;
  return territories > 0 ? t('%lld countries, %lld territories', countries, territories) : t('%lld countries', countries);
}

/** The land's own extent, from mainland anchors, as GhostMapSource frames the world. */
function ghostWorld(world) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const id of ['CA', 'GL', 'MX', 'BR', 'CL', 'AR', 'NO', 'ZA', 'CN', 'JP', 'ID', 'AU']) {
    const b = world.rows.get(id)?.bounds; if (!b) continue;
    x0 = Math.min(x0, b[0]); y0 = Math.min(y0, b[1]); x1 = Math.max(x1, b[0] + b[2]); y1 = Math.max(y1, b[1] + b[3]);
  }
  if (!isFinite(x0)) return world.frame;
  const w = x1 - x0, hgt = y1 - y0;
  return [x0 - w * 0.07, y0 - hgt * 0.02, w * 1.12, hgt * 1.04];
}

function PrintPreview({ world, ids, dark }) {
  const canvas = useRef(null), host = useRef(null);
  const rect = useMemo(() => ghostWorld(world), [world]);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e.contentRect.width)));
    ro.observe(host.current); return () => ro.disconnect();
  }, []);
  useEffect(() => {
    if (!width) return;
    let cancelled = false;
    const dpr = Math.min(2, devicePixelRatio || 1), w = Math.round(width * dpr), hgt = Math.round(width * rect[3] / rect[2] * dpr);
    const off = document.createElement('canvas'); off.width = w; off.height = hgt;
    paintPlaces(off.getContext('2d'), world, { rect, width: w, height: hgt, mode: 'contain', inked: new Set(ids), sea: false, dark }).then(() => {
      if (cancelled || !canvas.current) return;
      canvas.current.width = w; canvas.current.height = hgt; canvas.current.getContext('2d').drawImage(off, 0, 0);
    });
    return () => { cancelled = true; };
  }, [width, ids.join(','), dark]);
  return html`<div class="pi-preview" ref=${host} style=${{ aspectRatio: `${rect[2]} / ${rect[3]}` }} aria-hidden="true"><canvas ref=${canvas}></canvas></div>`;
}

export function PrintSheet({ Sheet, world, atlas, name, onClose, dark }) {
  // Made once when the sheet opens, so a retry or a copied link carries the same snapshot.
  const [made, setMade] = useState(null); // { url, snapshot } | { failed: true }
  const [lastSent, setLastSent] = useState(readLastSent);
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const snapshot = await printSnapshot(world, atlas, name);
        const code = await printCode(snapshot);
        const url = code ? Object.assign(new URL(printShop()), { hash: code }).href : null;
        if (live) setMade(url ? { url, snapshot } : { failed: true });
      } catch { if (live) setMade({ failed: true }); }
    })();
    return () => { live = false; };
  }, []);
  const person = made?.snapshot?.people[0];
  const ids = person?.ids ?? [];
  const isEmpty = !!made?.snapshot && ids.length === 0;
  let footer = isEmpty ? t('There are no countries or territories to print yet. Mark the places you’ve visited first.')
    : [t('The print shop opens with these names and the countries and territories visited.'), t('Dates, trips, plans and photos aren’t sent.'),
       t('You can add your own photos for a Memory print there.')].join(' ');
  const lastLine = lastSent > 0 && !isEmpty
    ? t('You last opened the print shop on %@.', new Intl.DateTimeFormat(language(), { dateStyle: 'medium' }).format(new Date(lastSent * 1000))) : '';
  const opened = () => { const now = Date.now() / 1000; try { localStorage.setItem(LAST_SENT, String(now)); } catch {} setLastSent(now); };
  const isDark = dark ?? document.documentElement.dataset.theme === 'dark';
  return html`<${Sheet} title=${t('Your World')} onClose=${onClose} class="pi-print">
    <div class="pi-print-body">
      <div class="pi-person">
        <strong>${t('Your atlas')}</strong>
        <span>${person ? countsLine(world, ids) : ' '}</span>
      </div>
      <p class="pi-footer">${footer}${lastLine && html`<br /><br />${lastLine}`}</p>
      ${made?.failed && html`<p class="pi-footer pi-error" role="alert"><strong>${t('Couldn’t prepare the print')}</strong><br />
        ${t('This atlas couldn’t be packed into a print link. Nothing was sent.')}</p>`}
      ${ids.length > 0 && html`<${PrintPreview} world=${world} ids=${ids} dark=${isDark} />`}
    </div>
    <div class="pi-continue">
      ${made?.url && !isEmpty
        ? html`<a class="ink" href=${made.url} target="_blank" rel="noopener" onClick=${opened}>${t('Continue to the print shop')}</a>`
        : html`<button class="ink" disabled>${t('Continue to the print shop')}</button>`}
    </div>
  <//>`;
}

export function PrintButton({ world, atlas, name, Sheet, class: cls = '', dark }) {
  const [open, setOpen] = useState(false);
  const direct = async () => {
    // Opened before the link is ready so the browser keeps it as the person's own click.
    const tab = window.open('about:blank', '_blank');
    const url = await printURL(world, atlas, name);
    if (url && tab) { tab.opener = null; tab.location.href = url; } else tab?.close();
  };
  return html`<button class=${'pi-print-button ' + cls} onClick=${() => (Sheet ? setOpen(true) : direct())}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="15" rx="1.5"/><rect x="7" y="8" width="10" height="8" rx="0.5"/></svg>
      <span class="pi-print-text"><b>${t('Framed print')}</b><small>${t('Print shop')}</small></span>
    </button>
    ${open && Sheet && html`<${PrintSheet} Sheet=${Sheet} world=${world} atlas=${atlas} name=${name} dark=${dark} onClose=${() => setOpen(false)} />`}`;
}
