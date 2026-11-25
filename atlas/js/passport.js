// The passport (PassportView.swift): one page per visited place, in the order they were first
// visited, headed by that place on the map edge to edge, with a hand-stamped entry mark, its
// name, continent, first-visit date and the trips that went there. The app's Photos part is left
// out: the web has no Photos library.
//
//   import { PassportSheet } from './passport.js';      // and link css/passport.css
//   html`<${PassportSheet} Sheet=${Sheet} world=${world} atlas=${atlas} name=${name}
//          visited=${visited} startID=${id /* optional page to open on */}
//          play=${(sound) => …  /* optional: 'page' on a turn, 'stamp' when a stamp lands */}
//          onShare=${(id) => …  /* optional: shows a share button for the page in front */}
//          onClose=${…} />`
//
// Pages turn with the buttons beside the art, the arrow keys and a sideways swipe. The stamp comes
// down onto the page the first time each page is shown (held still under Reduce Motion).
//
// Also exported for other modules (milestones.js, share cards):
//   Backdrop      the atlas as a page's picture (AtlasBackdrop): subject { place } | { places } |
//                 { closeUp }, inked and outlined sets, a paper wash; it inks in from the top and
//                 drifts once, slowly (never loops).
//   EntryStamp    the classic entry stamp, or `messy` for the share card's border stamps.
//   passportOrder visited places in passport order.
//   visitDateText a saved visit date ('2024' | '2024-05') as the app writes it.
//   useDark       true while the atlas is in its dark appearance.

import { h } from 'preact';
import { useState, useEffect, useRef, useMemo, useCallback } from 'preact/hooks';
import htm from 'htm';
import { t, language, upper, tracking, countryName } from './i18n.js';
import { paintPlaces, image, countryArtURL } from './placeart.js';

const html = htm.bind(h);
const GROUP_TITLE = { europe: 'Europe', asia: 'Asia', africa: 'Africa', 'north-america': 'North America', 'south-america': 'South America', oceania: 'Oceania' };
const Legend = ({ children, color, class: cls = '' }) =>
  html`<span class=${'legend ' + cls} style=${{ color, letterSpacing: tracking() }}>${upper(children)}</span>`;

