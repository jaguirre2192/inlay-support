// The atlas map in WebGL2, after the app's Metal renderer (docs/metal-renderer-spec.md):
// even-odd stencil-and-cover fills of the true outlines, paper art masked by its country (and
// by each plate's own clip), hairline borders, a stamp reveal in the fragment shader, and
// three copies of the world side by side so panning wraps round the Pacific seam.

import { boundsOf } from './inlr.js';

export const PALETTE = {
  light: { sea: 0xD8E3E3, land: 0xFCFCF9, edge: 0xB4C4C4, wantFill: 0xE1EDE4, wantEdge: 0x335C4A,
           visitedPaper: 0xEEE3C9, ink: 0x253B39, select: 0x1F2B27 },
  dark: { sea: 0x1D2C31, land: 0x34494C, edge: 0x607D81, wantFill: 0x426457, wantEdge: 0xA3D1B3,
          visitedPaper: 0xEEE3C9, ink: 0xF4EBD6, select: 0xEFE8D8 },
};
const rgb = (hex, a = 1) => [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255, a];

const SOLID_VS = `#version 300 es
in vec2 p; uniform vec3 view; uniform vec2 size; uniform float shift;
void main(){ vec2 s=(p+vec2(shift,0.)-view.xy)*view.z; gl_Position=vec4(s.x*2./size.x,-s.y*2./size.y,0.,1.); }`;
const SOLID_FS = `#version 300 es
precision mediump float; uniform vec4 color; out vec4 o; void main(){ o=vec4(color.rgb*color.a,color.a); }`;

// Art: a quad over the plate frame, sampling the crop. The reveal spreads from `centre` as a
// soft, slightly wavering disc (radius in map units); `opacity` lifts it off when unmarking.
const ART_VS = `#version 300 es
in vec2 p; uniform vec3 view; uniform vec2 size; uniform float shift; uniform vec4 frame; uniform vec4 crop;
out vec2 uv; out vec2 world;
void main(){ vec2 w=frame.xy+p*frame.zw; world=w; uv=crop.xy+p*crop.zw;
  vec2 s=(w+vec2(shift,0.)-view.xy)*view.z; gl_Position=vec4(s.x*2./size.x,-s.y*2./size.y,0.,1.); }`;
const ART_FS = `#version 300 es
precision highp float; in vec2 uv; in vec2 world; uniform sampler2D art; uniform float opacity;
uniform vec3 reveal; uniform float edge; out vec4 o;
float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
void main(){ vec4 c=texture(art,uv);
  float a=opacity;
  if(reveal.z>0.){ vec2 d=world-reveal.xy; float ang=atan(d.y,d.x);
    float wobble=1.+.06*sin(ang*7.+reveal.z*.01)+.04*sin(ang*13.-reveal.z*.02);
    float r=length(d)/wobble; a*=1.-smoothstep(reveal.z-edge,reveal.z,r); }
  o=vec4(c.rgb*c.a*a,c.a*a); }`;

function compile(gl, vs, fs) {
  const program = gl.createProgram();
  for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    gl.attachShader(program, s);
  }
  gl.bindAttribLocation(program, 0, 'p');
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
  const u = {}; for (let i = 0, n = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS); i < n; i++) {
    const name = gl.getActiveUniform(program, i).name; u[name] = gl.getUniformLocation(program, name);
  }
  return { program, u };
}

