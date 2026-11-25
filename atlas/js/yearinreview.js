// The year in review, ported from the app's YearInReview.swift: a short portrait video (1080 × 1920,
// 30 fps) of a year's new places inking onto the paper atlas one by one, each with its date and
// name, the count in the corner, then a closing card ("8 PLACES IN 2024", "Made with Inlay").
// The app's video is silent (its writer has a video input only), so this one is too.
//
//   import { YearInReviewSheet } from './yearinreview.js';   // and link css/yearinreview.css
//   html`<${YearInReviewSheet} Sheet=${Sheet} world=${world} atlas=${atlas} name=${name}
//          visited=${visited} onClose=${close} />`
//
// The sheet: the app's year chooser (AtlasChoiceRow capsules, years with dated visits newest first,
// then All time), the review played once on a canvas in the sheet and settling on its last frame
// (the last frame at once under Reduce Motion), and Save video. Saving draws the video frame by
// frame into a MediaRecorder (canvas.captureStream(0) + requestFrame, MP4/H.264 where the browser
// records it, WebM otherwise) while the sheet shows the app's rendering state: the year's places
// inking onto the paper map as far as the render has got, "Drawing your year" and the percentage.
// Then the finished video plays in the sheet with Share video (Web Share API with the file) and
// Download video.
//
// Pure pieces, for tests and harnesses:
//   reviewYears(world, atlas, visited)            years with dated visits, newest first
//   reviewPlan(world, atlas, visited, year, name) the app's Plan (year null: all time) or null
//   frameCount(plan), frameAt(plan, n)            the timeline, frame by frame
//   new Keyframes(world, plan)                    the map at each step (1000 px squares)
//   drawReviewFrame(ctx, plan, n, keyframes)      one frame onto a 1080 × 1920 context
//   recordReview(world, plan, { onProgress, signal }) → { blob, type, file }
//   videoType()                                   the MediaRecorder type this browser will use

import { h } from 'preact';
import { useState, useEffect, useRef, useMemo } from 'preact/hooks';
import htm from 'htm';
import { t, language, upper, tracking, countryName } from './i18n.js';
import { paintPlaces, image, countryArtURL } from './placeart.js';
import { backdropRect, useDark } from './passport.js';

const html = htm.bind(h);

// ---- the app's constants -------------------------------------------------------------------------
export const SIZE = { width: 1080, height: 1920 };
export const FPS = 30;
const HOLD = 0.55, FADE = 0.35, INTRO = 1.2, OUTRO = 2.2;
const MAP_SIDE = 1000;
const MAP_RECT = [40, 420, MAP_SIDE, MAP_SIDE];
const COLOUR = { paper: '#FBF8F1', ink: '#1F2B27', pencil: '#6B746F', sage: '#335C4A' };
const SYSTEM = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Helvetica Neue", system-ui, sans-serif';
const ROUNDED = 'ui-rounded, "SF Pro Rounded", -apple-system, BlinkMacSystemFont, system-ui, sans-serif';
const BITRATE = 8_000_000;

