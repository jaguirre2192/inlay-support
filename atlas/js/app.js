import { h, render } from 'preact';
import { useState, useEffect, useRef, useMemo, useCallback } from 'preact/hooks';
import htm from 'htm';
import { readWorld, readLand } from './inlr.js';
import { AtlasMap } from './map.js';
import * as store from './store.js';
import { t, useLanguage, preferredLanguage, countryName, placeName, tracking, upper, LANGUAGES, language } from './i18n.js';

const html = htm.bind(h);
const GROUPS = ['europe', 'asia', 'africa', 'north-america', 'south-america', 'oceania'];
const GROUP_TITLE = { europe: 'Europe', asia: 'Asia', africa: 'Africa', 'north-america': 'North America', 'south-america': 'South America', oceania: 'Oceania' };
const groupTitle = (g) => t(GROUP_TITLE[g] ?? g);
const darkQuery = matchMedia('(prefers-color-scheme: dark)');
const COUNTRY_ART = (image) => `/print/assets/art/${image}`;

// ---- helpers ---------------------------------------------------------------------------------
function Legend({ children, color, class: cls = '' }) {
  return html`<span class=${'legend ' + cls} style=${{ color, letterSpacing: tracking() }}>${typeof children === 'string' ? upper(children) : children}</span>`;
}

function useDark(prefs) {
  const [system, setSystem] = useState(darkQuery.matches);
  useEffect(() => { const f = () => setSystem(darkQuery.matches); darkQuery.addEventListener('change', f); return () => darkQuery.removeEventListener('change', f); }, []);
  return prefs.appearance === 'dark' ? true : prefs.appearance === 'light' ? false : system;
}