/** Packs ringsets into one buffer: fan triangles for stencil fills and segment pairs for edges. */
class GeometryBank {
  constructor(gl) { this.gl = gl; this.fans = []; this.lines = []; this.entries = new Map(); this.dirty = true; }
  add(key, rings) {
    if (this.entries.has(key)) return this.entries.get(key);
    const fanStart = this.fans.length / 2, lineStart = this.lines.length / 2;
    for (const ring of rings) {
      const n = ring.length / 2;
      for (let i = 1; i < n - 1; i++) this.fans.push(ring[0], ring[1], ring[2 * i], ring[2 * i + 1], ring[2 * i + 2], ring[2 * i + 3]);
      for (let i = 0; i < n; i++) { const k = (i + 1) % n; this.lines.push(ring[2 * i], ring[2 * i + 1], ring[2 * k], ring[2 * k + 1]); }
    }
    const entry = { fan: [fanStart, this.fans.length / 2 - fanStart], line: [lineStart, this.lines.length / 2 - lineStart], bounds: boundsOf(rings) };
    this.entries.set(key, entry); this.dirty = true;
    return entry;
  }
  upload() {
    if (!this.dirty) return;
    const gl = this.gl;
    for (const [name, data] of [['fanBuffer', this.fans], ['lineBuffer', this.lines]]) {
      if (!this[name]) this[name] = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this[name]);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
    }
    this.dirty = false;
  }
}

/** Decoded art on the GPU, least recently used first out. */
class Textures {
  constructor(gl, onReady, limit = 160) {
    this.gl = gl; this.onReady = onReady; this.limit = limit; this.map = new Map(); this.loading = new Set();
    this.aniso = gl.getExtension('EXT_texture_filter_anisotropic');
  }
  get(url) {
    const t = this.map.get(url);
    if (t) { this.map.delete(url); this.map.set(url, t); return t; }
    if (!this.loading.has(url)) this.load(url);
    return null;
  }
  async load(url) {
    this.loading.add(url);
    try {
      const blob = await (await fetch(url, { cache: 'force-cache' })).blob();
      const bitmap = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'default' });
      const gl = this.gl, tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      if (this.aniso) gl.texParameterf(gl.TEXTURE_2D, this.aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(this.aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
      bitmap.close?.();
      this.map.set(url, { tex, born: performance.now() });
      while (this.map.size > this.limit) { const [k, v] = this.map.entries().next().value; gl.deleteTexture(v.tex); this.map.delete(k); }
      this.onReady();
    } catch (e) {
      console.warn('Art unavailable', url, e);
    } finally { this.loading.delete(url); }
  }
}

export class AtlasRenderer {
  /**
   * @param canvas a <canvas>; sized by the caller through resize().
   * @param world  { frame, places: Map(id -> {rings, plates}), land }
   * @param artURL (image) -> url of a country or region plate
   */
  constructor(canvas, world, artURL) {
    const gl = canvas.getContext('webgl2', { stencil: true, antialias: true, premultipliedAlpha: true, alpha: false });
    if (!gl) throw new Error('WebGL2 unavailable');
    this.gl = gl; this.canvas = canvas; this.world = world; this.artURL = artURL;
    this.solid = compile(gl, SOLID_VS, SOLID_FS);
    this.artProgram = compile(gl, ART_VS, ART_FS);
    this.bank = new GeometryBank(gl);
    this.textures = new Textures(gl, () => this.requestDraw());
    this.quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    this.cover = gl.createBuffer();
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    gl.enableVertexAttribArray(0);
    this.landEntry = this.bank.add('land', world.land);
    for (const [id, place] of world.places) {
      place.entry = this.bank.add(id, place.rings);
      for (const plate of place.plates) plate.entry = plate.rings === place.rings ? place.entry : this.bank.add(plate, plate.rings);
    }
    this.state = { visited: new Set(), wanted: new Set(), selected: null, dark: false, reveals: new Map(),
                   region: null, wholeCountries: false };
    /** Regional detail per country, once its file is read (addRegions). */
    this.regional = new Map();
    this.view = { x: 0, y: 0, scale: 0.02 };
    this.size = [1, 1]; this.dpr = 1;
    this.pending = false;
  }

  resize(width, height, dpr) {
    this.dpr = dpr; this.size = [width, height];
    this.canvas.width = Math.round(width * dpr); this.canvas.height = Math.round(height * dpr);
    this.requestDraw();
  }

  set(state) { Object.assign(this.state, state); this.requestDraw(); }

