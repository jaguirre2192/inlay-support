// Dev harness for placeinfo.js: ?id=JP&lang=ja&theme=dark&print=1
// Loads the world as app.js does, with a stand-in Sheet that has the same markup.
import { h, render } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import htm from 'htm';
import { readWorld, readLand } from '../js/inlr.js';
import { t, useLanguage, countryName } from '../js/i18n.js';
import { PlaceSheet, PrintButton, PrintSheet, printURL } from '../js/placeinfo.js';

const html = htm.bind(h);
const q = new URLSearchParams(location.search);
const GROUPS = ['europe', 'asia', 'africa', 'north-america', 'south-america', 'oceania'];

function Sheet({ title, onClose, children, class: cls = '' }) {
  const ref = useRef(null);
  useEffect(() => { ref.current?.querySelector('.sheet-head button')?.focus(); }, []);
  return html`<div class="scrim" onClick=${(e) => e.target === e.currentTarget && onClose()}>
    <div class=${'sheet ' + cls} role="dialog" aria-modal="true" aria-label=${title} ref=${ref}>
      <div class="sheet-head"><h2>${title}</h2><button class="glass pill" onClick=${onClose}>${t('Done')}</button></div>
      ${children}
    </div></div>`;
}

const SAMPLE = {
  name: q.get('name') ?? 'Jorge', home: 'US',
  visits: { US: { date: '2019' }, 'US-CA': { date: '2019-06' }, 'US-NY': {}, JP: { date: '2024-04' }, FR: {}, IT: { date: '2022-09' },
            'IT-25': {}, GU: { date: '2023' }, PR: {}, CA: {}, MX: {}, GB: {} },
  wanted: { IS: { rank: 0, note: '', nextUp: true, modified: 0 }, PF: { rank: 1, note: '', nextUp: false, modified: 0 } },
  trips: [], prefs: {},
};

function Harness({ world }) {
  const [atlas, setAtlas] = useState(SAMPLE);
  const [id, setId] = useState(q.get('id') ?? 'JP');
  const [open, setOpen] = useState(!q.has('print'));
  const name = (cid) => { const r = world.rows.get(cid); return r ? countryName(cid, r.name) : cid; };
  const visited = new Set(Object.keys(atlas.visits)), wanted = new Set(Object.keys(atlas.wanted));
  const update = (fn) => setAtlas((a) => fn(structuredClone(a)));
  window.__dev = { world, atlas, printURL: () => printURL(world, atlas) };
  return html`<div style="padding:16px;display:grid;gap:8px;max-width:420px">
      <button class="outline" onClick=${() => setOpen(true)}>Open ${id}</button>
      <${PrintButton} world=${world} atlas=${atlas} Sheet=${Sheet} />
    </div>
    ${open && html`<${PlaceSheet} Sheet=${Sheet} world=${world} atlas=${atlas} id=${id} name=${name} visited=${visited} wanted=${wanted}
      onMark=${(v) => update((a) => { a.visits[v] = a.visits[v] ?? {}; return a; })}
      onUnmark=${(v) => update((a) => { delete a.visits[v]; return a; })} onClose=${() => setOpen(false)} />`}
    ${q.has('print') && html`<${PrintSheet} Sheet=${Sheet} world=${world} atlas=${atlas} onClose=${() => {}} />`}`;
}

(async () => {
  if (q.get('theme')) document.documentElement.dataset.theme = q.get('theme');
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
  const root = document.getElementById('app'); root.textContent = ''; root.style.overflow = 'auto';
  render(html`<${Harness} world=${world} />`, root);
})();