// Web-only wording (the app turns pages by swiping only).
const WEB = {
  ja: { 'Previous page': '前のページ', 'Next page': '次のページ' },
  ko: { 'Previous page': '이전 페이지', 'Next page': '다음 페이지' },
  de: { 'Previous page': 'Vorherige Seite', 'Next page': 'Nächste Seite' },
  'pt-BR': { 'Previous page': 'Página anterior', 'Next page': 'Próxima página' },
  it: { 'Previous page': 'Pagina precedente', 'Next page': 'Pagina successiva' },
  fr: { 'Previous page': 'Page précédente', 'Next page': 'Page suivante' },
};
const tw = (key) => WEB[language()]?.[key] ?? key;

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** True while the atlas shows its dark appearance (app.js sets data-theme on <html>). */
export function useDark() {
  const read = () => {
    const theme = document.documentElement.dataset.theme;
    return theme ? theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  };
  const [dark, setDark] = useState(read);
  useEffect(() => {
    const observer = new MutationObserver(() => setDark(read()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);
  return dark;
}

// ---- dates ---------------------------------------------------------------------------------
const parseDate = (d) => { const [y, m] = String(d).split('-').map(Number); return { year: y, month: m || 0 }; };

/** VisitDate.text: "May 2024", or the year alone. */
export function visitDateText(d) {
  if (!d) return null;
  const { year, month } = parseDate(d);
  if (!(month >= 1 && month <= 12)) return String(year);
  return new Intl.DateTimeFormat(language(), { month: 'long', year: 'numeric' }).format(new Date(year, month - 1, 1));
}

/** Trip.dateText: the month and year, or a range of months. */
function tripDateText(trip) {
  const start = new Date(trip.start), end = trip.end ? new Date(trip.end) : null;
  const f = (o, d) => new Intl.DateTimeFormat(language(), o).format(d);
  if (!end || (start.getFullYear() === end.getFullYear() && start.getMonth() === end.getMonth())) return f({ month: 'long', year: 'numeric' }, start);
  if (start.getFullYear() === end.getFullYear()) return t('%@ – %@', f({ month: 'long' }, start), f({ month: 'long', year: 'numeric' }, end));
  return t('%@ – %@', f({ month: 'short', year: 'numeric' }, start), f({ month: 'short', year: 'numeric' }, end));
}

/** Visited places in passport order: dated first, oldest first, then undated by name. */
export function passportOrder(world, atlas, name = (id) => countryName(id, world.rows.get(id).name)) {
  const ids = Object.keys(atlas.visits).filter((id) => world.rows.has(id));
  const english = (id) => world.rows.get(id).name;
  return ids.sort((a, b) => {
    const da = atlas.visits[a]?.date, db = atlas.visits[b]?.date;
    if (da && db) {
      const x = parseDate(da), y = parseDate(db);
      if (x.year !== y.year) return x.year - y.year;
      if (x.month !== y.month) return x.month - y.month;
      return english(a) < english(b) ? -1 : english(a) > english(b) ? 1 : 0;
    }
    if (da) return -1;
    if (db) return 1;
    return name(a).localeCompare(name(b), language(), { numeric: true });
  });
}

// ---- the atlas as a picture (AtlasBackdrop) -------------------------------------------------
/** The rect of the map to show for a subject on a page of width × height (AtlasBackdrop.camera). */
export function backdropRect(world, subject, width, height, band = 1) {
  if (subject.closeUp) {
    const row = world.rows.get(subject.closeUp); if (!row) return null;
    const [x, y, w, h] = row.focus;
    const s = Math.max(width / w, height / h) * 1.04;
    return [x + w / 2 - width / 2 / s, y + h / 2 - height * 0.42 / s, width / s, height / s];
  }
  const ids = subject.places ?? [subject.place];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const id of ids) {
    let f = null;
    const p = world.places.get(id);
    if (p) {
      // The main piece of its art where there is one, so far islands don't shrink it.
      f = p.plates.find((plate) => plate.rings === p.rings)?.frame ?? p.row.focus;
    } else {
      const r = world.regions?.rows.get(id);
      if (r) f = r.focusFrame ?? r.bounds;
    }
    if (!f || !(f[2] > 0 && f[3] > 0)) continue;
    x0 = Math.min(x0, f[0]); y0 = Math.min(y0, f[1]); x1 = Math.max(x1, f[0] + f[2]); y1 = Math.max(y1, f[1] + f[3]);
  }
  if (!isFinite(x0)) return null;
  const pw = (x1 - x0) * 1.12, ph = (y1 - y0) * 1.12, mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
  const th = height * Math.min(1, Math.max(0.2, band));
  const s = Math.min(width / pw, th / ph);
  return [mx - width / 2 / s, my - th / 2 / s, width / s, height / s];
}

const DRIFT_ORIGINS = ['top left', 'top', 'top right', 'left', 'right', 'bottom left'];
const seedOf = (text, start = 7, mod = 9973) => [...text].reduce((v, ch) => (v * 31 + ch.codePointAt(0)) % mod, start);

/**
 * The atlas as a page's picture: a part of the map edge to edge with a paper wash over it.
 * subject: { place: id } | { places: [ids] } (fitted into the upper `band`) | { closeUp: id }.
 * inked: places drawn with their art (default: the subject's places); outlined: Want to go style.
 * wash: 'footer' (clear, then paper at the foot) | 'hero' (clear above, paper behind words below).
 * inks: false shows the art at once instead of inking it in from the top.
 */
export function Backdrop({ world, subject, inked, outlined, wash = 'footer', band = 1, inks = true, class: cls = '', children }) {
  const host = useRef(null), canvas = useRef(null);
  const [size, setSize] = useState(null);
  const [shown, setShown] = useState(false);
  const dark = useDark();
  const key = JSON.stringify(subject);
  const inkedKey = inked ? [...inked].sort().join() : '', outlinedKey = outlined ? [...outlined].sort().join() : '';
  useEffect(() => {
    const el = host.current;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) setSize((s) => (s && Math.abs(s.w - width) < 1 && Math.abs(s.h - height) < 1 ? s : { w: width, h: height }));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!size) return;
    let cancelled = false;
    const ratio = Math.min(2, devicePixelRatio || 1);
    const width = Math.round(size.w * ratio), height = Math.round(size.h * ratio);
    const rect = backdropRect(world, subject, size.w, size.h, band);
    if (!rect) return;
    const ids = subject.closeUp ? null : subject.places ?? [subject.place];
    // A close-up inks everything in view; otherwise only what's asked for.
    let ink = inked ? new Set(inked) : ids ? new Set(ids) : null;
    if (!ink) {
      ink = new Set();
      for (const [id, p] of world.places) {
        const b = p.row.bounds;
        if (b[0] < rect[0] + rect[2] && b[0] + b[2] > rect[0] && b[1] < rect[1] + rect[3] && b[1] + b[3] > rect[1]) ink.add(id);
      }
    }
    // Paint off screen, then swap in whole, so a resize never shows a half-drawn map.
    const off = document.createElement('canvas');
    off.width = width; off.height = height;
    paintPlaces(off.getContext('2d'), world, { rect, width, height, inked: ink, outlined: new Set(outlined ?? []), dark, mode: 'cover' })
      .then(() => {
        if (cancelled || !canvas.current) return;
        const c = canvas.current;
        c.width = width; c.height = height;
        c.getContext('2d').drawImage(off, 0, 0);
        setShown(true);
      })
      .catch((e) => console.warn('passport art', e));
    return () => { cancelled = true; };
  }, [size, dark, key, inkedKey, outlinedKey, band]);
  const origin = DRIFT_ORIGINS[seedOf(key) % DRIFT_ORIGINS.length];
  return html`<div class=${'bd ' + cls} ref=${host} aria-hidden="true">
    <div class=${'bd-art' + (shown ? ' shown' : '') + (inks ? '' : ' at-once')} style=${{ transformOrigin: origin }}><canvas ref=${canvas}></canvas></div>
    <div class=${'bd-wash ' + wash}></div>
    ${children}
  </div>`;
}