  /**
   * A country's regions, from its regions-xx.inlr: { foundation, regions: Map(id -> {rings,
   * layers, overlays}) } plus `rows` (id -> {focusFrame, markable}) from regions.json.
   */
  addRegions(countryID, detail, rows, urlFor) {
    for (const layer of detail.foundation) { layer.entry = this.bank.add(layer, layer.rings); layer.url = urlFor(layer.image); }
    for (const [id, region] of detail.regions) {
      region.id = id;
      region.entry = this.bank.add(region, region.rings);
      region.row = rows.get(id);
      for (const layer of [...region.layers, ...region.overlays]) { layer.entry = this.bank.add(layer, layer.rings); layer.url = urlFor(layer.image); }
    }
    this.regional.set(countryID, detail);
    this.requestDraw();
  }

  /** How far a visited country has handed over to its regions' art (RegionalProgress in the app):
   *  every region together, so small ones never sit blank beside large ones. */
  regionalProgress(place) {
    const [w, h] = this.size, f = place.row.focus;
    const fit = Math.min(w / (f[2] + 180), h / (f[3] + 180));
    const linear = Math.min(1, Math.max(0, (this.view.scale - fit * 1.3) / (fit * 1.1)));
    return linear * linear * (3 - 2 * linear);
  }

  /** Italy's own curve: each region comes up as the map closes in on it (detailProgress). */
  italyProgress(place, region) {
    const [w, h] = this.size, f = place.row.focus, rf = region.row?.focusFrame ?? region.entry.bounds;
    const start = Math.min(w / (f[2] + 180), h / (f[3] + 180)) * 1.6;
    const full = Math.max(start * 1.2, Math.min(w / (rf[2] + 50), h / (rf[3] + 50)) * 0.88);
    const linear = Math.min(1, Math.max(0, (this.view.scale - start) / (full - start)));
    return linear * linear * (3 - 2 * linear);
  }
  setView(view) { this.view = view; this.requestDraw(); }

  /** Starts the stamp (or lift) for a place: the art spreads from its centre over `duration`. */
  stamp(id, lift = false, duration = 900) {
    const place = this.world.places.get(id); if (!place) return;
    const [x, y, w, h] = place.entry.bounds;
    this.state.reveals.set(id, { start: performance.now(), duration: lift ? 420 : duration, lift,
                                 centre: [x + w / 2, y + h / 2], radius: Math.hypot(w, h) / 2 * 1.08 });
    this.requestDraw();
  }

  requestDraw() {
    if (this.pending) return;
    this.pending = true;
    requestAnimationFrame(() => { this.pending = false; this.draw(); });
  }

  // ---- drawing --------------------------------------------------------------------------------
  uniforms(prog, shift) {
    const gl = this.gl, v = this.view, [w, h] = this.size;
    // view: top-left world point of the window and pixels per unit, in CSS pixels.
    gl.uniform3f(prog.u.view, v.x - w / 2 / v.scale, v.y - h / 2 / v.scale, v.scale);
    gl.uniform2f(prog.u.size, w, h);
    gl.uniform1f(prog.u.shift, shift);
    // The clip transform maps to [-1,1] from the window's centre, so offset by half the window.
    gl.uniform2f(prog.u.size, w, h);
  }

  useSolid(shift) {
    const gl = this.gl; gl.useProgram(this.solid.program);
    const v = this.view, [w, h] = this.size;
    gl.uniform3f(this.solid.u.view, v.x, v.y, v.scale);
    gl.uniform2f(this.solid.u.size, w, h);
    gl.uniform1f(this.solid.u.shift, shift);
  }