// Web-only wording: the app hands its video to the share sheet; here it's saved first.
const WEB = {
  'Save video': { ja: 'ビデオを保存', ko: '동영상 저장', de: 'Video sichern', 'pt-BR': 'Salvar vídeo', it: 'Salva video', fr: 'Enregistrer la vidéo' },
  'Download video': { ja: 'ビデオをダウンロード', ko: '동영상 다운로드', de: 'Video herunterladen', 'pt-BR': 'Baixar vídeo', it: 'Scarica video', fr: 'Télécharger la vidéo' },
  'Play again': { ja: 'もう一度再生', ko: '다시 재생', de: 'Erneut abspielen', 'pt-BR': 'Reproduzir de novo', it: 'Riproduci di nuovo', fr: 'Lire à nouveau' },
  'This browser can’t record video. Try a recent Safari, Chrome or Edge.': {
    ja: 'このブラウザではビデオを記録できません。最新の Safari、Chrome、Edge でお試しください。',
    ko: '이 브라우저에서는 동영상을 기록할 수 없습니다. 최신 Safari, Chrome 또는 Edge에서 시도해 보세요.',
    de: 'Dieser Browser kann kein Video aufnehmen. Versuch es mit einem aktuellen Safari, Chrome oder Edge.',
    'pt-BR': 'Este navegador não grava vídeo. Tente um Safari, Chrome ou Edge recente.',
    it: 'Questo browser non può registrare video. Prova con una versione recente di Safari, Chrome o Edge.',
    fr: 'Ce navigateur ne peut pas enregistrer de vidéo. Essayez une version récente de Safari, Chrome ou Edge.',
  },
};
const tw = (key) => WEB[key]?.[language()] ?? key;

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---- the plan (YearInReview.plan) ----------------------------------------------------------------
const parseDate = (d) => {
  if (!d) return null;
  const [y, m] = String(d).split('-').map(Number);
  return Number.isInteger(y) ? { year: y, month: m >= 1 && m <= 12 ? m : null } : null;
};
const before = (a, b) => (a.year !== b.year ? a.year < b.year : (a.month ?? 0) < (b.month ?? 0));
const same = (a, b) => a.year === b.year && (a.month ?? 0) === (b.month ?? 0);
/** VisitDate.text: "May 2024", or the year alone. */
const dateText = (d) => (d.month
  ? new Intl.DateTimeFormat(language(), { month: 'long', year: 'numeric' }).format(new Date(d.year, d.month - 1, 1))
  : String(d.year));

function datesOf(world, atlas, visited) {
  const out = new Map();
  for (const [id, v] of Object.entries(atlas.visits ?? {})) {
    if (!visited.has(id) || !world.rows.has(id)) continue;
    const d = parseDate(v?.date);
    if (d) out.set(id, d);
  }
  return out;
}

/** Years with at least one dated visit, newest first. */
export function reviewYears(world, atlas, visited) {
  return [...new Set([...datesOf(world, atlas, visited).values()].map((d) => d.year))].sort((a, b) => b - a);
}

/**
 * The year's places in the order they were first visited (undated ones last, by name, for All time),
 * the earlier years' places already inked underneath, and a square of the map that holds them.
 */
export function reviewPlan(world, atlas, visited, year, name = (id) => countryName(id, world.rows.get(id).name)) {
  const dates = datesOf(world, atlas, visited);
  const english = (id) => world.rows.get(id).name;
  const chosen = [...visited].filter((id) => world.rows.has(id) && world.places.has(id))
    .filter((id) => year == null || dates.get(id)?.year === year)
    .sort((x, y) => {
      const a = dates.get(x), b = dates.get(y);
      if (a && b) return same(a, b) ? (english(x) < english(y) ? -1 : english(x) > english(y) ? 1 : 0) : before(a, b) ? -1 : 1;
      if (a) return -1;
      if (b) return 1;
      return english(x) < english(y) ? -1 : english(x) > english(y) ? 1 : 0;
    });
  if (!chosen.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const id of chosen) {
    const [x, y, w, h] = world.rows.get(id).focus;
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + w); y1 = Math.max(y1, y + h);
  }
  // A square map with breathing room; never tighter than a small region.
  const side = Math.max(x1 - x0, y1 - y0, 900) * 1.35;
  const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
  const frame = [mx - side / 2, my - side / 2, side, side];
  const stops = chosen.map((id) => ({ id, name: name(id), caption: dates.has(id) ? dateText(dates.get(id)) : '' }));
  const picked = new Set(chosen);
  const base = year == null ? [] : [...visited].filter((id) => !picked.has(id) && world.places.has(id) && (dates.get(id)?.year ?? Infinity) < year);
  // The year as plain digits, not a grouped number ("2,026").
  const totalLine = year != null ? t('%lld places in %@', chosen.length, String(year)) : t('%lld places in your atlas', chosen.length);
  return { year, title: year != null ? String(year) : t('My atlas'), stops, baseVisited: base, frame, totalLine };
}

// ---- the timeline -------------------------------------------------------------------------------
const frames = (seconds) => Math.max(1, Math.round(seconds * FPS));
/** Total length in seconds, as the app computes it. */
export const reviewDuration = (plan) => INTRO + plan.stops.length * (HOLD + FADE) + OUTRO;
export const frameCount = (plan) => frames(INTRO) + plan.stops.length * (frames(FADE) + frames(HOLD)) + frames(OUTRO);