function download(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// ---- app -------------------------------------------------------------------------------------
function App({ world, initial }) {
  const [atlas, setAtlas] = useState(initial);
  const [selected, setSelected] = useState(null);
  const [region, setRegion] = useState(null);
  const [, setRegionsReady] = useState(0);
  const [area, setArea] = useState({ kind: 'world' });
  const [banner, setBanner] = useState(null);
  const [sheet, setSheet] = useState(null);
  const [, setLang] = useState(language());
  const mapHost = useRef(null), map = useRef(null), panel = useRef(null), top = useRef(null);
  const dark = useDark(atlas.prefs);
  const lastRatio = useRef(1);
  const homeRef = useRef(atlas.home), selectedRef = useRef(null), sheetRef = useRef(null), previous = useRef(atlas);
  sheetRef.current = sheet;
  const [milestone, setMilestone] = useState(null);
  const [launching, setLaunching] = useState(!matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [globe, setGlobe] = useState(false), [mapReady, setMapReady] = useState(false);
  selectedRef.current = selected;
  homeRef.current = atlas.home;
  const visited = useMemo(() => new Set(Object.keys(atlas.visits)), [atlas.visits]);
  const wanted = useMemo(() => new Set(Object.keys(atlas.wanted)), [atlas.wanted]);
  const name = useCallback((id) => { const r = world.rows.get(id); return r ? countryName(id, r.name) : id; }, [world, language()]);
  const shortName = useCallback((id) => { const r = world.rows.get(id); return r ? countryName(id, r.short) : id; }, [world, language()]);

  const update = useCallback((fn) => setAtlas((a) => { const next = fn(structuredClone(a)); store.save(next); return next; }), []);

  // The map, once.
  useEffect(() => {
    const m = new AtlasMap(mapHost.current, world, {
      artURL: COUNTRY_ART,
      label: (id) => upper(shortName(id)),
      cityLabel: placeName,
      tracking,
      home: () => homeRef.current,
      regions: world.regions,
      focusCountry: () => selectedRef.current,
      onRegions: () => setRegionsReady((n) => n + 1),
      // Pinching on past the whole world: ratio is the fingers' span against where it started.
      onBeyond: (ratio, ended) => { if (ended) curlToGlobe(curlProgress(1, lastRatio.current), true); else { lastRatio.current = ratio; curlToGlobe(curlProgress(1, ratio)); } },
      onSelect: (id, regionID) => {
        if (regionID) { setRegion(regionID); return; }
        setRegion(null); setSelected(id); if (!id) setArea({ kind: 'world' });
      },
      insets: () => {
        const p = panel.current?.getBoundingClientRect(), tp = top.current?.getBoundingClientRect(), host = mapHost.current.getBoundingClientRect();
        const wide = host.width >= 600 && host.width > host.height;
        return { top: (tp?.bottom ?? 60) - host.top + 8, bottom: wide ? 16 : host.bottom - (p?.top ?? host.bottom) + 12,
                 left: wide ? (p?.right ?? 0) - host.left + 16 : 0, right: 0 };
      },
    });
    map.current = m;
    window.__atlas = m;
    setMapReady(true);
    const key = (e) => {
      if (e.target.closest('input,textarea,select,[contenteditable]')) return;
      if (e.key === '/') { e.preventDefault(); setSheet('search'); return; }
      if (e.key === 'Escape') { setSheet(null); setSelected(null); setArea({ kind: 'world' }); m.frameWorld(); return; }
      if (sheetRef.current) return;
      if (m.key(e)) e.preventDefault();
    };
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  }, []);

  useEffect(() => { map.current?.set({ visited, wanted, selected, dark, region, wholeCountries: !!atlas.prefs.wholeCountries }); },
            [visited, wanted, selected, dark, region, atlas.prefs.wholeCountries]);
  useEffect(() => { document.documentElement.dataset.theme = dark ? 'dark' : 'light'; }, [dark]);

  // Selecting a place frames it.
  useEffect(() => {
    if (!selected) return;
    const r = world.rows.get(selected);
    if (r) { setArea({ kind: 'country', id: selected }); requestAnimationFrame(() => map.current.frame(r.focus)); map.current.ensureRegions(selected); }
  }, [selected]);
  useEffect(() => {
    const row = region && world.regions.rows.get(region);
    if (row) requestAnimationFrame(() => map.current.frame(row.focusFrame ?? row.bounds));
  }, [region]);

  const choose = (id) => {
    setSheet(null);
    const row = world.regions.rows.get(id);
    if (row) { setSelected(row.countryID); setRegion(id); } else { setRegion(null); setSelected(id); }
  };
  const chooseRegion = (id) => { setSheet(null); setRegion(id); };
  const regionName = (id) => placeName(world.regions.rows.get(id)?.name ?? id);
  const showGroup = (g) => { setSelected(null); setRegion(null); setArea({ kind: 'group', id: g }); map.current.frame(world.groups[g]); };
  const showWorld = () => { setSelected(null); setRegion(null); setArea({ kind: 'world' }); map.current.frameWorld(); };

  const mark = (id) => {
    const before = atlas, row = world.regions.rows.get(id), parent = row?.countryID;
    const parentNew = parent && !atlas.visits[parent];
    update((a) => { a.visits[id] = a.visits[id] ?? {}; if (parent) a.visits[parent] = a.visits[parent] ?? {}; return a; });
    if (!row || parentNew) map.current.stamp(parent ?? id);
    const label = row ? regionName(id) : name(id);
    setBanner({ text: parentNew ? t('%@ and %@ added to your atlas', label, name(parent)) : t('%@ added to your atlas', label),
                undo: () => { setAtlas(before); store.save(before); if (!row || parentNew) map.current.stamp(parent ?? id, true); } });
  };
  const unmark = (id) => {
    const before = atlas;
    const isRegion = world.regions.rows.has(id);
    update((a) => { delete a.visits[id]; return a; });
    if (!isRegion) map.current.stamp(id, true);
    setBanner({ text: t('%@ removed', isRegion ? regionName(id) : name(id)), undo: () => { setAtlas(before); store.save(before); if (!isRegion) map.current.stamp(id); } });
  };
  const toggleWant = (id) => {
    const before = atlas, had = !!atlas.wanted[id];
    update((a) => { if (had) delete a.wanted[id]; else a.wanted[id] = { rank: Object.keys(a.wanted).length, note: '', nextUp: false, modified: Date.now() / 1000 }; return a; });
    setBanner({ text: had ? t('%@ removed from Want to go', name(id)) : t('%@ saved to Want to go', name(id)),
                undo: () => { setAtlas(before); store.save(before); } });
  };
  // A milestone collected by any change (mark, trip, import) is celebrated once, as in the app.
  useEffect(() => {
    const got = newlyCollected(world, previous.current, atlas);
    previous.current = atlas;
    if (got?.length) setMilestone(got.at(-1));
  }, [atlas]);
  // An invitation link (/atlas/#INLAY2-…) opens straight into the comparison; the code
  // leaves the address bar so it stays out of history.
  useEffect(() => { (async () => {
    const shared = await openInviteFromURL(location).catch(() => null);
    if (!shared) return;
    update((a) => { addFriend(a, shared); return a; });
    setSheet({ kind: 'friends', open: friendID(shared) });
    history.replaceState(null, '', location.pathname);
  })(); }, []);
  const addWant = (id) => update((a) => { a.wanted[id] = a.wanted[id] ?? { rank: Object.keys(a.wanted).length, note: '', nextUp: false, modified: Date.now() / 1000 }; return a; });
  useEffect(() => { if (!banner) return; const timer = setTimeout(() => setBanner(null), 6000); return () => clearTimeout(timer); }, [banner]);

  const counts = useMemo(() => {
    let c = 0, tr = 0;
    for (const id of visited) { const r = world.rows.get(id); if (r?.kind === 'country') c++; else if (r?.kind === 'territory') tr++; }
    return { countries: c, territories: tr };
  }, [visited]);

  const changeLanguage = async (code) => {
    await useLanguage(code);
    update((a) => { a.prefs.language = code; return a; });
    setLang(code);
    map.current.renderer.requestDraw();
  };

  return html`
    <div class="atlas" data-sheet=${sheet ? 'open' : ''}>
      <div class="map" ref=${mapHost} role="application" aria-label=${t('World')}></div>
      ${mapReady && area.kind === 'world' && !selected && html`<${GlobeView} world=${world} atlas=${atlas} dark=${dark} view=${() => map.current?.view}
          insets=${() => map.current?.options.insets()} active=${globe}
          onPick=${(id) => { setGlobe(false); choose(id); }} onFlat=${() => setGlobe(false)} onCurlEnd=${(g) => setGlobe(g)} />`}
      ${mapReady && launching && html`<${GlobeLaunch} world=${world} atlas=${atlas} dark=${dark} view=${() => map.current?.view}
          insets=${() => map.current?.options.insets()} onDone=${() => setLaunching(false)} />`}
      <div class="wash" aria-hidden="true"></div>
      <header class="top" ref=${top}>
        <a class="wordmark" href="/" aria-label="Inlay">INLAY</a>
      </header>
      <button class="glass count-card" onClick=${() => setSheet('collection')} aria-label=${t('%lld countries, %lld territories', counts.countries, counts.territories)}>
        <span class="figure"><b>${counts.countries}</b><span class="of"> / ${world.countryCount}</span></span>
        <${Legend}>${t('Countries')}<//>
        <span class="bar"><i style=${{ width: (counts.countries / world.countryCount * 100) + '%' }}></i></span>
      </button>
      <nav class="rail">
        <button class="glass round" onClick=${() => setSheet('search')} aria-label=${t('Find a place')} title=${t('Find a place')}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/></svg>
        </button>
        ${area.kind === 'world' && !selected && html`<button class="glass round" onClick=${() => setGlobe(!globe)}
            aria-label=${globe ? t('Show flat map') : t('Show globe')} title=${globe ? t('Show flat map') : t('Show globe')}>
          ${globe ? html`<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="18" height="12" rx="1.5"/><path d="M3 12h18M12 6v12"/></svg>`
                  : html`<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.2 3 14.8 0 18M12 3c-3 3.2-3 14.8 0 18"/></svg>`}
        </button>`}
        <button class="glass round" onClick=${() => setSheet('settings')} aria-label=${t('Settings')} title=${t('Settings')}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3M4.9 4.9 7 7m10 10 2.1 2.1M4.9 19.1 7 17m10-10 2.1-2.1"/></svg>
        </button>
      </nav>
      <${Panel} ref_=${panel} world=${world} atlas=${atlas} area=${area} selected=${selected} name=${name}
        region=${region} regionName=${regionName} onCountry=${() => { setRegion(null); const r = world.rows.get(selected); if (r) map.current.frame(r.focus); }}
        onRegions=${() => setSheet('regions')}
        visited=${visited} wanted=${wanted} counts=${counts} banner=${banner} onDismissBanner=${() => setBanner(null)}
        onWorld=${showWorld} onGroup=${showGroup} onChoose=${() => setSheet('search')}
        onMark=${mark} onUnmark=${unmark} onWant=${toggleWant} onDate=${(id) => setSheet({ kind: 'date', id })}
        onInfo=${(id) => setSheet({ kind: 'place', id })}
        milestone=${milestone} onMilestone=${() => { setMilestone(null); setSheet('milestones'); }} onDismissMilestone=${() => setMilestone(null)} />
      ${sheet === 'search' && html`<${SearchSheet} world=${world} name=${name} visited=${visited} wanted=${wanted} onChoose=${choose} onClose=${() => setSheet(null)} />`}
      ${sheet === 'collection' && html`<${CollectionSheet} Sheet=${Sheet} world=${world} atlas=${atlas} update=${update} name=${name}
          visited=${visited} wanted=${wanted} onChoose=${choose} onClose=${() => setSheet(null)} onTool=${(tool) => setSheet(tool)} />`}
      ${sheet === 'milestones' && html`<${MilestonesSheet} Sheet=${Sheet} world=${world} atlas=${atlas} name=${name} onChoose=${choose} onClose=${() => setSheet(null)} />`}
      ${sheet === 'passport' && html`<${PassportSheet} Sheet=${Sheet} world=${world} atlas=${atlas} name=${name}
          onShare=${(id) => setSheet({ kind: 'share', design: 'passport', placeID: id })} onClose=${() => setSheet(null)} />`}
      ${(sheet === 'friends' || sheet?.kind === 'friends') && html`<${FriendsSheet} Sheet=${Sheet} world=${world} atlas=${atlas} update=${update} name=${name}
          visited=${visited} wanted=${wanted} openID=${sheet?.open} onWant=${addWant} onChoose=${choose} onClose=${() => setSheet(null)} />`}
      ${(sheet === 'share' || sheet?.kind === 'share') && html`<${ShareSheet} Sheet=${Sheet} world=${world} atlas=${atlas} name=${name} visited=${visited}
          friend=${sheet?.friend} design=${sheet?.design} placeID=${sheet?.placeID} onClose=${() => setSheet(null)} />`}
      ${sheet === 'yearinreview' && html`<${YearInReviewSheet} Sheet=${Sheet} world=${world} atlas=${atlas} name=${name} visited=${visited} onClose=${() => setSheet(null)} />`}
      ${sheet === 'print' && html`<${PrintSheet} Sheet=${Sheet} world=${world} atlas=${atlas} onClose=${() => setSheet(null)} />`}
      ${sheet === 'photos' && html`<${PhotosSheet} Sheet=${Sheet} world=${world} atlas=${atlas} update=${update} name=${name} regionName=${regionName}
          visited=${visited} loadRegions=${(id) => map.current.ensureRegions(id)} onClose=${() => setSheet(null)} />`}
      ${sheet?.kind === 'place' && html`<${PlaceSheet} Sheet=${Sheet} world=${world} atlas=${atlas} id=${sheet.id} name=${name}
          visited=${visited} wanted=${wanted} onMark=${mark} onUnmark=${unmark} onClose=${() => setSheet(null)} />`}
      ${sheet === 'regions' && selected && html`<${RegionSheet} world=${world} country=${selected} name=${name} regionName=${regionName}
          visited=${visited} wholeCountries=${!!atlas.prefs.wholeCountries} onChoose=${chooseRegion} onClose=${() => setSheet(null)} />`}
      ${sheet === 'settings' && html`<${SettingsSheet} world=${world} atlas=${atlas} name=${name} update=${update} setAtlas=${setAtlas}
          onLanguage=${changeLanguage} onClose=${() => setSheet(null)} />`}
      ${sheet?.kind === 'date' && html`<${DateSheet} id=${sheet.id} name=${name(sheet.id)} value=${atlas.visits[sheet.id]?.date}
          onSave=${(date) => { update((a) => { a.visits[sheet.id] = { ...(a.visits[sheet.id] ?? {}), date: date ?? undefined }; if (!date) delete a.visits[sheet.id].date; return a; }); setSheet(null); }}
          onClose=${() => setSheet(null)} />`}
      ${atlas.memoryOnly && html`<p class="memory-note">${tw('This browser isn’t keeping data, so your atlas lasts until you close the page. Export it to keep it.')}</p>`}
    </div>`;
}

// ---- the place panel -------------------------------------------------------------------------
/** What a country's subregions are called, lowercase plural (PlaceNames.kind in the app). */
const KINDS = ['states', 'provinces', 'prefectures', 'voivodeships', 'autonomous communities', 'divisions', 'island groups', 'areas', 'countries'];
export const kindWord = (kind) => t(KINDS.includes(kind) ? kind : 'regions');

function Panel({ ref_, world, atlas, area, selected, region, name, regionName, visited, wanted, counts, banner, onDismissBanner,
                 onWorld, onGroup, onChoose, onCountry, onRegions, onMark, onUnmark, onWant, onDate, onInfo,
                 milestone, onMilestone, onDismissMilestone }) {
  const row = selected ? world.rows.get(selected) : null;
  const regionRow = region ? world.regions.rows.get(region) : null;
  const target = regionRow && regionRow.markable !== false ? region : row?.id;
  const isVisited = target && visited.has(target), isWanted = row && !regionRow && wanted.has(row.id);
  const date = target && atlas.visits[target]?.date;
  const share = Math.round(counts.countries / world.countryCount * 100);
  const markable = row ? (world.regions.byCountry.get(row.id) ?? []).filter((r) => r.markable !== false) : [];
  let title, legend;
  if (regionRow) {
    title = regionName(region);
    const parts = [name(row.id)];
    if (regionRow.markable !== false) parts.push(isVisited ? (date ? t('Visited %@', formatDate(date)) : t('Visited')) : t('Not yet visited'));
    legend = parts.join(' · ');
  } else if (row) {
    title = name(row.id);
    const parts = [row.kind === 'territory' ? t('Territory') : groupTitle(row.group)];
    if (isVisited) parts.push(date ? t('Visited %@', formatDate(date)) : t('Visited'));
    else if (isWanted) parts.push(t('On your Want to go list'));
    else parts.push(t('Not yet visited'));
    legend = parts.join(' · ');
  } else if (area.kind === 'group') {
    title = groupTitle(area.id);
    legend = t('%@ · %lld destinations', groupTitle(area.id), world.byGroup[area.id].length);
  } else {
    title = t('All places');
    legend = t('%lld of %lld countries · %@ of the world', counts.countries, world.countryCount, `${share}%`);
  }
  const regionsDone = markable.filter((r) => visited.has(r.id)).length;
  return html`
    <section class="panel glass" ref=${ref_} aria-live="polite">
      ${milestone && html`<${MilestoneBanner} milestone=${milestone} onDismiss=${onDismissMilestone} onOpen=${onMilestone} />`}
      ${banner && html`<div class="banner">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>
        <span>${banner.text}</span>
        <button class="link" onClick=${() => { banner.undo(); onDismissBanner(); }}>${t('Undo')}</button>
        <button class="x" onClick=${onDismissBanner} aria-label=${t('Dismiss visit update')}>×</button>
      </div>`}
      <div class="title-row">
        <button class="crumb" onClick=${onWorld}><${Legend} color=${area.kind === 'world' && !row ? 'var(--ink)' : 'var(--sage)'}>${t('World')}<//></button>
        <span class="slash" aria-hidden="true">/</span>
        ${regionRow && html`<button class="crumb" onClick=${onCountry}><${Legend} color="var(--sage)">${name(row.id)}<//></button>
          <span class="slash" aria-hidden="true">/</span>`}
        <button class="place-title" onClick=${regionRow ? onRegions : onChoose} aria-label=${t('Choose destination')}>
          <span>${title}</span>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5"/></svg>
        </button>
        ${row && !regionRow && markable.length > 0 && html`<span class="spacer"></span>
          <button class="chip" onClick=${onRegions}><${Legend} color="var(--paper)">${kindWord(world.regions.kinds[row.id])}<//>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5"/></svg></button>`}
      </div>
      <${Legend} class="status">${legend}<//>
      ${row ? html`
        <div class="actions">
          ${regionRow && regionRow.markable === false ? null : isVisited ? html`
            <button class="outline" onClick=${() => onDate(target)}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4m6-4v4"/></svg>
              ${date ? formatDate(date) : t('Add date')}
            </button>
            <button class="outline round" onClick=${() => onInfo(target)} aria-label=${t('About %@', title)}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.01"/></svg></button>
            <span class="spacer"></span>
            <button class="quiet" onClick=${() => onUnmark(target)}>${t('Unmark')}</button>
          ` : html`
            <button class="ink" onClick=${() => onMark(target)}>${t('Mark as visited')}</button>
            <button class="outline round" onClick=${() => onInfo(target)} aria-label=${t('About %@', title)}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.01"/></svg></button>
            ${!regionRow && html`<button class=${'outline round' + (isWanted ? ' on' : '')} onClick=${() => onWant(row.id)} aria-label=${t('Want to go')} aria-pressed=${isWanted}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4h10v16l-5-3.5L7 20z"/></svg>
            </button>`}
          `}
        </div>
        ${!regionRow && markable.length > 0 && html`<button class="regions-row" onClick=${onRegions}>
          <${Legend}>${kindWord(world.regions.kinds[row.id])}<//>
          <span class="bar"><i style=${{ width: regionsDone / markable.length * 100 + '%' }}></i></span>
          <span class="num">${t('%lld of %lld', regionsDone, markable.length)}</span>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m10 7 5 5-5 5"/></svg>
        </button>`}` : html`
        <div class="tiles" role="list">
          ${(area.kind === 'group' ? [area.id] : GROUPS).map((g) => {
            const ids = world.byGroup[g].filter((id) => world.rows.get(id).kind === 'country');
            const done = ids.filter((id) => visited.has(id)).length;
            return html`<button class="tile" role="listitem" onClick=${() => onGroup(g)}>
              <span class="tile-name">${groupTitle(g)}</span>
              <span class="tile-foot"><span class="bar"><i style=${{ width: done / ids.length * 100 + '%' }}></i></span><span class="num">${done}/${ids.length}</span></span>
            </button>`;
          })}
        </div>`}
    </section>`;
}

function RegionSheet({ world, country, name, regionName, visited, wholeCountries, onChoose, onClose }) {
  const kind = world.regions.kinds[country];
  const rows = (world.regions.byCountry.get(country) ?? []).filter((r) => r.markable !== false)
    .sort((a, b) => regionName(a.id).localeCompare(regionName(b.id), language()));
  const done = rows.filter((r) => visited.has(r.id)).length;
  return html`<${Sheet} title=${name(country)} onClose=${onClose} class="search">
    <p class="sheet-line">${t('%lld of %lld %@ visited', done, rows.length, kindWord(kind))}</p>
    <p class="sheet-line small">${wholeCountries
      ? t('Marking one also marks %@. Your map shows all of %@ (Light up whole countries, in Settings); the %@ you mark are kept here.', name(country), name(country), kindWord(kind))
      : t('Marking one also marks %@. Unvisited %@ fade on the map once you’ve marked any.', name(country), kindWord(kind))}</p>
    <div class="list">
      ${rows.map((r) => html`<button class="row" onClick=${() => onChoose(r.id)}>
        <span class="row-name">${regionName(r.id)}</span>
        ${visited.has(r.id) && html`<svg class="tick" viewBox="0 0 24 24" aria-label=${t('Visited')}><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>`}
      </button>`)}
    </div>
  <//>`;
}

const formatDate = (d) => {
  const [y, m] = d.split('-').map(Number);
  return m ? new Intl.DateTimeFormat(language(), { month: 'long', year: 'numeric' }).format(new Date(y, m - 1, 1)) : String(y);
};

// ---- sheets ----------------------------------------------------------------------------------
function Sheet({ title, onClose, children, class: cls = '' }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    (el.querySelector('input[type=search]') ?? el.querySelector('.sheet-head button'))?.focus();
    const esc = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    el.addEventListener('keydown', esc);
    return () => el.removeEventListener('keydown', esc);
  }, []);
  return html`<div class="scrim" onClick=${(e) => e.target === e.currentTarget && onClose()}>
    <div class=${'sheet ' + cls} role="dialog" aria-modal="true" aria-label=${title} ref=${ref}>
      <div class="sheet-head"><h2>${title}</h2><button class="glass pill" onClick=${onClose}>${t('Done')}</button></div>
      ${children}
    </div></div>`;
}

