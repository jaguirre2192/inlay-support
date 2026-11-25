// The paper globe and its unfold into the flat map, after the app's AtlasGlobe.metal
// (`atlasGlobe`, `atlasUnfold`) and AtlasGlobeView.swift.
//
// The globe is drawn from the atlas's own picture: the flat map (sea, paper land, the art on
// visited places, Want to go washes) is painted once with placeart.js into one texture, and a
// single full-window fragment shader reads it through the inverse of the atlas's projection
// (Natural Earth I at width 39300, as photos.js `project`). Over it: the pencil graticule, a warm
// rim light and a paper atmosphere at the limb. One draw call per frame; the texture is painted
// again only when visits, wishes or the theme change. One WebGL2 canvas is shared by both
// components (they are never on screen together), so there is one texture.
//
//   import { GlobeLaunch, GlobeView, curlToGlobe, unfold, curlProgress, prepareGlobe } from './globe.js';
//   <link rel="stylesheet" href="./css/globe.css">
//
// GlobeLaunch { world, atlas, dark, view, insets?, onDone }
//   The launch: plain paper, the globe turning west for about six seconds (a touch or a key ends
//   it sooner), resting on what the flat World view shows at the globe's centre, opening out
//   into the flat map in one motion, then a crossfade to the real map and `onDone()`.
//   Put it inside the map's host (position: absolute; inset: 0), above the map and below the
//   chrome. `view()` returns the flat map's camera { x, y, scale } (AtlasMap.view: the world
//   point at the window's centre and CSS pixels per map unit); it is read at the start and again
//   when the globe opens out. `insets()` is the map's own insets function (the band clear of
//   the wordmark and the panel); the globe stands in that band. With prefers-reduced-motion,
//   or without WebGL2, it calls onDone() at once. A 16-second fallback always hands over.
//   If `view` returns null the globe dissolves towards you instead of opening out.
//
// GlobeView { world, atlas, dark, view, insets?, active = true, onPick(id), onFlat(), onCurlEnd?(globe) }
//   The globe for "Show globe" in the World view, covering the map on paper. Drag to turn (with
//   inertia), pinch or wheel to zoom, tap a place to pick it, arrow keys turn, + and − zoom.
//   Zooming in past its closest, the globe opens out into the flat map (as pinching the globe
//   does in the app); let go before it's mostly open and it rounds back. Opened all the way it
//   calls onFlat(). Keep it mounted (active = false) in the World view so its picture is ready
//   for a curl from the map.
//
// curlToGlobe(progress, ended = false)  from the map: 0 is the flat map, 1 the globe. Call it on
//   every frame of a pinch-out past the whole world (curlProgress gives the app's mapping), and
//   once with ended = true when the fingers lift: past a third it settles into the globe,
//   otherwise back to the map, then the mounted GlobeView calls onCurlEnd(true | false).
//   While curling from the map the globe takes no touches (the map keeps the pinch).
// unfold(progress, ended = false)       the same from the globe's side (1 globe → 0 map); on
//   ended it settles flat below 0.65.
// curlProgress(baseScale, scale)        the app's mapping of a map pinch to curl progress:
//   closing the fingers to half the span they had at the whole world makes the whole globe.
// prepareGlobe(world, visited, wanted, dark)  paints the texture ahead of time (a promise).

import { h } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import htm from 'htm';
import { t } from './i18n.js';
import { paintPlaces } from './placeart.js';
import { contains } from './inlr.js';

const html = htm.bind(h);
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

// ---- Natural Earth I, as the atlas's geometry was projected (NaturalEarthProjection) ----------
const SCALE = 39300 / (2 * Math.PI * 0.8707);
const rawY = (phi) => { const p2 = phi * phi, p4 = p2 * p2; return phi * (1.007226 + p2 * (0.015085 + p4 * (-0.044475 + 0.028874 * p2 - 0.005916 * p4))); };
const factor = (phi) => { const p2 = phi * phi, p4 = p2 * p2; return 0.8707 - 0.131979 * p2 + p4 * (-0.013791 + p4 * (0.003971 * p2 - 0.001529 * p4)); };
/** Map units for a latitude and longitude in degrees. */
export function project(latitude, longitude) {
  const phi = latitude * Math.PI / 180;
  return [19650 + SCALE * longitude * Math.PI / 180 * factor(phi), SCALE * (rawY(Math.PI / 2) - rawY(phi))];
}
/** The latitude and longitude (degrees) at a map point: the inverse of `project`. */
export function coordinate(x, y) {
  const target = rawY(Math.PI / 2) - y / SCALE;
  let phi = target / 1.007226;
  for (let i = 0; i < 12; i++) {
    const p2 = phi * phi, p4 = p2 * p2;
    const f = phi * (1.007226 + p2 * (0.015085 + p4 * (-0.044475 + 0.028874 * p2 - 0.005916 * p4))) - target;
    const d = 1.007226 + p2 * (3 * 0.015085 + p4 * (7 * -0.044475 + 9 * 0.028874 * p2 - 11 * 0.005916 * p4));
    phi -= f / d;
  }
  phi = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, phi));
  return [phi * 180 / Math.PI, (x - 19650) / SCALE / factor(phi) * 180 / Math.PI];
}