// ---- the entry stamp -----------------------------------------------------------------------
const STAMP_INK = {
  europe: ['rgb(140,46,51)', 'rgb(237,140,133)'],
  'north-america': ['rgb(41,69,128)', 'rgb(153,184,242)'],
  other: ['rgb(51,92,74)', 'rgb(163,209,179)'],
};
export const stampInk = (group, dark) => (STAMP_INK[group] ?? STAMP_INK.other)[dark ? 1 : 0];
/** Fixed per place, so each page looks hand-stamped but never changes. */
export const stampAngle = (seed) => ([...seed].reduce((v, ch) => (v * 31 + ch.codePointAt(0)) % 997, 0) % 17) - 8;

let measurer = null;
/** Shrinks a single line to fit (SwiftUI's lineLimit(1) with minimumScaleFactor). */
function fitSize(text, size, weight, width, letter, minScale, family = '-apple-system, BlinkMacSystemFont, system-ui, sans-serif') {
  measurer ??= document.createElement('canvas').getContext('2d');
  measurer.font = `${weight} ${size}px ${family}`;
  const w = measurer.measureText(text).width + letter * text.length;
  return w <= width ? size : Math.max(size * minScale, size * width / w);
}

// The messy border stamps' shapes, inks and words, as ShareCards draws them.
const MESSY_KINDS = ['box', 'round', 'oval', 'octagon', 'ticket'];
const MESSY_INKS = [[0.58, 0.16, 0.19], [0.15, 0.26, 0.52], [0.18, 0.38, 0.28], [0.38, 0.22, 0.50], [0.16, 0.17, 0.20], [0.10, 0.40, 0.45]];