/**
 * What frame n shows: keyframe `from` (and `to` mixed over it by `mix`), the stop being captioned,
 * the count in the corner, and whether it's the closing card.
 */
export function frameAt(plan, n) {
  const intro = frames(INTRO), fade = frames(FADE), hold = frames(HOLD), step = fade + hold;
  const last = plan.stops.length;
  if (n < intro) return { from: 0, to: null, mix: 0, stop: null, count: 0, outro: false };
  const k = n - intro;
  const index = Math.floor(k / step);
  if (index < last) {
    const f = k % step, stop = plan.stops[index];
    if (f < fade) {
      const u = (f + 1) / fade;
      return { from: index, to: index + 1, mix: u * u * (3 - 2 * u), stop, count: index + 1, outro: false };
    }
    return { from: index + 1, to: null, mix: 0, stop, count: index + 1, outro: false };
  }
  return { from: last, to: null, mix: 0, stop: null, count: last, outro: true };
}

// ---- keyframes: the map at each step -------------------------------------------------------------
const makeCanvas = (w, h) => {
  if (typeof OffscreenCanvas === 'function' && typeof document === 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
};

/** The map after each step, cumulative, drawn as the app's renderer draws it in light. Keeps a few. */
export class Keyframes {
  constructor(world, plan, { keep = 4, side = MAP_SIDE } = {}) {
    this.world = world; this.plan = plan; this.keep = keep; this.side = Math.round(side);
    this.made = new Map(); // index -> Promise<canvas>
    this.ready = new Map(); // index -> canvas
  }
  get count() { return this.plan.stops.length + 1; }
  /**
   * The map with the base places and the first `i` stops inked. The first is painted whole; each
   * after it is the one before with its new place painted on (only that place's art and border),
   * since painting the whole map takes far longer than painting one country.
   */
  get(i) {
    i = Math.max(0, Math.min(this.count - 1, i));
    if (!this.made.has(i)) {
      const side = this.side, rect = this.plan.frame;
      const previous = i > 0 ? this.get(i - 1) : null;
      const work = (async () => {
        const canvas = makeCanvas(side, side);
        const ctx = canvas.getContext('2d');
        if (!previous) {
          await paintPlaces(ctx, this.world, { rect, width: side, height: side, inked: new Set(this.plan.baseVisited), dark: false, mode: 'cover' });
        } else {
          ctx.drawImage(await previous, 0, 0);
          const id = this.plan.stops[i - 1].id, place = this.world.places.get(id);
          // The same painter, given a world of one place: its art, its hairline, then its ink edge.
          if (place) await paintPlaces(ctx, { places: new Map([[id, place]]), land: null }, {
            rect, width: side, height: side, inked: new Set([id]), dark: false, mode: 'cover', sea: false, paperAll: false });
        }
        if (this.made.get(i) === work) this.ready.set(i, canvas);
        return canvas;
      })();
      this.made.set(i, work);
      work.catch(() => this.made.delete(i));
    }
    return this.made.get(i);
  }
  /** Decodes every piece of art the review will ink, so later maps paint without waiting. */
  warm() {
    const ids = [...this.plan.baseVisited, ...this.plan.stops.map((s) => s.id)];
    const files = new Set(ids.flatMap((id) => this.world.places.get(id)?.plates.map((p) => p.image) ?? []));
    return Promise.all([...files].map((file) => image(countryArtURL(file)).catch(() => null)));
  }
  /** Ready now, or null. */
  now(i) { return this.ready.get(i) ?? null; }
  /** Forgets keyframes well behind `i`, so a long atlas doesn't hold hundreds of maps. */
  trim(i) {
    for (const k of [...this.made.keys()]) {
      if (k < i - 1 || k > i + this.keep) {
        const c = this.ready.get(k);
        if (c) { c.width = 0; c.height = 0; }
        this.made.delete(k); this.ready.delete(k);
      }
    }
  }
  /** Starts the keyframes frame n needs, and the next few. */
  prefetch(desc) {
    const want = [desc.from, desc.to ?? desc.from, desc.from + 1, desc.from + 2].filter((k) => k >= 0 && k < this.count);
    return Promise.all([...new Set(want)].map((k) => this.get(k)));
  }
  need(desc) { return [desc.from, desc.to].filter((k) => k != null); }
  has(desc) { return this.need(desc).every((k) => this.ready.has(k)); }
  /** The frame's maps and the next few are all painted already. */
  ahead(desc) { return [desc.from, desc.to ?? desc.from, desc.from + 1, desc.from + 2].filter((k) => k < this.count).every((k) => this.ready.has(k)); }
}

// ---- one frame (YearInReview.Card) ---------------------------------------------------------------
const hasSpacing = (ctx) => 'letterSpacing' in ctx;

/** NSAttributedString.draw(at:): the point is the top left of the line; kern after each character. */
function text(ctx, string, { size, weight, color, rounded = false, kern = 0, x, y, right = null, maxWidth = null }) {
  ctx.font = `${weight} ${size}px ${rounded ? ROUNDED : SYSTEM}`;
  ctx.fillStyle = color;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  const spaced = hasSpacing(ctx);
  if (spaced) ctx.letterSpacing = `${kern}px`;
  const chars = [...string];
  const measure = () => (spaced ? ctx.measureText(string).width : ctx.measureText(string).width + kern * chars.length);
  let width = measure();
  if (maxWidth && width > maxWidth) {
    // A name too long for the card shrinks to fit rather than running off it.
    const fitted = size * maxWidth / width;
    ctx.font = `${weight} ${fitted}px ${rounded ? ROUNDED : SYSTEM}`;
    if (spaced) ctx.letterSpacing = `${kern * fitted / size}px`;
    kern *= fitted / size; width = measure();
  }
  const m = ctx.measureText('Hg');
  const ascent = m.fontBoundingBoxAscent ?? size * 0.952;
  const left = right != null ? right - width : x;
  if (spaced || !kern) ctx.fillText(string, left, y + ascent);
  else {
    let cx = left;
    for (const ch of chars) { ctx.fillText(ch, cx, y + ascent); cx += ctx.measureText(ch).width + kern; }
  }
  if (spaced) ctx.letterSpacing = '0px';
  return width;
}

function roundedRect(ctx, [x, y, w, h], r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Frame n of the plan onto a 1080 × 1920 context. The keyframes it needs must be ready. */
export function drawReviewFrame(ctx, plan, n, keyframes) {
  const d = typeof n === 'number' ? frameAt(plan, n) : n;
  const { width, height } = SIZE;
  ctx.save();
  ctx.fillStyle = COLOUR.paper;
  ctx.fillRect(0, 0, width, height);
  text(ctx, 'INLAY', { size: 30, weight: 800, color: COLOUR.ink, kern: 9, x: 80, y: 150 });
  text(ctx, plan.title, { size: 120, weight: 700, color: COLOUR.ink, kern: -3, x: 72, y: 210, maxWidth: 760 });
  ctx.save();
  roundedRect(ctx, MAP_RECT, 36);
  ctx.clip();
  const [mx, my, mw, mh] = MAP_RECT;
  const from = keyframes.now(d.from);
  if (from) ctx.drawImage(from, mx, my, mw, mh);
  else { ctx.fillStyle = '#D8E3E3'; ctx.fillRect(mx, my, mw, mh); }
  const to = d.to != null ? keyframes.now(d.to) : null;
  if (to) { ctx.globalAlpha = d.mix; ctx.drawImage(to, mx, my, mw, mh); ctx.globalAlpha = 1; }
  ctx.restore();
  const below = my + mh + 70;
  const wide = width - 160;
  if (d.outro) {
    text(ctx, upper(plan.totalLine), { size: 30, weight: 600, color: COLOUR.sage, kern: 4, x: 80, y: below, maxWidth: wide });
    text(ctx, t('Made with Inlay'), { size: 56, weight: 700, color: COLOUR.ink, kern: -1, x: 80, y: below + 54, maxWidth: wide });
  } else if (d.stop) {
    text(ctx, upper(d.stop.caption), { size: 30, weight: 600, color: COLOUR.pencil, kern: 4, x: 80, y: below, maxWidth: wide });
    text(ctx, d.stop.name, { size: 76, weight: 700, color: COLOUR.ink, kern: -1.5, x: 76, y: below + 46, maxWidth: wide + 4 });
  } else {
    text(ctx, t('A YEAR ON THE MAP'), { size: 30, weight: 600, color: COLOUR.pencil, kern: 4, x: 80, y: below, maxWidth: wide });
  }
  text(ctx, String(d.count), { size: 64, weight: 600, color: COLOUR.sage, rounded: true, right: width - 80, y: 236 });
  ctx.restore();
}

// ---- recording -----------------------------------------------------------------------------------
const TYPES = [
  'video/mp4;codecs=avc1.640028', 'video/mp4;codecs=avc1.4d0028', 'video/mp4;codecs=avc1.42E028', 'video/mp4;codecs=avc1',
  'video/mp4;codecs=h264', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm',
];
/** MP4 with H.264 where the browser records it, WebM otherwise; null when it can't record. */
export function videoType() {
  if (typeof MediaRecorder !== 'function' || typeof HTMLCanvasElement === 'undefined' || !HTMLCanvasElement.prototype.captureStream) return null;
  return TYPES.find((type) => { try { return MediaRecorder.isTypeSupported(type); } catch { return false; } }) ?? null;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
const waitVisible = () => new Promise((resolve) => {
  if (!document.hidden) return resolve();
  const on = () => { if (!document.hidden) { document.removeEventListener('visibilitychange', on); resolve(); } };
  document.addEventListener('visibilitychange', on);
});

/**
 * Draws the plan frame by frame into a MediaRecorder and returns the file. Each frame is pushed
 * with requestFrame() and held for 1/30 s; when the next map isn't painted yet or the page is
 * hidden, the recorder pauses so the waiting never shows in the video.
 */
export async function recordReview(world, plan, { onProgress = () => {}, signal } = {}) {
  const type = videoType();
  if (!type) throw Object.assign(new Error('MediaRecorder unavailable'), { code: 'unsupported' });
  const canvas = makeCanvas(SIZE.width, SIZE.height);
  const ctx = canvas.getContext('2d');
  const stream = canvas.captureStream(0);
  const [track] = stream.getVideoTracks();
  const keyframes = new Keyframes(world, plan);
  const total = frameCount(plan);
  const chunks = [];
  let recorder;
  try {
    // The year's art and the first maps before the clock starts.
    await keyframes.warm();
    await keyframes.prefetch(frameAt(plan, 0));
    drawReviewFrame(ctx, plan, 0, keyframes);
    recorder = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: BITRATE });
    recorder.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
    const stopped = new Promise((resolve, reject) => {
      recorder.onstop = resolve;
      recorder.onerror = (e) => reject(e.error ?? new Error('MediaRecorder error'));
    });
    recorder.start(1000);
    const interval = 1000 / FPS;
    let clock = performance.now();
    for (let n = 0; n < total; n++) {
      if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
      const desc = frameAt(plan, n);
      if (!keyframes.ahead(desc) || document.hidden) {
        // Hold the recording still while the next maps are painted (or the page is away).
        if (recorder.state === 'recording') recorder.pause();
        const paused = performance.now();
        await Promise.all([keyframes.prefetch(desc), waitVisible()]);
        if (recorder.state === 'paused') recorder.resume();
        clock += performance.now() - paused;
      }
      drawReviewFrame(ctx, plan, desc, keyframes);
      keyframes.trim(desc.from);
      track.requestFrame?.() ?? stream.requestFrame?.();
      if (n % 3 === 0 || n === total - 1) onProgress((n + 1) / total);
      clock += interval;
      await sleep(clock - performance.now());
    }
    recorder.requestData?.();
    recorder.stop();
    await stopped;
  } finally {
    if (recorder && recorder.state !== 'inactive') try { recorder.stop(); } catch { /* already stopping */ }
    track.stop();
    for (const k of [...keyframes.ready.keys()]) { const c = keyframes.ready.get(k); c.width = 0; c.height = 0; }
  }
  if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
  const mime = type.split(';')[0];
  const blob = new Blob(chunks, { type: mime });
  if (!blob.size) throw new Error('Empty recording');
  const ext = mime === 'video/mp4' ? 'mp4' : 'webm';
  return { blob, type: mime, file: `Inlay ${plan.title}.${ext}` };
}

// ---- the sheet ----------------------------------------------------------------------------------
const Legend = ({ children }) => html`<span class="legend" style=${{ letterSpacing: tracking() }}>${upper(children)}</span>`;
const SHARE_ICON = html`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5v11M8 7.5l4-4 4 4"/><path d="M7.5 10.5H6a1.5 1.5 0 0 0-1.5 1.5v7A1.5 1.5 0 0 0 6 20.5h12a1.5 1.5 0 0 0 1.5-1.5v-7a1.5 1.5 0 0 0-1.5-1.5h-1.5"/></svg>`;
const DOWNLOAD_ICON = html`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5v12M8 11.5l4 4 4-4M5 20.5h14"/></svg>`;
const FILM_ICON = html`<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="14" rx="2"/><path d="M7.5 5v14M16.5 5v14M3.5 9.5h4M3.5 14.5h4M16.5 9.5h4M16.5 14.5h4"/></svg>`;

/** AtlasChoiceRow: one choice among several, capsules in a row that scrolls sideways. */
function ChoiceRow({ label, options, value, onChange }) {
  const row = useRef(null);
  useEffect(() => {
    const el = row.current?.querySelector('[aria-checked="true"]');
    if (!el || !row.current) return;
    const box = row.current;
    const left = el.offsetLeft - (box.clientWidth - el.offsetWidth) / 2;
    box.scrollTo({ left: Math.max(0, left), behavior: reducedMotion() ? 'auto' : 'smooth' });
  }, [value]);
  return html`<div class="yir-choices" role="radiogroup" aria-label=${label} ref=${row}>
    ${options.map(([v, title]) => html`<button role="radio" aria-checked=${v === value ? 'true' : 'false'}
      class=${'yir-choice' + (v === value ? ' on' : '')} onClick=${() => onChange(v)}>${title}</button>`)}
  </div>`;
}

/** The review played once on the canvas, settling on its last frame (at once under Reduce Motion). */
function Player({ world, plan, run, onEnd }) {
  const canvas = useRef(null);
  useEffect(() => {
    const c = canvas.current; if (!c || !plan) return;
    // Drawn at the size it's shown (the saved video is always full size).
    const shown0 = c.getBoundingClientRect().width * Math.min(2, devicePixelRatio || 1);
    const scale = Math.max(0.4, Math.min(1, shown0 / SIZE.width || 0.5));
    c.width = Math.round(SIZE.width * scale); c.height = Math.round(SIZE.height * scale);
    const ctx = c.getContext('2d');
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    const keyframes = new Keyframes(world, plan, { side: MAP_SIDE * scale });
    const total = frameCount(plan);
    let alive = true, raf = 0, shown = -1, last = null, clock = 0;
    const still = reducedMotion();
    const show = (n) => {
      const desc = frameAt(plan, n);
      keyframes.prefetch(desc);
      if (!keyframes.has(desc)) return false;
      drawReviewFrame(ctx, plan, desc, keyframes);
      keyframes.trim(desc.from);
      shown = n;
      return true;
    };
    if (still) {
      const end = frameAt(plan, total - 1);
      keyframes.prefetch(end).then(() => { if (alive) { show(total - 1); onEnd?.(); } }).catch(() => {});
      return () => { alive = false; };
    }
    // The clock only runs while the frame it needs is painted, so a slow map holds rather than skips.
    const tick = (now) => {
      if (!alive) return;
      // A hidden tab or a long paint never jumps the review ahead.
      const dt = last == null ? 0 : Math.min(100, now - last);
      last = now;
      const target = Math.min(total - 1, Math.floor(clock * FPS / 1000));
      if (target === shown || show(target)) clock += dt;
      if (shown >= total - 1) { onEnd?.(); return; }
      raf = requestAnimationFrame(tick);
    };
    // The opening frame first, then the art for the whole year, then the clock starts.
    keyframes.get(0).then(() => { if (alive) show(0); return keyframes.warm(); })
      .then(() => keyframes.prefetch(frameAt(plan, frames(INTRO))))
      .then(() => { if (alive) raf = requestAnimationFrame(tick); }).catch(() => {});
    return () => { alive = false; cancelAnimationFrame(raf); };
  }, [plan, run]);
  const label = plan ? `${plan.title}. ${plan.stops.map((s) => s.name).join(', ')}. ${plan.totalLine}` : '';
  return html`<canvas class="yir-canvas" ref=${canvas} role="img" aria-label=${label}></canvas>`;
}

/** While the video renders, that year's places ink onto the paper map as far as the render has got. */
function Drawing({ world, places, progress, onPainted }) {
  const host = useRef(null), paper = useRef(null), inked = useRef(null);
  const [size, setSize] = useState(null);
  const dark = useDark();
  const key = places.join();
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
    if (!size || !places.length) return;
    let cancelled = false;
    const ratio = Math.min(2, devicePixelRatio || 1);
    const width = Math.round(size.w * ratio), height = Math.round(size.h * ratio);
    const rect = backdropRect(world, { places }, size.w, size.h, 0.8);
    if (!rect) return;
    const paint = (target, ink) => {
      const off = document.createElement('canvas'); off.width = width; off.height = height;
      return paintPlaces(off.getContext('2d'), world, { rect, width, height, inked: ink, dark, mode: 'cover' }).then(() => {
        if (cancelled || !target.current) return;
        target.current.width = width; target.current.height = height;
        target.current.getContext('2d').drawImage(off, 0, 0);
      });
    };
    paint(paper, new Set()).then(() => paint(inked, new Set(places))).catch((e) => console.warn('year in review art', e))
      .finally(() => { if (!cancelled) onPainted?.(); });
    return () => { cancelled = true; };
  }, [size, dark, key]);
  const percent = new Intl.NumberFormat(language(), { style: 'percent', maximumFractionDigits: 0 }).format(progress);
  return html`<div class="yir-drawing" ref=${host} role="progressbar" aria-label=${t('Drawing your year')}
      aria-valuemin="0" aria-valuemax="100" aria-valuenow=${Math.round(progress * 100)} aria-valuetext=${percent}>
    <canvas class="yir-paper" ref=${paper} aria-hidden="true"></canvas>
    <canvas class="yir-ink" ref=${inked} aria-hidden="true" style=${{ '--reveal': `${progress * 125}%` }}></canvas>
    <div class="yir-wash" aria-hidden="true"></div>
    <div class="yir-progress">
      <${Legend}>${t('Drawing your year')}<//>
      <b class="yir-percent">${percent}</b>
      <span class="yir-scale"><i style=${{ width: progress > 0 ? `max(3px, ${progress * 100}%)` : '0' }}></i></span>
    </div>
  </div>`;
}

