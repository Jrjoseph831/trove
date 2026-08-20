---
name: TROVE
description: Real-time shared-world market game — a living newspaper you can trade inside.
colors:
  bg: "#f7f5f0"
  paper: "#ffffff"
  paper-2: "#fbfaf6"
  line: "#e7e2d8"
  line-2: "#d6cfc2"
  ink: "#1b1714"
  ink-dim: "#6c675f"
  ink-faint: "#a49d91"
  accent: "#c8851f"
  up: "#9a6a2a"
  dn: "#5f7689"
  edition: "#9c7b34"
  track-bg: "#efece4"
typography:
  display:
    fontFamily: "Georgia, \"Times New Roman\", serif"
    fontSize: "32px"
    fontWeight: 600
    lineHeight: 1.05
  headline:
    fontFamily: "Georgia, \"Times New Roman\", serif"
    fontSize: "25px"
    fontWeight: 600
    letterSpacing: "0.32em"
  title:
    fontFamily: "Georgia, \"Times New Roman\", serif"
    fontSize: "15px"
    fontWeight: 600
    letterSpacing: "0.01em"
  body:
    fontFamily: "Inter, \"Helvetica Neue\", system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Inter, \"Helvetica Neue\", system-ui, sans-serif"
    fontSize: "9.5px"
    fontWeight: 600
    letterSpacing: "0.22em"
rounded:
  bento: "16px"
  surface: "10px"
  pill: "999px"
  chip: "6px"
spacing:
  bento-gap: "16px"
  bento-pad: "22px"
  view-h: "40px"
  view-v: "32px"
components:
  bento-card:
    backgroundColor: "{colors.paper}"
    rounded: "{rounded.bento}"
    padding: "{spacing.bento-pad}"
  nav-button:
    backgroundColor: "transparent"
    textColor: "{colors.ink-dim}"
    rounded: "9px"
    padding: "9px 12px"
  nav-button-active:
    backgroundColor: "color-mix(in srgb, #c8851f 14%, transparent)"
    textColor: "{colors.accent}"
    rounded: "9px"
    padding: "9px 12px"
  pill-cta:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.pill}"
    padding: "11px 22px"
  chip:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink-dim}"
    rounded: "{rounded.pill}"
    padding: "6px 13px"
  chip-active:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.pill}"
    padding: "6px 13px"
  nav-badge:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.paper}"
    rounded: "{rounded.pill}"
    padding: "1px 6px"
---

# Design System: TROVE

## Overview

**Creative North Star: "The Market Chronicle"**

TROVE is a living newspaper you can trade inside. TNN writes the stories; the player moves the prices. The design takes its visual cue from the great financial papers — warm paper stock, restrained ink typography, tight editorial spacing — then lifts each card off the page with genuine physical depth. The result is not a trading terminal emulator; it is an editorial object with financial precision, a world where reading the news and acting on it happen in the same breath.

Restraint is the system's defining choice. The warm gold accent appears only where the market demands attention — one active state, one highlight, one critical status — and its rarity is what makes it land. Every number is set in a proportional-serif face that carries the weight of a printed ledger, while the sans handles all interface text at a density that lets data breathe. The page substrate is not pure white: it carries a warm-paper fill, a radial light from the upper left as if a gallery spot fell across it, and a fine fractal grain at near-invisible opacity — the three together make an empty screen feel like quality archival paper instead of a blank window.

