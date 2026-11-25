// Friends: compare two atlases from a link, as the app does (Friends.swift, OverlapMap.swift,
// LinkCode.swift). The list travels inside the link and this browser keeps its own copy;
// opening a newer link from the same friend updates it. Live friends (INLAY3, kept up to date
// through iCloud) are read and kept, but their places arrive with iCloud sync (phase 5).
//
// Codes (pure, tested in node with tools/test-friends.mjs against codes the app's own encoder made):
//   await readInvite(text)        INLAY1-/INLAY2-/INLAY3- code, inlay://friend?d=…, https://inlayatlas.com/friend/#…,
//                                 or a message holding one -> { name, visited: [ids], liveID? }; throws Error('notAnInvite').
//   await writeInvite(atlas, name) -> { code: 'INLAY2-…', url: 'https://inlayatlas.com/friend/#INLAY2-…', invitation };
//                                 throws Error('unpackable') when the atlas can't be packed (the app then sends nothing).
//   await openInviteFromURL(location) -> the friend's atlas from /atlas/#INLAY2-… or /atlas/?friend=…, else null.
//   addFriend(atlasClone, shared, now?) -> the stored friend; use inside update(): FriendStore.add.
//   friendID(friend), compare(mine, theirs, known) (AtlasComparison).
//
// Component:
//   <FriendsSheet Sheet world atlas update name visited wanted onChoose onClose
//                 openID? (a friend to open straight into the comparison) onWant?(id) dark? />
//   Stores friends in atlas.friends = [{ name, visited: [ids], updated: ISO 8601, liveID? }]
//   (the app's Friend) and the person's own name in atlas.name (the app's displayName, which its
//   export file also carries as `name`).

import { h } from 'preact';
import { useState, useEffect, useRef, useMemo } from 'preact/hooks';
import htm from 'htm';
import { t, language, upper, tracking } from './i18n.js';
import { paintPlaces, frameOf, path } from './placeart.js';

const html = htm.bind(h);

// ---- LinkCode -------------------------------------------------------------------------------
export const MAX_LENGTH = 24_000;   // LinkCode.maxLength: the longest code written or read
export const MAX_INFLATED = 200_000; // LinkCode.maxInflated: the largest JSON a code unpacks to
export const INVITE_PAGE = 'https://inlayatlas.com/friend/';
export const CODE_PREFIX = 'INLAY2-', LEGACY_PREFIX = 'INLAY1-', LIVE_PREFIX = 'INLAY3-';
const MAX_NAME_BYTES = 1024;

const isCodeChar = (c) => /[A-Za-z0-9_-]/.test(c);
const utf8 = new TextEncoder();
const strictUTF8 = () => new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

export function webSafe(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** LinkCode.data(webSafe:): null for anything Data(base64Encoded:) refuses. */
export function fromWebSafe(text) {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return null;
  let body = text.replace(/-/g, '+').replace(/_/g, '/');
  body += '='.repeat((4 - (body.length % 4)) % 4);
  try {
    const s = atob(body);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  } catch { return null; }
}

async function pipe(stream, bytes, limit = Infinity) {
  const writer = stream.writable.getWriter();
  writer.write(bytes).catch(() => {});
  writer.close().catch(() => {});
  const reader = stream.readable.getReader();
  const chunks = []; let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    // Stop as soon as it passes the limit: a crafted code can't inflate into gigabytes.
    if (total >= limit) { reader.cancel().catch(() => {}); return null; }
    chunks.push(value);
  }
  const out = new Uint8Array(total); let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}

/** LinkCode.pack: raw DEFLATE (RFC 1951) and base64url; null when longer than a code is read. */
export async function pack(jsonBytes) {
  const packed = await pipe(new CompressionStream('deflate-raw'), jsonBytes);
  const text = webSafe(packed);
  return text.length <= MAX_LENGTH ? text : null;
}

/** LinkCode.unpack: null when too long, not code characters, not DEFLATE, or too big inflated. */
export async function unpack(text) {
  if (text.length > MAX_LENGTH || ![...text].every(isCodeChar)) return null;
  const packed = fromWebSafe(text); if (!packed) return null;
  try { return await pipe(new DecompressionStream('deflate-raw'), packed, MAX_INFLATED); } catch { return null; }
}

