// Milestones (Milestones.swift): 36 collectable seals, like stamp pages in an album, in the app's
// chapters. The album lists the three closest to done first with what is left by name, then a page
// per part of the world; each seal opens on its places on the map, any of which shows on the map.
//
//   import { MilestonesSheet, MilestoneBanner, milestones, newlyCollected } from './milestones.js';
//   // link css/milestones.css and css/passport.css (the art backdrop and stamp press live there)
//   html`<${MilestonesSheet} Sheet=${Sheet} world=${world} atlas=${atlas} name=${name}
//          visited=${visited} onChoose=${(id) => …} onClose=${…} />`
//
// onChoose(id) gets a country or territory ID, or a region ID (US-CA, CA-BC…) for Fifty states,
// True north and Coast to coast: world.regions.rows.get(id).countryID is its country.
//
//   milestones(world, atlas) -> [{ id, title, detail, symbol, chapter, chapterTitle, kind,
//                                  done, total, collected, places: [ids], remaining: 'Latvia and Lithuania to go' }]
//   closest(list)            -> up to three begun and nearest to done
//   newlyCollected(world, before, after) -> milestones collected by going from `before` to `after`
//     (two saved atlases) that were never collected before on this device. Remembers when each was
//     first collected (localStorage), so each is celebrated once and the album can date it. Show the
//     last one: html`<${MilestoneBanner} milestone=${m} onDismiss=${…} onOpen=${…} />`.

import { h } from 'preact';
import { useState, useEffect, useRef, useMemo } from 'preact/hooks';
import htm from 'htm';
import { t, language, upper, tracking, countryName, placeName } from './i18n.js';
import { Backdrop, StampPress } from './passport.js';

const html = htm.bind(h);
const Legend = ({ children, color, class: cls = '' }) =>
  html`<span class=${'legend ' + cls} style=${{ color, letterSpacing: tracking() }}>${upper(children)}</span>`;
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---- the 36 seals ----------------------------------------------------------------------------
export const CHAPTERS = [['count', 'The count'], ['europe', 'Europe'], ['americas', 'The Americas'], ['asia', 'Asia'],
  ['africa', 'Africa'], ['oceania', 'Oceania'], ['journeys', 'Journeys']];

const M = (id, title, detail, symbol, kind, chapter = 'europe') => ({ id, title, detail, symbol, kind, chapter });
const set = (...ids) => ({ set: ids });

