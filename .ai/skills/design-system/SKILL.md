---
name: design-system
description: Design system reference for the BrytSpace B2B frontend. Points to DESIGN.md (repo root) as the single source of truth for all design tokens. Use when building or styling UI components.
user-invocable: true
---

# BrytSpace Design System Reference

**`DESIGN.md` (repo root) is the single source of truth.** Every design token — colours, fonts,
type scale, spacing, width scale, radius, borders, elevation, z-index, animations — and every
component spec lives there. **Read the relevant `DESIGN.md` section and copy exact values from it;
never hard-code a hex/px from memory and never duplicate the token tables into other files.**

This skill carries only the brand principles and a map of where things are in `DESIGN.md`. When a
token value is needed, go to `DESIGN.md`.

## Where to find each thing in DESIGN.md

| Need | DESIGN.md section |
|------|-------------------|
| Colours (brand ramp, lime accent, semantic, base, Figma tokens) | **Colors** |
| Fonts, weights, type scale, semantic text tokens, bryt-desktop/mobile, responsive hierarchy | **Typography** |
| Spacing scale | **Spacing** |
| Width scale & breakpoints | **Width Scale** / **Containers** |
| Radius tokens | **Border Radius** |
| Border widths & colours | **Borders** |
| Shadow roles | **Elevation** |
| Z-index layers | **Z-Index** |
| Hover / focus / disabled / checked recipes | **States** |
| Durations, easing, keyframes, prohibited motion | **Animations** |
| Component specs (Button, Badge, SupplierCard, Input, Modal, Tabs, …) | **Components** |
| Icon catalog & usage policy | **Components → Icon / Icon usage policy** |
| Gradients & overlay | **Gradients & Overlay** |
| Copy/voice rules | **Voice & Copy** |

## Where tokens live (not this repo)

This is the Laravel backend; the B2B frontend is a **separate repo**. Define the tokens from
`DESIGN.md` once in that frontend's global Tailwind theme (`@theme` in the main stylesheet) and
reference them by token name throughout — never hard-code raw values in components. There is nothing
to build here.

## Brand principles (the gut-check)

These shape every decision; pull the concrete values from `DESIGN.md`.

1. **Monochrome.** Near-black ink on white and a light grey canvas. The colour palette is neutral —
   the former teal and the purple accent are legacy/retired; don't extend them.
2. **One accent: lime**, for **functional signifiers only** — status/count badges, a "recommended"
   tag, a notification dot, the footer surface, at most one accent CTA per dark/hero screen. Never
   decoration, never a large surface. The **primary CTA is near-black**, not lime.
3. **Near-square.** 2px radius is the default for essentially everything; `rounded-full` only for
   pills/avatars; the SearchBar's 8px corner is the sole exception. No large radii.
4. **Near-flat elevation.** Separation comes from hairline borders + white/canvas surface contrast,
   not cast shadows. Cards have no shadow; only genuinely floating surfaces (modals, popovers) lift.
5. **Typography**: Geist (display/headings) · Inter (body/UI) · Geist Mono (numbers, prices,
   eyebrows) · Hanken Grotesk (editorial). No binary font files committed — load via web-font host.
6. **Sober motion.** 200–300ms `ease-in-out`; no scale-on-hover, no shadow-on-hover, no bounce, no
   parallax, no icon micro-animations.
7. **Icons** via `<Icon name="..." />` from the catalog (fall back to Lucide for uncatalogued, then
   promote). Never inline raw `<svg>` for an icon, never emoji.
8. **Voice**: Spanish-first, address as "tú". Lowercase buttons, display headlines end with a full
   stop, mono uppercase eyebrows, European number format, `·` as metadata separator, no emoji.
9. **One shared token set** across the whole product — never fork a per-screen palette; theme any
   third-party primitive to these tokens so it's indistinguishable.

When in doubt about a value, a measurement, or a component's anatomy, open `DESIGN.md` — it is
self-contained and authoritative.