// ---- SharedAtlas ----------------------------------------------------------------------------
// CharacterSet.whitespacesAndNewlines and .controlCharacters (Cc and Cf).
const SPACE = /[\p{Z}\t\n\v\f\r\u0085]/u, SPACES = /[\p{Z}\t\n\v\f\r\u0085]+/u, CONTROL = /[\p{Cc}\p{Cf}]/u;
const graphemes = (s) => [...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(s)].map((g) => g.segment);

/** SharedAtlas.cleanName: NFC, unsafe controls out (joiners kept), spaces collapsed, at most
 *  40 characters and 1024 UTF-8 bytes. */
export function cleanName(name) {
  const kept = [...String(name).normalize('NFC')]
    .filter((c) => !CONTROL.test(c) || SPACE.test(c) || c === '‌' || c === '‍').join('');
  const cleaned = kept.split(SPACES).filter(Boolean).join(' ');
  let result = '', bytes = 0;
  for (const g of graphemes(cleaned).slice(0, 40)) {
    const n = utf8.encode(g).length;
    if (bytes + n > MAX_NAME_BYTES) break;
    result += g; bytes += n;
  }
  return result;
}

/** SharedAtlas(name:visited:liveID:): an empty name reads "A friend"; places sorted, once each. */
function shared(name, visited, liveID) {
  const cleaned = cleanName(name);
  const out = { name: cleaned || 'A friend', visited: [...new Set(visited)].sort() };
  if (liveID != null) out.liveID = liveID;
  return out;
}

/** SharedAtlas.validated: a name, fewer than 1000 places with plain short IDs, a well-formed sharing ID. */
export function validated(name, visited, liveID) {
  const cleaned = cleanName(name);
  if (!cleaned || !Array.isArray(visited) || visited.length >= 1000) return null;
  if (!visited.every((id) => typeof id === 'string' && id.length <= 8 && /^[A-Za-z0-9-]*$/.test(id))) return null;
  if (liveID != null && !(typeof liveID === 'string' && liveID.length <= 64 && /^[0-9A-Fa-f-]*$/.test(liveID))) return null;
  return shared(cleaned, visited, liveID);
}

/** JSONEncoder's bytes for SharedAtlas: strings escaped as Foundation does (including "\/"),
 *  non-ASCII written as UTF-8, no liveID key when there is none. */
export function encodeShared(s) {
  const json = { name: s.name, visited: s.visited };
  if (s.liveID != null) json.liveID = s.liveID;
  return JSON.stringify(json).replace(/\//g, '\\/');
}

function body(text, prefix) {
  const at = text.indexOf(prefix);
  if (at < 0) return null;
  let out = '';
  for (const c of text.slice(at + prefix.length, at + prefix.length + MAX_LENGTH + 1)) { if (!isCodeChar(c)) break; out += c; }
  return out;
}

const refuse = () => { throw new Error('notAnInvite'); };

/** SharedAtlas(text:): a code, or any message or link that holds one. */
export async function readInviteText(text) {
  text = String(text ?? '');
  const live = body(text, LIVE_PREFIX);
  if (live != null) {
    if (!(live.length > 32 && live.length <= 32 + 4 * Math.floor((MAX_NAME_BYTES + 2) / 3))) refuse();
    if (!/^[0-9A-Fa-f]{32}$/.test(live.slice(0, 32))) refuse();
    const nameData = fromWebSafe(live.slice(32));
    if (!nameData || nameData.length > MAX_NAME_BYTES) refuse();
    let name; try { name = strictUTF8().decode(nameData); } catch { refuse(); }
    if (graphemes(name).length > 40 || !name.split(SPACES).some(Boolean)) refuse();
    const hex = live.slice(0, 32).toLowerCase();
    const id = [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-');
    return shared(name, [], id);
  }
  let json;
  const packed = body(text, CODE_PREFIX);
  if (packed != null) json = await unpack(packed);
  else {
    const plain = body(text, LEGACY_PREFIX);
    if (plain == null || plain.length > MAX_LENGTH) refuse();
    json = fromWebSafe(plain);
  }
  if (!json || json.length >= MAX_INFLATED) refuse();
  let decoded;
  try { decoded = JSON.parse(strictUTF8().decode(json)); } catch { refuse(); }
  // JSONDecoder: an object with a string name and an array of strings, liveID a string if present.
  if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded) || typeof decoded.name !== 'string'
      || !Array.isArray(decoded.visited) || !decoded.visited.every((v) => typeof v === 'string')
      || !(decoded.liveID == null || typeof decoded.liveID === 'string')) refuse();
  return validated(decoded.name, decoded.visited, decoded.liveID ?? null) ?? refuse();
}