/**
 * An inked entry stamp. Its colour follows the continent and its tilt is fixed per place. The
 * stamp words are border-stamp words, kept as they are in every language.
 * `messy`: a border stamp as it really lands (one of five shapes, six inks, a careless angle).
 */
export function EntryStamp({ name, date, group, seed, dark, scale = 1, messy = false, transparent = false }) {
  const dateText = date ? upper(visitDateText(date)) : t('UNDATED');
  const label = t('Entry stamp, %@, %@', name, date ? visitDateText(date) : t('undated'));
  const NAME = upper(name);
  if (messy) return html`<${MessyStamp} name=${NAME} dateText=${dateText} seed=${seed} dark=${dark} scale=${scale} label=${label} />`;
  const s = scale, ink = stampInk(group, dark);
  return html`<div class="pp-stamp" role="img" aria-label=${label}
      style=${{ '--stamp': ink, '--s': s, transform: `rotate(${stampAngle(seed)}deg)`, background: transparent ? 'transparent' : undefined }}>
    <span class="pp-stamp-word">ENTRY</span>
    <span class="pp-stamp-name" style=${{ fontSize: fitSize(NAME, 15 * s, 800, 112 * s, 1.2 * s, 0.6) + 'px' }}>${NAME}</span>
    <i class="pp-stamp-rule"></i>
    <span class="pp-stamp-date" style=${{ fontSize: fitSize(dateText, 10 * s, 700, 112 * s, 0, 0.7, 'ui-monospace, SFMono-Regular, Menlo, monospace') + 'px' }}>${dateText}</span>
  </div>`;
}

function MessyStamp({ name, dateText, seed, dark, scale: s, label }) {
  const hash = [...seed].reduce((v, ch) => (v * 131 + ch.codePointAt(0)) % 1000003, 17);
  const kind = MESSY_KINDS[hash % MESSY_KINDS.length];
  const angle = (Math.floor(hash / 5) % 37) - 18;
  const [r, g, b] = MESSY_INKS[Math.floor(hash / 191) % MESSY_INKS.length];
  const ink = dark ? `rgb(${(0.55 + r * 0.45) * 255},${(0.55 + g * 0.45) * 255},${(0.55 + b * 0.45) * 255})` : `rgb(${r * 255},${g * 255},${b * 255})`;
  const words = kind === 'ticket' ? ['ENTRY', 'ENTRADA', 'ARRIVAL', 'VISA'] : ['ENTRY', 'ADMITTED', 'ARRIVAL', 'ENTRADA', 'IMMIGRATION'];
  const word = words[Math.floor(hash / 7) % words.length];
  // Uneven ink: one side pressed harder than the other.
  const a = (hash % 360), fade = 0.5 + (hash % 20) / 100;
  const mask = `linear-gradient(${a + 90}deg, #000, rgba(0,0,0,${fade}))`;
  const mono = 'ui-monospace, SFMono-Regular, Menlo, monospace';
  const nameSize = (base, width, min = 0.5) => fitSize(name, base * s, 800, width * s, 0, min) + 'px';
  const dateSize = (base, width) => fitSize(dateText, base * s, 700, width * s, 0, 0.6, mono) + 'px';
  return html`<div class=${'pp-messy ' + kind} role="img" aria-label=${label}
      style=${{ '--stamp': ink, '--s': s, transform: `rotate(${angle}deg)`, opacity: dark ? 0.95 : 0.86, WebkitMaskImage: mask, maskImage: mask }}>
    ${kind === 'box' && html`<span class="w">${word}</span><span class="n" style=${{ fontSize: nameSize(15, 112, 0.55) }}>${name}</span><i></i><span class="d" style=${{ fontSize: dateSize(10, 112) }}>${dateText}</span>`}
    ${kind === 'round' && html`<svg class="plane" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 15.5v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V8.5l-8 5v2l8-2.5V18l-2 1.5V21l3.5-1 3.5 1v-1.5L13 18v-5z"/></svg>
      <span class="n" style=${{ fontSize: nameSize(13, 78) }}>${name}</span><span class="d" style=${{ fontSize: dateSize(8.5, 78) }}>${dateText}</span><span class="w">${word}</span>`}
    ${kind === 'oval' && html`<span class="w">${word}</span><span class="n" style=${{ fontSize: nameSize(14, 104) }}>${name}</span><span class="d" style=${{ fontSize: dateSize(9, 104) }}>${dateText}</span>`}
    ${kind === 'octagon' && html`<svg class="oct" viewBox="0 0 118 98" preserveAspectRatio="none" aria-hidden="true">
        <path d="M34 1h50l33 28v40l-33 28H34L1 69V29z" stroke-width="2.2"/><path d="M36 6h46l30 25.5v35L82 92H36L6 66.5v-35z" stroke-width="0.8"/></svg>
      <span class="n" style=${{ fontSize: nameSize(13, 84) }}>${name}</span><i></i><span class="d" style=${{ fontSize: dateSize(9, 84) }}>${dateText}</span><span class="w">${word}</span>`}
    ${kind === 'ticket' && html`<span class="w side">${word}</span><i class="v"></i>
      <span class="col"><span class="n" style=${{ fontSize: nameSize(14, 100) }}>${name}</span><span class="d" style=${{ fontSize: dateSize(9.5, 100) }}>${dateText}</span></span>`}
  </div>`;
}

