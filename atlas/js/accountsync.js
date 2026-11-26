// Optional accounts: the web atlas's side of the sync shared with the iPhone and Android apps
// (Inlay/docs/accounts-sync-spec.md). This module is plain data and the merge engine; Firebase
// sits behind a small remote interface so the engine is tested without it (tools/test-accountsync.mjs).
//
// The web atlas keeps visits and plans as present-or-absent entries. Sync needs to know when each
// record last changed and that a removed one was removed, so every save is compared with the one
// before it: changed records get an edit time in `atlas.modified`, and removed trips are kept as
// tombstones in `atlas.removedTrips`. Records never edited here (older saves) carry time 0, so any
// timestamped record from an app wins over them.

export const SCHEMA = 2;
const DATE = /^\d{4}(-(0[1-9]|1[0-2]))?$/;
const PLACE_ID = /^[A-Za-z0-9_-]{1,16}$/;
const SEASONS = ['spring', 'summer', 'autumn', 'winter'];
const TOMBSTONE_DAYS = 90;
const now = () => Date.now() / 1000;

/** The atlas with the fields sync needs (schema 2). Older saves upgrade with every time at 0. */
export function upgrade(atlas) {
  return { ...atlas, schema: SCHEMA, modified: atlas.modified ?? {}, removedTrips: atlas.removedTrips ?? {} };
}

// ---- records as this atlas holds them ---------------------------------------------------------