/** SharedAtlas(url:): the app's scheme (inlay://friend?d=…) or the invite page's fragment. */
export async function readInviteURL(url) {
  let u; try { u = url instanceof URL ? url : new URL(String(url)); } catch { refuse(); }
  if (u.protocol === 'inlay:' && u.host === 'friend') {
    const d = u.searchParams.get('d');
    return d == null ? refuse() : readInviteText(d);
  }
  if (u.protocol === 'https:' && u.href.startsWith(INVITE_PAGE) && u.hash.length > 1) return readInviteText(u.hash.slice(1));
  refuse();
}

/** A pasted code, link or message: a whole link reads as the app opens links, anything else as
 *  the app reads a paste. */
export async function readInvite(text) {
  const trimmed = String(text ?? '').trim();
  if (/^(inlay:\/\/friend\b|https:\/\/inlayatlas\.com\/friend\/)/i.test(trimmed) && !/\s/.test(trimmed)) {
    try { return await readInviteURL(trimmed); } catch { /* fall through to the text reading */ }
  }
  return readInviteText(trimmed);
}

/** The code "Invite a friend" sends: the whole list, compressed (INLAY2), and its link. */
export async function writeInvite(atlas, name = atlas?.name) {
  const mine = shared(name || 'A friend', Object.keys(atlas?.visits ?? {}));
  const valid = validated(mine.name, mine.visited, null);
  const text = valid && await pack(utf8.encode(encodeShared(valid)));
  if (!text) throw new Error('unpackable');
  const code = CODE_PREFIX + text, url = INVITE_PAGE + '#' + code;
  return { code, url, invitation: t('Compare travel maps with me on Inlay\n%@', url), shared: valid };
}

/** /atlas/#INLAY2-… (preferred: a fragment never reaches the server) or /atlas/?friend=…. */
export async function openInviteFromURL(location) {
  const hash = location?.hash?.slice(1) ?? '';
  const query = new URLSearchParams(location?.search ?? '').get('friend');
  for (const text of [hash, query]) {
    if (text && /INLAY[123]-/.test(text)) { try { return await readInviteText(text); } catch { /* try the next */ } }
  }
  return null;
}

// ---- FriendStore and AtlasComparison --------------------------------------------------------
export const friendID = (f) => f.liveID ?? f.name.toLowerCase();
const collator = () => new Intl.Collator(language(), { numeric: true, sensitivity: 'base' });

/** FriendStore.add, on a clone inside update(): the same sharing ID, or for links without one
 *  the same name, is the same friend. Returns the stored friend. */
export function addFriend(a, s, now = new Date()) {
  const friends = a.friends ?? [];
  const lower = s.name.toLowerCase(), sameName = (f) => f.name.toLowerCase() === lower;
  const existing = friends.find((f) => (s.liveID != null ? f.liveID === s.liveID : (f.liveID == null && sameName(f))))
    ?? (s.liveID != null ? friends.find((f) => f.liveID == null && sameName(f)) : undefined);
  // A short invite carries no places: keep the ones already known until iCloud sends them.
  const visited = s.visited.length === 0 && s.liveID != null ? existing?.visited ?? [] : [...new Set(s.visited)].sort();
  const friend = { name: s.name, visited, updated: now.toISOString().replace(/\.\d{3}Z$/, 'Z'), ...(s.liveID != null ? { liveID: s.liveID } : {}) };
  const drop = new Set([existing && friendID(existing), friendID(friend)]);
  const c = collator();
  a.friends = [...friends.filter((f) => !drop.has(friendID(f))), friend].sort((x, y) => c.compare(x.name, y.name));
  return friend;
}