export const MILESTONES = [
  M('first', 'First page', 'Your first country', 'book.closed', { countries: 1 }, 'count'),
  M('five', 'Five countries', 'Five countries visited', '5.circle', { countries: 5 }, 'count'),
  M('ten', 'Ten countries', 'Ten countries visited', '10.circle', { countries: 10 }, 'count'),
  M('twentyfive', 'Seasoned', '25 countries visited', 'globe.europe.africa', { countries: 25 }, 'count'),
  M('fifty', 'Cartographer', '50 countries visited', 'globe', { countries: 50 }, 'count'),
  M('hundred', 'Centurion', '100 countries visited', 'crown', { countries: 100 }, 'count'),
  M('threecontinents', 'Three continents', 'A place on each of three continents', '3.circle', { continents: 3 }, 'count'),
  M('sixcontinents', 'Every continent', 'A place in Europe, Asia, Africa, Oceania and both Americas', 'globe.desk', { continents: 6 }, 'count'),

  M('nordic', 'Nordic set', 'Denmark, Finland, Iceland, Norway and Sweden', 'snowflake', set('DK', 'FI', 'IS', 'NO', 'SE')),
  M('benelux', 'Benelux', 'Belgium, the Netherlands and Luxembourg', 'building.columns', set('BE', 'NL', 'LU')),
  M('baltic', 'Baltic coast', 'Estonia, Latvia and Lithuania', 'water.waves', set('EE', 'LV', 'LT')),
  M('iberia', 'Iberia', 'Spain, Portugal, Andorra and Gibraltar', 'sun.max', set('ES', 'PT', 'AD', 'GI')),
  M('isles', 'The Isles', 'UK, Ireland, the Isle of Man, Jersey and Guernsey', 'cloud.drizzle', set('GB', 'IE', 'IM', 'JE', 'GG')),
  M('alps', 'Alpine', 'Switzerland, Austria, Liechtenstein and Slovenia', 'mountain.2', set('CH', 'AT', 'LI', 'SI')),
  M('micro', 'Microstates', 'Andorra, Liechtenstein, Monaco, San Marino, Vatican City and Malta', 'seal', set('AD', 'LI', 'MC', 'SM', 'VA', 'MT')),
  M('balkans', 'Balkan road', 'Every country of the western Balkans', 'road.lanes', set('AL', 'BA', 'ME', 'MK', 'RS', 'XK', 'HR', 'SI')),
  M('caucasus', 'Caucasus', 'Armenia, Azerbaijan and Georgia', 'mountain.2.fill', set('AM', 'AZ', 'GE')),

  M('northamerica', 'Continental', 'Canada, the United States and Mexico', 'map', set('CA', 'US', 'MX'), 'americas'),
  M('central', 'The isthmus', 'All seven Central American countries', 'leaf', set('BZ', 'GT', 'HN', 'SV', 'NI', 'CR', 'PA'), 'americas'),
  M('antilles', 'Greater Antilles', 'Cuba, Hispaniola, Jamaica and Puerto Rico', 'beach.umbrella', set('CU', 'DO', 'HT', 'JM', 'PR'), 'americas'),
  M('andes', 'The Andes', 'Venezuela, Colombia, Ecuador, Peru, Bolivia, Chile and Argentina', 'figure.hiking', set('VE', 'CO', 'EC', 'PE', 'BO', 'CL', 'AR'), 'americas'),
  M('guianas', 'The Guianas', 'Guyana, Suriname and French Guiana', 'tree', set('GY', 'SR', 'GF'), 'americas'),
  M('coast', 'Coast to coast', 'California and New York', 'arrow.left.and.right', set('US-CA', 'US-NY'), 'americas'),
  M('fiftystates', 'Fifty states', 'Every US state and DC', 'star.circle', { allSubregions: 'US' }, 'americas'),
  M('canada', 'True north', 'Every Canadian province and territory', 'leaf.circle', { allSubregions: 'CA' }, 'americas'),

  M('mekong', 'The Mekong', 'China, Myanmar, Laos, Thailand, Cambodia and Vietnam', 'sailboat', set('CN', 'MM', 'LA', 'TH', 'KH', 'VN'), 'asia'),
  M('centralasia', 'Central Asia', 'Kazakhstan, Kyrgyzstan, Tajikistan, Turkmenistan and Uzbekistan', 'tent', set('KZ', 'KG', 'TJ', 'TM', 'UZ'), 'asia'),
  M('himalaya', 'Himalaya', 'India, Nepal, Bhutan, China and Pakistan', 'cloud.snow', set('IN', 'NP', 'BT', 'CN', 'PK'), 'asia'),
  M('gulf', 'The Gulf', 'Bahrain, Kuwait, Oman, Qatar, Saudi Arabia and the United Arab Emirates', 'sun.haze', set('BH', 'KW', 'OM', 'QA', 'SA', 'AE'), 'asia'),

  M('maghreb', 'Maghreb', 'Morocco, Algeria, Tunisia, Libya and Mauritania', 'moon.stars', set('MA', 'DZ', 'TN', 'LY', 'MR'), 'africa'),
  M('southernafrica', 'Southern Africa', 'South Africa, Namibia, Botswana, Lesotho and Eswatini', 'pawprint', set('ZA', 'NA', 'BW', 'LS', 'SZ'), 'africa'),
  M('africanislands', 'Island nations', 'Cabo Verde, Comoros, Madagascar, Mauritius, São Tomé and Príncipe, and Seychelles', 'fish', set('CV', 'KM', 'MG', 'MU', 'ST', 'SC'), 'africa'),

  M('antipodes', 'Antipodes', 'Australia and New Zealand', 'globe.asia.australia', set('AU', 'NZ'), 'oceania'),
  M('melanesia', 'Melanesia', 'Fiji, Papua New Guinea, Solomon Islands and Vanuatu', 'bird', set('FJ', 'PG', 'SB', 'VU'), 'oceania'),

  M('firsttrip', 'Bon voyage', 'Your first recorded trip', 'suitcase', { trips: 1 }, 'journeys'),
  M('fivetrips', 'Well travelled', 'Five recorded trips', 'suitcase.rolling', { trips: 5 }, 'journeys'),
];

