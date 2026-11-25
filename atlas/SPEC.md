# Inlay on the web — specification

Jorge, 2026-11-24: "After iOS is submitted we should abandon the macOS version in favor of replicating the iOS experience on the website", then "lets do the site version on inlayatlas.com". His answers on 2026-11-25:
- **Where:** `inlayatlas.com/atlas/`, its own route. The gallery, editions, print studio, support and privacy pages stay as they are, and the home page and nav gain an "Open your atlas" link.
- **Keeping places:** browser first, iCloud later. Phase 1 to 4 keep the atlas in the browser (IndexedDB) and move it to and from the iPhone app with the app's own atlas file (Settings → Export your atlas / Import an atlas file). Phase 5 adds iCloud sync through CloudKit JS.

The web atlas is the iPhone app's experience in a browser, not a marketing page. The app's DESIGN.md is its design authority: paper artwork leads, the interface recedes, no serif type (the gallery site's Italiana and Instrument Serif stay on the gallery pages), glass chrome over the map and paper pages for sheets. Where a browser can't do something the app does (widgets, Siri, haptics, tilt light, reading the Photos library), the web version leaves it out or takes the nearest honest equivalent, as listed per phase.

## What stays the same as the app

- **The atlas:** 249 destinations (199 countries and 50 territories, counted separately). Each has its authored paper artwork masked by its true border. Regions are markable where the app has them: Italy's 20, US states, Canadian provinces, and travel regions for 51 countries in Europe and Asia.
- **Selection** by tap or list, never by zoom alone. Mark, unmark and undo. The stamp reveals the art from the centre to the borders with an inked edge; unmarking lifts it off.
- **Languages:** English, Japanese, Korean, German, Brazilian Portuguese, Italian and French. The app's translations are reused (Localizable and PlaceNames catalogs, exported to JSON). Country names come from `Intl.DisplayNames`, as the app uses the system's names.
- **Interop:** the app's `inlay-atlas` version 1 file (places with visited, Want to go, date and plan; trips; home country; name). Import adds and never removes, exactly as `AtlasData.add` does. Export writes the same format, so the app can import it. Friend links (`inlay://friend?d=` / `INLAY1-` codes, raw DEFLATE + base64url, the `LinkCode` limits) open as a comparison on the web too.
- **Privacy:** no account, no analytics, no server state. Nothing leaves the browser except Wikipedia summary requests (as the app makes) and files the person exports.

## Architecture

- **Static, no build step at runtime,** like the rest of the site: ES modules under `/atlas/`, served by GitHub Pages. A small vendored UI library (Preact + htm, pinned, in `/atlas/vendor/`) and no bundler.
- **Data** is generated from the app's resources by `tools/build-atlas-data.py` in the site repo, pointed at a local Inlay checkout:
  - `atlas/data/world.json`: catalogue, groups, centroids and label anchors.
  - `atlas/data/geometry/*.bin`: country and region outlines, packed and pre-triangulated.
  - `atlas/data/art.json`: which art plate draws where, with frames and crops.
  - `atlas/data/i18n/<lang>.json`: interface strings and place names.
  - `atlas/data/summaries.json`: the bundled English Wikipedia introductions.

  The country art is shared with the print studio (`/print/assets/art/`). Regional art is copied once into `/atlas/art/regions/` and loads per country the first time it's opened, as the app's Background Assets packs do.
- **Renderer:** WebGL2, ported from the Metal renderer (docs/metal-renderer-spec.md in the app repo):
  - Paper land and sea; stencil-and-cover country fills; art textures with mipmaps masked per country; hairline borders.
  - Wrap-around panning; the stamp and lift reveals in the shader.
  - Labels on a 2D overlay, lettered as the app does them (tracked small caps, largest first, never over inked art).
  - Canvas 2D fallback when WebGL2 isn't available.
- **State:** IndexedDB (`inlay-atlas` database) holding visits, dates, wishes, trips, home and preferences. Every change saves at once. Undo is kept in memory.
- **Layout** follows the app's width rules: a bottom glass strip under 600 px, and a lower-leading card on wider windows. Keyboard: arrows pan, +/− zoom, / searches, Esc closes.

## Phases

1. **Atlas core:**
   - The world map with country art, pan, zoom and wrap.
   - Select, mark, unmark and undo, with the stamp animation.
   - The place card ("WORLD / Place", legend line, actions) and the countries card with live counts.
   - Continents row and search.
   - Import and export of the app file, the seven languages, and light and dark.
2. **Depth:**
   - Regions with regional art and the subregion picker.
   - Visit dates (year plus optional month) and the Timeline with years as bars.
   - Want to go with notes, season, year and Next up, ranked by dragging.
   - Trips with routes.
3. **Collection:**
   - The visited collection with stats and continent progress.
   - 36 milestones as an album, the passport with entry stamps, and the share card studio (5 designs, Story and Post, Paper and Night, PNG).
   - Friends comparison from a link.
   - The place sheet with the Wikipedia introduction and credit.
   - A print handoff to `/print/`, settings, and optional paper-and-ink sounds.
4. **Extras:**
   - Photos from files the person picks: place suggestions from their EXIF location, read in the browser, nothing uploaded.
   - The year in review, and the paper globe with the unfold.
5. **iCloud sync:** CloudKit JS with Sign in with Apple, against the app's CloudKit container and record types (CloudSync.swift). It needs a CloudKit web token from the developer portal, which is Jorge's or Atlas's step.

Each phase ends checked in a real browser at 390, 768 and 1440 px wide, light and dark, with a screenshot review and the import/export round trip against an app-exported file.

## Ownership

Atlas (Codex) built and owns the gallery site. This work adds `/atlas/` and its data tool. Outside it, the only edits are the home page and nav link to the atlas, the sitemap and the README route table. Deploying is a push to `main` on `jaguirre2192/inlay-support` (GitHub Pages).