/** AtlasComparison: both, only mine, only theirs, in `known` order. */
export function compare(mine, theirs, known) {
  const m = mine instanceof Set ? mine : new Set(mine), th = theirs instanceof Set ? theirs : new Set(theirs);
  return { both: known.filter((id) => m.has(id) && th.has(id)), onlyMine: known.filter((id) => m.has(id) && !th.has(id)),
           onlyTheirs: known.filter((id) => !m.has(id) && th.has(id)) };
}

// ---- web-only strings -----------------------------------------------------------------------
const WEB = {
  ja: { 'Link copied': 'リンクをコピーしました', 'Select the link and copy it.': 'リンクを選択してコピーしてください。',
        '%@’s places come through iCloud, which the web atlas can’t open yet.': '%@の場所はiCloud経由で届くため、ウェブのアトラスではまだ開けません。' },
  ko: { 'Link copied': '링크를 복사했습니다', 'Select the link and copy it.': '링크를 선택해 복사하세요.',
        '%@’s places come through iCloud, which the web atlas can’t open yet.': '%@의 장소는 iCloud로 전달되므로 웹 아틀라스에서는 아직 열 수 없습니다.' },
  de: { 'Link copied': 'Link kopiert', 'Select the link and copy it.': 'Markiere den Link und kopiere ihn.',
        '%@’s places come through iCloud, which the web atlas can’t open yet.': 'Die Orte von %@ kommen über iCloud, das der Web-Atlas noch nicht öffnen kann.' },
  'pt-BR': { 'Link copied': 'Link copiado', 'Select the link and copy it.': 'Selecione o link e copie.',
        '%@’s places come through iCloud, which the web atlas can’t open yet.': 'Os lugares de %@ chegam pelo iCloud, que o atlas na web ainda não consegue abrir.' },
  it: { 'Link copied': 'Link copiato', 'Select the link and copy it.': 'Seleziona il link e copialo.',
        '%@’s places come through iCloud, which the web atlas can’t open yet.': 'I luoghi di %@ arrivano tramite iCloud, che l’atlante web non può ancora aprire.' },
  fr: { 'Link copied': 'Lien copié', 'Select the link and copy it.': 'Sélectionnez le lien et copiez-le.',
        '%@’s places come through iCloud, which the web atlas can’t open yet.': 'Les lieux de %@ arrivent par iCloud, que l’atlas web ne peut pas encore ouvrir.' },
};
const tw = (key, ...args) => { const s = WEB[language()]?.[key] ?? key; let i = 0; return s.replace(/%@/g, () => String(args[i++] ?? '')); };

// ---- the overlap map ------------------------------------------------------------------------
const AREAS = ['world', 'europe', 'north-america', 'south-america', 'asia', 'africa', 'oceania'];
const AREA_TITLE = { world: 'World', europe: 'Europe', 'north-america': 'North America', 'south-america': 'South America', asia: 'Asia', africa: 'Africa', oceania: 'Oceania' };
/** OverlapMap.theirInk / yourInk. */
const INK = { theirs: { light: [0xB4, 0x59, 0x3C], dark: [0xE5, 0x9A, 0x7E] }, yours: { light: [0x33, 0x5C, 0x4A], dark: [0xA3, 0xD1, 0xB3] } };
const rgba = ([r, g, b], a = 1) => `rgba(${r},${g},${b},${a})`;

/** AtlasPostcard.frame(for:). */
function areaFrame(world, area) {
  if (area === 'world') return [600, 1500, world.frame[2] - 1200, 14600];
  return world.overviews?.[area] ?? world.groups[area];
}
/** AtlasPostcard.suggestedArea: the continent when every place is on one, else the world. */
function suggestedArea(world, ids) {
  const groups = new Set(ids.map((id) => world.rows.get(id)?.group).filter(Boolean));
  return groups.size === 1 ? [...groups][0] : 'world';
}