function SearchSheet({ world, name, visited, wanted, onChoose, onClose }) {
  const [q, setQ] = useState('');
  const fold = (s) => s.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase();
  const rows = useMemo(() => {
    const needle = fold(q.trim());
    return [...world.rows.values()].filter((r) => !needle || fold(name(r.id)).includes(needle) || fold(r.name).includes(needle))
      .sort((a, b) => name(a.id).localeCompare(name(b.id), language()));
  }, [q]);
  const grouped = GROUPS.map((g) => [g, rows.filter((r) => r.group === g)]).filter(([, list]) => list.length);
  return html`<${Sheet} title=${t('Places')} onClose=${onClose} class="search">
    <input class="search-field" type="search" placeholder=${t('Find a place')} value=${q} onInput=${(e) => setQ(e.target.value)}
      onKeyDown=${(e) => { if (e.key === 'Enter' && rows[0]) onChoose(rows[0].id); }} aria-label=${t('Find a place')} />
    <div class="list">
      ${grouped.map(([g, list]) => html`<section>
        <${Legend} class="section-title">${groupTitle(g)}<//>
        ${list.map((r) => html`<button class="row" onClick=${() => onChoose(r.id)}>
          <img class="flag" src=${`/print/assets/flags/${r.id.toLowerCase()}.svg`} alt="" loading="lazy" />
          <span class="row-name">${name(r.id)}${r.kind === 'territory' && html`<small>${t('Territory')}</small>`}</span>
          ${visited.has(r.id) ? html`<svg class="tick" viewBox="0 0 24 24" aria-label=${t('Visited')}><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>`
            : wanted.has(r.id) ? html`<svg class="tick want" viewBox="0 0 24 24" aria-label=${t('Want to go')}><path d="M7 4h10v16l-5-3.5L7 20z"/></svg>` : null}
        </button>`)}
      </section>`)}
    </div>
  <//>`;
}

