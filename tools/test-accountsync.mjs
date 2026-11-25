// Tests for the web atlas's account sync (atlas/js/accountsync.js): edit stamping, merging,
// the engine against an in-memory account that refuses stale writes as the Firestore rules do.
//
//   node tools/test-accountsync.mjs

import { stamp, records, apply, upgrade, wire, AccountSync, newer } from '../atlas/js/accountsync.js';

let passed = 0, failed = 0;
function check(name, ok, detail) {
  if (ok) passed++; else { failed++; console.error(`✗ ${name}${detail ? `: ${JSON.stringify(detail)}` : ''}`); }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const empty = () => upgrade({ version: 1, name: '', home: null, visits: {}, wanted: {}, trips: [], friends: [], prefs: {} });
const trip = (id, extra = {}) => ({ id, name: 'Iberia', start: '2019-06-01T12:00:00Z', end: null, places: ['ES', 'PT'], note: '', ...extra });
const TRIP = '0B4A8D1E-3C9F-4E2A-9B7D-5F6E1A2C3D4E';

// ---- stamping -----------------------------------------------------------------------------------
{
  let a = empty();
  let b = structuredClone(a); b.visits.FR = { date: '2019-06' };
  b = stamp(a, b, 100);
  check('marking a place stamps it', b.modified['p/FR'] === 100);
  let c = structuredClone(b); delete c.visits.FR;
  c = stamp(b, c, 200);
  check('unmarking stamps it again', c.modified['p/FR'] === 200);
  check('an unmarked place stays a record', eq(records(c).places.FR, { visited: false, wanted: false, date: null, modified: 200 }));
  let d = structuredClone(c); d.visits.IT = {};
  d = stamp(c, d, 150);
  check('an untouched place keeps its time', d.modified['p/FR'] === 200 && d.modified['p/IT'] === 150);
  let e = structuredClone(d); e.visits.IT = { date: '2020' };
  e = stamp(d, e, 140);
  check('a clock running behind still moves forward', e.modified['p/IT'] > 150, e.modified);
  let f = structuredClone(e); f.trips = [trip(TRIP)];
  f = stamp(e, f, 300);
  let g = structuredClone(f); g.trips = [];
  g = stamp(f, g, 400);
  check('a deleted trip leaves a tombstone', g.removedTrips[TRIP]?.deleted === true && g.modified[`t/${TRIP}`] === 400);
  check('the tombstone is a record', records(g).trips[TRIP]?.deleted === true);
  let h = structuredClone(g); h.wanted.JP = { rank: 0, note: '', nextUp: false, modified: 0 };
  h = stamp(g, h, 500);
  check('a new Want to go place stamps its place and plan', h.modified['p/JP'] === 500 && h.modified['w/JP'] === 500);
  let i = structuredClone(h); i.wanted.JP.note = 'Kyoto in spring';
  i = stamp(h, i, 600);
  check('editing a plan stamps only the plan', i.modified['w/JP'] === 600 && i.modified['p/JP'] === 500);
  // Undo hands back the older atlas object, whose times are behind the last save: still an edit.
  const undone = stamp(i, structuredClone(h), 700);
  check('undo is stamped as a new edit', undone.modified['w/JP'] === 700, undone.modified);
  const behind = stamp(i, structuredClone(h), 10);
  check('undo beats the edit it reverses, even with a clock behind', behind.modified['w/JP'] > 600, behind.modified);
  const old = { version: 1, visits: { FR: {} }, wanted: {}, trips: [trip(TRIP)] };
  check('an older save upgrades with time 0', records(old).places.FR.modified === 0 && records(old).trips[TRIP].modified === 0);
}

// ---- applying remote records --------------------------------------------------------------------
{
  let a = stamp(empty(), { ...empty(), visits: { FR: {} } }, 100);
  const merged = apply(a, { places: { FR: { visited: false, wanted: false, date: null, modified: 200 },
                                      IT: { visited: true, wanted: false, date: '2018-05', modified: 50 } }, wishes: {}, trips: {} });
  check('a newer unmarking removes the place', !merged.visits.FR);
  check('a new place arrives with its date', merged.visits.IT?.date === '2018-05');
  const resaved = stamp(a, merged, 900);
  check('merged changes are not re-stamped as local edits', resaved.modified['p/FR'] === 200 && resaved.modified['p/IT'] === 50, resaved.modified);
  const stale = apply(a, { places: { FR: { visited: false, wanted: false, date: null, modified: 50 } } });
  check('an older remote record is ignored', !!stale.visits.FR);
  const wantedPlan = apply(empty(), { places: { PE: { visited: false, wanted: true, date: null, modified: 10 } },
                                      wishes: { PE: { rank: 3, note: 'Lima', season: 'autumn', year: 2027, nextUp: true, modified: 11 } } });
  check('a remote plan arrives with its place', wantedPlan.wanted.PE?.note === 'Lima' && wantedPlan.wanted.PE.season === 'autumn');
  const skipped = apply(empty(), { places: { XX: { visited: true, wanted: false, date: null, modified: 1 } } }, (id) => id !== 'XX');
  check('unknown places are skipped', !skipped.visits.XX);
  const trips = apply(empty(), { trips: { [TRIP]: { ...trip(TRIP), deleted: false, modified: 5 } } });
  check('a remote trip arrives', trips.trips.length === 1 && trips.trips[0].name === 'Iberia');
  const gone = apply(trips, { trips: { [TRIP]: { ...trip(TRIP), deleted: true, modified: 6 } } });
  check('a remote deletion removes the trip', gone.trips.length === 0 && gone.removedTrips[TRIP]);
}

// ---- wire format --------------------------------------------------------------------------------
{
  check('a bad date is refused', wire.readPlace({ visited: true, wanted: false, date: '2019-13', modified: 1 }) === null);
  check('visited wins over wanted', wire.readPlace({ visited: true, wanted: true, modified: 1 })?.wanted === false);
  check('an unknown season is refused', wire.readWish({ rank: 0, season: 'monsoon', modified: 1 }) === null);
  check('a fractional rank is refused', wire.readWish({ rank: 1.5, modified: 1 }) === null);
  check('bad place IDs in a trip are dropped', eq(wire.readTrip({ name: 'x', start: '2019-01-01T00:00:00Z', places: ['FR', 'no way'], modified: 1 }).places, ['FR']));
  check('trip photos are never written', !('photoIDs' in wire.trip({ ...trip(TRIP), deleted: false, modified: 1, photoIDs: ['x'] })));
}

// ---- the engine against a fake account ----------------------------------------------------------
class FakeAccount {
  constructor() { this.records = { places: {}, wishes: {}, trips: {} }; this.listeners = new Set(); this.refused = 0; }
  save(incoming) {
    const accepted = { places: {}, wishes: {}, trips: {} };
    for (const kind of ['places', 'wishes', 'trips']) for (const [id, r] of Object.entries(incoming[kind] ?? {})) {
      const old = this.records[kind][id];
      if (old && old.modified >= r.modified) { this.refused++; continue; }
      this.records[kind][id] = r; accepted[kind][id] = r;
    }
    for (const l of this.listeners) l(structuredClone(accepted));
  }
}
function browser(account, uid = 'ann', start = empty()) {
  let atlas = start;
  const storage = new Map();
  const remote = {
    load: async () => structuredClone(account.records),
    observe: (fn) => { account.listeners.add(fn); return () => account.listeners.delete(fn); },
    save: async (r) => account.save(r),
    deleteEverything: async () => { account.records = { places: {}, wishes: {}, trips: {} }; },
  };
  const sync = new AccountSync({ uid, remote, get: () => atlas, set: (a) => { atlas = a; },
                                 storage: { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) } });
  return {
    sync, get atlas() { return atlas; },
    async edit(fn, time, { push = true } = {}) { const before = atlas; const next = fn(structuredClone(atlas)); atlas = stamp(before, next, time); if (push) await sync.push(); },
    reuse(otherUid) { return new AccountSync({ uid: otherUid, remote, get: () => atlas, set: (a) => { atlas = a; },
                                               storage: { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) } }); },
  };
}