/** Diagonal hatching about 3.2 pt apart over a light terracotta wash, at the canvas's scale. */
function hatch(ctx, dark, dpr) {
  const g = Math.max(3, Math.round(3.2 * dpr));
  const tile = document.createElement('canvas'); tile.width = tile.height = g;
  const c = tile.getContext('2d'), ink = INK.theirs[dark ? 'dark' : 'light'];
  c.fillStyle = rgba(ink, dark ? 0.28 : 0.2); c.fillRect(0, 0, g, g);
  c.strokeStyle = rgba(ink, 0.85); c.lineWidth = 0.9 * dpr; c.beginPath();
  for (const k of [-1, 0, 1]) { c.moveTo(k * g - 1, g + 1); c.lineTo(k * g + g + 1, -1); }
  c.stroke();
  return ctx.createPattern(tile, 'repeat');
}

/** OverlapMap.image: shared places carry their art, only-yours a sage wash, only-theirs hatched terracotta. */
export async function paintOverlap(ctx, world, { rect, width, height, comparison, dark, dpr = 1 }) {
  const yours = INK.yours[dark ? 'dark' : 'light'], theirs = INK.theirs[dark ? 'dark' : 'light'];
  const tint = new Map(), pattern = hatch(ctx, dark, dpr);
  for (const id of comparison.onlyMine) tint.set(id, rgba(yours, dark ? 0.5 : 0.42));
  for (const id of comparison.onlyTheirs) tint.set(id, pattern);
  const T = await paintPlaces(ctx, world, { rect, width, height, mode: 'contain', dark, inked: new Set(comparison.both), tint });
  ctx.lineJoin = 'round'; ctx.lineWidth = 0.8 * dpr;
  for (const [ids, ink] of [[comparison.onlyMine, yours], [comparison.onlyTheirs, theirs]]) {
    ctx.strokeStyle = rgba(ink);
    for (const id of ids) { const p = world.places.get(id); if (p) ctx.stroke(path(p.rings, T)); }
  }
  return T;
}

function useWidth(ref) {
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)));
    ro.observe(el); return () => ro.disconnect();
  }, []);
  return w;
}

const isDark = (dark) => dark ?? (document.documentElement.dataset.theme === 'dark'
  || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches));

function OverlapPanel({ world, comparison, friendName, dark }) {
  const ids = useMemo(() => [...comparison.both, ...comparison.onlyMine, ...comparison.onlyTheirs], [comparison]);
  const [area, setArea] = useState(null);
  const shown = area ?? suggestedArea(world, ids);
  const host = useRef(null), canvas = useRef(null);
  const width = useWidth(host);
  const [state, setState] = useState('updating'); // 'updating' | 'ready' | 'failed'
  const [attempt, setAttempt] = useState(0);
  const frame = areaFrame(world, shown);
  const height = width ? Math.min(300, Math.max(150, Math.round(width * frame[3] / frame[2]))) : 0;
  const dk = isDark(dark);
  useEffect(() => {
    if (!width) return;
    let live = true;
    setState('updating');
    const dpr = Math.min(Math.max(devicePixelRatio || 1, 1), 3);
    const off = document.createElement('canvas');
    off.width = Math.round(width * dpr); off.height = Math.round(height * dpr);
    const watchdog = setTimeout(() => live && setState('failed'), 20000);
    paintOverlap(off.getContext('2d'), world, { rect: frame, width: off.width, height: off.height, comparison, dark: dk, dpr })
      .then(() => {
        if (!live) return;
        const c = canvas.current; c.width = off.width; c.height = off.height;
        c.getContext('2d').drawImage(off, 0, 0);
        setState('ready');
      })
      .catch(() => live && setState('failed'))
      .finally(() => clearTimeout(watchdog));
    return () => { live = false; clearTimeout(watchdog); };
  }, [width, shown, dk, comparison, attempt]);
  const label = t('Map of %@: %lld places you’ve both been, %lld only you, %lld only %@', t(AREA_TITLE[shown]),
                  comparison.both.length, comparison.onlyMine.length, comparison.onlyTheirs.length, friendName);
  const legendInk = dk ? 'dark' : 'light';
  return html`<div class="friends-overlap">
    <div class="friends-map" ref=${host} style=${{ height: height ? height + 'px' : '180px' }}>
      <canvas ref=${canvas} role="img" aria-label=${label} class=${state === 'ready' ? 'on' : ''}
        style=${{ width: width + 'px', height: height + 'px' }}></canvas>
      ${state !== 'ready' && html`<span class="friends-map-state" role="status">${state === 'failed' ? t('Map unavailable') : t('Updating map…')}</span>`}
    </div>
    ${state === 'failed' && html`<button class="link" onClick=${() => setAttempt((n) => n + 1)}>${t('Try updating the map again')}</button>`}
    <div class="friends-legend-row">
      <div class="friends-legend">
        <span><i class="friends-swatch both"></i>${t('Both of you')}</span>
        <span><i class="friends-swatch" style=${{ background: rgba(INK.yours[legendInk], 0.6) }}></i>${t('Only you')}</span>
        <span><i class="friends-swatch hatch" style=${{ '--their': rgba(INK.theirs[legendInk]), '--their-wash': rgba(INK.theirs[legendInk], 0.25) }}></i>${t('Only %@', friendName)}</span>
      </div>
      <label class="friends-area">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.6 2.6 3.8 5.6 3.8 9s-1.2 6.4-3.8 9c-2.6-2.6-3.8-5.6-3.8-9S9.4 5.6 12 3z"/></svg>
        <select aria-label=${t('Map area, %@', t(AREA_TITLE[shown]))} value=${shown} onChange=${(e) => setArea(e.target.value)}>
          ${AREAS.map((a) => html`<option value=${a}>${t(AREA_TITLE[a])}</option>`)}
        </select>
      </label>
    </div>
  </div>`;
}