// ---- progress ------------------------------------------------------------------------------
const regionName = (world, id) => placeName(world.regions?.rows.get(id)?.name ?? id);

/** The places a milestone collects, in its own order; empty for counts and trips. */
function placeIDs(world, kind) {
  if (kind.set) return kind.set;
  if (kind.allSubregions) {
    return [...(world.regions?.byCountry.get(kind.allSubregions) ?? [])].map((r) => r.id)
      .sort((a, b) => regionName(world, a).localeCompare(regionName(world, b), language(), { numeric: true }));
  }
  return [];
}

function progress(world, kind, visited, tripCount) {
  if (kind.set) return [kind.set.filter((id) => visited.has(id)).length, kind.set.length];
  if (kind.countries) {
    let n = 0; for (const id of visited) if (world.rows.get(id)?.kind === 'country') n++;
    return [Math.min(kind.countries, n), kind.countries];
  }
  if (kind.continents) {
    const groups = new Set(); for (const id of visited) { const g = world.rows.get(id)?.group; if (g) groups.add(g); }
    return [Math.min(kind.continents, groups.size), kind.continents];
  }
  if (kind.allSubregions) {
    const ids = (world.regions?.byCountry.get(kind.allSubregions) ?? []).map((r) => r.id);
    return [ids.filter((id) => visited.has(id)).length, ids.length];
  }
  if (kind.trips) return [Math.min(kind.trips, tripCount), kind.trips];
  return [0, 0];
}

/** What's left, by name when it's two places or fewer. */
function remainingText(world, places, visited, done, total) {
  const names = places.filter((id) => !visited.has(id)).map((id) => {
    const row = world.rows.get(id);
    return row ? countryName(id, row.short) : regionName(world, id);
  });
  if (names.length && names.length <= 2) return t('%@ to go', new Intl.ListFormat(language(), { type: 'conjunction' }).format(names));
  return t('%lld to go', total - done);
}

/** Every milestone with its progress for this atlas, in album order. */
export function milestones(world, atlas) {
  const visited = new Set(Object.keys(atlas.visits ?? {}));
  const tripCount = (atlas.trips ?? []).length;
  return MILESTONES.map((m) => {
    const [done, total] = progress(world, m.kind, visited, tripCount);
    const places = placeIDs(world, m.kind);
    return { ...m, title: t(m.title), detail: t(m.detail), chapterTitle: t(CHAPTERS.find(([k]) => k === m.chapter)[1]),
             done, total, collected: total > 0 && done >= total, places,
             remaining: remainingText(world, places, visited, done, total) };
  });
}

/** The milestones already begun and nearest to done: fewest places left, then furthest along. */
export function closest(list, limit = 3) {
  return list.filter((m) => m.total > 0 && m.done > 0 && m.done < m.total)
    .map((m, i) => ({ m, i, left: m.total - m.done, share: m.done / m.total }))
    .sort((a, b) => a.left - b.left || b.share - a.share || a.i - b.i)
    .slice(0, limit).map((x) => x.m);
}

// ---- when each was first collected (MilestoneLedger) -------------------------------------
const LEDGER = 'inlay.atlas.milestonesEarned';
export function ledger() {
  try { return JSON.parse(localStorage.getItem(LEDGER)) ?? {}; } catch { return {}; }
}
function remember(ids, now = new Date()) {
  const earned = ledger();
  for (const id of ids) earned[id] ??= now.toISOString();
  try { localStorage.setItem(LEDGER, JSON.stringify(earned)); } catch { /* storage off: celebrated this session only */ }
}

/**
 * Milestones collected by the change from `before` to `after` (two saved atlases) and never
 * collected before on this device. Records them, so each is celebrated once; one lost by
 * unmarking keeps its first date and is earned again silently.
 */
export function newlyCollected(world, before, after) {
  const was = new Set(milestones(world, before).filter((m) => m.collected).map((m) => m.id));
  const earned = ledger();
  const fresh = milestones(world, after).filter((m) => m.collected && !was.has(m.id) && !earned[m.id]);
  if (fresh.length) remember(fresh.map((m) => m.id));
  return fresh;
}

