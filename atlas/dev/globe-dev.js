// Dev harness for globe.js: ?theme=dark&launch=0&lang=ja&visits=FR,IT,JP&home=JP
// The real AtlasMap underneath, the launch over it, and "Show globe" for the interactive globe.
// window.__dev: { map, curl(p, ended), unfold(p, ended), show(bool) } for scripted checks.
import { h, render } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import htm from 'htm';
import { readWorld, readLand } from '../js/inlr.js';
import { t, useLanguage, countryName, upper, tracking } from '../js/i18n.js';
import { AtlasMap } from '../js/map.js';
import { GlobeLaunch, GlobeView, curlToGlobe, unfold } from '../js/globe.js';

const html = htm.bind(h);
const q = new URLSearchParams(location.search);
const GROUPS = ['europe', 'asia', 'africa', 'north-america', 'south-america', 'oceania'];
const dark = q.get('theme') === 'dark';
const VISITS = (q.get('visits') ?? 'US,CA,MX,FR,IT,ES,PT,GB,DE,JP,PE,BR,AR,MA,EG,ZA,AU,NZ,IS,GR,TR,IN,TH').split(',');
const atlas = { name: 'Dev', home: q.get('home') ?? 'US', visits: Object.fromEntries(VISITS.map((v) => [v, {}])),
  wanted: { NO: { rank: 0, note: '', nextUp: true, modified: 0 }, PF: { rank: 1, note: '', nextUp: false, modified: 0 } }, trips: [], prefs: {} };

function Harness({ world }) {
  const host = useRef(null), panel = useRef(null), map = useRef(null);
  const [launching, setLaunching] = useState(q.get('launch') !== '0');
  const [globe, setGlobe] = useState(false);
  const [picked, setPicked] = useState(null);
  const insets = () => {
    const hr = host.current.getBoundingClientRect(), p = panel.current?.getBoundingClientRect();
    const wide = hr.width >= 600 && hr.width > hr.height;
    return { top: 60, bottom: wide ? 16 : hr.bottom - (p?.top ?? hr.bottom) + 12, left: wide ? (p?.right ?? 0) - hr.left + 16 : 0, right: 0 };
  };
  useEffect(() => {
    const m = new AtlasMap(host.current, world, { artURL: (i) => `/print/assets/art/${i}`, label: (id) => upper(countryName(id, world.rows.get(id).short)),
      tracking, home: () => atlas.home, regions: world.regions, onSelect: () => {}, insets });
    m.set({ visited: new Set(VISITS), wanted: new Set(Object.keys(atlas.wanted)), dark });
    m.frameWorld(false);
    map.current = m;
    window.__dev = { map: m, curl: curlToGlobe, unfold, show: setGlobe, get launching() { return launching; } };
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  }, []);
  const view = () => map.current?.view;
  return html`
    <div class="map" ref=${host}></div>
    <div class="dev-layer" style=${{ pointerEvents: globe || launching ? 'auto' : 'none' }}>
      <${GlobeView} world=${world} atlas=${atlas} dark=${dark} view=${view} insets=${insets} active=${globe && !launching}
        onPick=${(id) => setPicked(id)} onFlat=${() => setGlobe(false)} onCurlEnd=${(g) => setGlobe(g)} />
      ${launching && html`<${GlobeLaunch} world=${world} atlas=${atlas} dark=${dark} view=${view} insets=${insets}
        onDone=${() => { setLaunching(false); window.__launchDone = true; }} />`}
    </div>
    <div class="dev-top"><span class="wordmark">INLAY</span></div>
    <div class="dev-panel glass" ref=${panel}>
      <span class="legend" style=${{ letterSpacing: tracking() }}>${upper(t('World'))}</span>
      <div class="actions" style="margin-top:10px">
        <button class="outline" id="toggle" onClick=${() => setGlobe(!globe)}>${globe ? t('Show flat map') : t('Show globe')}</button>
      </div>
      <p class="quiet" id="picked">${picked ? countryName(picked, world.rows.get(picked)?.name) : ''}</p>
    </div>`;
}

(async () => {
  await useLanguage(q.get('lang') ?? 'en');
  const [meta, places, land, regionIndex] = await Promise.all([
    fetch('./data/world.json').then((r) => r.json()), readWorld('./data/world.inlr'), readLand('./data/land.inlr'),
    fetch('./data/regions.json').then((r) => r.json()),
  ]);
  const regionRows = new Map(regionIndex.regions.map((r) => [r.id, r]));
  const byCountry = new Map();
  for (const r of regionIndex.regions) { if (!byCountry.has(r.countryID)) byCountry.set(r.countryID, []); byCountry.get(r.countryID).push(r); }
  const rows = new Map(meta.places.map((r) => [r.id, r]));
  for (const [pid, p] of places) p.row = rows.get(pid);
  const byGroup = Object.fromEntries(GROUPS.map((g) => [g, meta.places.filter((r) => r.group === g).map((r) => r.id)]));
  const world = { frame: [0, 0, meta.frame[2], meta.frame[3]], places, land, rows, byGroup, groups: meta.groups,
                  regions: { files: regionIndex.files, kinds: regionIndex.kinds, rows: regionRows, byCountry },
                  countryCount: meta.countryCount, territoryCount: meta.territoryCount };
  const root = document.getElementById('app'); root.textContent = '';
  render(html`<${Harness} world=${world} />`, root);
  window.harnessReady = true;
})();
