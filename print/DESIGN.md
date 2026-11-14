---
name: "Inlay Connected Print Studio"
description: "The implemented personal proof editor within Inlay’s approved warm-paper print identity."
colors:
  ink: "#22382e"
  ink-hover: "#3c5140"
  focus: "#7d542d"
  error: "#8f3020"
  error-line: "#bb8c74"
  frame-oak: "#be9967"
  frame-walnut: "#674b35"
  paper: "#f5f0e4"
  muted: "#53614e"
  line: "#cdcdbb"
  field: "#faf7ed"
  control-line: "#7d8b70"
  choice-line: "#929a7e"
  selected: "#e5e9d8"
  notice-paper: "#e6e8d9"
  error-paper: "#f7e5da"
  gallery-ground: "#e2e0d2"
  footer-ground: "#20382d"
  mount-paper: "#fffdf7"
  unvisited-ground: "#dedfcf"
  map-line: "#b7bba8"
typography:
  display:
    fontFamily: "Italiana, serif"
    fontSize: "46px"
    fontWeight: 400
    lineHeight: 1.1
    letterSpacing: "-0.025em"
  title:
    fontFamily: "Instrument, serif"
    fontSize: "32px"
    fontWeight: 400
    lineHeight: 1.2
  body:
    fontFamily: "Sans, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.55
  action:
    fontFamily: "Sans, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.4
  label:
    fontFamily: "Sans, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.55
  label-small:
    fontFamily: "Sans, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.55
  note:
    fontFamily: "Sans, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.6
  caption:
    fontFamily: "Instrument, serif"
    fontSize: "18px"
    fontWeight: 400
    lineHeight: 1.55
  wordmark:
    fontFamily: "Sans, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    letterSpacing: "0.26em"
rounded:
  control: "2px"
  square: "0px"
spacing:
  small: "8px"
  action-gap: "12px"
  medium: "16px"
  field-gap: "24px"
  stack-gap: "32px"
  gutter-min: "24px"
  gutter-max: "80px"
  page-end: "96px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    typography: "{typography.action}"
    rounded: "{rounded.control}"
    padding: "12px 22px"
  button-primary-hover:
    backgroundColor: "{colors.ink-hover}"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.action}"
    rounded: "{rounded.control}"
    padding: "12px 22px"
  button-secondary-hover:
    backgroundColor: "{colors.selected}"
  button-text:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.square}"
    padding: "10px 0"
  text-field:
    backgroundColor: "{colors.field}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "12px 13px"
    width: "100%"
  file-selector:
    backgroundColor: "{colors.field}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "10px 14px"
  choice-option:
    textColor: "{colors.ink}"
    typography: "{typography.label-small}"
    rounded: "{rounded.square}"
    padding: "11px 13px"
  choice-option-selected:
    backgroundColor: "{colors.selected}"
  navigation:
    textColor: "{colors.ink}"
    height: "84px"
  disclosure:
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    padding: "16px 0"
  atlas-summary:
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    padding: "14px 0"
  notice:
    backgroundColor: "{colors.notice-paper}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    padding: "14px 18px"
  notice-error:
    backgroundColor: "{colors.error-paper}"
    textColor: "{colors.error}"
---

# Design System: Inlay Connected Print Studio

## Overview

**Creative North Star: "A private gallery of travel memories"**

The connected print studio extends Inlay’s approved print collection into a quiet working surface. Warm paper, deep green ink, fine Italiana lettering and authentic illustrated geography carry the existing identity; Instrument Serif gives captions and dedications an intimate print voice. Flat controls and thin rules keep the artwork prominent while making personalization easy to scan.

This record describes the completed implementation under /print/. Its visual authority is the approved private Inlay Print Collection design system, reconciled with studio.css and renderer.js. The separate support and invitation identity remains governed by the repository-root DESIGN.md. Page mode, first-viewport composition, task states and acceptance remain in the connected print surface brief; this document records the reusable visual rules found in the finished source.

**Key Characteristics:**

- Continuous warm paper and green ink connect the editor to the proof.
- Italiana display lettering, Instrument Serif captions and Instrument Sans controls have distinct roles.
- Nearly square controls, authored SVG disclosures, thin rules and aligned gutters provide quiet structure.
- Physical depth belongs to frames, photograph mounts and flag mounts; form surfaces stay flat.
- Complete artwork remains visible, with a separate contained inspection view for detail.