// ---- symbols (SF Symbols, drawn as line art on a 24 grid) --------------------------------
function scallop() {
  let d = '';
  const n = 12, c = 12, r = 7.9, out = 10.2;
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2, am = (a0 + a1) / 2;
    const p = (a, rr) => `${(c + rr * Math.cos(a)).toFixed(2)} ${(c + rr * Math.sin(a)).toFixed(2)}`;
    d += (i ? '' : `M${p(a0, r)}`) + `Q${p(am, out)} ${p(a1, r)}`;
  }
  return d + 'Z';
}
const numeral = (n) => html`<circle cx="12" cy="12" r="9"/><text x="12" y="12" dy=".36em" text-anchor="middle" class="ms-num"
  style=${{ fontSize: n.length > 1 ? '9px' : '11px' }}>${n}</text>`;
const globe = html`<circle cx="12" cy="12" r="9"/>`;
const CLOUD = 'M7.2 14.5a3.7 3.7 0 0 1-.3-7.4 5.2 5.2 0 0 1 9.9 1.3 3.1 3.1 0 0 1 .4 6.1z';
const SYMBOLS = {
  'book.closed': html`<path d="M6.5 3.5H18v14H7.5a2 2 0 0 0-2 2V5a1.5 1.5 0 0 1 1-1.5z"/><path d="M5.5 19.5a2 2 0 0 0 2 1H18v-3"/><path d="M10 3.5v6l2-1.4 2 1.4v-6"/>`,
  '5.circle': numeral('5'), '10.circle': numeral('10'), '3.circle': numeral('3'),
  'globe.europe.africa': html`${globe}<path class="ms-fill" d="M10.6 4.2c1.6-.2 3.1.5 3 1.6-.1 1-1.6 1.1-1.3 2.1.3 1.1 2.5.7 3.1 2.1.6 1.4-.9 2.1-1.3 3.5-.4 1.4-.1 3-1.3 3.6-1.1.4-1.6-1.4-1.9-2.8-.3-1.5-1.9-1.9-2.3-3.2-.4-1.3.7-2.2.4-3.4-.3-1.1-1.5-1.3-1-2.2.5-.8 1.5-1.1 2.6-1.3z"/>`,
  'globe': html`${globe}<ellipse cx="12" cy="12" rx="3.8" ry="9"/><path d="M3 12h18M4.6 7.5h14.8M4.6 16.5h14.8"/>`,
  'crown': html`<path d="M4.5 17.5 3.2 7.8l4.9 3.8L12 5.5l3.9 6.1 4.9-3.8-1.3 9.7z"/><path d="M5 20.5h14"/>`,
  'globe.desk': html`<circle cx="12" cy="10" r="6"/><path d="M4.9 4.6a8.6 8.6 0 0 0 12.4 11.9M12 18.6V21M8.5 21h7M9 7.5c1.5.5 1.7 2 .6 3s.2 2.4 1.7 2.5M14 5.3c-.4 1.3.7 2.2 1.9 2.3"/>`,
  'snowflake': html`<path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9M9.6 4.6 12 7l2.4-2.4M9.6 19.4 12 17l2.4 2.4M4.7 10.6l3.3-.9-.9-3.3M19.3 13.4l-3.3.9.9 3.3M7.1 17.2l.9-3.3-3.3-.9M16.9 6.8l-.9 3.3 3.3.9"/>`,
  'building.columns': html`<path d="M3 9.2 12 4l9 5.2zM5.5 11.5v6M9.8 11.5v6M14.2 11.5v6M18.5 11.5v6M3.5 20h17M4.5 17.5h15"/>`,
  'water.waves': html`<path d="M3 7.5c1.5-1.2 3-1.2 4.5 0s3 1.2 4.5 0 3-1.2 4.5 0 3 1.2 4.5 0M3 12c1.5-1.2 3-1.2 4.5 0s3 1.2 4.5 0 3-1.2 4.5 0 3 1.2 4.5 0M3 16.5c1.5-1.2 3-1.2 4.5 0s3 1.2 4.5 0 3-1.2 4.5 0 3 1.2 4.5 0"/>`,
  'sun.max': html`<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.5 1.5M17.2 17.2l1.5 1.5M5.3 18.7l1.5-1.5M17.2 6.8l1.5-1.5"/>`,
  'cloud.drizzle': html`<path d=${CLOUD}/><path d="M8.5 17.5 7.7 20M12.5 17.5l-.8 2.5M16.5 17.5l-.8 2.5"/>`,
  'mountain.2': html`<path d="M2.5 19.5 9 8.5l6.5 11M12.5 14.5l3.5-5.5 5.5 10.5H2.5"/>`,
  'mountain.2.fill': html`<path class="ms-fill" d="M2.5 19.5 9 8.5l3.6 6.1L16 9l5.5 10.5z"/>`,
  'seal': html`<path d=${scallop()}/>`,
  'road.lanes': html`<path d="M7 3 3.5 21M17 3l3.5 18M12 3v3M12 10v4M12 18v3"/>`,
  'map': html`<path d="M3 6.6 8.6 4.2l6.8 2.6L21 4.4v13L15.4 19.8l-6.8-2.6L3 19.6zM8.6 4.2v13M15.4 6.8v13"/>`,
  'leaf': html`<path d="M5 19.5C4.6 11 9.6 4.8 19.5 4.5c.4 9.6-5.4 15.2-14.5 15z"/><path d="M5 19.5 14 10.5"/>`,
  'beach.umbrella': html`<path d="M4.2 10.6a8.3 8.3 0 0 1 15.6-3.4c-1.5-.3-2.8.2-3.8 1.3-1.2-.7-2.6-.7-3.9 0-1.2-.8-2.7-.9-4.1-.3-1.2-.4-2.6-.1-3.8 2.4z"/><path d="m12 8.5 3.8 11.5M7 20.5h12"/>`,
  'figure.hiking': html`<circle cx="13.2" cy="4.3" r="1.7"/><path d="M12.6 7.8 11 13.4l3.2 3.1V21M11 13.4l-2.6 7.4M12.5 8.4l2.7 2.9 2.3-.6M12.4 8.6l-2.9 2-1.1 3.2M18.3 9.5 19.3 21"/>`,
  'tree': html`<path d="M12 21v-6.5M12 14.5c-4.3 0-6.5-2.4-6.5-5.1A6.3 6.3 0 0 1 12 3a6.3 6.3 0 0 1 6.5 6.4c0 2.7-2.2 5.1-6.5 5.1zM12 17.5l-2.6-2.2M12 16.3l2.4-1.8"/>`,
  'arrow.left.and.right': html`<path d="M3 12h18M7 8l-4 4 4 4M17 8l4 4-4 4"/>`,
  'star.circle': html`${globe}<path d="m12 7.2 1.4 3 3.2.3-2.4 2.2.7 3.2L12 14.3l-2.9 1.6.7-3.2-2.4-2.2 3.2-.3z"/>`,
  'leaf.circle': html`${globe}<path d="M8.2 15.8c-.3-4.6 2.5-8 7.8-8.1.2 5.1-2.9 8.2-7.8 8.1zM8.2 15.8l4.6-4.6"/>`,
  'sailboat': html`<path d="M12 3v13M12 4.5 18.5 15H12M10.8 7 6 15h4.8M3.5 17.5h17l-2 3h-13z"/>`,
  'tent': html`<path d="M2.5 20h19M4 20 12 5.5 20 20M12 12.2 8.8 20M12 12.2l3.2 7.8M12 5.5 10.8 3.5M12 5.5l1.2-2"/>`,
  'cloud.snow': html`<path d=${CLOUD}/><path d="M8 17.3v2.6M6.8 18.6h2.4M12 17.3v2.6M10.8 18.6h2.4M16 17.3v2.6M14.8 18.6h2.4"/>`,
  'sun.haze': html`<path d="M7.6 13a4.4 4.4 0 0 1 8.8 0M12 4.2v2.2M5.7 6.7l1.5 1.5M18.3 6.7l-1.5 1.5M3 13h2.2M18.8 13H21M4.5 16.5h15M7 20h10"/>`,
  'moon.stars': html`<path d="M13.2 4.2a7.8 7.8 0 1 0 6.6 11.6 6.3 6.3 0 0 1-6.6-11.6z"/><path d="M17.5 3.5v3M16 5h3M20 8.5v2M19 9.5h2"/>`,
  'pawprint': html`<g class="ms-fill"><ellipse cx="5.6" cy="10.4" rx="1.8" ry="2.3" transform="rotate(-20 5.6 10.4)"/><ellipse cx="9.4" cy="6.3" rx="1.9" ry="2.5" transform="rotate(-8 9.4 6.3)"/>
    <ellipse cx="14.6" cy="6.3" rx="1.9" ry="2.5" transform="rotate(8 14.6 6.3)"/><ellipse cx="18.4" cy="10.4" rx="1.8" ry="2.3" transform="rotate(20 18.4 10.4)"/>
    <path d="M12 11.6c-3 0-5.6 3.4-5.6 5.8 0 1.6 1.3 2.5 2.8 2.5 1.1 0 1.8-.5 2.8-.5s1.7.5 2.8.5c1.5 0 2.8-.9 2.8-2.5 0-2.4-2.6-5.8-5.6-5.8z"/></g>`,
  'fish': html`<path d="M3 12c3-4.6 8.8-5.6 13.4-1.2L20.5 8v8l-4.1-2.8C11.8 17.6 6 16.6 3 12z"/><circle class="ms-fill" cx="7.6" cy="11.2" r=".9"/>`,
  'globe.asia.australia': html`${globe}<path class="ms-fill" d="M9 4.2c2.4-.6 5 .1 6.9 1.6.6.9-.4 1.6-1.4 1.8-1.4.2-1.5 1.5-2.6 2.1-1 .5-2.3-.3-3 .6-.6.8.3 2-.6 2.6-.8.5-1.9-.3-2.6-1.2-.6-1-.6-2.5-.2-3.7C6 6.5 7.4 4.6 9 4.2zM14.6 14.6c1.3-.5 3.2-.3 3.6.7.4 1.2-.6 2.6-2 3-1.2.3-2.3-.4-2.5-1.5-.2-1 .1-1.8.9-2.2z"/>`,
  'bird': html`<path d="M3.2 9.2c2.4-1 4.6-.2 6 1.8 1.5-2.5 4-3.9 7-3.9l4.1 1.1-3.1 1.5c.4 4.1-2.1 7.9-7 8.4H5l3-2.4C5.3 14.4 3.7 12.3 3.2 9.2z"/><circle class="ms-fill" cx="15.3" cy="8.9" r=".7"/>`,
  'suitcase': html`<rect x="3" y="7" width="18" height="12.5" rx="2"/><path d="M8.5 7V5.2a1.2 1.2 0 0 1 1.2-1.2h4.6a1.2 1.2 0 0 1 1.2 1.2V7M7.8 7v12.5M16.2 7v12.5"/>`,
  'suitcase.rolling': html`<rect x="6.3" y="6" width="11.4" height="12.5" rx="1.8"/><path d="M10 6V3.5h4V6M9.8 9v6.5M14.2 9v6.5"/><circle cx="9" cy="20.3" r="1"/><circle cx="15" cy="20.3" r="1"/>`,
};
export const SealSymbol = ({ name, size = 20 }) =>
  html`<svg class="ms-symbol" viewBox="0 0 24 24" width=${size} height=${size} style=${{ width: size + 'px', height: size + 'px' }} aria-hidden="true">${SYMBOLS[name]}</svg>`;