function DateSheet({ name, value, onSave, onClose }) {
  const now = new Date();
  const [year, setYear] = useState(value ? Number(value.slice(0, 4)) : now.getFullYear());
  const [month, setMonth] = useState(value?.length > 4 ? Number(value.slice(5)) : null);
  const months = Array.from({ length: 12 }, (_, i) => new Intl.DateTimeFormat(language(), { month: 'short' }).format(new Date(2026, i, 1)));
  const future = (m) => year === now.getFullYear() && m > now.getMonth() + 1;
  return html`<${Sheet} title=${t('Date of first visit')} onClose=${onClose} class="date">
    <p class="sheet-line">${name}</p>
    <div class="stepper">
      <button class="outline round" onClick=${() => setYear(year - 1)} aria-label="−">−</button>
      <b class="year">${year}</b>
      <button class="outline round" disabled=${year >= now.getFullYear()} onClick=${() => setYear(year + 1)} aria-label="+">+</button>
    </div>
    <div class="months">${months.map((m, i) => html`<button class=${'month' + (month === i + 1 ? ' on' : '')} disabled=${future(i + 1)}
      onClick=${() => setMonth(month === i + 1 ? null : i + 1)}>${m}</button>`)}</div>
    <div class="actions">
      <button class="ink" onClick=${() => onSave(month ? `${year}-${String(month).padStart(2, '0')}` : String(year))}>${t('Save')}</button>
      ${value && html`<button class="quiet" onClick=${() => onSave(null)}>${t('Remove date')}</button>`}
    </div>
  <//>`;
}

