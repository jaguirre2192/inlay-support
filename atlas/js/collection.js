// "Your atlas": the visited collection (share of the world, figures, continents, places), the
// Timeline (new places by year, trips) and Want to go (ranked, with plans), as in the app.

import { h } from 'preact';
import { useState, useMemo, useEffect, useRef } from 'preact/hooks';
import htm from 'htm';
import { t, language, upper, tracking } from './i18n.js';
import { isoSeconds } from './store.js';
import { paintPlaces, frameOf } from './placeart.js';
import { milestones } from './milestones.js';

const html = htm.bind(h);
const GROUPS = ['europe', 'asia', 'africa', 'north-america', 'south-america', 'oceania'];
const GROUP_TITLE = { europe: 'Europe', asia: 'Asia', africa: 'Africa', 'north-america': 'North America', 'south-america': 'South America', oceania: 'Oceania' };
const SEASONS = ['spring', 'summer', 'autumn', 'winter'];
const SEASON_TITLE = { spring: 'Spring', summer: 'Summer', autumn: 'Autumn', winter: 'Winter' };
const Legend = ({ children, color }) => html`<span class="legend" style=${{ color, letterSpacing: tracking() }}>${upper(children)}</span>`;

export const whenText = (w) => w.season && Number.isInteger(w.year) ? t('%@ %@', t(SEASON_TITLE[w.season]), String(w.year))
  : w.season ? t(SEASON_TITLE[w.season]) : Number.isInteger(w.year) ? String(w.year) : null;