// ---- the friends sheet ----------------------------------------------------------------------
const Legend = ({ children, class: cls = '' }) => html`<span class=${'legend ' + cls} style=${{ letterSpacing: tracking() }}>${upper(children)}</span>`;
const Bookmark = ({ filled }) => html`<svg viewBox="0 0 24 24" aria-hidden="true" class=${filled ? 'filled' : ''}><path d="M6.5 3.5h11v17l-5.5-4-5.5 4z"/></svg>`;

/** The art behind the sheet's title: your places and your friends' together, or the Americas side by side. */
function Hero({ world, ids, dark, children }) {
  const host = useRef(null), canvas = useRef(null);
  const width = useWidth(host);
  const dk = isDark(dark);
  const key = ids.join(',');
  useEffect(() => {
    if (!width) return;
    let live = true;
    const dpr = Math.min(devicePixelRatio || 1, 2), height = 220;
    const off = document.createElement('canvas'); off.width = width * dpr; off.height = height * dpr;
    const g = world.groups, na = g['north-america'], sa = g['south-america'];
    const rect = ids.length ? frameOf(world, ids, 0.08)
      : [Math.min(na[0], sa[0]), Math.min(na[1], sa[1]), Math.max(na[0] + na[2], sa[0] + sa[2]) - Math.min(na[0], sa[0]), Math.max(na[1] + na[3], sa[1] + sa[3]) - Math.min(na[1], sa[1])];
    paintPlaces(off.getContext('2d'), world, { rect, width: off.width, height: off.height, dark: dk, inked: new Set(ids.length ? ids : [...world.byGroup['north-america'], ...world.byGroup['south-america']]) })
      .then(() => { if (!live) return; const c = canvas.current; c.width = off.width; c.height = off.height; c.getContext('2d').drawImage(off, 0, 0); c.classList.add('on'); })
      .catch(() => {});
    return () => { live = false; };
  }, [width, key, dk]);
  return html`<div class="friends-hero" ref=${host}><canvas ref=${canvas} aria-hidden="true"></canvas><div class="friends-hero-text">${children}</div></div>`;
}

export function FriendsSheet({ Sheet, world, atlas, update, name, visited, wanted, onChoose, onClose, openID = null, onWant, dark }) {
  const friends = atlas.friends ?? [];
  const [opened, setOpened] = useState(openID);
  const friend = friends.find((f) => friendID(f) === opened) ?? null;
  const known = useMemo(() => { const c = collator(); return [...world.rows.keys()].sort((a, b) => c.compare(name(a), name(b))); }, [world, language()]);
  const want = onWant ?? ((id) => update((a) => {
    if (!a.wanted[id]) a.wanted[id] = { rank: Object.keys(a.wanted).length, note: '', nextUp: false, modified: Date.now() / 1000 };
    return a;
  }));
  if (friend) {
    return html`<${Sheet} title=${t('You and %@', friend.name)} onClose=${onClose} class="friends">
      <${Comparison} world=${world} friend=${friend} known=${known} name=${name} visited=${visited} wanted=${wanted}
        onWant=${want} onBack=${() => setOpened(null)} dark=${dark} />
    <//>`;
  }
  return html`<${Sheet} title=${t('Friends')} onClose=${onClose} class="friends">
    <${FriendList} world=${world} atlas=${atlas} update=${update} friends=${friends} known=${known} visited=${visited}
      onOpen=${setOpened} dark=${dark} />
  <//>`;
}