const wrapped = (deg) => { const r = deg * Math.PI / 180; return Math.atan2(Math.sin(r), Math.cos(r)) * 180 / Math.PI; };
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
/** The app's ease (cubic in-out), clamped to 0…1. */
const ease = (t) => { const x = clamp(t, 0, 1); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };
const smooth = (t) => { const x = clamp(t, 0, 1); return x * x * (3 - 2 * x); };

/** The app's mapping of a pinch on the zoomed-out map to curl progress (NativeAtlasView.curlPinched). */
export const curlProgress = (baseScale, scale) => clamp((baseScale - scale) / (baseScale * 0.5), 0, 1);

// ---- the shared WebGL2 canvas --------------------------------------------------------------
const VERTEX = `#version 300 es
void main(){ vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)); gl_Position = vec4(p * 2. - 1., 0., 1.); }`;

// `atlasUnfold` (which at open = 0 is `atlasGlobe`), plus the ground the globe stands on: the
// paper, the sphere's soft shadow and the shadow on the desk below, turning to sea as it opens.
const FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D map;
uniform vec2 size; uniform float dpr;
uniform vec2 center;      // latitude, longitude facing the viewer (radians)
uniform vec2 scene;       // the map's size in its own units
uniform vec3 sphere;      // centre and radius, CSS px
uniform vec4 target;      // where the flat world sits on screen (one copy), CSS px
uniform vec4 box;         // the outline the sphere eases into: the map's band across the window
uniform float open, dark, preview, shown;
uniform vec3 paper, ink;
out vec4 colour;
const float PI = 3.14159265;
float rawY(float p){ float p2 = p * p, p4 = p2 * p2; return p * (1.007226 + p2 * (0.015085 + p4 * (-0.044475 + 0.028874 * p2 - 0.005916 * p4))); }
vec2 mapUV(float phi, float lon){
  float s = 39300. / (2. * PI * 0.8707);
  float p2 = phi * phi, p4 = p2 * p2;
  float f = 0.8707 - 0.131979 * p2 + p4 * (-0.013791 + p4 * (0.003971 * p2 - 0.001529 * p4));
  return vec2(19650. + s * lon * f, s * (rawY(PI * 0.5) - rawY(phi))) / scene;
}
void main(){
  vec2 pos = vec2(gl_FragCoord.x, size.y * dpr - gl_FragCoord.y) / dpr;
  float e = open;
  float radius = max(sphere.z, 1.);
  vec2 n = vec2((pos.x - sphere.x) / radius, -(pos.y - sphere.y) / radius);
  float r = length(n);
  // Off the sphere, read the picture at its edge, the way it will stretch out.
  vec2 m = r < 0.999 ? n : n / max(r, 0.001) * 0.999;
  float mr = min(r, 0.999);
  float fwd = sqrt(max(0., 1. - mr * mr));
  float sl = sin(center.x), cl = cos(center.x);
  float phi = asin(clamp(m.y * cl + fwd * sl, -1., 1.));
  float lon = center.y + atan(m.x, fwd * cl - m.y * sl);
  lon = atan(sin(lon), cos(lon));
  vec2 guv = mapUV(phi, lon);
  // The flat map wraps round the Pacific: take the copy nearest to where the globe reads.
  vec2 fuv = (pos - target.xy) / target.zw;
  fuv.x += floor(guv.x - fuv.x + 0.5);
  float beyond = smoothstep(0.98, 1.25, r);
  vec2 uv = mix(guv, fuv, max(e, beyond));
  // Mip level from the picture's own spacing, ignoring the jumps at the seam.
  vec2 gx = dFdx(uv), gy = dFdy(uv);
  gx.x -= floor(gx.x + 0.5); gy.x -= floor(gy.x + 0.5);
  vec3 rgb = textureGrad(map, vec2(fract(uv.x), uv.y), gx, gy).rgb;

  float look = (1. - e) * (1. - e);
  // Light from the upper left, as on the flat map, fading as it flattens.
  float lit = dot(vec3(m, fwd), normalize(vec3(-0.35, 0.5, 0.8)));
  rgb *= mix(1., 0.94 + 0.08 * lit, look);
  vec3 haze = dark > 0.5 ? vec3(0.10, 0.15, 0.16) : vec3(0.97, 0.96, 0.93);
  rgb = mix(rgb, haze, 0.22 * smoothstep(0.86, 1., mr) * look);
  // A faint pencil graticule every 15 degrees, thinning out toward the limb.
  float dpp = 57.2958 / radius;
  float latL = abs(fract(phi * 57.2958 / 15. + 0.5) - 0.5) * 15.;
  float lonL = abs(fract(lon * 57.2958 / 15. + 0.5) - 0.5) * 15. * cos(phi);
  float line = 1. - smoothstep(0., dpp * 0.9, min(latL, lonL));
  vec3 pencil = dark > 0.5 ? vec3(0.55, 0.65, 0.66) : vec3(0.42, 0.50, 0.51);
  rgb = mix(rgb, pencil, mix(0.07, 0.10, preview) * line * (1. - smoothstep(0.75, 1., mr)) * look);
  // A warm rim of light on the upper left, a cool shade on the lower right.
  vec2 tw = m / max(mr, 0.001);
  float rim = smoothstep(0.86, 1., mr) * look;
  rgb += vec3(1., 0.92, 0.78) * 0.16 * rim * clamp(dot(tw, normalize(vec2(-0.6, 0.8))), 0., 1.);
  rgb = mix(rgb, rgb * vec3(0.82, 0.86, 0.88), 0.28 * rim * clamp(dot(tw, normalize(vec2(0.6, -0.8))), 0., 1.));

  // The outline: the circle easing into the map's band (signed distances, CSS px).
  float dC = length(pos - sphere.xy) - radius;
  vec2 hb = box.zw * 0.5;
  vec2 q = abs(pos - (box.xy + hb)) - hb;
  float dB = length(max(q, 0.)) + min(max(q.x, q.y), 0.);
  float d = mix(dC, dB, e);
  float cov = clamp(0.5 - d * dpr, 0., 1.);
  // The sphere's hairline edge (AtlasStyle.rule), gone as it opens.
  float stroke = clamp((0.5 - abs(dC + 0.5)) * dpr + 0.5, 0., 1.) * look;
  rgb = mix(rgb, ink, 0.12 * stroke);

  // Around it, the paper the globe stood on turns into the map's sea.
  vec3 sea = texture(map, vec2(0.002, 0.5)).rgb;
  vec3 ground = mix(paper, sea, smoothstep(0.2, 1., e));
  float side = radius * 2.;
  float ds = length(pos - (sphere.xy + vec2(0., side * 0.025))) - radius;
  float halo = (dark > 0.5 ? 0.5 : 0.16) * 0.55 * (1. - smoothstep(-side * 0.05, side * 0.05, ds));
  vec2 el = (pos - (sphere.xy + vec2(0., side * 0.54))) / vec2(side * 0.35, side * 0.04);
  float ed = (length(el) - 1.) * side * 0.04;
  float desk = (dark > 0.5 ? 0.35 : 0.10) * (1. - smoothstep(-side * 0.035, side * 0.035, ed));
  ground *= 1. - clamp(halo + desk, 0., 0.9) * look * shown;
  colour = vec4(mix(ground, rgb, cov * shown), 1.);
}`;

let engine = null;
function getEngine() {
  if (engine) return engine;
  const canvas = document.createElement('canvas');
  canvas.className = 'globe-gl';
  canvas.setAttribute('aria-hidden', 'true');
  const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false, powerPreference: 'high-performance' });
  if (!gl) return (engine = { failed: true });
  const shader = (type, src) => {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('globe shader: ' + gl.getShaderInfoLog(s));
    return s;
  };
  try {
    const prog = gl.createProgram();
    gl.attachShader(prog, shader(gl.VERTEX_SHADER, VERTEX)); gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FRAGMENT));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('globe program: ' + gl.getProgramInfoLog(prog));
    const u = {};
    for (const name of ['map', 'size', 'dpr', 'center', 'scene', 'sphere', 'target', 'box', 'open', 'dark', 'preview', 'shown', 'paper', 'ink']) u[name] = gl.getUniformLocation(prog, name);
    engine = { canvas, gl, prog, u, vao: gl.createVertexArray(), texture: null, key: null, painting: null, size: [1, 1], dpr: 1, width: 0 };
    canvas.addEventListener('webglcontextlost', (ev) => { ev.preventDefault(); engine.lost = true; engine.texture = null; engine.key = null; });
  } catch (err) {
    console.error(err);
    engine = { failed: true };
  }
  return engine;
}

/**
 * Puts the shared canvas in `host` and keeps it sized to it; `onResize` runs after each fit.
 * Hosts stack: the newest holds the canvas, and when it lets go the one before takes it back
 * (the launch can sit over a mounted, hidden GlobeView). Returns a detach function.
 */
const hosts = [];
function mount(host, onResize) {
  const e = getEngine();
  const entry = { host, onResize, ro: null };
  const fit = () => {
    if (hosts[hosts.length - 1] !== entry) return;
    const r = host.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2);
    e.size = [Math.max(1, r.width), Math.max(1, r.height)]; e.dpr = dpr;
    const w = Math.round(e.size[0] * dpr), hh = Math.round(e.size[1] * dpr);
    if (e.canvas.width !== w || e.canvas.height !== hh) { e.canvas.width = w; e.canvas.height = hh; }
    entry.onResize?.();
  };
  entry.fit = fit;
  hosts.push(entry);
  host.prepend(e.canvas);
  entry.ro = new ResizeObserver(fit); entry.ro.observe(host); fit();
  return {
    set onResize(f) { entry.onResize = f; },
    detach() {
      entry.ro.disconnect();
      const top = hosts[hosts.length - 1] === entry;
      hosts.splice(hosts.indexOf(entry), 1);
      if (!top) return;
      if (e.canvas.parentNode === host) e.canvas.remove();
      const back = hosts[hosts.length - 1];
      if (back) { back.host.prepend(e.canvas); back.fit(); }
    },
  };
}

const keyOf = (visited, wanted, dark) => `${dark ? 'd' : 'l'}|${[...visited].sort().join(',')}|${[...wanted].sort().join(',')}`;
const nextFrame = () => new Promise((r) => setTimeout(r, 0));

/**
 * Paints the flat atlas into the globe's texture: 8192 wide where the GPU allows (and the
 * device isn't a small, low-memory one), else 4096; in four vertical strips so no canvas
 * passes Safari's 16.7-megapixel limit, uploaded into one mipmapped texture.
 */
export function prepareGlobe(world, visited, wanted, dark) {
  const e = getEngine();
  if (e.failed) return Promise.reject(new Error('WebGL2 unavailable'));
  const key = keyOf(visited, wanted, dark);
  if (e.key === key && e.texture) return Promise.resolve();
  if (e.painting?.key === key) return e.painting.promise;
  const gl = e.gl, job = { key };
  job.promise = (async () => {
    const [, , W, H] = world.frame;
    const max = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    const small = (navigator.deviceMemory && navigator.deviceMemory < 4) || (matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 600);
    const widths = (small ? [4096] : [8192, 4096]).filter((w) => w <= max);
    if (!widths.length) widths.push(Math.min(4096, max));
    const strip = document.createElement('canvas');
    for (const width of widths) {
      const height = Math.round(width * H / W), levels = Math.floor(Math.log2(width)) + 1, tile = width / 4;
      while (gl.getError() !== gl.NO_ERROR) { /* clear */ }
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texStorage2D(gl.TEXTURE_2D, levels, gl.RGBA8, width, height);
      if (gl.getError() !== gl.NO_ERROR) { gl.deleteTexture(tex); continue; }
      strip.width = tile; strip.height = height;
      const ctx = strip.getContext('2d');
      if (!ctx) { gl.deleteTexture(tex); continue; }
      let ok = true;
      for (let i = 0; i < 4; i++) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, tile, height);
        await paintPlaces(ctx, world, { rect: [i * W / 4, 0, W / 4, H], width: tile, height, inked: visited, outlined: wanted, dark, sea: true, paperAll: true });
        if (e.painting !== job || e.lost) { gl.deleteTexture(tex); return; }
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, i * tile, 0, gl.RGBA, gl.UNSIGNED_BYTE, strip);
        if (gl.getError() !== gl.NO_ERROR) { ok = false; break; }
        await nextFrame();
      }
      if (!ok) { gl.deleteTexture(tex); continue; }
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const aniso = gl.getExtension('EXT_texture_filter_anisotropic');
      if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
      strip.width = strip.height = 1;
      if (e.texture) gl.deleteTexture(e.texture);
      e.texture = tex; e.key = key; e.width = width;
      return;
    }
    throw new Error('The globe’s picture could not be made.');
  })();
  e.painting = job;
  job.promise.finally(() => { if (e.painting === job) e.painting = null; }).catch(() => {});
  return job.promise;
}

const PAPER = { light: [0xFB, 0xF8, 0xF1], dark: [0x1A, 0x22, 0x20] };
const INK = { light: [0x1F, 0x2B, 0x27], dark: [0xEF, 0xE8, 0xD8] };
const unit = (c) => c.map((v) => v / 255);

/** One frame: the globe facing lat/lon, part way (`open`) to the flat world at `target`. */
function draw({ lat, lon, sphere, target, open = 0, dark, preview = false, shown = 1 }) {
  const e = engine; if (!e || e.failed || !e.texture) return;
  const gl = e.gl, u = e.u, [w, hh] = e.size;
  gl.viewport(0, 0, e.canvas.width, e.canvas.height);
  gl.useProgram(e.prog);
  gl.bindVertexArray(e.vao);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, e.texture);
  gl.uniform1i(u.map, 0);
  gl.uniform2f(u.size, w, hh); gl.uniform1f(u.dpr, e.dpr);
  gl.uniform2f(u.center, lat * Math.PI / 180, lon * Math.PI / 180);
  gl.uniform2f(u.scene, e.scene[0], e.scene[1]);
  gl.uniform3f(u.sphere, sphere[0], sphere[1], sphere[2]);
  const tg = target ?? [0, 0, w, w * e.scene[1] / e.scene[0]];
  gl.uniform4f(u.target, tg[0], tg[1], tg[2], tg[3]);
  // The flat map wraps sideways, so its band runs the window's full width.
  gl.uniform4f(u.box, -4, tg[1], w + 8, tg[3]);
  gl.uniform1f(u.open, open); gl.uniform1f(u.dark, dark ? 1 : 0); gl.uniform1f(u.preview, preview ? 1 : 0); gl.uniform1f(u.shown, shown);
  gl.uniform3fv(u.paper, unit(dark ? PAPER.dark : PAPER.light));
  gl.uniform3fv(u.ink, unit(dark ? INK.dark : INK.light));
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

/** A plain paper frame (before the picture is ready). */
function drawPaper(dark) {
  const e = engine; if (!e || e.failed) return;
  const gl = e.gl, p = unit(dark ? PAPER.dark : PAPER.light);
  gl.viewport(0, 0, e.canvas.width, e.canvas.height);
  gl.clearColor(p[0], p[1], p[2], 1); gl.clear(gl.COLOR_BUFFER_BIT);
}

// ---- layout ---------------------------------------------------------------------------------
/** Where the globe stands: the band the map frames places in, clear of the chrome, padded. */
function globeArea(size, insets) {
  const [w, hh] = size, wide = w >= 600 && w > hh;
  const i = insets?.() ?? { top: 64, bottom: 16, left: 0, right: 0 };
  const left = (i.left || 0) + 16, right = (i.right || 0) + (wide ? 56 : 16);
  const top = (i.top || 0) + (wide ? 8 : 24), bottom = (i.bottom || 0) + 8;
  const x = left, y = top, cw = Math.max(0, w - left - right), ch = Math.max(0, hh - top - bottom);
  return { x, y, w: cw, h: ch, cx: x + cw / 2, cy: y + ch / 2, radius: Math.max(0, Math.min(cw, ch)) / 2 };
}

/** Where one copy of the flat world sits on screen for the map's camera. */
function targetFor(v, size, world) {
  if (!v) return null;
  const [w, hh] = size, [, , W, H] = world.frame;
  return [w / 2 - v.x * v.scale, hh / 2 - v.y * v.scale, W * v.scale, H * v.scale];
}

/** What a flat world at `target` shows at a point of the window, as latitude and longitude. */
function facingAt(target, px, py, world) {
  const [, , W, H] = world.frame;
  let x = (px - target[0]) / target[2] * W;
  x = ((x % W) + W) % W;
  const y = clamp((py - target[1]) / target[3] * H, 0, H);
  const [lat, lon] = coordinate(x, y);
  return { lat: clamp(lat, -85, 85), lon: wrapped(lon) };
}

/** The latitude and longitude under a window point of a globe facing lat/lon (the shader's inverse). */
function pointOnGlobe(px, py, sphere, lat, lon) {
  const x = (px - sphere[0]) / sphere[2], y = (sphere[1] - py) / sphere[2], r2 = x * x + y * y;
  if (r2 > 1) return null;
  const fwd = Math.sqrt(1 - r2), c = lat * Math.PI / 180;
  const phi = Math.asin(clamp(y * Math.cos(c) + fwd * Math.sin(c), -1, 1));
  const l = lon * Math.PI / 180 + Math.atan2(x, fwd * Math.cos(c) - y * Math.sin(c));
  return [phi * 180 / Math.PI, wrapped(l * 180 / Math.PI)];
}

/** The destination at a map point; territories win over the country around them. */
function placeAt(world, x, y) {
  let country = null;
  for (const [id, p] of world.places) {
    const [bx, by, bw, bh] = p.row?.bounds ?? p.entry?.bounds ?? [0, 0, 0, 0];
    const pad = Math.max(bw, bh) < 1 ? 0.45 : 0;
    if (x < bx - pad || x > bx + bw + pad || y < by - pad || y > by + bh + pad) continue;
    if (pad === 0 && !contains(p.rings, x, y)) continue;
    if (p.row?.kind === 'territory') return id;
    country ??= id;
  }
  return country;
}

function useLatest(value) { const r = useRef(value); r.current = value; return r; }
const setsOf = (atlas) => [new Set(Object.keys(atlas?.visits ?? {})), new Set(Object.keys(atlas?.wanted ?? {}))];

// ---- the launch ----------------------------------------------------------------------------
const INTRO_SECONDS = 6.5, INTRO_DEG_PER_SECOND = 7, UNFOLD_SECONDS = 2.1, FADE_IN = 0.6;

export function GlobeLaunch({ world, atlas, dark, view, insets, onDone }) {
  const host = useRef(null);
  const props = useLatest({ view, insets, onDone, dark });
  useEffect(() => {
    const done = () => props.current.onDone?.();
    const e = getEngine();
    if (reduceMotion.matches || e.failed) { done(); return; }
    const node = host.current;
    const held = mount(node);
    e.scene = [world.frame[2], world.frame[3]];
    const now = () => performance.now() / 1000;
    const start = now();
    // Measured when the picture is ready (the map may be made after this component, and settle).
    let area = null, target = null, facing = null, introFrom = 0, lat = 25, lon = 0;
    const measure = () => {
      area = globeArea(e.size, props.current.insets);
      target = targetFor(props.current.view?.(), e.size, world) ?? target;
      facing = target ? facingAt(target, area.cx, area.cy, world) : facing ?? { lat: 25, lon: -30 };
    };
    let readyAt = null, introEpoch = null, stopped = false, unfoldAt = null, from = null, finished = false, raf = 0;
    const timers = [];

    const finish = () => {
      if (finished) return; finished = true;
      node.classList.add(unfoldAt != null ? 'globe-handover' : 'globe-dissolve');
      timers.push(setTimeout(done, unfoldAt != null ? 480 : 1320));
    };
    const introLon = (at) => wrapped(introFrom - INTRO_DEG_PER_SECOND * clamp(at - introEpoch, 0, INTRO_SECONDS));
    const stop = () => {
      if (stopped || finished) return; stopped = true;
      if (introEpoch != null) lon = introLon(now());
      if (readyAt == null) { finish(); return; }
      // Measure again: the map may have settled since the launch began.
      measure();
      if (!target) { finish(); return; }
      from = { lat, lon }; unfoldAt = now();
    };
    const frame = () => {
      raf = 0;
      const tnow = now();
      const d = props.current.dark;
      if (readyAt == null) { drawPaper(d); }
      else {
        const shown = smooth((tnow - readyAt) / FADE_IN);
        const sphere = [area.cx, area.cy, area.radius];
        if (unfoldAt == null) {
          const l = stopped ? lon : introLon(tnow);
          draw({ lat, lon: l, sphere, target, open: 0, dark: d, preview: true, shown });
          if (!stopped && tnow - introEpoch >= INTRO_SECONDS) stop();
        } else {
          const tt = (tnow - unfoldAt) / UNFOLD_SECONDS;
          const face = ease(tt / 0.45), open = ease((tt - 0.18) / 0.82);
          draw({ lat: from.lat + (facing.lat - from.lat) * face, lon: from.lon + wrapped(facing.lon - from.lon) * face,
                 sphere, target, open, dark: d, preview: true, shown });
          if (tt >= 1) { finish(); return; }
        }
      }
      if (!finished) raf = requestAnimationFrame(frame);
    };
    held.onResize = () => { if (area) area = globeArea(e.size, props.current.insets); if (!raf && !finished) frame(); };
    const [visited, wanted] = setsOf(atlas);
    prepareGlobe(world, visited, wanted, dark)
      .then(() => {
        if (finished || stopped) return;
        measure();
        introFrom = wrapped(facing.lon + INTRO_DEG_PER_SECOND * INTRO_SECONDS); lon = introFrom;
        readyAt = now(); introEpoch = readyAt;
      })
      .catch((err) => { console.warn(err); stop(); });
    // A touch or a key ends the turn where it has got to.
    const interrupt = () => stop();
    node.addEventListener('pointerdown', interrupt);
    addEventListener('keydown', interrupt);
    const onMotion = () => { if (reduceMotion.matches) finish(); };
    reduceMotion.addEventListener('change', onMotion);
    const onHide = () => { if (document.hidden) stop(); };
    document.addEventListener('visibilitychange', onHide);
    // Whatever happens to the globe's picture, the map takes over in the end.
    timers.push(setTimeout(finish, 16000));
    raf = requestAnimationFrame(frame);
    window.__globeLaunch = { stop, get phase() { return finished ? 'handover' : unfoldAt != null ? 'unfold' : readyAt != null ? 'turn' : 'paper'; }, start };
    return () => {
      cancelAnimationFrame(raf); timers.forEach(clearTimeout);
      node.removeEventListener('pointerdown', interrupt); removeEventListener('keydown', interrupt);
      reduceMotion.removeEventListener('change', onMotion); document.removeEventListener('visibilitychange', onHide);
      held.detach();
    };
  }, []);
  return html`<div class="globe-launch" ref=${host} aria-hidden="true"></div>`;
}

// ---- the interactive globe -----------------------------------------------------------------
const ZOOM_MAX = 3.2, ZOOM_MIN = 0.8;
let live = null;

/** From the map: 0 flat, 1 globe. See the header. */
export function curlToGlobe(progress, ended = false) { live?.curl(progress, ended, true); }
/** From the globe: 1 globe, 0 flat. See the header. */
export function unfold(progress, ended = false) { live?.curl(progress, ended, false); }

export function GlobeView({ world, atlas, dark, view, insets, active = true, onPick, onFlat, onCurlEnd }) {
  const host = useRef(null);
  const [failed, setFailed] = useState(() => getEngine().failed);
  const [label, setLabel] = useState('');
  const [curling, setCurling] = useState(null); // null | 'map' | 'globe'
  const props = useLatest({ view, insets, onPick, onFlat, onCurlEnd, dark, active });
  const [visited, wanted] = setsOf(atlas);
  const key = keyOf(visited, wanted, dark);
  const ctl = useRef(null);

  useEffect(() => {
    const e = getEngine();
    if (e.failed) return;
    const node = host.current;
    const held = mount(node);
    e.scene = [world.frame[2], world.frame[3]];
    // hold: after a curl settles, the end it settled on is kept on screen until the app shows or hides the globe.
    const s = { lat: 25, lon: 0, zoom: 1, curl: null, hold: null, fromMap: false, start: null, vel: null, raf: 0, settle: null, placed: false };
    const area = () => globeArea(e.size, props.current.insets);
    const sphere = () => { const a = area(); return [a.cx, a.cy, a.radius * s.zoom]; };
    const target = () => targetFor(props.current.view?.(), e.size, world);
    const facing = () => { const tg = target(), a = area(); return tg ? facingAt(tg, a.cx, a.cy, world) : { lat: s.lat, lon: s.lon }; };
    const describe = () => {
      const whole = (x) => String(Math.round(Math.abs(x)));
      setLabel(t('Centered at %@° %@, %@° %@', whole(s.lat), s.lat < 0 ? t('S') : t('N'), whole(s.lon), s.lon < 0 ? t('W') : t('E')));
    };
    const render = () => {
      if (hosts[hosts.length - 1]?.host !== node) return;
      const c = s.curl ?? s.hold;
      const visible = props.current.active || c != null;
      if (!visible || !e.texture) { if (visible) drawPaper(props.current.dark); return; }
      if (c != null) {
        const f = facing(), k = ease((1 - c) / 0.5);
        const lat = s.lat + (f.lat - s.lat) * k, lon = s.lon + wrapped(f.lon - s.lon) * k;
        draw({ lat, lon, sphere: sphere(), target: target(), open: ease((1 - c - 0.12) / 0.88), dark: props.current.dark });
      } else {
        draw({ lat: s.lat, lon: s.lon, sphere: sphere(), target: target(), open: 0, dark: props.current.dark });
      }
    };
    const request = () => { if (!s.raf) s.raf = requestAnimationFrame(tick); };
    let last = 0;
    function tick(ms) {
      s.raf = 0;
      const dt = last ? Math.min(0.05, (ms - last) / 1000) : 1 / 60; last = ms;
      let again = false;
      if (s.vel) {
        s.lat = clamp(s.lat + s.vel[0] * dt, -85, 85); s.lon = wrapped(s.lon + s.vel[1] * dt);
        const k = Math.exp(-dt * 3.2); s.vel = [s.vel[0] * k, s.vel[1] * k];
        if (Math.hypot(s.vel[0], s.vel[1]) < 0.6) { s.vel = null; describe(); } else again = true;
      }
      if (s.settle) {
        const st = s.settle, tt = st.duration > 0 ? clamp((ms - st.begin) / 1000 / st.duration, 0, 1) : 1;
        s.curl = st.from + (st.to - st.from) * (1 - Math.pow(1 - tt, 3));
        if (tt >= 1) {
          s.settle = null; const toGlobe = st.to >= 1;
          if (toGlobe && s.fromMap) { const f = facing(); s.lat = f.lat; s.lon = f.lon; }
          if (!toGlobe) s.zoom = 1;
          // Kept on screen until the app has shown (or hidden) the globe to match.
          const waits = st.fromMap ? toGlobe && !props.current.active : !toGlobe && props.current.active;
          s.hold = waits ? st.to : null;
          s.curl = null; s.fromMap = false; setCurling(waits ? 'globe' : null);
          if (!toGlobe && !st.fromMap) props.current.onFlat?.();
          props.current.onCurlEnd?.(toGlobe);
          describe();
        } else again = true;
      }
      render();
      if (again) request(); else last = 0;
    }
    held.onResize = () => request();

    // Curling, from the map or from the globe's own over-zoom.
    const curl = (progress, ended, fromMap) => {
      if (!e.texture) { if (ended) props.current.onCurlEnd?.(false); return; }
      if (s.curl == null && !s.settle) {
        s.fromMap = fromMap; s.vel = null; s.hold = null;
        if (fromMap) { const f = facing(); s.lat = f.lat; s.lon = f.lon; s.zoom = 1; s.placed = true; }
        setCurling(fromMap ? 'map' : 'globe');
      }
      s.settle = null;
      const p = clamp(progress, 0, 1);
      if (ended) {
        const to = s.fromMap ? (p > 0.35 ? 1 : 0) : (p < 0.65 ? 0 : 1);
        s.settle = { from: p, to, begin: performance.now(), duration: reduceMotion.matches ? 0 : 0.15 + 0.4 * Math.abs(to - p), fromMap: s.fromMap };
      }
      s.curl = p;
      request();
    };
    ctl.current = { request, describe, s, render };
    live = { curl };

    // Gestures: one finger turns (or taps), two pinch; wheel zooms.
    const pointers = new Map();
    let pinch = null, wheelIdle = 0;
    const overZoom = (z) => {
      // Past the closest zoom the globe opens out into the map, as pinching it does in the app.
      if (z <= ZOOM_MAX) {
        if (s.curl != null && !s.fromMap) { s.curl = null; s.settle = null; setCurling(null); }
        s.zoom = clamp(z, ZOOM_MIN, ZOOM_MAX); return;
      }
      s.zoom = ZOOM_MAX;
      curl(1 - clamp((z / ZOOM_MAX - 1) / 0.9, 0, 1), false, false);
    };
    const down = (ev) => {
      if (s.fromMap && s.curl != null) return;
      node.setPointerCapture?.(ev.pointerId);
      pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      s.vel = null;
      if (pointers.size === 1) s.start = { x: ev.clientX, y: ev.clientY, lat: s.lat, lon: s.lon, turned: false, samples: [] };
      else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom: s.zoom * (s.curl != null ? (1 + (1 - s.curl) * 0.9) : 1) };
        s.start = null;
      }
    };
    const move = (ev) => {
      if (!pointers.has(ev.pointerId)) return;
      pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      if (pinch && pointers.size >= 2) {
        const [a, b] = [...pointers.values()];
        overZoom(pinch.zoom * Math.hypot(a.x - b.x, a.y - b.y) / Math.max(1, pinch.dist));
        request(); return;
      }
      const st = s.start; if (!st) return;
      const dx = ev.clientX - st.x, dy = ev.clientY - st.y;
      if (!st.turned && Math.hypot(dx, dy) <= 6) return;
      st.turned = true;
      const deg = 180 / Math.PI / Math.max(sphere()[2], 1);
      s.lat = clamp(st.lat + dy * deg, -85, 85);
      s.lon = wrapped(st.lon - dx * deg);
      st.samples.push({ t: ev.timeStamp, lat: s.lat, lon: s.lon });
      if (st.samples.length > 6) st.samples.shift();
      request();
    };
    const up = (ev) => {
      if (!pointers.has(ev.pointerId)) return;
      pointers.delete(ev.pointerId);
      if (pinch) {
        if (pointers.size < 2) { pinch = null; if (s.curl != null && !s.fromMap) curl(s.curl, true, false); describe(); }
        return;
      }
      const st = s.start; s.start = null;
      if (!st) return;
      if (st.turned) {
        const a = st.samples[0], b = st.samples[st.samples.length - 1];
        const dt = b && a ? (b.t - a.t) / 1000 : 0;
        if (!reduceMotion.matches && dt > 0.01 && ev.timeStamp - b.t < 80) {
          s.vel = [clamp((b.lat - a.lat) / dt, -400, 400), clamp(wrapped(b.lon - a.lon) / dt, -400, 400)];
          request();
        } else describe();
        return;
      }
      if (ev.type === 'pointercancel') return;
      const r = node.getBoundingClientRect();
      const hit = pointOnGlobe(ev.clientX - r.left, ev.clientY - r.top, sphere(), s.lat, s.lon);
      if (!hit) return;
      const [x, y] = project(hit[0], hit[1]);
      const id = placeAt(world, x, y);
      if (id) props.current.onPick?.(id);
    };
    const wheel = (ev) => {
      if (s.fromMap && s.curl != null) return;
      ev.preventDefault();
      s.vel = null;
      const current = s.curl != null ? ZOOM_MAX * (1 + (1 - s.curl) * 0.9) : s.zoom;
      overZoom(current * Math.exp(-ev.deltaY * (ev.ctrlKey ? 0.01 : 0.0018)));
      clearTimeout(wheelIdle);
      wheelIdle = setTimeout(() => { if (s.curl != null && !s.fromMap) curl(s.curl, true, false); }, 220);
      request();
    };
    const key = (ev) => {
      const turn = { ArrowLeft: [0, -25], ArrowRight: [0, 25], ArrowUp: [20, 0], ArrowDown: [-20, 0] }[ev.key];
      if (turn) { s.vel = null; s.lat = clamp(s.lat + turn[0], -85, 85); s.lon = wrapped(s.lon + turn[1]); }
      else if (ev.key === '+' || ev.key === '=') s.zoom = clamp(s.zoom * 1.25, ZOOM_MIN, ZOOM_MAX);
      else if (ev.key === '-' || ev.key === '_') s.zoom = clamp(s.zoom / 1.25, ZOOM_MIN, ZOOM_MAX);
      else return;
      ev.preventDefault(); ev.stopPropagation(); describe(); request();
    };
    node.addEventListener('pointerdown', down);
    node.addEventListener('pointermove', move);
    node.addEventListener('pointerup', up);
    node.addEventListener('pointercancel', up);
    node.addEventListener('wheel', wheel, { passive: false });
    node.addEventListener('keydown', key);
    return () => {
      cancelAnimationFrame(s.raf); clearTimeout(wheelIdle);
      node.removeEventListener('pointerdown', down); node.removeEventListener('pointermove', move);
      node.removeEventListener('pointerup', up); node.removeEventListener('pointercancel', up);
      node.removeEventListener('wheel', wheel); node.removeEventListener('keydown', key);
      if (live?.curl === curl) live = null;
      ctl.current = null;
      held.detach();
    };
  }, []);

  // The picture: painted once per set of visits, wishes and theme (kept while hidden).
  useEffect(() => {
    if (failed) return;
    let gone = false;
    prepareGlobe(world, visited, wanted, dark).then(() => { if (!gone) ctl.current?.request(); }).catch((err) => { console.warn(err); if (!gone) setFailed(true); });
    return () => { gone = true; };
  }, [key, failed]);

  // Showing it: facing what the flat map shows at the globe's centre, the first time.
  useEffect(() => {
    const c = ctl.current; if (!c) return;
    if (c.s.hold != null) { c.s.hold = null; setCurling(null); }
    if (active && !c.s.placed) {
      c.s.placed = true;
      const e = getEngine(), tg = targetFor(view?.(), e.size, world), a = globeArea(e.size, insets);
      if (tg) { const f = facingAt(tg, a.cx, a.cy, world); c.s.lat = f.lat; c.s.lon = f.lon; }
    }
    c.describe(); c.request();
  }, [active, dark]);

  const shown = active || curling != null;
  if (failed && active) {
    return html`<div class="globe-view globe-failed">
      <p>${t('The globe couldn’t be drawn.')}</p>
      <button class="outline" onClick=${() => onFlat?.()}>${t('Show flat map')}</button>
    </div>`;
  }
  return html`<div class=${'globe-view' + (shown ? '' : ' globe-hidden') + (curling === 'map' ? ' globe-passive' : '')} ref=${host}
      role="img" tabindex=${active ? 0 : -1} aria-hidden=${!active}
      aria-label=${t('Globe')}
      aria-description=${label + '. ' + t('Drag to turn it. Choose a place from All places.')}></div>`;
}
