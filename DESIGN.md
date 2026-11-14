# Inlay support design

The existing paper atlas identity is the authority. This task publishes and hardens the native author's existing invitation-page draft; it does not replace the site's visual world.

## Tokens

| Role | Light | Invitation dark |
| --- | --- | --- |
| Paper | #f2eddf | #1d2c31 |
| Ink | #203337 | #f3efe4 |
| Secondary text | #4c625f | #c3cbbd |
| Action | #36564d | #c5d2b8 |
| Rule | #c3c7b7 | #52635d |
| Hover accent | #8a6228 | #e1c28b |

Newsreader is self-hosted under the included OFL license. System sans serves action labels and prose. Shared24px phone gutters,40px desktop gutters and an8px spacing rhythm anchor the layout. The invitation is an Operate surface: one primary Open in Inlay action, one secondary Copy invitation action, familiar support/footer links, and no decorative animation.

## Invitation states

The three INLAY code versions are passed intact from the URL fragment into the registered app scheme. The page does not fetch an atlas, validate server-side expiry, log the code, or store it. No fragment is inserted as HTML. CSP blocks network connections and all scripts/styles/assets are local.

Empty or malformed links explain the incomplete invitation and hide actions. Opening the app requires the visitor's tap. Staying in the browser is not proof that an app is absent or an invitation expired; the page offers retry/copy guidance. Copy has pending, confirmed, timeout and denied states, with recovery and no stale success after a fragment change. Without JavaScript, visible instructions explain copying the link directly into Inlay.

The route supports light and dark appearance, small phone, phone landscape, tablet and desktop. Images have intrinsic dimensions; the app icon is decorative beside the written brand. Controls have at least44px targets and visible keyboard focus. Status updates are announced politely. Layouts scroll rather than truncate at small heights or large text sizes.

## Preview artwork

The1200x630 card combines the approved Atlas window icon with the site's typography and palette. It contains no traveller name, sharing identifier or visit data. Open Graph metadata uses absolute HTTPS URLs. Embedded PNG description metadata and card.provenance.json preserve its source-art hash and rendering recipe. The icon carries XMP provenance; the illustration is unchanged.

## Verification boundary

Isolated headless Chromium and WebKit verified twelve responsive/appearance layouts, the three code generations, malformed-to-valid recovery, clipboard success/denial/stall recovery, no-JavaScript fallback, local-only asset requests, loaded fonts and no horizontal overflow. Actual installed-app launching and the Messages cache require a device and are not claimed by these browser checks. The public support/privacy pages remain unchanged.