// ---- the seal --------------------------------------------------------------------------------
/** True once the element has been on screen (first sight); at once under Reduce Motion. */
function useFirstSight(ref) {
  const [seen, setSeen] = useState(reducedMotion);
  useEffect(() => {
    if (seen || !ref.current) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { setSeen(true); observer.disconnect(); }
    }, { threshold: 0.4 });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return seen;
}

/**
 * A milestone's seal: an inked disc once collected, a ring filling in until then. The first time
 * it's seen the ring draws round to where it stands and a collected seal spreads its ink from the
 * centre; `delay` lets a grid of seals fill one after another.
 */
export function Seal({ symbol, done, total, size = 72, delay = 0, still = false }) {
  const ref = useRef(null);
  const sight = useFirstSight(ref);
  const fill = sight || still;
  const earned = total > 0 && done >= total;
  const big = size > 60, ringWidth = big ? 2.5 : 2, edge = big ? 1.5 : 1;
  const r = size / 2 - 1.5, length = 2 * Math.PI * r;
  const share = Math.min(1, done / Math.max(total, 1));
  return html`<span class=${'ms-seal' + (earned ? ' earned' : '') + (fill ? ' fill' : '')} ref=${ref}
      style=${{ width: size + 'px', height: size + 'px', '--delay': (0.2 + delay) + 's' }} aria-hidden="true">
    <svg class="ms-rings" viewBox=${`0 0 ${size} ${size}`} width=${size} height=${size}>
      ${earned && html`<circle class="ms-disc" cx=${size / 2} cy=${size / 2} r=${size / 2} />`}
      <circle class="ms-edge" cx=${size / 2} cy=${size / 2} r=${size / 2 - edge / 2} stroke-width=${edge} />
      ${earned ? html`<circle class="ms-press" cx=${size / 2} cy=${size / 2} r=${size / 2 - size * 0.07 - 0.5} />`
        : html`<circle class="ms-ring" cx=${size / 2} cy=${size / 2} r=${r} stroke-width=${ringWidth}
            stroke-dasharray=${length} stroke-dashoffset=${fill ? length * (1 - share) : length}
            style=${{ opacity: share > 0 ? 1 : 0 }} />`}
    </svg>
    <${SealSymbol} name=${symbol} size=${Math.round(size * 0.4)} />
  </span>`;
}