const dateFormat = (d) => new Intl.DateTimeFormat(language(), { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(d));
const tripDates = (trip) => trip.end && trip.end.slice(0, 10) !== trip.start.slice(0, 10)
  ? new Intl.DateTimeFormat(language(), { day: 'numeric', month: 'short', year: 'numeric' }).formatRange(new Date(trip.start), new Date(trip.end))
  : dateFormat(trip.start);

export function CollectionSheet({ Sheet, world, atlas, update, name, visited, wanted, onChoose, onClose, onTool }) {
  const [tab, setTab] = useState('visited');
  const [editing, setEditing] = useState(null); // { trip } or { wish: id }
  const tabs = [['visited', t('Visited')], ['timeline', t('Timeline')], ['want', t('Want to go')]];
  return html`<${Sheet} title=${t('Your atlas')} onClose=${onClose} class="collection">
    <div class="segments" role="tablist">${tabs.map(([key, label]) =>
      html`<button role="tab" aria-selected=${tab === key} class=${tab === key ? 'on' : ''} onClick=${() => setTab(key)}>${label}</button>`)}</div>
    <div class="list">
      ${tab === 'visited' && html`<${Tools} world=${world} atlas=${atlas} visited=${visited} onTool=${onTool} />`}
      ${tab === 'visited' && html`<${VisitedTab} world=${world} name=${name} visited=${visited} wanted=${wanted} onChoose=${onChoose} />`}
      ${tab === 'timeline' && html`<${TimelineTab} world=${world} atlas=${atlas} name=${name} onTrip=${(trip) => setEditing({ trip })} />`}
      ${tab === 'want' && html`<${WantTab} atlas=${atlas} update=${update} name=${name} onChoose=${onChoose} onPlan=${(id) => setEditing({ wish: id })} />`}
    </div>
    ${editing?.trip && html`<${TripEditor} Sheet=${Sheet} world=${world} atlas=${atlas} update=${update} name=${name} trip=${editing.trip}
        onClose=${() => setEditing(null)} />`}
    ${editing?.wish && html`<${PlanEditor} Sheet=${Sheet} atlas=${atlas} update=${update} id=${editing.wish} name=${name(editing.wish)}
        onClose=${() => setEditing(null)} />`}
  <//>`;
}

function VisitedTab({ world, name, visited, wanted, onChoose }) {
  const rows = [...world.rows.values()];
  const countries = rows.filter((r) => r.kind === 'country'), territories = rows.filter((r) => r.kind === 'territory');
  const c = countries.filter((r) => visited.has(r.id)).length, tr = territories.filter((r) => visited.has(r.id)).length;
  const share = c / world.countryCount;
  const percent = new Intl.NumberFormat(language(), { style: 'percent', maximumFractionDigits: 0 }).format(share);
  return html`
    <section class="share">
      <${Legend}>${t('Your share of the world')}<//>
      <div class="share-figure"><b>${percent}</b><span>${t('of %lld countries', world.countryCount)}</span></div>
      <span class="bar"><i style=${{ width: share * 100 + '%' }}></i></span>
      <div class="figures">
        <div><b>${c}</b><small>/ ${world.countryCount}</small><${Legend}>${t('Countries')}<//></div>
        <div><b>${tr}</b><small>/ ${world.territoryCount}</small><${Legend}>${t('Territories')}<//></div>
        <div><b>${wanted.size}</b><${Legend}>${t('Want to go')}<//></div>
      </div>
    </section>
    <section>
      <${Legend}>${t('Continents')}<//>
      ${GROUPS.map((g) => {
        const ids = world.byGroup[g].filter((id) => world.rows.get(id).kind === 'country');
        const done = ids.filter((id) => visited.has(id)).length;
        return html`<div class="continent"><span>${t(GROUP_TITLE[g])}</span><span class="bar"><i style=${{ width: done / ids.length * 100 + '%' }}></i></span><span class="num">${done}/${ids.length}</span></div>`;
      })}
    </section>
    ${GROUPS.map((g) => {
      const list = world.byGroup[g].filter((id) => visited.has(id)).sort((a, b) => name(a).localeCompare(name(b), language()));
      return list.length > 0 && html`<section><${Legend}>${t(GROUP_TITLE[g])}<//>
        ${list.map((id) => html`<button class="row" onClick=${() => onChoose(id)}>
          <img class="flag" src=${`/print/assets/flags/${id.toLowerCase()}.svg`} alt="" loading="lazy" />
          <span class="row-name">${name(id)}</span></button>`)}</section>`;
    })}
    ${visited.size === 0 && html`<p class="empty">${t('Every place you mark as visited gets its own page here, stamped on the day you mark it.')}</p>`}`;
}

function TimelineTab({ world, atlas, name, onTrip }) {
  const years = useMemo(() => {
    const count = new Map();
    for (const [id, v] of Object.entries(atlas.visits)) if (v.date && world.rows.has(id)) {
      const y = Number(v.date.slice(0, 4)); count.set(y, (count.get(y) ?? 0) + 1);
    }
    if (!count.size) return [];
    const first = Math.min(...count.keys()), last = Math.max(...count.keys());
    return Array.from({ length: last - first + 1 }, (_, i) => ({ year: first + i, count: count.get(first + i) ?? 0 }));
  }, [atlas.visits]);
  const most = Math.max(1, ...years.map((y) => y.count));
  const top = years.filter((y) => y.count === most);
  const trips = [...atlas.trips].sort((a, b) => String(b.start).localeCompare(String(a.start)));
  return html`
    ${years.length > 0 && html`<section>
      <${Legend}>${t('New places by year')}<//>
      <div class="years" role="list">${years.map((y) => html`<div class="year-bar" role="listitem" aria-label=${`${y.year}: ${t('%lld new places', y.count)}`}>
        <i style=${{ height: (y.count / most * 100) + '%' }}></i><span>${'’' + String(y.year % 100).padStart(2, '0')}</span></div>`)}</div>
      ${top.length === 1 && years.length > 1 && html`<p class="sheet-line">${t('Your biggest year was %@, with %lld new places.', String(top[0].year), top[0].count)}</p>`}
    </section>`}
    <section>
      <div class="section-head"><${Legend}>${t('Trips')}<//><button class="link" onClick=${() => onTrip({})}>${t('New trip')}</button></div>
      ${trips.map((trip) => html`<button class="row trip" onClick=${() => onTrip(trip)}>
        <span class="row-name">${trip.name || t('Trip')}<small>${t('%@ · %lld places', tripDates(trip), trip.places.length)}</small></span>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m10 7 5 5-5 5"/></svg></button>`)}
      ${!trips.length && html`<p class="empty">${t('Plan your next trip or keep the route, photos and notes from one you’ve taken.')}</p>`}
    </section>`;
}

function WantTab({ atlas, update, name, onChoose, onPlan }) {
  const order = Object.entries(atlas.wanted).sort(([, a], [, b]) => (a.rank ?? 0) - (b.rank ?? 0)).map(([id]) => id);
  const move = (from, to) => update((a) => {
    const ids = Object.entries(a.wanted).sort(([, x], [, y]) => (x.rank ?? 0) - (y.rank ?? 0)).map(([id]) => id);
    const [id] = ids.splice(from, 1); ids.splice(to, 0, id);
    ids.forEach((k, i) => { a.wanted[k].rank = i; });
    return a;
  });
  if (!order.length) return html`<p class="empty">${t('Save places you’d like to visit. They’ll be outlined on your map.')}</p>`;
  return html`<section>
    <${Legend}>${t('Touch and hold to reorder · Next up shows on your widgets')}<//>
    ${order.map((id, i) => {
      const w = atlas.wanted[id], when = whenText(w);
      return html`<div class="row want-row">
        <b class="rank">${i + 1}</b>
        <button class="row-name plain" onClick=${() => onChoose(id)}>${name(id)}
          <small>${[w.nextUp ? t('Next up') : null, when, w.note].filter(Boolean).join(' · ')}</small></button>
        <button class="quiet icon" onClick=${() => onPlan(id)} aria-label=${t('Plan %@', name(id))}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg></button>
        <span class="order">
          <button class="quiet" disabled=${i === 0} onClick=${() => move(i, i - 1)} aria-label=${t('Move up')}>↑</button>
          <button class="quiet" disabled=${i === order.length - 1} onClick=${() => move(i, i + 1)} aria-label=${t('Move down')}>↓</button>
        </span>
      </div>`;
    })}
  </section>`;
}

function PlanEditor({ Sheet, atlas, update, id, name, onClose }) {
  const w = atlas.wanted[id] ?? {};
  const [note, setNote] = useState(w.note ?? ''), [season, setSeason] = useState(w.season ?? ''), [year, setYear] = useState(w.year ?? '');
  const [nextUp, setNextUp] = useState(!!w.nextUp);
  const now = new Date().getFullYear();
  const save = () => {
    update((a) => {
      if (nextUp) for (const k of Object.keys(a.wanted)) a.wanted[k].nextUp = false; // one Next up place
      a.wanted[id] = { ...a.wanted[id], note: note.trim(), season: season || undefined, year: year ? Number(year) : undefined, nextUp, modified: Date.now() / 1000 };
      return a;
    });
    onClose();
  };
  return html`<${Sheet} title=${name} onClose=${onClose} class="plan">
    <label class="field"><${Legend}>${t('Notes')}<//><textarea rows="3" value=${note} onInput=${(e) => setNote(e.target.value)}></textarea></label>
    <label class="field"><${Legend}>${t('Season')}<//>
      <select value=${season} onChange=${(e) => setSeason(e.target.value)}>
        <option value="">${t('Any time')}</option>${SEASONS.map((s) => html`<option value=${s}>${t(SEASON_TITLE[s])}</option>`)}</select></label>
    <label class="field"><${Legend}>${t('Year')}<//>
      <select value=${year} onChange=${(e) => setYear(e.target.value)}>
        <option value="">${t('Some day')}</option>${Array.from({ length: 10 }, (_, i) => now + i).map((y) => html`<option value=${y}>${y}</option>`)}</select></label>
    <label class="toggle"><input type="checkbox" checked=${nextUp} onChange=${(e) => setNextUp(e.target.checked)} /><span>${t('Next up')}</span></label>
    <div class="actions"><button class="ink" onClick=${save}>${t('Save')}</button><button class="quiet" onClick=${onClose}>${t('Cancel')}</button></div>
  <//>`;
}

function TripEditor({ Sheet, world, atlas, update, name, trip, onClose }) {
  const isNew = !trip.id;
  const today = new Date().toISOString().slice(0, 10);
  const [draft, setDraft] = useState({ name: trip.name ?? '', start: (trip.start ?? today).slice(0, 10), end: trip.end ? trip.end.slice(0, 10) : '',
                                       places: trip.places ?? [], note: trip.note ?? '' });
  const [record, setRecord] = useState(true), [adding, setAdding] = useState('');
  const upcoming = draft.start > today;
  const set = (k) => (e) => setDraft({ ...draft, [k]: e.target.value });
  const options = useMemo(() => [...world.rows.values()].sort((a, b) => name(a.id).localeCompare(name(b.id), language())), []);
  const save = () => {
    update((a) => {
      const entry = { id: trip.id ?? crypto.randomUUID().toUpperCase(), name: draft.name.trim() || (draft.places[0] ? name(draft.places[0]) : t('Trip')),
                      start: isoSeconds(draft.start + 'T12:00:00Z'), end: draft.end ? isoSeconds(draft.end + 'T12:00:00Z') : null,
                      places: draft.places, note: draft.note };
      a.trips = isNew ? [...a.trips, entry] : a.trips.map((x) => x.id === trip.id ? entry : x);
      // A past trip can record its places as visited; first-visit dates already set are kept.
      if (!upcoming && record) for (const id of draft.places) {
        a.visits[id] = a.visits[id] ?? {};
        if (!a.visits[id].date) a.visits[id].date = draft.start.slice(0, 7);
      }
      return a;
    });
    onClose();
  };
  const remove = () => {
    if (!confirm(t('Its places stay in your atlas. Its dates, note and chosen photos are removed.'))) return;
    update((a) => { a.trips = a.trips.filter((x) => x.id !== trip.id); return a; });
    onClose();
  };
  return html`<${Sheet} title=${isNew ? t('New trip') : t('Edit trip')} onClose=${onClose} class="trip">
    <label class="field"><${Legend}>${t('Trip name')}<//><input value=${draft.name} onInput=${set('name')} /></label>
    <div class="pair">
      <label class="field"><${Legend}>${upcoming ? t('Starts') : t('Started')}<//><input type="date" value=${draft.start} onInput=${set('start')} /></label>
      <label class="field"><${Legend}>${upcoming ? t('Ends') : t('Ended')}<//><input type="date" min=${draft.start} value=${draft.end} onInput=${set('end')} /></label>
    </div>
    <div class="field"><${Legend}>${t('Route')}<//>
      ${draft.places.map((id, i) => html`<div class="row stop"><b class="rank">${i + 1}</b><span class="row-name">${name(id)}</span>
        <button class="quiet" onClick=${() => setDraft({ ...draft, places: draft.places.filter((_, k) => k !== i) })} aria-label=${t('Remove')}>×</button></div>`)}
      <select value=${adding} onChange=${(e) => { if (e.target.value) setDraft({ ...draft, places: [...draft.places, e.target.value] }); setAdding(''); }}>
        <option value="">${t('Add a place')}</option>${options.map((r) => html`<option value=${r.id}>${name(r.id)}</option>`)}</select>
      <p class="sheet-line small">${upcoming ? t('In the order you plan to travel. Saving a future trip keeps your visited places and Want to go unchanged.')
        : record ? t('Saving records these places as visited. Existing first-visit dates are kept.') : t('Saving keeps your route, notes and photos. Your visited places stay unchanged.')}</p>
      ${!upcoming && html`<label class="toggle"><input type="checkbox" checked=${record} onChange=${(e) => setRecord(e.target.checked)} /><span>${t('Record places as visited')}</span></label>`}
    </div>
    <label class="field"><${Legend}>${t('Notes')}<//><textarea rows="3" value=${draft.note} onInput=${set('note')}></textarea></label>
    <div class="actions"><button class="ink" onClick=${save}>${t('Save')}</button><button class="quiet" onClick=${onClose}>${t('Cancel')}</button>
      ${!isNew && html`<span class="spacer"></span><button class="quiet danger" onClick=${remove}>${t('Delete trip')}</button>`}</div>
  <//>`;
}

// ---- the tools: small prints of the atlas, each its own slice of art (DESIGN.md, motion pass) --
function ToolPrint({ world, ids, slice, inked, onClick, title, line }) {
  const canvas = useRef(null);
  useEffect(() => {
    const c = canvas.current; if (!c) return;
    const dpr = Math.min(devicePixelRatio || 1, 2), w = c.clientWidth || 160, h = c.clientHeight || 96;
    c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
    const ctx = c.getContext('2d'); ctx.scale(dpr, dpr);
    const dark = document.documentElement.dataset.theme === 'dark';
    paintPlaces(ctx, world, { rect: slice ?? frameOf(world, ids, 0.18), width: w, height: h, inked, dark });
  }, [ids.join(), inked.size]);
  return html`<button class="tool-print" onClick=${onClick}>
    <canvas ref=${canvas} aria-hidden="true"></canvas>
    <span class="tool-words"><b>${title}</b><small>${line}</small></span>
  </button>`;
}

function Tools({ world, atlas, visited, onTool }) {
  const ids = [...visited].filter((id) => world.rows.has(id));
  const seals = useMemo(() => milestones(world, atlas), [atlas]);
  const collected = seals.filter((m) => m.collected).length;
  const sample = (list, n) => list.slice(0, n);
  const f = world.frame;
  return html`<div class="tools" role="list">
    <${ToolPrint} world=${world} ids=${ids.length ? sample(ids, 6) : ['GR']} inked=${visited} onClick=${() => onTool('passport')}
      title=${t('Passport')} line=${t('%lld pages', ids.length)} />
    <${ToolPrint} world=${world} ids=${['IT', 'FR', 'ES', 'PT']} inked=${visited} onClick=${() => onTool('milestones')}
      title=${t('Milestones')} line=${t('%lld of %lld', collected, seals.length)} />
    <${ToolPrint} world=${world} ids=${['JP']} inked=${visited} onClick=${() => onTool('photos')}
      title=${t('Photos')} line=${t('Find places')} />
    <${ToolPrint} world=${world} ids=${[]} slice=${[f[0], f[1] + f[3] * 0.1, f[2], f[3] * 0.62]} inked=${visited} onClick=${() => onTool('friends')}
      title=${t('Friends')} line=${t('Compare atlases')} />
    <${ToolPrint} world=${world} ids=${['PE', 'CL', 'AR']} inked=${visited} onClick=${() => onTool('share')}
      title=${t('Share')} line=${t('Stamps')} />
    <${ToolPrint} world=${world} ids=${['IS', 'NO']} inked=${visited} onClick=${() => onTool('print')}
      title=${t('Print')} line=${t('Framed print')} />
  </div>`;
}
