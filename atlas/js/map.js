// The map element: renderer + label layer + camera + gestures + hit testing.

import { AtlasRenderer } from './renderer.js';
import { contains, boundsOf } from './inlr.js';

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

/** The largest ring of a ringset: its bounds and area-weighted centre. */
function mainland(rings) {
  let best = null, bestArea = 0;
  for (const ring of rings) {
    let a = 0, cx = 0, cy = 0;
    const n = ring.length / 2;
    for (let i = 0, k = n - 1; i < n; k = i++) {
      const x0 = ring[2 * k], y0 = ring[2 * k + 1], x1 = ring[2 * i], y1 = ring[2 * i + 1];
      const cross = x0 * y1 - x1 * y0;
      a += cross; cx += (x0 + x1) * cross; cy += (y0 + y1) * cross;
    }
    if (Math.abs(a) > bestArea) { bestArea = Math.abs(a); best = { ring, centre: [cx / (3 * a), cy / (3 * a)] }; }
  }
  if (!best) return { bounds: [0, 0, 0, 0], centre: [0, 0] };
  return { bounds: boundsOf([best.ring]), centre: best.centre };
}

export class AtlasMap {
  /**
   * @param host    element the map fills
   * @param world   { frame, places: Map(id -> {rings, plates, row}), land }
   * @param options { artURL, label(id) -> display name, onSelect(id|null), insets() -> {top,bottom,left,right} }
   */
  constructor(host, world, options) {
    this.host = host; this.world = world; this.options = options;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'map-gl';
    this.labels = document.createElement('canvas');
    this.labels.className = 'map-labels';
    this.labels.setAttribute('aria-hidden', 'true');
    host.append(this.canvas, this.labels);
    this.renderer = new AtlasRenderer(this.canvas, world, options.artURL);
    this.renderer.onDraw = () => this.drawLabels();
    this.ctx = this.labels.getContext('2d');
    this.view = { x: world.frame[2] / 2, y: world.frame[3] / 2, scale: 0.02 };
    this.anim = null;
    this.state = { visited: new Set(), wanted: new Set(), selected: null, dark: false };
    // Labels sit on each place's largest landmass: its area-weighted centre, sized to its own
    // bounds, so the US label isn't pulled into the Pacific by Hawaii, nor Fiji by the date line.
    for (const p of world.places.values()) p.mainland = mainland(p.rings);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    this.resize();
    this.bindGestures();
  }

  get minScale() {
    // Pinching out stops at the whole world, with a little sea round it.
    const [w, h] = this.size, f = this.world.frame;
    return Math.min(w / f[2], h / f[3]) * 0.92;
  }

