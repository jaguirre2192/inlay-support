// Optional accounts on the web atlas: Sign in with Apple or Google, then the atlas stays in step
// with the Inlay app through Firestore (Inlay/docs/accounts-sync-spec.md). Firebase is loaded only
// when someone uses this, so visiting the atlas never contacts Google.
//
// ACCOUNTS_LIVE publishes the account section to everyone. Until then it shows only with
// ?accounts in the address (remembered in this browser; ?accounts=off forgets it).
// ?emulators talks to the local Firebase emulators instead (Inlay/firebase, for testing).

import { useState, useEffect, useRef, useCallback } from 'preact/hooks';
import { AccountSync, wire } from './accountsync.js';
import { FIREBASE_CONFIG } from './firebase-config.js';

/** Flip to true when sign-in launches (with the privacy policy that describes it). */
export const ACCOUNTS_LIVE = false;

const PREVIEW_KEY = 'inlay-accounts-preview', LINKED_KEY = 'inlay-account';
const params = new URLSearchParams(location.search);
const storage = (() => { try { return localStorage; } catch { return null; } })();
const get = (k) => { try { return storage?.getItem(k) ?? null; } catch { return null; } };
const put = (k, v) => { try { v == null ? storage?.removeItem(k) : storage?.setItem(k, v); } catch {} };
if (params.has('accounts')) put(PREVIEW_KEY, params.get('accounts') === 'off' ? null : '1');

export const accountsEnabled = () => ACCOUNTS_LIVE || get(PREVIEW_KEY) === '1';
const useEmulators = params.has('emulators');

// ---- Firebase, loaded on first use ------------------------------------------------------------
let firebase = null;
async function loadFirebase() {
  if (firebase) return firebase;
  firebase = (async () => {
    const [app, auth, fs] = await Promise.all([
      import('../vendor/firebase-app.js'), import('../vendor/firebase-auth.js'), import('../vendor/firebase-firestore.js')]);
    const instance = app.initializeApp(FIREBASE_CONFIG);
    const a = auth.initializeAuth(instance, { persistence: [auth.indexedDBLocalPersistence, auth.browserLocalPersistence],
                                              popupRedirectResolver: auth.browserPopupRedirectResolver });
    let db;
    try { db = fs.initializeFirestore(instance, { localCache: fs.persistentLocalCache() }); }
    catch { db = fs.getFirestore(instance); }  // private windows: memory cache
    if (useEmulators) {
      auth.connectAuthEmulator(a, 'http://127.0.0.1:9099', { disableWarnings: true });
      fs.connectFirestoreEmulator(db, '127.0.0.1', 8086);
    }
    return { auth, fs, a, db };
  })();
  return firebase;
}

function providerFor(auth, kind) {
  if (kind === 'apple') {
    const p = new auth.OAuthProvider('apple.com');
    p.addScope('email'); p.addScope('name');
    return p;
  }
  return new auth.GoogleAuthProvider();
}

// ---- the account's records in Firestore -------------------------------------------------------
const KINDS = [['places', 'readPlace', 'place'], ['wishes', 'readWish', 'wish'], ['trips', 'readTrip', 'trip']];