function SettingsSheet({ world, atlas, name, update, setAtlas, onLanguage, onClose }) {
  const [note, setNote] = useState(null);
  const file = useRef(null);
  const describe = (id) => { const r = world.rows.get(id); return r && { kind: r.kind, name: r.name }; };
  const doImport = async (e) => {
    const f = e.target.files?.[0]; e.target.value = '';
    if (!f) return;
    try {
      const data = store.readExport(await f.text());
      const { atlas: next, summary } = store.addExport(atlas, data, (id) => world.rows.has(id));
      setAtlas(next); store.save(next);
      const parts = [];
      if (summary.visited) parts.push(t('%lld visited places', summary.visited));
      if (summary.wanted) parts.push(t('%lld Want to go places', summary.wanted));
      if (summary.trips) parts.push(t('%lld trips', summary.trips));
      let text = parts.length ? t('Added %@.', new Intl.ListFormat(language(), { type: 'conjunction' }).format(parts))
                              : t('Everything in this file is already in your atlas.');
      if (summary.skipped) text += ' ' + t('%lld places weren’t recognised.', summary.skipped);
      setNote(text);
    } catch (err) {
      setNote(err.message === 'newerVersion' ? t('This file was made by a newer version of Inlay. Update Inlay, then import it again.')
                                             : t('That isn’t an Inlay atlas file. Choose a file made with Export your atlas.'));
    }
  };
  return html`<${Sheet} title=${t('Settings')} onClose=${onClose} class="settings">
    <section class="group">
      <label class="field"><${Legend}>${tw('Language')}<//>
        <select value=${language()} onChange=${(e) => onLanguage(e.target.value)}>
          ${LANGUAGES.map(([code, label]) => html`<option value=${code}>${label}</option>`)}
        </select></label>
      <label class="field"><${Legend}>${t('Home country')}<//>
        <select value=${atlas.home ?? ''} onChange=${(e) => update((a) => { a.home = e.target.value || null; return a; })}>
          <option value="">—</option>
          ${[...world.rows.values()].filter((r) => r.kind === 'country').sort((a, b) => name(a.id).localeCompare(name(b.id), language()))
            .map((r) => html`<option value=${r.id}>${name(r.id)}</option>`)}
        </select></label>
      <label class="toggle"><input type="checkbox" checked=${!!atlas.prefs.wholeCountries}
          onChange=${(e) => update((a) => { a.prefs.wholeCountries = e.target.checked; return a; })} />
        <span>${t('Light up whole countries')}</span></label>
      <label class="field"><${Legend}>${tw('Appearance')}<//>
        <select value=${atlas.prefs.appearance ?? 'system'} onChange=${(e) => update((a) => { a.prefs.appearance = e.target.value; return a; })}>
          <option value="system">${tw('Automatic')}</option><option value="light">${tw('Light')}</option><option value="dark">${tw('Dark')}</option>
        </select></label>
    </section>
    <section class="group">
      <${Legend} class="section-title">${tw('Your atlas and the app')}<//>
      <p class="sheet-line">${tw('Your atlas is kept in this browser. To move it between the Inlay app and the web, export it on one and import it on the other: places, dates, Want to go plans and trips come along.')}</p>
      <div class="actions">
        <button class="outline" onClick=${() => download('Inlay atlas.json', store.writeExport(atlas, describe))}>${t('Export your atlas')}</button>
        <button class="outline" onClick=${() => file.current.click()}>${t('Import an atlas file')}</button>
        <input ref=${file} type="file" accept="application/json,.json" hidden onChange=${doImport} />
      </div>
      ${note && html`<p class="note" role="status">${note}</p>`}
    </section>
    <section class="group links">
      <a href="/">${tw('Inlay gallery')}</a> · <a href="/print/">${tw('Print your atlas')}</a> · <a href="/print/credits.html">${t('Map credits')}</a> · <a href="/privacy/">${tw('Privacy')}</a>
    </section>
  <//>`;
}