  resize() {
    const r = this.host.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 3);
    this.size = [Math.max(1, r.width), Math.max(1, r.height)];
    this.renderer.resize(this.size[0], this.size[1], dpr);
    this.labels.width = Math.round(this.size[0] * dpr); this.labels.height = Math.round(this.size[1] * dpr);
    this.labels.style.width = this.size[0] + 'px'; this.labels.style.height = this.size[1] + 'px';
    this.dpr = dpr;
    if (!this.framed) { this.frameWorld(false); this.framed = true; }
    this.apply();
  }

  set(state) {
    Object.assign(this.state, state);
    this.renderer.set({ visited: this.state.visited, wanted: this.state.wanted, selected: this.state.selected, dark: this.state.dark });
  }

  stamp(id, lift) { if (!reduceMotion.matches) this.renderer.stamp(id, lift); else this.renderer.requestDraw(); }

  // ---- camera ---------------------------------------------------------------------------------
  /** The band of the window the map frames places in: clear of the title and the panel. */
  band() {
    const inset = this.options.insets?.() ?? { top: 0, bottom: 0, left: 0, right: 0 };
    const [w, h] = this.size;
    return { x: inset.left, y: inset.top, w: Math.max(80, w - inset.left - inset.right), h: Math.max(80, h - inset.top - inset.bottom) };
  }

  /** The view that shows `rect` (map units) inside the band, padded. */
  viewFor(rect, pad = 0.12) {
    const b = this.band(), [w, h] = this.size;
    const [x, y, rw, rh] = rect;
    const scale = Math.min(b.w / (rw * (1 + pad * 2)), b.h / (rh * (1 + pad * 2)), 6);
    // Centre of the band in window coordinates, relative to the window centre.
    const dx = b.x + b.w / 2 - w / 2, dy = b.y + b.h / 2 - h / 2;
    return { x: x + rw / 2 - dx / scale, y: y + rh / 2 - dy / scale, scale: Math.max(scale, this.minScale) };
  }

  /** World: the inhabited world (poles left off) fills the band between the wordmark and the
   *  panel. In a tall window that's a slice about a third of the way across, centred on home,
   *  and it pans sideways; pinching out still shows the whole world (DESIGN.md, 2026-11-23). */
  frameWorld(animated = true) {
    const f = this.world.frame, b = this.band(), [w, h] = this.size;
    const top = f[1] + f[3] * 0.06, height = f[3] * 0.74;
    const fitHeight = b.h / height, fitWidth = b.w / f[2];
    const scale = Math.max(fitHeight, fitWidth);
    const home = this.options.home?.();
    const homeX = home ? this.world.places.get(home)?.mainland.centre[0] : null;
    const x = scale > fitWidth * 1.05 ? (homeX ?? f[0] + f[2] * 0.53) : f[0] + f[2] / 2;
    const dy = b.y + b.h / 2 - h / 2;
    this.go({ x, y: top + height / 2 - dy / scale, scale }, animated);
  }

  frame(rect, animated = true) { this.go(this.viewFor(rect), animated); }

  go(target, animated = true) {
    // Take the shortest way round the seam.
    const W = this.world.frame[2];
    while (target.x - this.view.x > W / 2) target.x -= W;
    while (this.view.x - target.x > W / 2) target.x += W;
    if (!animated || reduceMotion.matches) { this.anim = null; this.view = { ...target }; this.apply(); return; }
    const from = { ...this.view }, start = performance.now(), duration = 650;
    // Zoom out and in along the way, on a log scale, so long flights don't blur past.
    const fromLog = Math.log(from.scale), toLog = Math.log(target.scale);
    const dist = Math.hypot(target.x - from.x, target.y - from.y) * Math.min(from.scale, target.scale);
    const dip = Math.min(1.2, dist / Math.max(this.size[0], this.size[1]) * 0.6);
    this.anim = (now) => {
      const t = Math.min(1, (now - start) / duration), e = t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;
      const log = fromLog + (toLog - fromLog) * e - dip * Math.sin(Math.PI * e);
      this.view = { x: from.x + (target.x - from.x) * e, y: from.y + (target.y - from.y) * e, scale: Math.exp(log) };
      this.apply();
      return t < 1;
    };
    const step = (now) => { if (this.anim && this.anim(now)) requestAnimationFrame(step); else this.anim = null; };
    requestAnimationFrame(step);
  }

  apply() {
    const W = this.world.frame[2], f = this.world.frame;
    const v = this.view;
    v.scale = Math.min(Math.max(v.scale, this.minScale), 60);
    // Wrap once zoomed in past the whole world; otherwise keep the world in view.
    if (v.scale * W > this.size[0] * 1.02) {
      if (v.x < f[0]) v.x += W; else if (v.x > f[0] + W) v.x -= W;
    } else v.x = f[0] + W / 2;
    const halfH = this.size[1] / 2 / v.scale;
    if (f[3] > halfH * 2) v.y = Math.min(Math.max(v.y, f[1] + halfH * 0.4), f[1] + f[3] - halfH * 0.4);
    else v.y = f[1] + f[3] / 2;
    this.renderer.setView(v);
    this.options.onView?.(v);
  }

  toWorld(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect(), v = this.view;
    return [v.x + (clientX - r.left - this.size[0] / 2) / v.scale, v.y + (clientY - r.top - this.size[1] / 2) / v.scale];
  }

  zoomAt(clientX, clientY, factor) {
    const [wx, wy] = this.toWorld(clientX, clientY);
    const v = this.view, next = Math.min(Math.max(v.scale * factor, this.minScale), 60);
    v.x = wx - (wx - v.x) * (v.scale / next); v.y = wy - (wy - v.y) * (v.scale / next); v.scale = next;
    this.anim = null; this.apply();
  }

  // ---- hit testing ----------------------------------------------------------------------------
  placeAt(clientX, clientY) {
    let [x, y] = this.toWorld(clientX, clientY);
    const f = this.world.frame, W = f[2];
    x = ((x - f[0]) % W + W) % W + f[0];
    let best = null, bestArea = Infinity;
    for (const [id, p] of this.world.places) {
      const [bx, by, bw, bh] = p.entry.bounds;
      if (x < bx || x > bx + bw || y < by || y > by + bh) continue;
      // Territories sit inside or beside their parent; the smaller hit wins.
      if (contains(p.rings, x, y) && bw * bh < bestArea) { best = id; bestArea = bw * bh; }
    }
    if (best) return best;
    // Small islands: a few pixels' slack around the nearest outline.
    const slack = 10 / this.view.scale;
    for (const [id, p] of this.world.places) {
      const [bx, by, bw, bh] = p.entry.bounds;
      if (bw * this.view.scale > 24 && bh * this.view.scale > 24) continue;
      if (x > bx - slack && x < bx + bw + slack && y > by - slack && y < by + bh + slack) return id;
    }
    return null;
  }

  // ---- gestures -------------------------------------------------------------------------------
  bindGestures() {
    const el = this.labels.parentElement;
    const pointers = new Map();
    let last = null, moved = 0, pinch = null, velocity = [0, 0], lastTime = 0, glide = null;
    el.addEventListener('pointerdown', (e) => {
      if (e.target !== this.labels && e.target !== this.canvas) return;
      el.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, [e.clientX, e.clientY]);
      this.anim = null; glide = null;
      moved = 0; last = [e.clientX, e.clientY]; velocity = [0, 0]; lastTime = performance.now();
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), c: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] };
      }
    });
    el.addEventListener('pointermove', (e) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, [e.clientX, e.clientY]);
      if (pointers.size === 2 && pinch) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a[0] - b[0], a[1] - b[1]), c = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        this.view.x -= (c[0] - pinch.c[0]) / this.view.scale; this.view.y -= (c[1] - pinch.c[1]) / this.view.scale;
        this.zoomAt(c[0], c[1], d / pinch.d);
        pinch = { d, c }; moved += 10;
        return;
      }
      const dx = e.clientX - last[0], dy = e.clientY - last[1];
      moved += Math.abs(dx) + Math.abs(dy);
      const now = performance.now(), dt = Math.max(1, now - lastTime);
      velocity = [dx / dt, dy / dt]; lastTime = now;
      this.view.x -= dx / this.view.scale; this.view.y -= dy / this.view.scale;
      last = [e.clientX, e.clientY];
      this.apply();
    });
    const end = (e) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.delete(e.pointerId);
      if (pointers.size === 1) { last = [...pointers.values()][0]; pinch = null; return; }
      if (pointers.size > 0) return;
      pinch = null;
      if (moved < 6 && e.type === 'pointerup') {
        const id = this.placeAt(e.clientX, e.clientY);
        this.options.onSelect?.(id);
        return;
      }
      // Glide on after a flick.
      if (!reduceMotion.matches && performance.now() - lastTime < 60 && Math.hypot(...velocity) > 0.2) {
        let [vx, vy] = velocity, t0 = performance.now();
        glide = (now) => {
          const dt = now - t0; t0 = now;
          vx *= 0.93 ** (dt / 16); vy *= 0.93 ** (dt / 16);
          this.view.x -= vx * dt / this.view.scale; this.view.y -= vy * dt / this.view.scale; this.apply();
          return Math.hypot(vx, vy) > 0.01;
        };
        const step = (now) => { if (glide && glide(now)) requestAnimationFrame(step); };
        requestAnimationFrame(step);
      }
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (e.ctrlKey) this.zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.012)); // trackpad pinch
      else if (Math.abs(e.deltaX) > 0 && !e.deltaMode) { this.view.x += e.deltaX / this.view.scale; this.view.y += e.deltaY / this.view.scale; this.apply(); }
      else this.zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * (e.deltaMode ? 0.05 : 0.0022)));
    }, { passive: false });
    // Safari trackpad pinch.
    let gestureScale = 1;
    el.addEventListener('gesturestart', (e) => { e.preventDefault(); gestureScale = 1; });
    el.addEventListener('gesturechange', (e) => { e.preventDefault(); this.zoomAt(e.clientX, e.clientY, e.scale / gestureScale); gestureScale = e.scale; });
    el.addEventListener('dblclick', (e) => this.zoomAt(e.clientX, e.clientY, e.altKey ? 0.5 : 2));
  }

  key(e) {
    const step = 80 / this.view.scale, [w, h] = this.size, r = this.canvas.getBoundingClientRect();
    const cx = r.left + w / 2, cy = r.top + h / 2;
    switch (e.key) {
      case 'ArrowLeft': this.view.x -= step; break;
      case 'ArrowRight': this.view.x += step; break;
      case 'ArrowUp': this.view.y -= step; break;
      case 'ArrowDown': this.view.y += step; break;
      case '+': case '=': this.zoomAt(cx, cy, 1.5); return true;
      case '-': case '_': this.zoomAt(cx, cy, 1 / 1.5); return true;
      default: return false;
    }
    this.anim = null; this.apply(); return true;
  }

  // ---- labels ---------------------------------------------------------------------------------
  /** Country names in tracked small caps where a place can hold its name, largest first, never
   *  over inked art or each other; zoomed in, the art's own city labels take over. */
  drawLabels() {
    const ctx = this.ctx, dpr = this.dpr, [w, h] = this.size, v = this.view, s = this.state;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const W = this.world.frame[2];
    const toScreen = (x, y, shift) => [(x + shift - v.x) * v.scale + w / 2, (y - v.y) * v.scale + h / 2];
    const shifts = this.renderer.visibleShifts();
    const placed = [];
    const free = (box) => !placed.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1]);
    const dark = s.dark;
    const rows = [...this.world.places.values()].sort((a, b) => b.entry.bounds[2] * b.entry.bounds[3] - a.entry.bounds[2] * a.entry.bounds[3]);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    // Cities on visited places once there's room.
    for (const p of rows) {
      if (!s.visited.has(p.row.id) || !p.row.labels?.length) continue;
      const [bx, by, bw, bh] = p.entry.bounds;
      if (bw * v.scale < 260) continue;
      for (const shift of shifts) {
        if (!this.renderer.onScreen(p.entry.bounds, shift)) continue;
        for (const [name, x, y] of p.row.labels) {
          const [sx, sy] = toScreen(x, y, shift);
          if (sx < -40 || sx > w + 40 || sy < -20 || sy > h + 20) continue;
          const text = this.options.cityLabel?.(name) ?? name;
          ctx.font = '500 11px -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", system-ui, sans-serif';
          const tw = ctx.measureText(text).width + 14, box = [sx - tw / 2, sy - 10, sx + tw / 2, sy + 10];
          if (!free(box)) continue;
          placed.push(box);
          ctx.fillStyle = dark ? 'rgba(26,34,32,0.78)' : 'rgba(255,253,248,0.86)';
          ctx.beginPath(); ctx.roundRect(box[0], box[1], tw, 20, 6); ctx.fill();
          ctx.fillStyle = dark ? '#EFE8D8' : '#1F2B27';
          ctx.fillText(text, sx, sy + 0.5);
        }
      }
    }
    // Country names on paper.
    ctx.font = '600 10px -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", system-ui, sans-serif';
    ctx.letterSpacing = this.options.tracking?.() ?? '1.6px';
    for (const p of rows) {
      const id = p.row.id;
      if (s.visited.has(id)) continue;
      const { bounds: [, , bw, bh], centre: anchor } = p.mainland;
      const text = this.options.label(id);
      const tw = ctx.measureText(text).width;
      if (bw * v.scale < tw * 1.15 + 12 || bh * v.scale < 18) continue;
      for (const shift of shifts) {
        const [sx, sy] = toScreen(anchor[0], anchor[1], shift);
        if (sx < -tw || sx > w + tw || sy < -12 || sy > h + 12) continue;
        const box = [sx - tw / 2 - 4, sy - 8, sx + tw / 2 + 4, sy + 8];
        if (!free(box)) continue;
        placed.push(box);
        ctx.fillStyle = dark ? 'rgba(239,232,216,0.62)' : 'rgba(31,43,39,0.55)';
        ctx.fillText(text, sx, sy);
      }
    }
    ctx.letterSpacing = '0px';
  }
}