/**
 * An entry stamp coming down onto the page (StampPress): held above it, large and tilted, it
 * drops, presses in a touch too far and settles, its ink going from soft to sharp.
 */
export function StampPress({ pressed, children, class: cls = '' }) {
  return html`<div class=${'pp-press ' + cls + (pressed ? ' pressed' : '')}>${children}</div>`;
}

// ---- the passport --------------------------------------------------------------------------
export function PassportSheet({ Sheet, world, atlas, name, startID, play, onShare, onClose }) {
  const nameOf = name ?? ((id) => countryName(id, world.rows.get(id)?.name ?? id));
  const pages = useMemo(() => passportOrder(world, atlas, nameOf), [atlas.visits, language()]);
  const [state, setState] = useState(() => ({ id: startID && pages.includes(startID) ? startID : pages[0] ?? null, leaving: null, dir: 0 }));
  const [stamped, setStamped] = useState(() => new Set());
  const current = state.id && pages.includes(state.id) ? state.id : pages[0] ?? null;
  const index = current ? pages.indexOf(current) : -1;

  const turn = useCallback((step) => {
    setState((s) => {
      const i = pages.indexOf(s.id);
      const next = pages[i + step];
      if (!next) return s;
      play?.('page');
      return { id: next, leaving: reducedMotion() ? null : s.id, dir: step };
    });
  }, [pages, play]);

  // The stamp comes down the first time each page is in front.
  useEffect(() => {
    if (!current || stamped.has(current)) return;
    if (reducedMotion()) { setStamped((s) => new Set(s).add(current)); return; }
    const timer = setTimeout(() => { setStamped((s) => new Set(s).add(current)); play?.('stamp'); }, 380);
    return () => clearTimeout(timer);
  }, [current]);

  // The pages either side decode their art ahead, so a turned-to page inks in at once.
  useEffect(() => {
    for (const id of [pages[index + 1], pages[index - 1], pages[index + 2]]) {
      for (const plate of world.places.get(id)?.plates ?? []) image(countryArtURL(plate.image)).catch(() => {});
    }
  }, [current]);

  // Arrow keys turn pages (caught before the map's own arrow-key panning).
  useEffect(() => {
    const key = (e) => {
      if (e.target.closest?.('input,textarea,select,[contenteditable]')) return;
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      if (document.querySelector('.sheet.pp-sheet') == null) return;
      e.preventDefault(); e.stopPropagation();
      turn(e.key === 'ArrowRight' ? 1 : -1);
    };
    addEventListener('keydown', key, true);
    return () => removeEventListener('keydown', key, true);
  }, [turn]);

  const dark = useDark();
  // The page turning away stays mounted (its art already drawn) until it has hinged off.
  const layers = state.leaving && state.leaving !== current && pages.includes(state.leaving) ? [state.leaving, current] : [current];
  if (!pages.length) {
    return html`<${Sheet} title=${t('Passport')} onClose=${onClose} class="pp-sheet pp-empty-sheet">
      <${Backdrop} world=${world} subject=${{ closeUp: 'GR' }} wash="hero" class="pp-empty">
        <div class="pp-prompt">
          <h3>${t('Your passport is empty')}</h3>
          <p>${t('Every place you mark as visited gets its own page here, stamped on the day you mark it.')}</p>
        </div>
      <//>
    <//>`;
  }
  return html`<${Sheet} title=${t('Passport')} onClose=${onClose} class="pp-sheet">
    ${onShare && html`<button class="glass round pp-share" onClick=${() => onShare(current)} aria-label=${t('Share this page')} title=${t('Share this page')}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V3.5M8 7.5l4-4 4 4M7 11H6a1.5 1.5 0 0 0-1.5 1.5v7A1.5 1.5 0 0 0 6 21h12a1.5 1.5 0 0 0 1.5-1.5v-7A1.5 1.5 0 0 0 18 11h-1"/></svg></button>`}
    <div class="pp-pages" aria-roledescription="carousel">
      ${layers.map((id) => html`<${Page} key=${id} leaving=${id !== current} dir=${state.leaving ? state.dir : 0}
          world=${world} atlas=${atlas} id=${id} name=${nameOf} number=${pages.indexOf(id) + 1} of=${pages.length}
          stamped=${stamped.has(id)} dark=${dark} onTurn=${turn}
          onGone=${() => setState((s) => (s.leaving === id ? { ...s, leaving: null } : s))} />`)}
    </div>
    <button class="glass round pp-turn prev" onClick=${() => turn(-1)} disabled=${index <= 0} aria-label=${tw('Previous page')} title=${tw('Previous page')}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 7-5 5 5 5"/></svg></button>
    <button class="glass round pp-turn next" onClick=${() => turn(1)} disabled=${index >= pages.length - 1} aria-label=${tw('Next page')} title=${tw('Next page')}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m10 7 5 5-5 5"/></svg></button>
  <//>`;
}