## Colors

The approved warm-paper and green-ink palette remains the authority. Frontmatter is normative; these names explain each role. The sidecar’s synthesized tonal ramps are panel aids, not additional implemented palette tokens.

### Primary

- **Deep Green Ink** (`ink`): reading text, primary actions, selected-choice edges and print lettering.
- **Lifted Green** (`ink-hover`): the primary action’s hover state.

### Secondary

- **Earth Focus** (`focus`): keyboard outlines and quiet link hover; it carries a usable state rather than decoration.
- **Clay Error** (`error`, `error-line`): written error meaning and its enclosing stroke.
- **Natural Oak** (`frame-oak`) and **Dark Walnut** (`frame-walnut`): preview-only frame presentations around the artwork.

### Neutral

- **Warm Paper** (`paper`): the shared page and print ground, and reversed text on primary actions.
- **Quiet Green** (`muted`): instructions, metadata, captions and local-storage notes.
- **Paper Rule** (`line`): section dividers, disclosure edges and summary rules.
- **Field Paper** (`field`) and **Control Edge** (`control-line`): readable text-field interiors and strokes.
- **Choice Edge** (`choice-line`) and **Selected Sage** (`selected`): radio options, reinforced by an ink edge and inset stroke when selected.
- **Status Paper** (`notice-paper`) and **Error Paper** (`error-paper`): flat status and recovery surfaces.
- **Gallery Mount** (`gallery-ground`): the quiet well behind the framed proof.
- **Footer Green** (`footer-ground`): the existing dark footer, distinct from the reading-ink token.
- **Mount Paper** (`mount-paper`): native photograph and flag mounts inside the renderer.
- **Unvisited Ground** (`unvisited-ground`) and **Map Rule** (`map-line`): unpainted geography and its base outline before selected places receive their real artwork.

**The Paper and Ink Rule.** Keep the approved paper ground continuous between the proof and its surrounding editor; use deep green ink for the primary reading and action hierarchy.

## Typography

**Display Font:** Italiana, with serif fallback.  
**Body Font:** Instrument Sans, registered as `Sans`, with system-ui and sans-serif fallback.  
**Caption Font:** Instrument Serif, registered as `Instrument`, including its supplied italic face.

The regular supplied faces remain the visual authority. Display lettering gives the artwork its character; the sans face carries every working instruction. Serif italics belong to intimate captions and dedications. The source has a role-based hierarchy with responsive overrides, not a universal modular scale.

### Hierarchy

- **Display:** the frontmatter role is the default editor title. At widths up to (850px) it becomes (42px), and up to (480px) it becomes (40px). The initial import title instead uses a fluid size (clamp(38px, 3.8vw, 58px)), then (44px) below the tablet breakpoint; its weight, line height and tracking match the display role.
- **Title:** Instrument Serif introduces the photograph section and smaller editorial headings using the frontmatter title role.
- **Body:** the body role carries prose and editable text. Introductory copy stays within (45ch); the artwork-credit route permits longer paragraphs (70ch).
- **Action / Label:** action text has its own compact line height. Labels and summary rows use the label role; options, back navigation and progress use the smaller sans role. Summary figures are tabular, and individual names use the source’s emphasis (500).
- **Note / Caption:** helper copy uses the note role; freshness metadata retains its inherited body line height. The preview caption uses the caption role in italic and becomes (16px) on a phone. The footer’s italic serif line is (21px).
- **Maker’s mark:** the navigation wordmark uses the frontmatter wordmark role and becomes (13px) at the narrow-phone breakpoint. The print’s own spaced maker’s mark retains its separate canvas scale.
- **Canvas lettering:** scale the whole composition rather than copying canvas sizes into interface headings. World/Our World titles begin at (88px/76px), country totals at (96px), recipients at (32px) and dedication/date at (23px). Italy Country uses a title (132px); Italy Memory uses (120px). Renderer text shrinks to fit its allotted width when needed.

**The Two Voices Rule.** Reserve Italiana for large headings and the print’s own lettering. Use Instrument Sans for controls, instructions and small metadata; Instrument Serif supplies intimate captions and dedications.

## Layout

