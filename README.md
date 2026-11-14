# Inlay support website

Public support and privacy pages for Inlay. The application and artwork repository remains private. This site includes no analytics, build secrets, user travel data or application source.

Newsreader is used under the SIL Open Font License; see `assets/fonts/OFL-Newsreader.txt`. Font source: https://github.com/google/fonts/tree/main/ofl/newsreader .

The `/friend/` route opens invitation codes locally in Inlay and provides the Messages preview card. Invitation payloads stay in the fragment and are not sent to this site. See `DESIGN.md` for the existing design tokens and supported states. `friend/card.provenance.json` records the approved icon source. Native app launch and actual Messages preview caching remain device checks.