function firestoreRemote({ fs, db }, uid) {
  const col = (name) => fs.collection(db, 'users', uid, name);
  const read = (snapshot, reader, into) => {
    for (const d of snapshot.docs ?? []) { const r = wire[reader](d.data()); if (r) into[d.id] = r; }
  };
  return {
    async load() {
      const out = { places: {}, wishes: {}, trips: {} };
      await Promise.all(KINDS.map(async ([name, reader]) => read(await fs.getDocs(col(name)), reader, out[name])));
      return out;
    },
    observe(onChange) {
      const stops = KINDS.map(([name, reader]) => fs.onSnapshot(col(name), (snapshot) => {
        const changed = { places: {}, wishes: {}, trips: {} };
        for (const c of snapshot.docChanges()) {
          if (c.type === 'removed' || c.doc.metadata.hasPendingWrites) continue;
          const r = wire[reader](c.doc.data());
          if (r) changed[name][c.doc.id] = r;
        }
        if (Object.keys(changed[name]).length) onChange(changed);
      }, () => {}));
      return () => stops.forEach((stop) => stop());
    },
    async save(outgoing) {
      // One write per record: the rules refuse any the account holds a newer copy of, and
      // that copy arrives through observe().
      const writes = [], keys = [];
      for (const [name, , writer] of KINDS) for (const [id, r] of Object.entries(outgoing[name])) {
        writes.push(fs.setDoc(fs.doc(col(name), id), { ...wire[writer](r), syncedAt: fs.serverTimestamp() }));
        keys.push([name, id, r]);
      }
      // Refused or failed writes are handed back, so the engine offers them again next time.
      const missed = { places: {}, wishes: {}, trips: {} };
      (await Promise.allSettled(writes)).forEach((result, i) => {
        if (result.status === 'rejected') { const [name, id, r] = keys[i]; missed[name][id] = r; }
      });
      return missed;
    },
    async deleteEverything() {
      const profileRef = fs.doc(db, 'users', uid);
      const profile = await fs.getDoc(profileRef).catch(() => null);
      const liveID = profile?.exists() ? profile.data().liveID : null;
      if (liveID) await fs.deleteDoc(fs.doc(db, 'shared', liveID)).catch(() => {});
      for (const name of ['places', 'wishes', 'trips', 'friends']) {
        const docs = (await fs.getDocs(col(name))).docs;
        for (let i = 0; i < docs.length; i += 400) {
          const batch = fs.writeBatch(db);
          for (const d of docs.slice(i, i + 400)) batch.delete(d.ref);
          await batch.commit();
        }
      }
      // The profile goes last: while it's there, a deletion that stopped part way isn't finished.
      await fs.deleteDoc(profileRef);
    },
  };
}

// ---- the page's hook --------------------------------------------------------------------------

/**
 * The account for the App component. `getAtlas` returns the page's current atlas, `replace`
 * puts a merged one in place (and saves it), `known` says whether an ID is a place on this map.
 */