// ---- the album -------------------------------------------------------------------------------
const monthYear = (iso) => new Intl.DateTimeFormat(language(), { month: 'short', year: 'numeric' }).format(new Date(iso));
const longDate = (iso) => new Intl.DateTimeFormat(language(), { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(iso));

export function MilestonesSheet({ Sheet, world, atlas, name, onChoose, onClose }) {
  const list = useMemo(() => milestones(world, atlas), [atlas.visits, atlas.trips, language()]);
  const earned = useMemo(ledger, [atlas.visits, atlas.trips]);
  const [opened, setOpened] = useState(null);
  const complete = list.filter((m) => m.collected).length;
  const near = closest(list);
  const open = list.find((m) => m.id === opened);
  return html`<${Sheet} title=${t('Milestones')} onClose=${onClose} class="ms-sheet">
    <div class="ms-album">
      <section class="ms-total" aria-label=${`${complete} ${t('of %lld collected', list.length)}`}>
        <div class="ms-total-line"><b>${complete}</b><span>${t('of %lld collected', list.length)}</span></div>
        <span class="ms-scale"><i style=${{ width: (complete / list.length * 100) + '%' }}></i></span>
      </section>

      ${near.length > 0 && html`<section class="ms-closest">
        <${Legend}>${t('Closest')}<//>
        <div class="ms-rows">${near.map((m) => html`<button class="ms-closest-row" onClick=${() => setOpened(m.id)}
            aria-label=${m.title} aria-description=${t('%lld of %lld, %@', m.done, m.total, m.remaining)}>
          <${Seal} symbol=${m.symbol} done=${m.done} total=${m.total} size=${44} />
          <span class="ms-closest-words"><b>${m.title}</b><small>${m.remaining}</small></span>
          <span class="ms-fraction">${t('%lld/%lld', m.done, m.total)}</span>
          <svg class="ms-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m10 7 5 5-5 5"/></svg>
        </button>`)}</div>
      </section>`}

      ${CHAPTERS.map(([key]) => {
        const items = list.filter((m) => m.chapter === key);
        return html`<section class="ms-chapter">
          <div class="ms-chapter-head"><h3>${items[0].chapterTitle}</h3>
            <span class="ms-fraction">${t('%lld of %lld', items.filter((m) => m.collected).length, items.length)}</span></div>
          <div class="ms-grid">${items.map((m, i) => html`<button class=${'ms-item' + (m.collected ? ' earned' : '')} onClick=${() => setOpened(m.id)}
              aria-label=${t('%@, %@', m.title, m.detail)} aria-description=${m.collected ? t('Collected') : t('%lld of %lld', m.done, m.total)}>
            <${Seal} symbol=${m.symbol} done=${m.done} total=${m.total} size=${72} delay=${(i % 9) * 0.06} />
            <b>${m.title}</b>
            <small>${m.collected ? (earned[m.id] ? monthYear(earned[m.id]) : t('Collected')) : t('%lld of %lld', m.done, m.total)}</small>
          </button>`)}</div>
        </section>`;
      })}
    </div>
    ${open && html`<${MilestoneDetail} Sheet=${Sheet} world=${world} atlas=${atlas} name=${name} milestone=${open}
        earnedOn=${earned[open.id]} onChoose=${onChoose} onClose=${() => setOpened(null)} />`}
  <//>`;
}

/** One milestone, opened: its places on the map, the seal pressed onto the art, what's done and what's left. */
function MilestoneDetail({ Sheet, world, atlas, name, milestone: m, earnedOn, onChoose, onClose }) {
  const visited = new Set(Object.keys(atlas.visits));
  const [pressed, setPressed] = useState(reducedMotion);
  useEffect(() => { if (pressed) return; const timer = setTimeout(() => setPressed(true), 320); return () => clearTimeout(timer); }, []);
  // Its places on the map, those collected inked and the rest outlined; a count shows all your countries.
  const pictured = m.places.length ? m.places : [...visited].filter((id) => world.rows.has(id));
  // Regions draw as their country (the album's pictures use the country art).
  const asPlace = (id) => world.rows.has(id) ? id : world.regions?.rows.get(id)?.countryID;
  const drawn = [...new Set(pictured.map(asPlace).filter(Boolean))];
  const inked = drawn.filter((id) => (pictured.includes(id) ? visited.has(id) : pictured.some((p) => asPlace(p) === id && visited.has(p))));
  const outlined = drawn.filter((id) => !inked.includes(id));
  const status = m.collected ? (earnedOn ? t('Collected %@', longDate(earnedOn)) : t('Collected')) : t('%lld of %lld · %lld to go', m.done, m.total, m.total - m.done);
  const placeLabel = (id) => (world.rows.has(id) ? name?.(id) ?? countryName(id, world.rows.get(id).name) : regionName(world, id));
  return html`<${Sheet} title=${m.title} onClose=${onClose} class=${'ms-detail' + (drawn.length ? '' : ' bare')}>
    <div class="ms-detail-scroll">
      ${drawn.length > 0 && html`<${Backdrop} world=${world} subject=${{ places: pictured }} inked=${inked} outlined=${outlined}
          wash="footer" band=${0.88} class="ms-art" />`}
      <div class="ms-detail-head">
        <span class="ms-detail-seal">
          <${StampPress} pressed=${pressed}><span class="ms-seal-paper"><${Seal} symbol=${m.symbol} done=${m.done} total=${m.total} size=${104} still /></span><//>
        </span>
        <h3>${m.title}</h3>
        <p>${m.detail}</p>
        <${Legend} color=${m.collected ? 'var(--sage)' : 'var(--pencil)'} class="ms-status">${status}<//>
      </div>
      ${m.places.length > 0 && html`<div class="ms-places">${m.places.map((id) => {
        const done = visited.has(id), label = placeLabel(id);
        return html`<button class="ms-place" onClick=${() => onChoose?.(id)} disabled=${!onChoose}
            aria-label=${label} aria-description=${(done ? t('Visited') : t('Not yet visited')) + (onChoose ? '. ' + t('Shows %@ on the map', label) : '')}>
          <svg class=${'ms-check' + (done ? ' done' : '')} viewBox="0 0 24 24" aria-hidden="true">
            ${done ? html`<circle cx="12" cy="12" r="9.5"/><path d="m7.8 12.3 2.9 2.9 5.5-6"/>` : html`<circle cx="12" cy="12" r="9"/>`}</svg>
          <span class="ms-place-name">${label}</span>
          ${onChoose && html`<${Legend}>${t('Map')}<//><svg class="ms-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m10 7 5 5-5 5"/></svg>`}
        </button>`;
      })}</div>`}
    </div>
  <//>`;
}

/** The banner the map shows when a mark completes a milestone (AtlasScreen.milestoneBanner). */
export function MilestoneBanner({ milestone, onDismiss, onOpen }) {
  return html`<div class="ms-banner" role="status" aria-live="polite">
    <span class="ms-banner-seal"><${SealSymbol} name=${milestone.symbol} size=${18} /></span>
    <button class="ms-banner-words" onClick=${onOpen} disabled=${!onOpen}>
      <${Legend} color="var(--sage)">${t('Milestone collected')}<//>
      <b>${milestone.title}</b>
    </button>
    <button class="x" onClick=${onDismiss} aria-label=${t('Dismiss milestone')}>×</button>
  </div>`;
}