function FriendList({ world, atlas, update, friends, known, visited, onOpen, dark }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState(false);
  const [invite, setInvite] = useState(undefined); // undefined while packing, null when it can't be
  const [copied, setCopied] = useState(null);      // 'copied' | 'failed'
  const [draftName, setDraftName] = useState(atlas.name ?? '');
  const visitKey = Object.keys(atlas.visits).sort().join(',');
  useEffect(() => {
    let live = true;
    writeInvite(atlas, draftName).then((v) => live && setInvite(v), () => live && setInvite(null));
    return () => { live = false; };
  }, [visitKey, draftName]);
  useEffect(() => { setCopied(null); }, [invite?.url]);
  const heroIDs = useMemo(() => [...new Set([...visited, ...friends.flatMap((f) => f.visited)])].filter((id) => world.rows.has(id)).sort(),
                          [visited, friends]);
  const add = async (text) => {
    try {
      const s = await readInvite(text);
      setError(false); setCode('');
      update((a) => { addFriend(a, s); return a; });
      onOpen(friendID(s));
    } catch { setError(true); }
  };
  const share = async () => {
    try { await navigator.share({ text: invite.invitation }); } catch { /* dismissed */ }
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(invite.url); setCopied('copied'); } catch { setCopied('failed'); }
  };
  const title = friends.length === 0 ? t('Atlases, side by side') : friends.length === 1 ? t('You and %@', friends[0].name) : t('You and %lld friends', friends.length);
  return html`<div class="list friends-list">
    <${Hero} world=${world} ids=${heroIDs} dark=${dark}>
      <h3>${title}</h3>
      <p>${t('See where you’ve both been, where only one of you has, and who to ask about the places on your list.')}</p>
    <//>
    <section class="friends-section">
      <label class="field"><${Legend}>${t('Your name')}<//>
        <input type="text" autocomplete="given-name" value=${draftName} maxlength="80"
          onInput=${(e) => setDraftName(e.target.value)}
          onChange=${(e) => update((a) => { a.name = e.target.value.trim(); return a; })} /></label>
    </section>
    <section class="friends-section">
      <${Legend} class="section-title">${t('Share your atlas')}<//>
      ${invite === null ? html`<div class="friends-unavailable"><b>${t('Invite a friend')}</b>
          <p>${t('Your atlas couldn’t be packed into a link. Try again after your next change.')}</p></div>`
        : html`<div class="actions">
          ${typeof navigator.share === 'function' && html`<button class="ink" disabled=${!invite} onClick=${share}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V3.5M7.5 8 12 3.5 16.5 8M6 11.5H5v9h14v-9h-1"/></svg>${t('Invite a friend')}</button>`}
          <button class="outline" disabled=${!invite} onClick=${copy}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1"/></svg>${t('Copy Link')}</button>
          ${copied === 'copied' && html`<span class="friends-copied" role="status">${tw('Link copied')}</span>`}
        </div>
        ${copied === 'failed' && html`<label class="field"><span class="friends-foot">${tw('Select the link and copy it.')}</span>
          <input type="text" readonly value=${invite.url} onFocus=${(e) => e.target.select()} /></label>`}`}
      <p class="friends-foot">${t('Friends see the places you’ve visited, as of when you send the link, and can order a print of your map as a gift. Send a new link to update it.')}</p>
    </section>
    <section class="friends-section">
      <${Legend} class="section-title">${t('Friends')}<//>
      <form class="friends-paste" onSubmit=${(e) => { e.preventDefault(); add(code); }}>
        <input type="text" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck=${false}
          placeholder=${t('Friend’s link or code')} aria-label=${t('Friend’s link or code')} value=${code}
          aria-invalid=${error ? 'true' : 'false'} aria-describedby=${error ? 'friends-error' : undefined}
          onInput=${(e) => { setCode(e.target.value); if (error) setError(false); }} />
        <button class="outline" type="submit" disabled=${!code.trim()}>${t('Add')}</button>
      </form>
      ${error && html`<p class="friends-error" id="friends-error" role="alert">${t('That isn’t an Inlay atlas code. Ask your friend to send their link again.')}</p>`}
      ${friends.map((f) => {
        const c = compare(visited, f.visited, known);
        return html`<div class="row friends-row" key=${friendID(f)}>
          <button class="plain friends-open" onClick=${() => onOpen(friendID(f))}>
            <span class="friends-name">${f.name}</span>
            <${Legend}>${t('%lld in common · %lld only theirs', c.both.length, c.onlyTheirs.length)}<//>
          </button>
          <button class="quiet friends-remove" onClick=${() => update((a) => { a.friends = (a.friends ?? []).filter((x) => friendID(x) !== friendID(f)); return a; })}>${t('Remove')}</button>
          <svg class="friends-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>
        </div>`;
      })}
      ${friends.length === 0 && html`<p class="friends-foot">${t('Paste a friend’s Inlay link or code above, or open the link they sent you.')}</p>`}
    </section>
  </div>`;
}