The page shell is centered with a maximum width (1640px). Gutters are fluid (clamp(24px, 5vw, 80px)); the phone minimum aligns the header, preview and editor. Main content starts with a top inset (40px), reduced to (28px) up to tablet width, and finishes with the recorded page-end space. The header uses three balanced columns (1fr / auto / 1fr), a gap (16px) and a default height (84px); it becomes (72px) at tablet width. Narrow phones hide only the back link’s written label while preserving its accessible name.

The studio uses a wide proof column and narrower working column (minmax(0, 1.6fr) / minmax(300px, 1fr)), separated by a fluid gap (clamp(36px, 5vw, 80px)). The proof becomes sticky only from (1100px), at a top offset (28px). At widths up to (850px), the layout stacks with a gap (32px); editor width is bounded at (620px), and the preview at (800px). The initial import panel has its own paired columns (1.15fr / 1fr), maximum width (1160px) and desktop gap (64px), then becomes one column at the same tablet breakpoint.

Spacing is descriptive of repeated source values, not an imposed new scale: labels sit above fields by (8px), form and action stacks use (12px), related content uses (16px), fields and fieldsets end with (24px), and stacked major regions use (32px). Radio choices wrap with a smaller gap (9px). Gallery padding is fluid on desktop, then (32px) at tablet width and (26px 22px) on narrow phones. Portrait editions receive their own balanced art-well padding and maximum frame widths (570px desktop, 390px tablet), preserving the full composition.

Enlarged inspection is a focusable local scroller with a proof width (1100px) and maximum height (70vh), reduced to (65vh) on a narrow phone. It intentionally scrolls within the page. Browser print styling removes the interface and illustrative frame, leaves the artwork on paper, and clears page margins. These CSS print rules are an output treatment, not a claim of physical production readiness.

**The Shared Guides Rule.** Align the preview, fields, choices and action stack to deliberate column edges. Contain enlarged-proof scrolling within its own focusable region.

## Elevation & Depth

