---
name: Inlay gallery
description: Illustrated travel memories presented as personal artwork.
colors:
  paper: "#f5f0e4"
  ink: "#22382e"
  muted: "#53614e"
  line: "#cdcdbb"
  focus: "#7d542d"
  action-hover: "#3c5140"
  stage-world: "#e3dfd1"
  stage-country: "#e3decf"
  stage-memory: "#d9decf"
  stage-gift: "#dedfd0"
  room-green: "#20382d"
typography:
  display:
    fontFamily: "Italiana, serif"
    fontSize: "clamp(66px,6.2vw,88px)"
    fontWeight: 400
    lineHeight: 1.02
    letterSpacing: "-0.025em"
  headline:
    fontFamily: "Italiana, serif"
    fontSize: "clamp(38px,4.2vw,64px)"
    fontWeight: 400
    lineHeight: 1.02
    letterSpacing: "-0.025em"
  title:
    fontFamily: "Instrument, serif"
    fontSize: "34px"
    fontWeight: 400
    lineHeight: 1.2
    letterSpacing: "normal"
  tagline:
    fontFamily: "Instrument, serif"
    fontSize: "27px"
    fontWeight: 400
    lineHeight: 1.3
  body:
    fontFamily: "Sans, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: "Sans, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.55
  caption:
    fontFamily: "Sans, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.7
rounded:
  control: "2px"
spacing:
  gutter: "clamp(24px,5.5vw,96px)"
  gutter-phone: "24px"
  section: "100px"
  section-phone: "60px"
  action-block: "12px"
  action-inline: "25px"
  action-gap: "18px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "12px 25px"
  button-primary-hover:
    backgroundColor: "{colors.action-hover}"
    textColor: "{colors.paper}"
  button-light:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "12px 25px"
  text-link:
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    padding: "9px 0"
  navigation:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    padding: "25px clamp(24px,5.5vw,96px)"
    height: "88px"
  mobile-navigation:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    padding: "16px 24px 26px"
  framed-artwork:
    padding: "10px"
  disclosure:
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    padding: "20px 0"
  atmosphere-control:
    textColor: "{colors.paper}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "9px 14px"
---

# Design System: Inlay gallery

## Overview

**Creative North Star: "A private gallery of travel memories"**

Warm paper, deep green ink and authentic illustrated geography give Inlay the character of personal artwork. Fine Italiana lettering leads; Instrument Serif gives edition names and intimate captions a print voice; Instrument Sans keeps navigation and explanations clear. The gallery's olive wall, timber frames and one atmosphere film make the artwork feel physical without turning the surrounding interface into decoration.

This record captures the approved cinematic gallery as implemented in [collection.css](collection.css), the six generated marketing pages and [collection.js](collection.js). The visual world was approved before this production port. Its historical concept-seed omission is disclosed provenance, not an unresolved identity decision. Composition and acceptance belong to the [cinematic surface brief](.impeccable/surfaces/cinematic-site.md); product availability and proof scope belong to [PRODUCT.md](PRODUCT.md).

The editor has its own authority in [print/DESIGN.md](print/DESIGN.md) and [print/.impeccable/design.json](print/.impeccable/design.json). The support and invitation identity is preserved in [friend/DESIGN.md](friend/DESIGN.md): support/privacy continue to use [styles.css](styles.css), and invitations use [friend/friend.css](friend/friend.css). This root record does not restyle those surfaces.

**Key Characteristics:**

- Actual illustrated geography and complete framed compositions lead the experience.
- Warm paper rooms and dark green illustration passages share a restrained reading hierarchy.
- Three self-hosted type voices separate display, intimate print text and functional copy.
- Shared gutters, unequal editorial columns and nearly square actions keep the gallery deliberate.
- Physical depth belongs to artwork; the atmosphere poster remains useful without playback.

## Colors