const TABS = [['both', 'Both'], ['theirs', 'Only them'], ['mine', 'Only you']];

function Comparison({ world, friend, known, name, visited, wanted, onWant, onBack, dark }) {
  const [tab, setTab] = useState('both');
  const comparison = useMemo(() => compare(visited, friend.visited, known), [visited, friend.visited, known]);
  const ask = comparison.onlyTheirs.filter((id) => wanted.has(id));
  const ids = tab === 'both' ? comparison.both : tab === 'theirs' ? comparison.onlyTheirs : comparison.onlyMine;
  const waiting = friend.liveID != null && friend.visited.length === 0;
  return html`<div class="list friends-compare">
    <button class="link friends-back" onClick=${onBack}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>${t('Friends')}</button>
    ${waiting && html`<p class="friends-live" role="status">${tw('%@’s places come through iCloud, which the web atlas can’t open yet.', friend.name)}</p>`}
    <${OverlapPanel} world=${world} comparison=${comparison} friendName=${friend.name} dark=${dark} />
    <div class="friends-counts">
      <div><b>${comparison.both.length}</b><span>${t('both')}</span></div>
      <div><b>${comparison.onlyTheirs.length}</b><span>${t('only %@', friend.name)}</span></div>
      <div><b>${comparison.onlyMine.length}</b><span>${t('only you')}</span></div>
    </div>
    <div class="segments" role="tablist" aria-label=${t('Show')}>
      ${TABS.map(([key, label]) => html`<button role="tab" aria-selected=${tab === key} class=${tab === key ? 'on' : ''} onClick=${() => setTab(key)}>${t(label)}</button>`)}
    </div>
    ${ask.length > 0 && html`<section class="friends-ask">
      <${Legend} class="section-title">${t('Ask %@ about', friend.name)}<//>
      ${ask.map((id) => html`<div class="row" key=${id}><${Bookmark} filled /><span class="row-name">${name(id)}</span></div>`)}
      <p class="friends-foot">${t('On your Want to go list, and %@ has been.', friend.name)}</p>
    </section>`}
    <section class="friends-places" role="tabpanel">
      ${ids.length === 0 && html`<p class="empty">${t('No places here yet')}</p>`}
      ${ids.map((id) => html`<div class="row" key=${id}>
        <span class="row-name">${name(id)}</span>
        ${tab === 'theirs' && html`<button class="quiet icon friends-want" disabled=${wanted.has(id)} aria-pressed=${wanted.has(id)}
            aria-label=${wanted.has(id) ? t('On your Want to go list') : t('Save %@ to Want to go', name(id))}
            title=${wanted.has(id) ? t('On your Want to go list') : t('Save %@ to Want to go', name(id))}
            onClick=${() => !wanted.has(id) && onWant(id)}><${Bookmark} filled=${wanted.has(id)} /></button>`}
      </div>`)}
    </section>
  </div>`;
}