// Strings the app doesn't have; translated here (WEB_STRINGS) and looked up by key.
import { WEB_STRINGS } from './web-strings.js';
import { CollectionSheet } from './collection.js';
import { MilestonesSheet, MilestoneBanner, newlyCollected } from './milestones.js';
import { PassportSheet } from './passport.js';
import { FriendsSheet, openInviteFromURL, addFriend, friendID } from './friends.js';
import { PlaceSheet, PrintSheet } from './placeinfo.js';
import { PhotosSheet } from './photos.js';
import { ShareSheet } from './share.js';
import { YearInReviewSheet } from './yearinreview.js';
import { GlobeLaunch, GlobeView, curlToGlobe, curlProgress } from './globe.js';
function tw(key) { return WEB_STRINGS[language()]?.[key] ?? key; }

// ---- start -----------------------------------------------------------------------------------
async function start() {
  const root = document.getElementById('app');
  try {
    const initial = await store.load();
    await useLanguage(preferredLanguage(initial.prefs?.language));
    const [meta, places, land, regionIndex] = await Promise.all([
      fetch('./data/world.json', { cache: 'force-cache' }).then((r) => r.json()),
      readWorld('./data/world.inlr'), readLand('./data/land.inlr'),
      fetch('./data/regions.json', { cache: 'force-cache' }).then((r) => r.json()),
    ]);
    const regionRows = new Map(regionIndex.regions.map((r) => [r.id, r]));
    const byCountry = new Map();
    for (const r of regionIndex.regions) { if (!byCountry.has(r.countryID)) byCountry.set(r.countryID, []); byCountry.get(r.countryID).push(r); }
    const regions = { files: regionIndex.files, kinds: regionIndex.kinds, rows: regionRows, byCountry };
    const rows = new Map(meta.places.map((r) => [r.id, r]));
    for (const [id, p] of places) p.row = rows.get(id);
    const byGroup = Object.fromEntries(GROUPS.map((g) => [g, meta.places.filter((r) => r.group === g).map((r) => r.id)]));
    const world = { frame: [0, 0, meta.frame[2], meta.frame[3]], places, land, rows, byGroup, groups: meta.groups, regions,
                    overviews: meta.overviews, countryCount: meta.countryCount, territoryCount: meta.territoryCount };
    root.textContent = '';
    render(html`<${App} world=${world} initial=${initial} />`, root);
  } catch (e) {
    console.error(e);
    root.innerHTML = '';
    const p = document.createElement('p'); p.className = 'fatal';
    p.textContent = e.message?.includes('WebGL') ? 'This browser can’t draw the atlas (WebGL 2 is off or unavailable).' : 'The atlas couldn’t load. Check your connection and reload.';
    root.append(p);
  }
}
start();