Flat paper, tonal wells and thin rules organize the working interface. Depth belongs to the proof object and its native mounts. The frame has a diffuse two-part shadow (10px 18px 32px #39332638, 2px 3px 5px #39332625); Proof only removes both frame inset and shadow. Selected radio options use an inset ink stroke (1px), which reinforces state without floating the control.

The renderer’s photograph mounts retain their native shadow color (rgba(45,40,30,.17)), blur (14 canvas units) and vertical offset (7 canvas units). Flag mounts use their own smaller shadow color (rgba(40,32,20,.14)), blur (4 canvas units) and offset (2 canvas units). These canvas values remain artwork construction details, not CSS card tokens.

**The Artwork Depth Rule.** Concentrate diffuse depth on the physical artwork, its frame and its native photograph and flag mounts. Forms, summaries and status surfaces stay flat and legible.

## Shapes

Rectangular prints, nearly square controls and ruled disclosure rows define the form language. Text fields, ordinary buttons and file-selector buttons use the slight corner softening in frontmatter; choice labels remain square. There is no pill or circular utility-control vocabulary in this connected editor. Dividers and form strokes are thin (1px). The illustrative frame inset is (9px), reduced to (6px) on narrow phones; Proof only removes it completely.

World and shared-world artwork retain landscape proportions (1800×1200 logical units, 3:2); Country and Memory retain portrait proportions (1200×1600, 3:4). The renderer draws at twice those logical dimensions. Scaling preserves the full composition and complete flag faces. Photograph mounts and their small rotations remain part of the approved print material language; controls do not borrow those rotations.

## Components

### Buttons

Quiet rectangular actions share the frontmatter padding and radius, a minimum height (49px), a gap (12px) and an ink border (1px). Primary actions reverse paper text onto ink; their hover uses Lifted Green. Secondary actions stay transparent and hover into Selected Sage. Text actions remain underlined, with a minimum height (44px), no border and Earth Focus on hover. Disabled asynchronous buttons retain their shape, reduce opacity (0.55) and show a waiting cursor. Keyboard focus is an Earth Focus outline (2px), offset (5px).

Color transitions run only when reduced motion is not requested: buttons and links use background/color transitions (0.18s); frame presentation uses background-color (0.2s). There is no required entrance animation or imported gallery-film behavior on this working surface.

### Chips

Edition and preview-presentation choices are real radio controls expressed as flat, wrapping options. Default borders use Choice Edge; a selection adds Selected Sage, an ink border and an inset ink stroke (1px). Focus is drawn around the visible option (2px outline, 4px offset). Options have a minimum height (45px); their padding tightens to (10px 9px) at the narrow-phone breakpoint. Keep native radio semantics even though the actual radio is visually hidden.

### Cards / Containers

The gallery is an art well rather than a rounded card. The complete framed proof remains its focus, followed by an italic caption. The atlas summary is a flat ruled panel with aligned name/value rows; values align right and use tabular figures. Shared totals are separated by another quiet rule. Status notices use flat Status Paper; errors combine Clay Error text, Error Paper and the error stroke with a written recovery action.

### Inputs / Fields

Text inputs, selects and textareas use Field Paper, Control Edge, the recorded control radius and padding, and a minimum height (48px). Labels remain above the input; helper text remains adjacent. Textareas resize vertically. File inputs retain native local-file selection, a minimum input height (48px) and a themed selector button of at least (44px); its hover uses Selected Sage. Photograph slots have ruled separation, a small chosen-photo thumbnail (90×80px), an independent caption field and a text action to remove that photograph. Each chosen photograph can be replaced without changing the other slots.

### Navigation

The restrained header balances a back link on the left, widely tracked wordmark at center and Clear draft on the right. Footer links remain in the established dark-paper reversal. Both use authored thin-stroked SVG where an icon is present. The skip link reveals itself on focus and goes directly to the editor. Navigation typography and focus treatment remain consistent with the working controls.

### Print proof and disclosures

The complete composition is visible first. Inspect the print offers a separate enlarged view; Places in this atlas exposes readable HTML place lists. Every disclosure uses the same authored SVG plus (22px); its vertical stroke disappears when open, leaving a minus. Summary rows have a minimum height (56px), aligned text and an icon at the opposite edge. The disclosure’s native open/closed behavior remains intact.

**The Complete Proof Rule.** Keep the complete print visible at composition scale, and offer a separate enlarged inspection region when personalization becomes too small to read.

The Italy Country proof preserves artwork at (150,160), sized (960×1150), with its title below-left. Italy Memory preserves artwork at (90,300), sized (820×982), and three mounted photographs at the approved positions and rotations. Other Memory proofs reserve a separate right photo rail. The United States retains distinct mainland, Alaska and Hawaiʻi panels. World/Our World keeps geography above the complete flag mounts and recipient/count footer; dense selections compress that band rather than crop flags.

### State and recovery

Keep import, render, export, photo and storage feedback in their existing adjacent status surfaces. Missing or invalid incoming data never acquires decorative sample travel. Confirmed zero remains a legitimate empty atlas. Failed replacement or saved-design restoration keeps the existing draft and photographs visible. A design-file failure offers Choose another design, opening the relevant native file picker; it does not present stale link-import recovery. Clear draft exposes Undo clear while the current page remains open.

Photographs are explicitly selected local files; empty mounts are honest empty slots. Keep the visible explanation that no photograph is imported through an atlas link. A shared atlas can describe any two people; its HTML summary keeps country and territory totals separate and defines overlap without claiming they traveled together. The primary action is Download proof, with the adjacent statement that no order or payment is taken. These product truths constrain the visual treatment without turning physical commerce into a documented capability.

## Do's and Don'ts

### Do:

- Do preserve the approved print proportions, actual country artwork, true geography, recipient dedication and complete flag faces.
- Do align headings, art stages, fields, choice groups and action stacks to shared gutters and deliberate column guides.
- Do keep focus, status, validation and recovery messages adjacent to the affected controls, with the current names, dedication and selected photographs preserved.
- Do use the same visual language for an individual atlas, a friend’s gift or an atlas for any two people.
- Do retain the visible local-photo, frame-visualization and personal-digital-proof disclosures.

### Don't:

- Don’t replace illustrated artwork with generic map decoration or adopt the separate support identity’s palette and type.
- Don’t crop a complete proof to fit its preview stage or turn enlarged inspection into page-wide horizontal scrolling.
- Don’t turn flat form, summary or recovery surfaces into elevated cards, pills or badge clusters.
- Don’t replace authored SVG disclosure marks with font glyphs.
- Don’t use tiny print lettering as the only readable confirmation of edited names or shared counts.