Visual rejections confirmed by the owner: no candy red or green for price movement (Auction Bronze and Ledger Steel are the system's vocabulary); no dark auction-house terminal skin; no decorative grid-line backgrounds except on actual measurement or blueprint surfaces.

**Key Characteristics:**
- Warm paper substrate with grain texture and ambient radial light — not pure white
- Georgia serif for all financial values, numerals, and tile titles; Inter for all interface text
- Three-shadow elevation stack on cards — they sit on a surface, not float in front of it
- Auction Bronze rising, Ledger Steel cooling — muted directional color, never candy
- Trading Floor Gold appears on ≤1 element per viewport at rest (active nav, one CTA, one badge)
- Uppercase eyebrow labels (9.5px, 0.22em tracking) mark every editorial section boundary
- 16px rounded bento tiles on a 12-column grid — the single global layout token

## Colors

The palette is an editorial ink-and-paper spectrum anchored by two directional signals and one warm accent.

### Primary
- **Trading Floor Gold** (`#c8851f`): The system's single active voice. Used for the nav active state, primary CTAs, nav badges, and the accent light bleed in the page substrate. Appears on ≤1 element per viewport at rest; its scarcity is the point.

### Secondary
- **Auction Bronze** (`#9a6a2a`): Rising price movement, positive delta. Warm, aged, muted — never vivid. Used exclusively for `.chg.pos` / `--up` states and corresponding track fills.
- **Ledger Steel** (`#5f7689`): Cooling price movement, negative delta. A muted desaturated blue-grey that reads as a receding, cold value. Used exclusively for `.chg.neg` / `--dn` states.

### Tertiary
- **Antique Gold** (`#9c7b34`): Collectible / edition items only. A slightly greener, darker gold that signals scarcity without competing with the accent. Used for edition borders, copy-number reveals, and edition-specific track fills.

### Neutral
- **Warm Paper Page** (`#f7f5f0`): The page substrate — the app background. Carries the grain and radial-light gradient treatment. Never used as a card surface.
- **Card Surface** (`#ffffff`): Bento card backgrounds. Appears lifted off the page via the elevation shadow stack.
- **Inset Surface** (`#fbfaf6`): Hover states, inset panels, section subdivisions within a tile.
- **Hairline Rule** (`#e7e2d8`): All borders, dividers, and card outlines at rest. The thinnest line the system draws.
- **Stronger Rule** (`#d6cfc2`): Hover borders, stronger dividers, scrollbar thumbs.
- **Pressman Black** (`#1b1714`): Primary text, masthead wordmark, high-contrast CTA backgrounds. Warm near-black with a trace of amber — not cool charcoal.
- **Ink-Dim** (`#6c675f`): Secondary text, body copy, nav item labels at rest.
- **Ink-Faint** (`#a49d91`): Tertiary text, eyebrow label color, "why" sub-labels in tile headers, caption metadata.
- **Track Background** (`#efece4`): The rail/track behind meter bars and sector-index bars.

### Named Rules
**The One Voice Rule.** Trading Floor Gold (`#c8851f`) appears on ≤1 element per viewport at rest. Its rarity is the point — the moment it appears, the player knows it is the system speaking to them.

**The No Candy Rule.** Price direction is never communicated with red or green. Auction Bronze and Ledger Steel are the only directional colors. Nothing in the UI should trigger a trading-game reflex; it should trigger a newspaper-reading one.

## Typography

**Display / Numerals:** Georgia, "Times New Roman", serif  
**Interface / Body / Labels:** Inter, "Helvetica Neue", system-ui, sans-serif

**Character:** A deliberate two-voice system. The serif carries weight, history, and financial authority — every number, every price, every tile title carries the feel of a printed ledger. The sans handles all navigation, metadata, and body copy with modern precision. They never switch roles.

### Hierarchy
- **Display** (600, 32px, 1.05 line-height, tabular-nums): The main financial value — net worth, large price readouts. Always Georgia, always tabular-nums so columns align. The largest type in the product.
- **Headline** (600, 25px, 0.32em letter-spacing): The brand wordmark "TROVE" only. Extreme letter-spacing turns it into a near-monogram. Nothing else runs at this size and tracking combination.
- **Title** (600, 15px, 0.01em letter-spacing, Georgia): Tile headers inside bento cards (`.bc-h .t`). The serif here signals "this tile has editorial authority."
- **Body** (400, 14px, 1.5 line-height, Inter): All prose content, descriptions, order details. Line-length capped at 62-65ch where possible.
- **Label** (600, 9.5px, 0.22em letter-spacing, uppercase, Inter): Eyebrow section markers, nav section headers, small metadata. The tracking is extreme by design — at 9.5px, character-spaced text reads as a stamp rather than running text.

### Named Rules
**The Two-Voice Rule.** Georgia carries numbers and titles. Inter carries interface text and body. They do not switch. A price label in Inter or a navigation item in Georgia is an error.

**The Tabular Numbers Rule.** Every financial value uses `font-variant-numeric: tabular-nums`. Prices, deltas, quantities, and rankings must never cause columns to shift when a digit changes width.

## Layout

TROVE uses a fixed shell — 256px rail on the left, flexible main content area on the right — with a 12-column bento grid as the universal layout system for all content pages. The rail never collapses on desktop; on mobile it slides in as a drawer.

**Shell:** `display: grid; grid-template-columns: 256px 1fr;` at the app root. The rail carries `background: var(--paper); border-right: 1px solid var(--line);` and a fixed height with its own internal scroll.

**View padding:** `32px 40px 56px` (top / sides / bottom). This generous bottom pad ensures content never clips behind mobile browser chrome.

**Bento grid:** `display: grid; grid-template-columns: repeat(12, 1fr); gap: 16px;` inside `.bento`, centered with `max-width: 1200px; margin: 0 auto;` on the `.view > .bento` selector. Span helpers `.col-3` through `.col-12` control tile widths.

**Responsive collapse:** At ≤1000px all partial-width tiles (`.col-3` through `.col-9`) collapse to `span 12` — full-width single-column. This is the only responsive breakpoint for the grid; the rail converts to a drawer via its own `@media (max-width: 780px)` breakpoint.

**Spacing rhythm:** `--bento-gap: 16px` between tiles; `--bento-pad: 22px` inside tiles. These two numbers are the spatial heartbeat of every screen. Never override them per-component.

## Elevation & Depth

TROVE uses a structured three-layer shadow stack, not flat surfaces. The philosophy, written directly in the codebase: "a single blur reads as a drop-shadow effect while a stack reads as an object sitting on a surface." Cards do not float; they rest.

### Shadow Vocabulary
- **Lift-1 (rest):** `0 1px 1px rgba(0,0,0,0.04), 0 2px 6px -2px rgba(0,0,0,0.06), 0 12px 28px -20px rgba(0,0,0,0.28)` — the contact edge (tight), a short ambient halo, and a long soft breath beneath. Applied to all bento cards at rest.
- **Lift-2 (hover):** `0 1px 1px rgba(0,0,0,0.05), 0 6px 14px -6px rgba(0,0,0,0.12), 0 22px 46px -24px rgba(0,0,0,0.5)` — the same stack, amplified. The card rises; the long shadow deepens.
- **Edge light:** `inset 0 1px 0 rgba(255,255,255,0.55)` — a hairline of white on the top edge, as if the surface caught gallery light. Applied alongside Lift-1 on all bento cards.

Dark mode shadows are heavier (stronger opacity, wider spreads) to separate a dark card from a near-black page. The edge light drops to `rgba(255,255,255,0.05)` in dark mode so it reads as a whisper rather than a visible white line.

### Named Rules
**The Stack Rule.** Never apply a single `box-shadow` blur to a card. The three-layer stack is what separates "resting on a surface" from "floating above it." Single-blur shadows are a downgrade, not a simplification.

**The Flat-by-Design Rule.** Interactive elements smaller than a card (buttons, chips, badges, nav items) are flat at rest. Depth lives at the tile level — not inside it.

## Shapes

The system uses four distinct radii that correspond to four distinct element scales.

- **Bento (16px, `--bento-r`):** All content tile cards and their outer containers. The primary shape token — the visual signature of the bento grid. No bento card may use a different radius; consistency is the point.
- **Surface (10px, `--r`):** Inner containers, module panels, input fields, and sub-panels that live inside tiles. One step softer than the tile.
- **Pill (999px):** Badges, filter chips, mode-switch toggles, CTAs (`.guestbar-cta`, `.modeswitch`), and search inputs. Reserved for anything that reads as a tag or action pill, not a surface.
- **Chip (4-6px):** Small utility elements: the scrollbar thumb (6px), nav disabled-state badges (4px). These carry no brand meaning — they are incidental radii.

**Named Rules**

**The Bento Radius Rule.** All bento card tiles use `border-radius: var(--bento-r)` (16px), always. One-off radii on bento tiles are prohibited — the grid's visual cohesion depends on every tile sharing the same corner language.

**The Two-Shape Language Rule.** The product has two intentional shapes: the softly squared bento tile (16px) and the fully rounded pill (999px). Content containers are always one; interactive tags and CTAs are always the other. Nothing in between (8px, 12px, 24px) should appear in primary UI.

## Components

### Bento Cards
The signature component. Every content surface in the app is a bento card or a group of bento cards.

- **Shape:** Softly rounded (16px), hairline border (`1px solid var(--line)`), white card surface on a warm paper substrate.
- **Elevation:** Lift-1 shadow stack + edge-light at rest; Lift-2 on hover; `translateY(1px) scale(0.997)` micro-press on active.
- **Hover:** `border-color` transitions to `--line-2`, shadow upgrades to Lift-2. Duration: border 0.16s ease, shadow 0.18s ease, transform 0.13s ease.
- **Internal padding:** `--bento-pad: 22px` on all four sides.
- **Tile header (`.bc-h`):** A flex row inside the tile — serif title (15px, 600, Georgia) paired with a faint "why" sub-label (11px, `--ink-faint`). Every tile with a named purpose uses this header pattern; tiles that are purely visual (charts, images) may omit it.

### Navigation
The rail sidebar is the product's primary wayfinding surface.

- **Shell:** 256px fixed-width column, `--paper` background, `1px solid --line` right border, `26px 22px 30px` internal padding with `gap: 26px` between sections.
- **Section headers:** 10.5px, 0.16em letter-spacing, uppercase, `--ink-faint`, `padding: 0 12px 10px` — positioned as an editorial label above each nav group.
- **Nav items:** 13.5px Inter, `--ink-dim` default, `9px 12px` padding, 9px radius. 16px Lucide icon at left, fixed-width `span.ic` container.
- **Hover:** `color: --ink; background: color-mix(in srgb, --ink 6%, transparent);`
- **Active:** `color: --accent; background: color-mix(in srgb, --accent 14%, transparent); font-weight: 700;` — the one place gold fires in the rail.
- **Nav badge:** Accent-background pill (`--accent` fill, `--paper` text, 999px, `1px 6px` padding, 9px/800-weight). Appears for pending orders and goal counts.
- **Mobile:** At ≤780px, the rail slides in as a full-height overlay drawer from the left; a scrim (`rgba(247,245,240,0.82)`) covers the content area.

### Buttons
Two distinct button types; no others exist in the system.

- **Pill CTA (primary action):** `background: --ink; color: --paper; border-radius: 999px; padding: 11px 22px; font-size: 13px; font-weight: 700;` Hover: `opacity: 0.88`. Used for high-stakes actions (sign in, confirm trade, unlock).
- **Chip / filter button:** `background: --paper; border: 1px solid --line-2; border-radius: 999px; padding: 6px 13px; font-size: 10px; letter-spacing: 0.06em; text-transform: uppercase; font-weight: 600; color: --ink-dim;` Hover: `border-color: --ink-faint; color: --ink;` Active/selected: `background: --ink; color: --paper; border-color: --ink;`

### Chips and Badges
- **Filter chip:** See Chip / filter button above — this is the same element used for sector/category filtering.
- **Mode switch:** A pill container holding two equal buttons — `border: 1px solid --line-2; border-radius: 999px; overflow: hidden;` Each button is `background: transparent; color: --ink-dim; 9.5px/0.14em/uppercase/600;` Active button: `background: --ink; color: --paper;`
- **Nav badge:** Accent-filled circle/pill for counts (orders, goal progress). See Navigation.

### Inputs / Search
- **Search field:** `background: --paper; border: 1px solid --line-2; border-radius: 999px; padding: 8px 16px; font-size: 12.5px; color: --ink;` Pill-shaped to match the chip language. No box-shadow at rest; subtle border-color shift on focus.

### Price Delta (Signature Component)
The directional color system — the most product-specific component in the visual vocabulary.

- **Rising (`.chg.pos`):** `color: var(--up)` — Auction Bronze (`#9a6a2a`). Applied to positive price deltas, sector-index up arrows, and rising value indicators. Always rendered in `font-variant-numeric: tabular-nums`.
- **Falling (`.chg.neg`):** `color: var(--dn)` — Ledger Steel (`#5f7689`). Applied to negative price deltas, sector-index down arrows, and cooling values.
- **Size:** 11.5px by default alongside larger body copy; may scale with the display value it modifies.
- **Rule:** Directional color applies ONLY to the delta figure, never to backgrounds, borders, or tile fills.

## Do's and Don'ts

### Do:
- **Do** use `--bento-r: 16px` on every tile card. The grid's visual authority depends on a single consistent radius.
- **Do** use Georgia (serif) for all financial values, numerals, tile titles, and the brand wordmark. Use Inter for everything else.
- **Do** add `font-variant-numeric: tabular-nums` to any element that displays a price, quantity, rank, or percentage.
- **Do** use the three-shadow Lift-1 stack on all bento cards at rest. Single-blur box-shadows are a visual downgrade.
- **Do** apply Trading Floor Gold (`#c8851f`) to at most one element per viewport at rest — the active nav item OR a single CTA OR a count badge.
- **Do** use uppercase, wide-tracked eyebrow labels (9.5px, 0.22em, `--ink-faint`) to mark every editorial section boundary inside a tile or above a group.
- **Do** use Auction Bronze / Ledger Steel for all price direction. Never red or green.

### Don't:
- **Don't** use a single-blur `box-shadow` on a card surface. Apply the three-layer Lift-1 stack or nothing.
- **Don't** use per-tile one-off `border-radius` values. All bento cards must use `var(--bento-r)` (16px).
- **Don't** switch the font voice — no Georgia in navigation or body copy; no Inter in financial values or tile titles.
- **Don't** use red or green anywhere in the product for price direction or status. Auction Bronze and Ledger Steel are the system's vocabulary.
- **Don't** animate `width`, `height`, `padding`, or `margin` directly. Use `transform` for motion and `grid-template-rows: 0fr → 1fr` for height transitions.
- **Don't** use a decorative grid-line background except on actual canvas, map, blueprint, or measurement surfaces.
- **Don't** render the raw 0–100 heat score. Expose tier names (CLEAN / WATCHED / FLAGGED / UNDER INVESTIGATION) only.