The palette combines warm paper and green ink with quiet, related staging grounds. The frontmatter records the runtime values; the sidecar's generated tonal strips are panel previews, not additional CSS tokens.

### Primary

- **Green ink** carries headings, reading text, primary actions and the footer ground.
- **Gallery room green** supports the illustrated app section and its light reading hierarchy.
- **Action hover green** changes primary actions gently without adding a new accent family.
- **Warm brown focus** provides the default keyboard outline on paper. Dark passages and the header use their current foreground for visible focus.

### Neutral

- **Warm paper** is the page ground, reverse text and the light hero action.
- **Muted green** supports descriptions, captions and proof disclosures on paper.
- **Paper rule** separates product details, process rows, disclosures and navigation.
- **World, Country, Memory and Gift grounds** stage the actual artwork with small changes in paper and sage tone.

**The Paper and Ink Rule.** Carry warm paper and green ink through reading and action surfaces; let the actual illustrations supply the richer color.

## Typography

**Display Font:** Italiana, self-hosted as `Italiana`, with serif fallback.

**Body Font:** Instrument Sans, self-hosted as `Sans`, with sans-serif fallback.

**Print Font:** Instrument Serif regular and italic, self-hosted as `Instrument`, with serif fallback.

The display face is fine and spacious, the print face intimate, and the sans quiet and direct. All three use the supplied regular font files. Font paths and licenses live under [print/assets/fonts/](print/assets/fonts/).

### Hierarchy

- **Display:** the hero uses the frontmatter display role. At the phone breakpoint it becomes 60px with a 1.01 line height and -0.03em tracking; at the smallest breakpoint it becomes 53px.
- **Headline:** the frontmatter headline is the shared starting point. Actual rooms use authored size variants for their content; common phone section headings are 43px. These are source variants, not one universal desktop scale.
- **Title:** edition captions use Instrument Serif; their phone size is 31px. Process titles use the same face at 29px, becoming 28px on phones.
- **Tagline:** product descriptions begin with the frontmatter print role, becoming 28px on phones.
- **Body:** the page default is the frontmatter body role. Longer descriptive paragraphs commonly use a 1.8 line height; the base paragraph ceiling is 70ch, with narrower editorial columns where the source establishes them.
- **Label:** navigation and utilities use the label role. The wordmark uses the sans with 0.2em tracking, distinct from display lettering.
- **Caption:** sample and illustrative-frame information stays visible beneath artwork. Product captions use the caption role; the hero sample credit is 12px.

**The Three Voices Rule.** Use Italiana for large display headings, Instrument Serif for intimate print text and Instrument Sans for controls, explanations and small metadata.

## Layout

The shared shell is centered with a maximum width of 1540px and the frontmatter fluid gutter. Desktop navigation balances three columns (`1fr auto 1fr`); the gallery uses unequal editorial columns rather than a uniform card grid. Artwork and adjacent copy share deliberate leading edges, and product detail panels align to their own column.

At 1100px and below, gaps and art stages compress. At 760px and below, the gutter becomes the phone token, editorial pairs stack, artwork remains complete, and primary actions stretch to the available column. The phone header is 74px tall with 20px side padding and an optically centered wordmark. At 365px and below, the header side padding becomes 16px and selected headings step down. The wide-screen hero expands at 1600px. Exact breakpoint metadata is in the sidecar.

Section intervals vary with the composition: the frontmatter section tokens capture recurring desktop and phone intervals, not an invented universal spacing grid. Product grids use a larger artwork column, then stack artwork before details on phones. Frame padding is 10px normally, 7px on phones and 6px in the phone hero.

**The Shared Guides Rule.** Align artwork stages, headings, copy and actions to deliberate gutters and column edges while preserving the approved unequal gallery rhythm.

## Elevation & Depth