function placeState(atlas, id) {
  const visit = atlas.visits[id];
  return { visited: !!visit, wanted: !visit && !!atlas.wanted[id], date: visit?.date ?? null };
}
function wishState(atlas, id) {
  const w = atlas.wanted[id];
  if (!w) return null;
  return { rank: Number.isInteger(w.rank) ? w.rank : 2147483647, note: w.note ?? '',
           season: SEASONS.includes(w.season) ? w.season : null,
           year: Number.isInteger(w.year) ? w.year : null, nextUp: !!w.nextUp };
}
function tripState(trip, deleted = false) {
  return { name: trip.name ?? '', start: trip.start, end: trip.end ?? null, places: [...(trip.places ?? [])],
           note: deleted ? '' : (trip.note ?? ''), deleted };
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Stamps what changed between two saves: each place, plan or trip that differs gets the edit time
 * (always later than its last one), and a trip that's gone leaves a tombstone. Returns `after`.
 */
export function stamp(before, after, time = now()) {
  const next = upgrade(after);
  const modified = { ...(before?.modified ?? {}), ...next.modified };
  const removed = { ...(before?.removedTrips ?? {}), ...next.removedTrips };
  const touch = (key) => {
    // Already given a time since the last save (by `apply`, from the account): not a local edit.
    if ((next.modified[key] ?? -1) > (before?.modified?.[key] ?? -1)) return;
    modified[key] = Math.max(time, Math.max(modified[key] ?? 0, before?.modified?.[key] ?? 0) + 0.001);
  };
  const prior = before ? upgrade(before) : upgrade({ visits: {}, wanted: {}, trips: [] });

  const placeIDs = new Set([...Object.keys(prior.visits), ...Object.keys(prior.wanted),
                            ...Object.keys(next.visits), ...Object.keys(next.wanted)]);
  for (const id of placeIDs) {
    if (!same(placeState(prior, id), placeState(next, id))) touch(`p/${id}`);
    const was = wishState(prior, id), is = wishState(next, id);
    if (is && !same(was, is)) touch(`w/${id}`);
  }
  const oldTrips = new Map((prior.trips ?? []).map((t) => [t.id, t]));
  const newTrips = new Map((next.trips ?? []).map((t) => [t.id, t]));
  for (const [id, trip] of newTrips) {
    if (removed[id]) delete removed[id];
    if (!oldTrips.has(id) || !same(tripState(oldTrips.get(id)), tripState(trip))) touch(`t/${id}`);
  }
  for (const [id, trip] of oldTrips) {
    if (!newTrips.has(id)) { removed[id] = tripState(trip, true); touch(`t/${id}`); }
  }
  // Tombstones only need to outlive the person's other devices catching up.
  const cutoff = time - TOMBSTONE_DAYS * 86400;
  for (const id of Object.keys(removed)) if ((modified[`t/${id}`] ?? 0) < cutoff) delete removed[id];
  next.modified = modified;
  next.removedTrips = removed;
  return next;
}

/** This atlas as synced records, each with its edit time. */
export function records(atlas) {
  const a = upgrade(atlas);
  const out = { places: {}, wishes: {}, trips: {} };
  const ids = new Set([...Object.keys(a.visits), ...Object.keys(a.wanted)]);
  for (const key of Object.keys(a.modified)) if (key.startsWith('p/')) ids.add(key.slice(2));
  for (const id of ids) {
    if (!PLACE_ID.test(id)) continue;
    out.places[id] = { ...placeState(a, id), modified: a.modified[`p/${id}`] ?? 0 };
    const wish = wishState(a, id);
    if (wish) out.wishes[id] = { ...wish, modified: a.modified[`w/${id}`] ?? a.wanted[id].modified ?? 0 };
  }
  for (const trip of a.trips ?? []) out.trips[trip.id] = { ...tripState(trip), modified: a.modified[`t/${trip.id}`] ?? 0 };
  for (const [id, trip] of Object.entries(a.removedTrips)) out.trips[id] = { ...trip, deleted: true, modified: a.modified[`t/${id}`] ?? 0 };
  return out;
}

/** Records newer here than `known` (the account's last edit time per record). */
export function newer(local, known) {
  const pick = (kind, prefix) => Object.fromEntries(Object.entries(local[kind])
    .filter(([id, r]) => r.modified > (known[`${prefix}/${id}`] ?? -1)));
  return { places: pick('places', 'p'), wishes: pick('wishes', 'w'), trips: pick('trips', 't') };
}

export const isEmpty = (r) => !Object.keys(r.places).length && !Object.keys(r.wishes).length && !Object.keys(r.trips).length;

/**
 * Applies records edited later elsewhere. A place is never both visited and wanted; a wanted place
 * keeps its plan; an unmarked place goes, as when it's unmarked here.
 */
export function apply(atlas, remote, known = (id) => true) {
  const a = upgrade(structuredClone(atlas));
  for (const [id, r] of Object.entries(remote.places ?? {})) {
    if (!known(id) || r.modified <= (a.modified[`p/${id}`] ?? -1)) continue;
    a.modified[`p/${id}`] = r.modified;
    if (r.visited) {
      a.visits[id] = r.date ? { ...(a.visits[id] ?? {}), date: r.date } : (() => { const v = { ...(a.visits[id] ?? {}) }; delete v.date; return v; })();
      delete a.wanted[id];
    } else {
      delete a.visits[id];
      if (r.wanted) a.wanted[id] = a.wanted[id] ?? { rank: Object.keys(a.wanted).length, note: '', nextUp: false, modified: 0 };
      else delete a.wanted[id];
    }
  }
  for (const [id, w] of Object.entries(remote.wishes ?? {})) {
    if (!known(id) || !a.wanted[id] || w.modified <= (a.modified[`w/${id}`] ?? a.wanted[id].modified ?? -1)) continue;
    a.modified[`w/${id}`] = w.modified;
    a.wanted[id] = { rank: w.rank, note: w.note ?? '', nextUp: !!w.nextUp, modified: w.modified,
                     ...(w.season ? { season: w.season } : {}), ...(Number.isInteger(w.year) ? { year: w.year } : {}) };
  }
  for (const [id, t] of Object.entries(remote.trips ?? {})) {
    if (t.modified <= (a.modified[`t/${id}`] ?? -1)) continue;
    a.modified[`t/${id}`] = t.modified;
    a.trips = (a.trips ?? []).filter((x) => x.id !== id);
    if (t.deleted) a.removedTrips[id] = tripState(t, true);
    else {
      delete a.removedTrips[id];
      a.trips.push({ id, name: t.name, start: t.start, end: t.end ?? null, places: (t.places ?? []).filter(known), note: t.note ?? '' });
    }
  }
  return a;
}

// ---- wire format (the documents iOS and Android read and write) -------------------------------

export const wire = {
  place(r) { return { visited: r.visited, wanted: r.wanted && !r.visited, date: r.date ?? null, modified: r.modified }; },
  wish(w) { return { rank: w.rank, note: w.note, season: w.season ?? null, year: w.year ?? null, nextUp: w.nextUp, modified: w.modified }; },
  trip(t) { return { name: t.name, start: t.start, end: t.end ?? null, places: t.places, note: t.note, deleted: t.deleted, modified: t.modified }; },
  /** Reads a document as strictly as the security rules; anything else is ignored. */
  readPlace(d) {
    if (typeof d?.visited !== 'boolean' || typeof d.wanted !== 'boolean' || typeof d.modified !== 'number') return null;
    if (d.date != null && !(typeof d.date === 'string' && DATE.test(d.date))) return null;
    return { visited: d.visited, wanted: d.wanted && !d.visited, date: d.date ?? null, modified: d.modified };
  },
  readWish(d) {
    if (!Number.isInteger(d?.rank) || typeof d.modified !== 'number') return null;
    if (d.season != null && !SEASONS.includes(d.season)) return null;
    if (d.year != null && !(Number.isInteger(d.year) && d.year >= 1000 && d.year <= 9999)) return null;
    return { rank: d.rank, note: typeof d.note === 'string' ? d.note : '', season: d.season ?? null, year: d.year ?? null,
             nextUp: !!d.nextUp, modified: d.modified };
  },
  readTrip(d) {
    if (typeof d?.name !== 'string' || typeof d.start !== 'string' || typeof d.modified !== 'number') return null;
    return { name: d.name, start: d.start, end: typeof d.end === 'string' ? d.end : null,
             places: Array.isArray(d.places) ? d.places.filter((p) => typeof p === 'string' && PLACE_ID.test(p)) : [],
             note: typeof d.note === 'string' ? d.note : '', deleted: !!d.deleted, modified: d.modified };
  },
};

// ---- the engine -------------------------------------------------------------------------------

/**
 * Keeps this browser's atlas and an account's in step. `remote` provides
 *   load() → records, observe(onChange) → stop(), deleteEverything(), and
 *   save(records) → the records the account didn't take (refused or failed), which the next
 *   push offers again.
 * `get`/`set` read and replace the page's atlas.
 */
export class AccountSync {
  constructor({ uid, remote, get, set, known = () => true, storage = globalThis.localStorage }) {
    Object.assign(this, { uid, remote, get, set, known, storage });
    this.account = {};
    this.stopObserving = null;
    this.pushing = null;
    this.again = false;
  }

  /** First sync, then live both ways. Returns what this browser added, on the first sign-in here. */
  async start() {
    const remote = await this.remote.load();
    let linked = null;
    try { linked = this.storage?.getItem('inlay-account') ?? null; } catch {}
    let atlas = upgrade(this.get());
    if (linked && linked !== this.uid) {
      // A different person's account: theirs replaces this browser's atlas, never a mix.
      atlas = upgrade({ ...atlas, visits: {}, wanted: {}, trips: [], modified: {}, removedTrips: {} });
    }
    const summary = linked === this.uid ? null : summarize(records(atlas), remote);
    this.note(remote);
    this.set(apply(atlas, remote, this.known));
    try { this.storage?.setItem('inlay-account', this.uid); } catch {}
    await this.push();
    this.stopObserving = this.remote.observe((changed) => {
      this.note(changed);
      this.set(apply(this.get(), changed, this.known));
    });
    return summary;
  }

  stop() { this.stopObserving?.(); this.stopObserving = null; }

  /** Call after each local save: uploads what changed. */
  async push() {
    if (this.pushing) { this.again = true; return this.pushing; }
    this.pushing = (async () => {
      do {
        this.again = false;
        const outgoing = newer(records(this.get()), this.account);
        if (isEmpty(outgoing)) continue;
        const before = { ...this.account };
        this.note(outgoing);
        const missed = (await this.remote.save(outgoing)) ?? {};
        // What didn't land goes back to what the account was known to hold, so it's retried.
        for (const [prefix, kind] of [['p', 'places'], ['w', 'wishes'], ['t', 'trips']]) {
          for (const id of Object.keys(missed[kind] ?? {})) {
            const key = `${prefix}/${id}`;
            if (key in before) this.account[key] = before[key]; else delete this.account[key];
          }
        }
      } while (this.again);
    })();
    try { await this.pushing; } finally { this.pushing = null; }
  }

  note(r) {
    for (const [prefix, kind] of [['p', 'places'], ['w', 'wishes'], ['t', 'trips']]) {
      for (const [id, x] of Object.entries(r[kind] ?? {})) this.account[`${prefix}/${id}`] = Math.max(this.account[`${prefix}/${id}`] ?? -1, x.modified);
    }
  }
}

function summarize(local, remote) {
  const out = { places: 0, trips: 0, accountHadAtlas: !isEmpty(remote) };
  for (const [id, r] of Object.entries(local.places)) {
    if (!r.visited) continue;
    const theirs = remote.places[id];
    if (theirs && (theirs.visited || theirs.modified >= r.modified)) continue;
    out.places++;
  }
  for (const [id, t] of Object.entries(local.trips)) if (!t.deleted && !remote.trips[id]) out.trips++;
  return out;
}