function Page({ world, atlas, id, name, number, of, stamped, dark, dir, leaving, onGone, onTurn }) {
  const row = world.rows.get(id);
  const date = atlas.visits[id]?.date;
  const trips = (atlas.trips ?? []).filter((trip) => trip.places?.includes(id)).sort((a, b) => String(a.start).localeCompare(String(b.start)));
  const scroller = useRef(null), art = useRef(null), page = useRef(null), drag = useRef(null);
  // A page turned to arrives already inked (the turn is its motion); the first page inks in.
  const turnedTo = useRef(dir !== 0).current;
  // A page turning away is removed once it has hinged off (or soon after, should no animation run).
  useEffect(() => { if (!leaving) return; const timer = setTimeout(() => onGone?.(), 800); return () => clearTimeout(timer); }, [leaving]);

  // The art drifts slower than the words as they scroll up.
  const onScroll = () => {
    if (reducedMotion() || !art.current) return;
    const y = scroller.current.scrollTop;
    art.current.style.transform = y > 0 ? `translateY(${y * 0.35}px)` : '';
  };

  // A sideways swipe follows the finger, hinged on the spine, and turns the page past a third.
  const down = (e) => {
    if (leaving || e.button > 0 || e.target.closest('button,a')) return;
    drag.current = { x: e.clientX, y: e.clientY, t: performance.now(), active: false, id: e.pointerId };
  };
  const move = (e) => {
    const d = drag.current; if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (!d.active) {
      if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { drag.current = null; return; }
      if (Math.abs(dx) < 10) return;
      d.active = true; page.current.setPointerCapture?.(e.pointerId);
    }
    d.dx = dx;
    const w = page.current.offsetWidth || 1, p = Math.max(-1, Math.min(1, dx / w));
    if (!reducedMotion()) {
      page.current.style.transition = 'none';
      page.current.style.transformOrigin = p < 0 ? 'right center' : 'left center';
      page.current.style.transform = `perspective(1400px) translateX(${dx}px) rotateY(${-p * 22}deg) scale(${1 - Math.abs(p) * 0.04})`;
      page.current.style.filter = `brightness(${1 - Math.abs(p) * 0.12})`;
    }
  };
  const up = () => {
    const d = drag.current; drag.current = null;
    if (!d?.active) return;
    const w = page.current.offsetWidth || 1, speed = Math.abs(d.dx) / Math.max(1, performance.now() - d.t);
    const el = page.current;
    el.style.transition = 'transform .32s cubic-bezier(.2,.8,.2,1), filter .32s';
    el.style.transform = ''; el.style.filter = '';
    if (Math.abs(d.dx) > w / 3 || (Math.abs(d.dx) > 40 && speed > 0.5)) onTurn?.(d.dx < 0 ? 1 : -1);
  };

  const cls = 'pp-page' + (leaving ? ' leaving' : '') + (dir > 0 ? ' forward' : dir < 0 ? ' back' : '');
  return html`<article class=${cls} ref=${page} aria-label=${name(id)} aria-hidden=${leaving ? 'true' : undefined}
      onPointerDown=${down} onPointerMove=${move} onPointerUp=${up} onPointerCancel=${up}
      onAnimationEnd=${(e) => { if (leaving && e.target === e.currentTarget) onGone?.(); }}>
    <div class="pp-scroll" ref=${scroller} onScroll=${onScroll}>
      <div class="pp-head">
        <div class="pp-art" ref=${art}>
          <${Backdrop} world=${world} subject=${{ place: id }} inked=${[id]} wash="footer" band=${0.88} inks=${!turnedTo} />
        </div>
        <div class="pp-stamp-spot">
          <${StampPress} pressed=${stamped}>
            <${EntryStamp} name=${countryName(id, row.short)} date=${date} group=${row.group} seed=${id} dark=${dark} />
          <//>
        </div>
      </div>
      <div class="pp-words">
        <div class="pp-line">
          <${Legend}>${row.kind === 'territory' ? t('Territory') : t(GROUP_TITLE[row.group])}<//>
          <span class="pp-number">${t('No. %@ of %lld', String(number).padStart(2, '0'), of)}</span>
        </div>
        <h3 class="pp-name">${name(id)}</h3>
        <p class="pp-date">${date ? t('First visited %@', visitDateText(date)) : t('Date not recorded')}</p>
        ${trips.length > 0 && html`<section class="pp-trips">
          <${Legend}>${t('Trips')}<//>
          ${trips.map((trip) => html`<div class="pp-trip">
            <div class="pp-trip-line"><span class="pp-trip-name">${trip.name || t('Trip')}</span><span class="pp-trip-date">${tripDateText(trip)}</span></div>
            ${trip.note && html`<p class="pp-trip-note">${trip.note}</p>`}
          </div>`)}
        </section>`}
      </div>
    </div>
  </article>`;
}