The wall image supplies actual light and texture. Timber-colored gradients describe physical frames, while offset diffuse shadows lift the framed print from its stage. The hero uses a stronger two-part shadow and a slight rotation; linked edition frames lift gently on hover. Paper reading areas and ordinary controls remain flat. The mobile navigation alone uses a shallow dropdown shadow to distinguish its temporary layer.

The sidecar carries the exact frame, hero and menu shadow values, the frame gradient, and motion snippets. The approved physical frame gradient is part of this world; it is not a license for gradient lettering or decorative interface panels.

**The Artwork Depth Rule.** Concentrate physical depth on the artwork and its frame; keep reading and action surfaces quiet and legible.

## Shapes

Artwork, stages and disclosure rows are rectangular. Primary and light actions use the frontmatter control radius, with a one-pixel border and a minimum height of 50px. Native details summaries and navigation actions provide at least 44px targets. Arrows, menu marks and disclosure symbols are authored inline SVG with the shared 1.5 stroke weight. No badge or pill system is present on the marketing routes.

## Components

### Buttons and text links

The primary action pairs green ink with paper text; the hero action reverses that relationship. Both share the same nearly square geometry and restrained upward hover shift. Hover colors are recorded in the sidecar; default keyboard focus is the warm brown outline, with paper or current-color outlines on dark contexts. Text links use a thin underline, an authored arrow and a minimum height of 44px. The actual product action opens `/print/`; it does not encode an edition selection.

### Navigation

The full header uses a wordmark, centered links and a right-aligned studio action. On the homepage it sits transparently over the wall in paper text; inner pages use paper and ink. Current-page and hover links receive an extending underline. At the phone breakpoint a native details menu replaces the centered links, preserving no-JavaScript access. The enhancement closes it on Escape, outside click, selected link or a return to desktop width; Escape restores summary focus.

### Framed artwork

The frame wraps the complete actual raster composition with its intrinsic aspect ratio. Landscape Your World and Our World and portrait Country and Memory retain their own proportions. The frame is illustrative; sample labels stay adjacent. The app room uses the real bundled [Italy illustration](print/assets/art/approved-italy.png), explicitly captioned as artwork. The older app-phone captures are excluded from this record and from current marketing HTML.

**The Complete Artwork Rule.** Preserve the entire approved composition, including its dedication, geography and complete flag faces; use staging space rather than cropping the art.

### Disclosures

Native details and summary elements use a thin top rule, a readable question and an SVG plus that rotates when opened. FAQ and product details share this vocabulary; product rows use their own tighter vertical padding. Answers remain ordinary text on paper, with visible focus on the summary.

### Atmosphere

The illustration poster is present in static HTML. The film and its play, pause, cancel and retry control enhance it; failed or stalled playback leaves the poster and copy readable. The JavaScript waits seven seconds before offering a specific retry, makes a fresh load on retry, and pauses offscreen or when the document is hidden. Reduced-motion and Save-Data preferences suppress automatic film loading. Reduced motion also removes smooth scrolling and transitions.

**The Poster First Rule.** Keep the actual illustration, reading hierarchy and recovery action available through unavailable, rejected or stalled playback.

## Do's and Don'ts

### Do:

- **Do** preserve approved illustrations, complete compositions, recipient dedications and flag faces.
- **Do** align repeated elements to shared gutters and deliberate editorial column guides.
- **Do** keep sample, illustrative-frame, coming-soon and digital-proof disclosures readable beside the relevant content.
- **Do** preserve native disclosure behavior and visible keyboard focus when adding enhancements.
- **Do** keep the poster available and honor reduced-motion and Save-Data preferences.

### Don't:

- **Don't** replace authentic geographic artwork with generic map decoration or stale app screenshots.
- **Don't** turn the gallery's flat reading surfaces into elevated interface cards or badge clusters.
- **Don't** crop approved artwork to force different editions into equal boxes.
- **Don't** replace authored SVG controls with font glyphs or add decorative eyebrow labels.
- **Don't** apply this gallery record over the separate invitation/support or print-editor authorities.