{
  const account = new FakeAccount();
  const first = browser(account);
  await first.edit((a) => { a.visits.FR = { date: '2019-06' }; a.visits.JP = {}; a.trips = [trip(TRIP)]; return a; }, 100, { push: false });
  const summary = await first.sync.start();
  check('first sign-in uploads this browser\'s atlas', !!account.records.places.FR?.visited && !!account.records.trips[TRIP], account.records);
  check('the summary counts what this browser added', summary?.places === 2 && summary.trips === 1 && summary.accountHadAtlas === false, summary);

  const second = browser(account);
  const s2 = await second.sync.start();
  check('another browser receives the atlas', !!second.atlas.visits.FR && second.atlas.visits.FR.date === '2019-06');
  check('…and adds nothing', s2?.places === 0 && s2.accountHadAtlas === true, s2);

  await second.edit((a) => { delete a.visits.JP; a.visits.KR = {}; return a; }, 200);
  check('edits reach the other browser', !first.atlas.visits.JP && !!first.atlas.visits.KR);
  check('the echo of an edit is not sent again', isEmptyOutgoing(first));

  first.sync.stop();  // the first browser goes offline
  await second.edit((a) => { a.visits.MX = {}; return a; }, 300);
  await first.edit((a) => { a.wanted.MX = { rank: 0, note: '', nextUp: false, modified: 0 }; return a; }, 250);  // its clock was behind
  check('a stale edit is refused by the account', account.records.places.MX.visited === true && account.refused > 0, account.records.places.MX);

  const again = browser(account);
  await again.sync.start();
  const third = await again.reuse('ann').start();
  check('signing in again in the same browser is not a first merge', third === null);

  const bea = new FakeAccount();
  bea.records.places.NZ = { visited: true, wanted: false, date: null, modified: 10 };
  // `second` is linked to ann; signing in as bea replaces its atlas rather than mixing.
  const beaRemote = { load: async () => structuredClone(bea.records), observe: () => () => {}, save: async (r) => bea.save(r) };
  let secondAtlas = second.atlas;
  const store = new Map([['inlay-account', 'ann']]);
  const beaSync = new AccountSync({ uid: 'bea', remote: beaRemote, get: () => secondAtlas, set: (a) => { secondAtlas = a; },
                                    storage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) } });
  await beaSync.start();
  check('another person\'s account replaces the atlas', eq(Object.keys(secondAtlas.visits), ['NZ']), Object.keys(secondAtlas.visits));
  check('…without uploading the old one', !bea.records.places.FR);
}

function isEmptyOutgoing(b) {
  const out = newer(records(b.atlas), b.sync.account);
  return !Object.keys(out.places).length && !Object.keys(out.wishes).length && !Object.keys(out.trips).length;
}

console.log(`${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
