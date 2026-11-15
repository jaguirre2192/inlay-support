# Inlay website

Static source for Inlay's cinematic gallery, personalized digital-proof studio, invitations, support and privacy pages at the configured `inlayatlas.com` domain. The native application repository remains separate and private. This checkout includes the artwork and geographic assets needed by the website and proof renderer; it includes no native application source, analytics, build secrets or real user travel history.

Jorge authorized the approved cinematic website launch on 2026-11-15. The current source has passed the independent finish review; deployment and live-publication verification are separate steps. Inlay is **coming soon to iPhone**. The app will be free.

## Routes

| Route | Purpose |
| --- | --- |
| `/` | Cinematic gallery, illustrated atlas introduction, proof handoff and FAQ. |
| `/editions/` | Your World, Country and Memory collection. |
| `/editions/your-world/` | Landscape atlas edition and real studio entry. |
| `/editions/country/` | Single-country illustrated edition and real studio entry. |
| `/editions/memory/` | Country artwork with buyer-selected photographs and real studio entry. |
| `/gifts/` | A friend's atlas and Our World for any two people. |
| `/print/` | Import an actual Inlay atlas or saved design, personalize, download a PNG proof and save a design. |
| `/print/credits.html` | Artwork, geographic and font acknowledgments. |
| `/friend/` | Open an invitation locally in Inlay, copy it and provide the Messages preview card. |
| `/support/` | App support. |
| `/privacy/` | Privacy policy. |

A collection CTA opens the studio. The visitor imports an atlas or saved design and chooses the edition there; the marketing link does not promise to preselect it. An already-shared friend's atlas can be used for a gift. Our World works for any two people; common visited places do not imply travelling together. Country and territory counts remain separate.

## Scope and privacy

This release creates **personalized digital proofs**. Payment, physical orders, print providers, paper, physical sizing, materials, frames, shipping and fulfillment are deferred. No order is placed. Frames and marketing travel histories/photographs are illustrative samples. The app section uses the approved bundled [Italy artwork](print/assets/art/approved-italy.png), labeled as illustration; the older phone screenshots are not approved for publication. Fresh app captures require their own native-build and visual review.

The proof studio works on atlas/design data and selected photographs in the browser. User exports are explicit. Atlas links contain no photographs; Memory photo slots begin empty and the buyer chooses files locally. Invitation payloads remain in the URL fragment and are not sent to this site. The invitation page does not fetch an atlas, insert fragments as HTML or store the payload. Actual installed-app opening and Messages preview caching remain device checks.

## Source and local preview

[tools/build-collection.py](tools/build-collection.py) generates the six marketing HTML pages from the approved compositions. Run it from the repository root with Python 3:

```sh
python3 tools/build-collection.py
```

Edit the generator for marketing markup and copy, [collection.css](collection.css) for gallery styling and [collection.js](collection.js) for the mobile-menu and atmosphere enhancements. Generated marketing pages remain readable and navigable without JavaScript. The generator leaves the proof studio, invitations, support and privacy routes untouched.

Preview the repository as a static site, keeping absolute asset and route paths intact:

```sh
python3 -m http.server 8080
```

Open `http://localhost:8080/`. Hosting uses GitHub Pages with the custom domain recorded in [CNAME](CNAME). A local preview or committed source is not proof of live publication.

The gallery's source art and origin records are in [assets/collection/provenance.json](assets/collection/provenance.json). It reuses actual approved artwork and the atmosphere film. The Italy illustration comes from the bundled atlas under `/print/assets/art/`. No new country illustrations were generated for this port.

## Design and verification

- [DESIGN.md](DESIGN.md) and [.impeccable/design.json](.impeccable/design.json) record the implemented cinematic gallery tokens and components.
- [.impeccable/surfaces/cinematic-site.md](.impeccable/surfaces/cinematic-site.md) carries the gallery composition and interaction contract.
- [print/DESIGN.md](print/DESIGN.md) and [print/.impeccable/design.json](print/.impeccable/design.json) remain the separate studio authority.
- [friend/DESIGN.md](friend/DESIGN.md) preserves the historical invitation/support identity. Invitations use [friend/friend.css](friend/friend.css); support/privacy continue to use [styles.css](styles.css).
- [.impeccable/review/cinematic-launch-20261115/independent-finish.md](.impeccable/review/cinematic-launch-20261115/independent-finish.md) records the source-bound `ship` disposition with no material fixes. Its [documentation handoff](.impeccable/review/cinematic-launch-20261115/documentation.md) records this design extraction and its checks. These are pre-deployment records, not a publication receipt.

The launch review packet binds the six-route 320/390/768/1440 responsive matrix, no-JavaScript and motion/data preferences, atmosphere failure/stall/retry, actual synthetic Swift-fixture import and PNG export, and support/privacy/invitation regression evidence. The synthetic fixture is a codec test, not someone's travel history. Native release readiness and physical-print commerce are outside that review.

## Fonts

The gallery and studio self-host Italiana, Instrument Serif regular/italic and Instrument Sans under their included SIL Open Font Licenses: [Italiana](print/assets/fonts/Italiana-OFL.txt), [Instrument Serif](print/assets/fonts/InstrumentSerif-OFL.txt) and [Instrument Sans](print/assets/fonts/InstrumentSans-OFL.txt).

The preserved support/invitation identity uses self-hosted Newsreader under the [SIL Open Font License](assets/fonts/OFL-Newsreader.txt). Its source is the [Google Fonts Newsreader family](https://github.com/google/fonts/tree/main/ofl/newsreader). [friend/card.provenance.json](friend/card.provenance.json) records the approved preview-icon source and rendering recipe.