  /** Writes an outline's even-odd interior into the stencil bits in `mask`. */
  stencilFill(entry, mask) {
    const gl = this.gl;
    gl.colorMask(false, false, false, false);
    gl.stencilMask(mask);
    gl.stencilFunc(gl.ALWAYS, 0, 0xff);
    gl.stencilOp(gl.KEEP, gl.KEEP, gl.INVERT);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bank.fanBuffer);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, entry.fan[0], entry.fan[1]);
    gl.colorMask(true, true, true, true);
  }

  /** Fills `bounds` where the stencil equals `ref` under `mask`, clearing those bits as it goes. */
  coverRect(bounds, color, mask, ref = mask, clear = true) {
    const gl = this.gl, [x, y, w, h] = bounds;
    gl.uniform4fv(this.solid.u.color, color);
    gl.stencilMask(clear ? mask : 0);
    gl.stencilFunc(gl.EQUAL, ref, mask);
    gl.stencilOp(gl.KEEP, gl.KEEP, clear ? gl.ZERO : gl.KEEP);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.cover);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([x, y, x + w, y, x, y + h, x + w, y + h]), gl.STREAM_DRAW);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  clearStencil(bounds, mask) { this.coverRect(bounds, [0, 0, 0, 0], mask, 0, true); this.coverRect(bounds, [0, 0, 0, 0], mask, mask, true); }

  fill(entry, color) {
    this.stencilFill(entry, 0x80);
    this.coverRect(entry.bounds, color, 0x80);
  }

  edges(entry, color) {
    const gl = this.gl;
    gl.uniform4fv(this.solid.u.color, color);
    gl.stencilFunc(gl.ALWAYS, 0, 0xff); gl.stencilMask(0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bank.lineBuffer);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.LINES, entry.line[0], entry.line[1]);
  }

  visibleShifts() {
    const W = this.world.frame[2], v = this.view, half = this.size[0] / 2 / v.scale;
    const shifts = [0];
    if (v.x - half < this.world.frame[0]) shifts.push(-W);
    if (v.x + half > this.world.frame[0] + W) shifts.push(W);
    return shifts;
  }

  onScreen(bounds, shift) {
    const v = this.view, hw = this.size[0] / 2 / v.scale, hh = this.size[1] / 2 / v.scale;
    const [x, y, w, h] = bounds;
    return x + shift < v.x + hw && x + w + shift > v.x - hw && y < v.y + hh && y + h > v.y - hh;
  }

  draw() {
    const gl = this.gl, s = this.state, pal = s.dark ? PALETTE.dark : PALETTE.light;
    this.bank.upload();
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    const sea = rgb(pal.sea);
    gl.clearColor(sea[0], sea[1], sea[2], 1);
    gl.clearStencil(0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
    gl.enable(gl.STENCIL_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindVertexArray(this.vao);
    const now = performance.now();
    let animating = false;

    for (const shift of this.visibleShifts()) {
      this.useSolid(shift);
      // Land, then Want to go washes.
      this.fill(this.landEntry, rgb(pal.land));
      for (const id of s.wanted) {
        const p = this.world.places.get(id);
        if (p && !s.visited.has(id) && this.onScreen(p.entry.bounds, shift)) this.fill(p.entry, rgb(pal.wantFill));
      }
      // Visited places: paper, then each plate inside the outline and its own clip.
      const inked = [];
      for (const [id, p] of this.world.places) {
        const reveal = s.reveals.get(id);
        const showing = s.visited.has(id) || (reveal && reveal.lift);
        if (!showing || !this.onScreen(p.entry.bounds, shift)) continue;
        let t = 1, opacity = 1, radius = 0;
        if (reveal) {
          t = Math.min(1, (now - reveal.start) / reveal.duration);
          if (t >= 1) { s.reveals.delete(id); if (reveal.lift) continue; }
          else animating = true;
          const ease = 1 - (1 - t) ** 3;
          if (reveal.lift) opacity = 1 - t; else radius = reveal.radius * ease;
        }
        this.drawPlace(p, shift, pal, opacity, reveal && !reveal.lift && t < 1 ? [...reveal.centre, Math.max(radius, 0.0001)] : null, reveal?.radius);
        inked.push([p, reveal && !reveal.lift ? t : 1]);
      }
      // Borders: land edge once, then each place.
      this.useSolid(shift);
      this.edges(this.landEntry, rgb(pal.edge, 0.9));
      for (const [id, p] of this.world.places) {
        if (!this.onScreen(p.entry.bounds, shift)) continue;
        const wanted = s.wanted.has(id) && !s.visited.has(id);
        this.edges(p.entry, wanted ? rgb(pal.wantEdge, 0.8) : rgb(pal.edge));
      }
      // The inked edge settles in as a stamp finishes.
      for (const [p, t] of inked) this.edges(p.entry, rgb(pal.ink, 0.55 * Math.min(1, t * 1.4)));
      if (s.selected) {
        const p = this.world.places.get(s.selected);
        if (p) this.edges(p.entry, rgb(pal.select, 0.95));
      }
    }
    gl.disable(gl.STENCIL_TEST);
    if (animating) this.requestDraw();
    this.onDraw?.();
  }

  drawPlace(p, shift, pal, opacity, reveal, radius) {
    const gl = this.gl;
    this.useSolid(shift);
    // Paper under the art, faded in with the stamp so the reveal reads as ink on paper.
    this.stencilFill(p.entry, 0x80);
    this.coverRect(p.entry.bounds, rgb(pal.visitedPaper, opacity * (reveal ? 0.5 + 0.5 * Math.min(1, reveal[2] / (radius || 1)) : 1)), 0x80, 0x80, false);
    for (const plate of p.plates) {
      const tex = this.textures.get(this.artURL(plate.image));
      if (!tex) continue;
      const ownClip = plate.entry !== p.entry;
      if (ownClip) { this.useSolid(shift); this.stencilFill(plate.entry, 0x40); }
      this.art(plate, tex, shift, opacity, ownClip ? 0xC0 : 0x80, reveal, radius);
      if (ownClip) { this.useSolid(shift); this.coverRect(plate.entry.bounds, [0, 0, 0, 0], 0x40, 0x40, true); }
    }
    if (!reveal && opacity === 1) this.drawRegional(p, shift, pal);
    // Clear this place's bits for the next one.
    this.useSolid(shift);
    this.coverRect(p.entry.bounds, [0, 0, 0, 0], 0xE0, 0x80, true);
  }

  /** One art plate where the stencil holds all of `ref`'s bits. */
  art(plate, tex, shift, alpha, ref, reveal = null, radius = 1) {
    const gl = this.gl, v = this.view, [w, h] = this.size, u = this.artProgram.u;
    gl.useProgram(this.artProgram.program);
    gl.uniform3f(u.view, v.x, v.y, v.scale); gl.uniform2f(u.size, w, h); gl.uniform1f(u.shift, shift);
    gl.uniform4fv(u.frame, plate.frame);
    gl.uniform4fv(u.crop, plate.crop);
    const fade = Math.min(1, (performance.now() - tex.born) / 350);
    if (fade < 1) this.requestDraw();
    gl.uniform1f(u.opacity, alpha * fade);
    gl.uniform3fv(u.reveal, reveal ?? [0, 0, 0]);
    gl.uniform1f(u.edge, (radius || 1) * 0.12);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex.tex); gl.uniform1i(u.art, 0);
    gl.stencilMask(0); gl.stencilFunc(gl.EQUAL, ref, ref); gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  /** A regional layer inside its own clip (bit 0x20) and whatever `ref` already holds. */
  layer(layer, tex, shift, alpha, ref) {
    this.useSolid(shift); this.stencilFill(layer.entry, 0x20);
    this.art(layer, tex, shift, alpha, ref | 0x20);
    this.useSolid(shift); this.coverRect(layer.entry.bounds, [0, 0, 0, 0], 0x20, 0x20, true);
  }

  /**
   * Regions inside a visited country (stencil 0x80 holds the country). As the map closes in,
   * the collage hands over to every region's own plate together (Italy: region by region);
   * once one region is marked, the others fade back to paper unless whole countries light up.
   */
  drawRegional(p, shift, pal) {
    const detail = this.regional.get(p.row.id);
    if (!detail) {
      // Load the country's regions once the map closes in (the app's per-country packs).
      if (this.view.scale > Math.min(this.size[0] / (p.row.focus[2] + 180), this.size[1] / (p.row.focus[3] + 180))) this.onNeedRegions?.(p.row.id);
      return;
    }
    const s = this.state, wash = 0xEEE6D3;
    const regions = [...detail.regions.values()].filter((r) => this.onScreen(r.entry.bounds, shift));
    if (!regions.length) return;
    const isItaly = p.row.id === 'IT';
    const markable = regions.filter((r) => r.row?.markable !== false);
    const marked = markable.some((r) => s.visited.has(r.id));
    const tex = (layer) => this.textures.get(layer.url);
    const regionStencil = (r) => { this.useSolid(shift); this.stencilFill(r.entry, 0x40); };
    const regionClear = (r) => { this.useSolid(shift); this.coverRect(r.entry.bounds, [0, 0, 0, 0], 0x40, 0x40, true); };

    if (isItaly) {
      const shown = regions.map((r) => [r, this.italyProgress(p, r)]).filter(([, t]) => t > 0);
      // As elsewhere: the wash and the regions come in only once every region in view has its art.
      const allReady = shown.every(([r]) => r.layers.every((l) => tex(l)));
      if (shown.length && allReady) {
        const strongest = Math.max(...shown.map(([, t]) => t));
        this.useSolid(shift); this.coverRect(p.entry.bounds, rgb(wash, 0.88 * strongest), 0x80, 0x80, false);
        for (const [r, t] of shown) {
          const ready = r.layers.map(tex);
          if (ready.some((x) => !x)) continue;
          regionStencil(r);
          this.useSolid(shift); this.coverRect(r.entry.bounds, rgb(wash, t), 0xC0, 0xC0, false);
          r.layers.forEach((l, i) => this.layer(l, ready[i], shift, t, 0xC0));
          if (s.region && s.region !== r.id) { this.useSolid(shift); this.coverRect(r.entry.bounds, rgb(wash, 0.76 * t), 0xC0, 0xC0, false); }
          regionClear(r);
          this.useSolid(shift); this.edges(r.entry, rgb(0xFFF9EA, 0.75 * t));
        }
      }
    } else if (regions.some((r) => r.layers.length || detail.foundation.length)) {
      const t = this.regionalProgress(p);
      if (t > 0) {
        // The country changes over all at once, when every image its regions list is here.
        const all = [...detail.foundation, ...regions.flatMap((r) => [...r.layers, ...r.overlays])];
        const ready = new Map(all.map((l) => [l, tex(l)]));
        if ([...ready.values()].every(Boolean)) {
          for (const r of regions) {
            regionStencil(r);
            this.useSolid(shift); this.coverRect(r.entry.bounds, rgb(wash, 0.88 * t), 0xC0, 0xC0, false);
            for (const l of detail.foundation) if (this.onScreen(l.entry.bounds, shift)) this.layer(l, ready.get(l), shift, t, 0xC0);
            regionClear(r);
          }
          for (const r of regions) {
            regionStencil(r);
            for (const l of r.layers) this.layer(l, ready.get(l), shift, t, 0xC0);
            regionClear(r);
            this.useSolid(shift); this.edges(r.entry, rgb(0xFFF9EA, 0.75 * t));
          }
          // Coastal overlays may sit over the water: drawn inside their own clip only.
          for (const r of regions) {
            if (marked && !s.visited.has(r.id)) continue;
            for (const l of r.overlays) {
              this.useSolid(shift); this.stencilFill(l.entry, 0x20);
              this.art(l, ready.get(l), shift, t, 0x20);
              this.useSolid(shift); this.coverRect(l.entry.bounds, [0, 0, 0, 0], 0x20, 0x20, true);
            }
          }
        }
      }
    }
    // Marked regions: the rest fade back to paper, state by state.
    if (marked && !s.wholeCountries && !isItaly) {
      for (const r of markable) {
        if (s.visited.has(r.id)) continue;
        regionStencil(r);
        this.useSolid(shift); this.coverRect(r.entry.bounds, rgb(wash, 0.72), 0xC0, 0xC0, false);
        regionClear(r);
      }
      for (const r of markable) { this.useSolid(shift); this.edges(r.entry, [0.7, 0.7, 0.7, 0.7]); }
    }
    if (s.region && !isItaly) {
      const r = detail.regions.get(s.region);
      if (r) { this.useSolid(shift); this.edges(r.entry, rgb(pal.select, 0.95)); }
    }
  }
}
