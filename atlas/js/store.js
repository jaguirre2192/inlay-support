// The atlas, kept in this browser (IndexedDB), with the app's own file format for moving it
// to and from the iPhone app (AtlasData.swift: AtlasExport, version 1).

const DB = 'inlay-atlas', STORE = 'atlas', KEY = 'mine';

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function emptyAtlas() {
  return { version: 1, name: '', home: null, visits: {}, wanted: {}, trips: [], friends: [], prefs: {}, created: new Date().toISOString() };
}

export async function load() {
  try {
    const db = await open();
    return await new Promise((resolve) => {
      const req = db.transaction(STORE).objectStore(STORE).get(KEY);
      req.onsuccess = () => resolve({ ...emptyAtlas(), ...(req.result || {}) });
      req.onerror = () => resolve(emptyAtlas());
    });
  } catch {
    // Private windows and blocked storage: keep the atlas in memory only.
    return { ...emptyAtlas(), memoryOnly: true };
  }
}

let queued = null, writing = false;
export async function save(atlas) {
  queued = atlas;
  if (writing) return;
  writing = true;
  try {
    while (queued) {
      const next = queued; queued = null;
      const db = await open();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        const { memoryOnly, ...plain } = next;
        tx.objectStore(STORE).put(JSON.parse(JSON.stringify(plain)), KEY);
        tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
      });
    }
  } catch (e) { console.warn('Couldn’t save the atlas in this browser', e); }
  finally { writing = false; }
}

// ---- the app's atlas file ------------------------------------------------------------------

const DATE = /^\d{4}(-(0[1-9]|1[0-2]))?$/;

/** ISO 8601 without fractional seconds: Foundation's .iso8601 strategy rejects them. */
export const isoSeconds = (d) => new Date(d).toISOString().replace(/\.\d{3}Z$/, 'Z');

/** Reads a file made by the app's Export (or this site's). Anything else is refused. */
export function readExport(text) {
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('notAnAtlas'); }
  if (!data || data.format !== 'inlay-atlas' || !Array.isArray(data.places)) throw new Error('notAnAtlas');
  if ((data.version ?? 1) > 1) throw new Error('newerVersion');
  return data;
}

/** Adds what a file holds. Nothing already here is removed or overwritten: a place stays
 *  visited and a date already set is kept (AtlasData.add). */
export function addExport(atlas, file, known) {
  const summary = { visited: 0, wanted: 0, trips: 0, skipped: 0 };
  const next = structuredClone(atlas);
  for (const place of file.places) {
    if (!known(place.id)) { summary.skipped++; continue; }
    if (place.visited) {
      const had = next.visits[place.id];
      if (!had) { next.visits[place.id] = {}; summary.visited++; }
      if (place.date && DATE.test(place.date) && !next.visits[place.id].date) next.visits[place.id].date = place.date;
    }
    if (place.wantToGo && !next.wanted[place.id]) {
      next.wanted[place.id] = { ...(place.plan ?? {}), rank: Object.keys(next.wanted).length };
      summary.wanted++;
    }
  }
  const tripIDs = new Set(next.trips.map((t) => t.id));
  for (const trip of file.trips ?? []) {
    const id = trip.id ?? crypto.randomUUID().toUpperCase();
    if (tripIDs.has(id)) continue;
    next.trips.push({ id, name: trip.name ?? '', start: trip.start, end: trip.end ?? null,
                      places: (trip.places ?? []).filter(known), note: trip.note ?? '' });
    tripIDs.add(id); summary.trips++;
  }
  if (!next.home && file.homeCountry && known(file.homeCountry)) next.home = file.homeCountry;
  if (!next.name && file.name) next.name = file.name;
  return { atlas: next, summary };
}

/** The atlas as the app's export file, sorted as the app sorts it. */
export function writeExport(atlas, describe) {
  const ids = new Set([...Object.keys(atlas.visits), ...Object.keys(atlas.wanted)]);
  const places = [...ids].map((id) => {
    const d = describe(id); if (!d) return null;
    const visited = !!atlas.visits[id], wanted = !!atlas.wanted[id];
    const place = { date: atlas.visits[id]?.date ?? undefined, id, kind: d.kind, name: d.name, visited, wantToGo: wanted };
    const w = atlas.wanted[id];
    if (wanted && w && (w.note || w.season || w.year || w.nextUp)) {
      // WishDetail has no custom decoder: every non-optional field must be present.
      place.plan = { rank: w.rank ?? 0, note: w.note ?? '', nextUp: !!w.nextUp, modified: w.modified ?? 0,
                     ...(w.season ? { season: w.season } : {}), ...(Number.isInteger(w.year) ? { year: w.year } : {}) };
    }
    return place;
  }).filter(Boolean).sort((a, b) => (a.kind + a.name + a.id).localeCompare(b.kind + b.name + b.id));
  const file = {
    exported: isoSeconds(new Date()),
    format: 'inlay-atlas',
    homeCountry: atlas.home ?? undefined,
    name: atlas.name ?? '',
    places,
    trips: [...atlas.trips].sort((a, b) => String(a.start).localeCompare(String(b.start)))
      .map((t) => ({ end: t.end ? isoSeconds(t.end) : undefined, id: t.id, name: t.name ?? '', note: t.note ?? '',
                     places: t.places ?? [], start: isoSeconds(t.start) })),
    version: 1,
  };
  return JSON.stringify(file, null, 2);
}