/** Picks a year, plays the review, records the video and hands it to Share or Download. */
export function YearInReviewSheet({ Sheet, world, atlas, name, visited, onClose }) {
  const years = useMemo(() => reviewYears(world, atlas, visited), [world, atlas, visited]);
  const [year, setYear] = useState(() => years[0] ?? null);
  const [run, setRun] = useState(0);
  const [ended, setEnded] = useState(false);
  // idle | drawing | done | failed
  const [render, setRender] = useState({ state: 'idle', progress: 0, video: null, unsupported: false });
  const job = useRef(null), painted = useRef(null);
  const plan = useMemo(() => reviewPlan(world, atlas, visited, year, name), [world, atlas, visited, year, name, language()]);
  const places = useMemo(() => (plan ? plan.stops.map((s) => s.id).sort() : []), [plan]);
  const canShare = useMemo(() => {
    const type = videoType()?.split(';')[0] ?? 'video/mp4';
    try { return !!navigator.canShare?.({ files: [new File([new Blob()], 'review.' + (type === 'video/mp4' ? 'mp4' : 'webm'), { type })] }); } catch { return false; }
  }, []);

  useEffect(() => { if (year != null && !years.includes(year)) setYear(years[0] ?? null); }, [years]);
  // A new choice starts over: the review plays again and any saved video is put away.
  useEffect(() => {
    job.current?.abort();
    setEnded(false);
    setRender((r) => { if (r.video) URL.revokeObjectURL(r.video.url); return { state: 'idle', progress: 0, video: null, unsupported: false }; });
  }, [plan]);
  useEffect(() => () => { job.current?.abort(); }, []);
  useEffect(() => () => { if (render.video) URL.revokeObjectURL(render.video.url); }, [render.video]);

  const save = async () => {
    if (!plan) return;
    if (!videoType()) { setRender({ state: 'failed', progress: 0, video: null, unsupported: true }); return; }
    job.current?.abort();
    const controller = new AbortController();
    job.current = controller;
    // The rendering page paints its map first, so that work never lands between video frames.
    const backdrop = new Promise((resolve) => { painted.current = resolve; });
    setRender({ state: 'drawing', progress: 0, video: null, unsupported: false });
    await Promise.race([backdrop, sleep(5000)]);
    if (job.current !== controller || controller.signal.aborted) return;
    let lastProgress = performance.now();
    // Rendering that stops reporting progress for 30 seconds is given up, as in the app.
    const watchdog = setInterval(() => {
      if (performance.now() - lastProgress >= 30000) { controller.abort(); clearInterval(watchdog); setRender({ state: 'failed', progress: 0, video: null, unsupported: false }); }
    }, 2000);
    try {
      const made = await recordReview(world, plan, {
        signal: controller.signal,
        onProgress: (p) => {
          if (job.current !== controller) return;
          lastProgress = performance.now();
          setRender((r) => (r.state === 'drawing' && p > r.progress ? { ...r, progress: p } : r));
        },
      });
      if (job.current !== controller || controller.signal.aborted) return;
      setRender({ state: 'done', progress: 1, video: { ...made, url: URL.createObjectURL(made.blob) }, unsupported: false });
    } catch (e) {
      if (e?.name === 'AbortError' || job.current !== controller) return;
      console.error('year in review', e);
      setRender({ state: 'failed', progress: 0, video: null, unsupported: e?.code === 'unsupported' });
    } finally {
      clearInterval(watchdog);
    }
  };

  const share = async (download) => {
    const video = render.video; if (!video) return;
    const file = new File([video.blob], video.file, { type: video.type });
    if (!download && canShare) {
      try { await navigator.share({ files: [file], title: plan?.title ?? t('Year in review') }); return; }
      catch (e) { if (e?.name === 'AbortError') return; }
    }
    const a = Object.assign(document.createElement('a'), { href: video.url, download: video.file });
    document.body.append(a); a.click(); a.remove();
  };

  // A long-kept atlas has more years than a segmented control can name.
  const options = [...years.map((y) => [y, String(y)]), [null, t('All time')]];
  const failed = !plan || render.state === 'failed';
  let stage;
  if (failed) {
    stage = html`<div class="yir-failed">
      ${FILM_ICON}
      <h3>${t('Couldn’t make the video')}</h3>
      <p>${render.unsupported ? tw('This browser can’t record video. Try a recent Safari, Chrome or Edge.') : t('Rendering stopped or took too long. Your places and selected year are kept.')}</p>
      ${plan && !render.unsupported && html`<button class="outline" onClick=${save}>${t('Try again')}</button>`}
    </div>`;
  } else if (render.state === 'drawing') {
    stage = html`<${Drawing} world=${world} places=${places} progress=${render.progress} onPainted=${() => painted.current?.()} />`;
  } else if (render.state === 'done') {
    stage = html`<video class="yir-video" src=${render.video.url} autoplay muted playsinline controls
      aria-label=${plan.title}></video>`;
  } else {
    stage = html`<${Player} world=${world} plan=${plan} run=${run} onEnd=${() => setEnded(true)} />`;
  }

  return html`<${Sheet} title=${t('Year in review')} onClose=${onClose} class="yir">
    <${ChoiceRow} label=${t('Year')} options=${options} value=${year} onChange=${setYear} />
    <div class="yir-stage">${stage}</div>
    <div class="yir-actions" aria-live="polite">
      ${plan && render.state === 'idle' && html`
        <button class="ink" onClick=${save}>${DOWNLOAD_ICON}${tw('Save video')}</button>
        ${ended && !reducedMotion() && html`<button class="outline" onClick=${() => { setEnded(false); setRun((n) => n + 1); }}>${tw('Play again')}</button>`}`}
      ${render.state === 'done' && canShare && html`
        <button class="ink" onClick=${() => share(false)}>${SHARE_ICON}${t('Share video')}</button>
        <button class="outline" onClick=${() => share(true)}>${DOWNLOAD_ICON}${tw('Download video')}</button>`}
      ${render.state === 'done' && !canShare && html`<button class="ink" onClick=${() => share(true)}>${DOWNLOAD_ICON}${tw('Download video')}</button>`}
    </div>
  <//>`;
}