export function useAccount({ getAtlas, replace, known }) {
  const [state, setState] = useState({ status: get(LINKED_KEY) ? 'loading' : 'signedOut', user: null, summary: null, error: null });
  // What the person sees about syncing: whether changes are still on their way, and when the
  // account last confirmed everything.
  const [progress, setProgress] = useState({ pending: false, syncedAt: null, online: navigator.onLine !== false });
  useEffect(() => {
    const update = () => setProgress((p) => ({ ...p, online: navigator.onLine !== false }));
    addEventListener('online', update); addEventListener('offline', update);
    return () => { removeEventListener('online', update); removeEventListener('offline', update); };
  }, []);
  const sync = useRef(null), fb = useRef(null);
  const binding = useRef({ getAtlas, replace, known });
  binding.current = { getAtlas, replace, known };

  const begin = useCallback(async (user) => {
    sync.current?.stop();
    const engine = new AccountSync({
      uid: user.uid, remote: firestoreRemote(fb.current, user.uid),
      get: () => binding.current.getAtlas(), set: (a) => binding.current.replace(a), known: (id) => binding.current.known(id),
    });
    sync.current = engine;
    setState((s) => ({ ...s, status: 'syncing', user: describe(user), error: null }));
    try {
      const summary = await engine.start();
      if (sync.current !== engine) return;
      setProgress((p) => ({ ...p, pending: false, syncedAt: Date.now() }));
      setState((s) => ({ ...s, status: 'signedIn', summary }));
    } catch (e) {
      console.warn('Account sync couldn’t start', e);
      setState((s) => ({ ...s, status: 'signedIn', error: 'unavailable' }));
    }
  }, []);

  const connect = useCallback(async () => {
    if (fb.current) return fb.current;
    fb.current = await loadFirebase();
    const { auth, a } = fb.current;
    if (useEmulators) {
      // Tests only: the emulator accepts an unsigned Google credential, so a page can sign in
      // without the popup (which embedded browsers open in the same tab).
      window.inlayTestSignIn = (email) => auth.signInWithCredential(a, auth.GoogleAuthProvider.credential(
        JSON.stringify({ sub: `test-${email}`, email, email_verified: true })));
      window.inlayTestDeleteData = () => firestoreRemote(fb.current, a.currentUser.uid).deleteEverything();
    }
    auth.onAuthStateChanged(a, (user) => {
      if (user) begin(user);
      else { sync.current?.stop(); sync.current = null; setState({ status: 'signedOut', user: null, summary: null, error: null }); }
    });
    return fb.current;
  }, [begin]);

  // A browser that was signed in picks the session back up.
  useEffect(() => {
    if (accountsEnabled() && (get(LINKED_KEY) || useEmulators)) connect().catch(() => setState((s) => ({ ...s, status: 'signedOut' })));
  }, []);

  const signIn = useCallback(async (kind) => {
    setState((s) => ({ ...s, error: null }));
    try {
      const { auth, a } = await connect();
      await auth.signInWithPopup(a, providerFor(auth, kind));
    } catch (e) {
      const code = e?.code ?? '';
      if (code.includes('popup-closed') || code.includes('cancelled-popup')) return;
      setState((s) => ({ ...s, error: code.includes('popup-blocked') ? 'popupBlocked'
        : code.includes('account-exists-with-different-credential') ? 'otherProvider' : 'signInFailed' }));
    }
  }, [connect]);

  /** Signs out; `keep` false also clears this browser's copy of the atlas. */
  const signOut = useCallback(async (keep) => {
    const { auth, a } = await connect();
    sync.current?.stop(); sync.current = null;
    await auth.signOut(a);
    put(LINKED_KEY, null);
    if (!keep) binding.current.replace({ ...binding.current.getAtlas(), visits: {}, wanted: {}, trips: [], modified: {}, removedTrips: {} });
  }, [connect]);

  /** Deletes the account and everything in it (App Store 5.1.1(v), Google Play). This browser's copy stays. */
  const deleteAccount = useCallback(async () => {
    const { auth, a, fs, db } = await connect();
    const user = a.currentUser;
    if (!user) return;
    setState((s) => ({ ...s, status: 'deleting', error: null }));
    try {
      const appleUser = user.providerData.some((p) => p.providerId === 'apple.com');
      const kind = appleUser ? 'apple' : 'google';
      // Deleting needs a recent sign-in; for Apple it also hands back a token to revoke.
      const result = await auth.reauthenticateWithPopup(user, providerFor(auth, kind));
      sync.current?.stop(); sync.current = null;
      await firestoreRemote({ fs, db }, user.uid).deleteEverything();
      if (appleUser) {
        const token = auth.OAuthProvider.credentialFromResult(result)?.accessToken;
        if (token) await auth.revokeAccessToken(a, token).catch((e) => console.warn('Apple token not revoked', e));
      }
      await user.delete();
      put(LINKED_KEY, null);
      setState({ status: 'deleted', user: null, summary: null, error: null });
    } catch (e) {
      console.warn('Account not deleted', e);
      const code = e?.code ?? '';
      setState((s) => ({ ...s, status: 'signedIn', error: code.includes('popup-closed') ? null : 'deleteFailed' }));
    }
  }, [connect]);

  /** Call after each local save. */
  const changed = useCallback(() => {
    const engine = sync.current;
    if (!engine) return;
    setProgress((p) => ({ ...p, pending: true }));
    engine.push().then(() => { if (sync.current === engine && !engine.pushing) setProgress((p) => ({ ...p, pending: false, syncedAt: Date.now() })); },
                       () => {});
  }, []);

  return { ...state, ...progress, signIn, signOut, deleteAccount, changed, dismissSummary: () => setState((s) => ({ ...s, summary: null })) };
}

function describe(user) {
  const provider = user.providerData[0]?.providerId === 'apple.com' ? 'apple' : 'google';
  const relay = /@privaterelay\.appleid\.com$/i.test(user.email ?? '');
  return { provider, email: relay ? null : user.email ?? null };
}

