# MediCare+

Trustworthy, sterile-clean, calming blue.

## Overview

MediCare+ is a clinical design system for hospital portals and patient management systems. It prioritizes clarity, trust, and error prevention above all else. The calming blue palette is intentionally sterile — evoking the reliability of medical-grade environments. Standard density ensures that forms, data tables, and patient records are legible without ambiguity. Every component is designed with accessibility as a non-negotiable requirement (WCAG AA minimum), large touch targets for bedside tablets, and clear visual hierarchy that prevents critical misreadings.

## Colors

- **Primary** (#0077B6): Med Blue — primary actions, navigation, links
- **Secondary** (#48CAE4): Light Blue — supporting accents, charts, badges
- **Tertiary** (#90E0EF): Pale Cyan — highlights, progress bars, tags
- **Background** (#FAFCFF): Very pale blue-white page background
- **Surface** (#FFFFFF): Cards, panels, form containers
- **Success** (#059669)
- **Warning** (#D97706)
- **Error** (#DC2626)
- **Info** (#0077B6)

## Color Ramps

**Philosophy:** The palette above names the tones that carry meaning. The panel, however, needs an
11-rung ramp per colour role (50…950), because that is the shape every component library — ours
included — indexes into. The ramps below are the single source of those rungs; they are *not*
free-hand tones.

**Derivation rule.** A ramp is built by placing the tones this document already names at their rung,
and filling the gaps by interpolating in OKLCH between the two named neighbours, keeping hue and
chroma and moving only lightness. Rungs beyond the last named tone are extrapolated with the same
lightness step. An interpolated or extrapolated rung is **decorative-safe only**: it may never be the
sole carrier of a text or border contrast requirement — those roles must land on a named, verified
tone. Named tones are marked ✳ below.

- **Primary / Info**: 50 #F0F7FF ✳ · 100 #E0EFFF ✳ · 200 #BBE6FC · 300 #90E0EF ✳ · 400 #48CAE4 ✳ · 500 #1BA1CF · 600 #0077B6 ✳ · 700 #006399 ✳ · 800 #005280 ✳ · 900 #004168 · 950 #003250
- **Gray**: 50 #F8FAFC ✳ · 100 #F1F5F9 · 200 #E2E8F0 ✳ · 300 #CBD5E1 ✳ · 400 #94A3B8 ✳ · 500 #64748B · 600 #475569 ✳ · 700 #334155 · 800 #1E293B · 900 #0F172A ✳ · 950 #020617
- **Danger**: 50 #FEF2F2 ✳ · 100 #FEE2E2 · 200 #FECACA ✳ · 300 #FCA5A5 · 400 #F87171 · 500 #EF4444 · 600 #DC2626 ✳ · 700 #B91C1C ✳ · 800 #991B1B ✳ · 900 #7F1D1D · 950 #450A0A
- **Success**: 50 #ECFDF5 ✳ · 100 #D1FAE5 · 200 #A7F3D0 ✳ · 300 #6EE7B7 · 400 #34D399 · 500 #10B981 · 600 #059669 ✳ · 700 #047857 · 800 #065F46 · 900 #064E3B · 950 #022C22
- **Warning**: 50 #FFFBEB ✳ · 100 #FEF3C7 · 200 #FDE68A ✳ · 300 #FCD34D · 400 #FBBF24 · 500 #F59E0B · 600 #D97706 ✳ · 700 #B45309 · 800 #92400E · 900 #78350F · 950 #451A03

The gray ramp is Tailwind v3 Slate, which is where the greys this document names come from; the v4
Slate ramp is a different set of tones and must not be substituted. The 300 and 400 rungs of Danger,
Success and Warning are the dark-mode semantic tones of § Dark Mode, so they are named there rather
than here.

## Typography

- **Headline Font**: Figtree
- **Body Font**: Open Sans
- **Mono Font**: IBM Plex Mono

- **Display**: Figtree 34px bold, 1.2 line height, 0.02em tracking. Dashboard greetings, hero text.
- **Headline**: Figtree 26px bold, 1.3 line height, 0.01em tracking. Page titles, section headers.
- **Subhead**: Figtree 20px semibold, 1.4 line height. Card titles, panel headings.
- **Body Large**: Open Sans 18px regular, 1.6 line height. Important instructions, alerts.
- **Body**: Open Sans 16px regular, 1.6 line height. Default reading text, forms.
- **Body Small**: Open Sans 14px regular, 1.55 line height. Table cells, secondary info.
- **Caption**: Open Sans 12px medium, 1.5 line height, 0.01em tracking. Timestamps, record IDs.
- **Overline**: Open Sans 11px bold, 1.4 line height, 0.08em tracking. Status labels, section markers.
- **Code**: IBM Plex Mono 14px regular, 1.6 line height. Medical codes, IDs, data fields.

## Spacing

- **Base unit**: 8px
- **Scale**: 4, 8, 16, 24, 32, 40, 48, 64, 80
- **Component padding — small**: 8px
- **Component padding — medium**: 16px
- **Component padding — large**: 32px
- **Section spacing — mobile**: 40px
- **Section spacing — tablet**: 56px
- **Section spacing — desktop**: 80px

## Border Radius

- **None** (0px): Table cells, dividers
- **Small** (4px): Chips, badges, small inline elements
- **Medium** (8px): Buttons, inputs, cards, panels
- **Large** (12px): Modals, dialogs, large panels
- **XL** (16px): Onboarding cards, hero containers
- **Full** (9999px): Avatars, status indicators, pill badges
The default radius is 8px — professional and approachable, with enough rounding to feel friendly without being playful.

## Elevation

**Philosophy:** Subtle, clean shadows establish hierarchy in dense clinical interfaces. They must be gentle — no harsh edges or dramatic elevation that might distract from critical content.
- **Subtle**: 1px offset, 3px blur, #000000 at 6%; 1px offset, 2px blur, #000000 at 4%. Cards, form containers.
- **Medium**: 4px offset, 12px blur, #000000 at 7%; 1px offset, 3px blur, #000000 at 4%. Hovered cards, active panels.
- **Large**: 12px offset, 32px blur, #000000 at 8%; 4px offset, 8px blur, #000000 at 4%. Modals, critical alerts.
- **Overlay**: 20px offset, 48px blur, #000000 at 12%; 8px offset, 16px blur, #000000 at 6%. Dropdown menus, date pickers.
**Special — Blue Focus:** 2px ring #FAFCFF, 4px ring #0077B6 — high-visibility focus ring for keyboard and assistive technology users.
**Special — Error Halo:** 2px ring #FAFCFF, 4px ring #DC2626 — immediate visual alert for fields with validation errors.

## Components

### Buttons
- **Primary**: #0077B6 fill, #FFFFFF text, no border, 8px corners. Open Sans 15px semibold. 10px/24px padding, 44px (touch target) min height. Hover: Background #006399. Active: Background #005280.
- **Secondary**: #FFFFFF fill, #0077B6 text, 1.5px #0077B6 border, 8px corners. Open Sans 15px semibold. 10px/24px padding, 44px min height. Hover: Background #F0F7FF. Active: Background #E0EFFF.
- **Ghost**: transparent, #0077B6 text, no border, 8px corners. Open Sans 15px semibold. 10px/24px padding, 44px min height. Hover: Background #F0F7FF. Active: Background #E0EFFF.
- **Destructive**: #DC2626 fill, #FFFFFF text, no border, 8px corners. Open Sans 15px semibold. 10px/24px padding, 44px min height. Hover: Background #B91C1C. Active: Background #991B1B.
- **Sizes**: Small 8px 16px / 13px (min-height 36px), Medium 10px 24px / 15px (min-height 44px), Large 14px 32px / 16px (min-height 52px)
- **Disabled**: Background #E2E8F0, text #94A3B8, disabled cursor, no hover change.

### Cards
- **Default**: #FFFFFF fill, 1px #E2E8F0 border, 8px corners, 1px offset, 3px blur, #000000 at 6%; 1px offset, 2px blur, #000000 at 4% shadow. 24px padding. Hover: Shadow 0 4px 12px #000000 at 7%; 1px offset, 3px blur, #000000 at 4%.
- **Elevated**: #FFFFFF fill, 1px #E2E8F0 border, 8px corners, 4px offset, 12px blur, #000000 at 7%; 1px offset, 3px blur, #000000 at 4% shadow. 24px padding.

### Inputs
- **Text Input**: #FFFFFF fill, 1.5px #CBD5E1 border, 8px corners, #0F172A text. Open Sans 16px regular. 44px tall, 10px/14px padding, #94A3B8 placeholder color. Focus: Border #0077B6, ring 2px ring #FAFCFF, 4px ring #0077B6. Error: Border #DC2626, ring 2px ring #FAFCFF, 4px ring #DC2626. Disabled: Background #F8FAFC, border #E2E8F0, 60% opacity.
- **Label**: Open Sans, 14px, weight 600, color #0F172A, bottom margin 6px. Required fields append a red asterisk `*` in #DC2626.
- **Helper Text**: Open Sans, 13px, weight 400, color #475569, top margin 6px. Error helper color #DC2626, prefixed with a warning icon.

### Chips
- **Filter Chip**: #F0F7FF fill, 1px #CBD5E1 border, pill shape, #475569 text. Open Sans 13px semibold. 6px/14px padding. Selected: Background #0077B6, text #FFFFFF, border #0077B6. Hover: Background #E0EFFF.
- **Status Chip**: 4px corners. Open Sans 12px bold uppercase. 4px/12px padding, Background #ECFDF5, text #059669, border 1px #A7F3D0 success, Background #FFFBEB, text #D97706, border 1px #FDE68A warning, Background #F0F7FF, text #006399, border 1px #90E0EF info. Error: Background #FEF2F2, text #B91C1C, border 1px #FECACA.
  The info and error inks are one rung darker than the Info and Error tones of § Colors because the chip
  fill is not white: #0077B6 on #F0F7FF is 4.51:1 and #DC2626 on #FEF2F2 is 4.41:1, so neither clears
  Do's #1 with any margin. #006399 (§ Buttons · Primary hover) reaches 6.00:1 and #B91C1C (§ Buttons ·
  Destructive hover) reaches 5.91:1. Hue is unchanged; only lightness moves.

### Lists
- **Default List Item**: 1px #E2E8F0 border bottom, #0F172A text. Open Sans 16px regular. 14px/16px padding, #475569, 13px secondary text, 20px icon, color #0077B6 leading element, 48px (touch target) min height. Hover: Background #F0F7FF. Active: Background #E0EFFF.

### Checkboxes
20px (larger for clinical accuracy), 1.5px #CBD5E1 border, 4px corners, #FFFFFF fill. 44px minimum touch target. Checked: Background #0077B6, border #0077B6, checkmark #FFFFFF. Indeterminate: Background #0077B6, dash #FFFFFF. Hover: Border #0077B6, background #F0F7FF. Focus: Ring 2px ring #FAFCFF, 4px ring #0077B6. Disabled: Background #F8FAFC, 50% opacity. Labels in Open Sans 16px regular left margin 10px.

### Radio Buttons
20px (larger for clinical accuracy), 1.5px #CBD5E1 border, pill shape, #FFFFFF fill. 44px minimum touch target. Selected: Border #0077B6, inner dot #0077B6 (10px). Hover: Border #0077B6, background #F0F7FF. Focus: Ring 2px ring #FAFCFF, 4px ring #0077B6. Disabled: Background #F8FAFC, 50% opacity. Labels in Open Sans 16px regular left margin 10px.

### Tooltips
#0F172A fill, #FFFFFF text, 8px corners, 4px offset, 12px blur, #000000 at 12% shadow. Open Sans 13px medium. 8px/14px padding, 280px max width, 6px, same background arrow, 300ms enter, 100ms leave delay.

### Charts

**Philosophy:** A chart is drawn on a `<canvas>`, so it cannot inherit a single class from the page;
every colour has to be handed to it explicitly. That is exactly why it needs to be specified here —
otherwise each chart grows its own private palette. Chart colours are not new colours: the chrome
reuses the ink and border roles, and the series reuse the ramps of § Color Ramps.

- **Plot surface**: Surface (#FFFFFF) — charts live inside a card.
- **Grid lines / axis lines**: #E2E8F0 (the § Cards border; decorative, 1.23:1).
- **Axis tick labels and chart caption**: #475569 (7.58:1 on the plot surface). Open Sans 12px.
- **Point border** (the halo that separates a marker from the line): the plot surface, #FFFFFF.
- **Tooltip**: § Tooltips unchanged — #0F172A fill, #FFFFFF text (17.85:1).
- **Series, in order**: 1 #0077B6 (4.87:1) · 2 #005280 (8.34:1) · 3 #059669 (3.77:1) · 4 #D97706 (3.19:1).
  All clear the 3:1 of WCAG 1.4.11 for graphical objects on the plot surface. The first two are the
  preferred pair: they are the two blues of the system and carry no status meaning. Series 3 and 4
  reuse the Success and Warning hues, so from the third series on a legend is mandatory and the
  reading must never depend on colour alone (Do's #3) — pair them with distinct marker shapes.
  Red is never a series colour (Don'ts #4): it belongs to errors alone.

## Dark Mode

**Philosophy:** Dark mode is not a second palette — it is the MediCare+ ramp read in reverse. Nothing here is picked by eye: every dark token is derived from a light token by the rules below, and every text pair is verified at WCAG AA or better. Blue is still action and navigation; red is still reserved for errors, critical alerts, and destructive actions.

### Derivation Rules — Dark

Use these three rules to derive the dark counterpart of any token added in the future. Never invent a loose hex.
1. **Surfaces invert the ladder.** Surfaces descend from the light-mode ink family (#0F172A). In light, the page background (#FAFCFF) sits below the surface (#FFFFFF); in dark the page background is the darkest rung (#0B1220) and every elevation level climbs one step of luminance (#152238 → #1E2D45 → #26374F). Ink and background swap roles: ink becomes near-white blue (#E8EEF7), secondary ink #AEBDD1.
2. **Accents step one rung up the existing scale.** The same hue needs more luminance to read on a dark ground, so Primary takes the light Secondary (#0077B6 → #48CAE4), Secondary takes the light Tertiary (#90E0EF), and Tertiary extends the same cyan scale by one new rung (#C2F0F7). Blue solids never darken in dark mode — they lighten, and their text flips to dark ink.
3. **Semantics keep their hue and lift to the 400 rung.** Success #059669 → #34D399, Warning #D97706 → #FBBF24, Error #DC2626 → #F87171, Info = Primary. Hue is never rotated. If a derived pair fails 4.5:1, lift the tone another rung — never lower the requirement.

**Every dark token is verified against the whole surface ladder, not only against Surface.** A card
sits on Surface, but a popover sits on Surface Raised and a dropdown on Surface Overlay, and each rung
is lighter than the last: the deepest rung of the ladder (#26374F) is the worst case for any
foreground. A token is only accepted if it clears its threshold on **Surface Overlay** too. This is
what lifted the placeholder, the interactive border and the error ink above their first candidates.

### Colors — Dark

- **Primary** (#48CAE4): Med Cyan — primary actions, navigation, links
- **Primary Hover** (#7FDBEE) / **Primary Active** (#90E0EF)
- **Secondary** (#90E0EF): supporting accents, charts, badges
- **Tertiary** (#C2F0F7): highlights, progress bars, tags
- **Background** (#0B1220): page background, deepest rung of the surface ladder
- **Surface** (#152238): cards, panels, form containers
- **Surface Raised** (#1E2D45): hovered cards, active panels, popovers
- **Surface Overlay** (#26374F): dropdown menus, date pickers, popovers — the lightest rung, and therefore the worst case every foreground token is verified against
- **Surface Hover** (#1A2A42): row and list-item hover
- **Ink** (#E8EEF7): primary text
- **Ink Secondary** (#AEBDD1): helper text, secondary list text, captions
- **Ink Muted** (#94A6BE): placeholders only — never data
- **Ink Disabled** (#8093AE) on **Surface Disabled** (#1B2740)
- **Border** (#2A3A55): card, table and divider borders (decorative)
- **Border Strong** (#7189AC): input, checkbox and radio borders (interactive, >=3:1 on every rung of the ladder)
- **Border Strong Hover** (#8CA2C4)
- **Success** (#34D399)
- **Warning** (#FBBF24)
- **Error** (#F87171): fills, borders, halos and icons — graphical roles, threshold 3:1
- **Error Ink** (#FCA5A5): every red **text** role — message copy, helper text, required asterisk. #F87171 as text falls to 4.36:1 on Surface Overlay, so red text always takes this tone. It is also the Destructive hover fill
- **Info** (#48CAE4)

### Elevation — Dark

**Philosophy:** A black shadow is invisible on a dark ground, so in dark mode hierarchy is carried by *surface luminance plus border*, not by the shadow. The vocabulary does not change — the same four levels exist, each expressed as one step up the surface ladder instead of one step out of the page. Shadows are kept, darkened and widened, purely to soften the seam; the border is what actually holds the hierarchy, so no dark level may be drawn without one.
- **Subtle**: fill Surface (#152238), 1px #2A3A55 border; 1px offset, 3px blur, #000000 at 32%. Cards, form containers.
- **Medium**: fill Surface Raised (#1E2D45), 1px #33455F border; 4px offset, 12px blur, #000000 at 40%. Hovered cards, active panels.
- **Large**: fill Surface Raised (#1E2D45), 1px #3B4E6B border; 12px offset, 32px blur, #000000 at 48%. Modals, critical alerts.
- **Overlay**: fill Surface Overlay (#26374F), 1px #44587A border; 20px offset, 48px blur, #000000 at 56%. Dropdown menus, date pickers.
Steps between levels are only 1.15–1.17:1, so do not nest more than three elevation levels; beyond that the ladder flattens into a single grey.
**Special — Blue Focus (dark):** 2px ring #0B1220, 4px ring #48CAE4 — same two-ring construction as light; the inner ring takes the dark page background so the halo separates from any surface. The light rings (#FAFCFF) must never be used in dark mode — they render as a white halo.
**Special — Error Halo (dark):** 2px ring #0B1220, 4px ring #F87171.

### Components — Dark

- **Button Primary**: #48CAE4 fill, #0B1220 text, no border. Hover: Background #7FDBEE. Active: Background #90E0EF. Text is dark ink on a light-blue fill — white text on this fill cannot reach AA.
- **Button Secondary**: transparent fill, #48CAE4 text, 1.5px #48CAE4 border. Hover: Background #16304A. Active: Background #1B3B5C.
- **Button Ghost**: transparent fill, #48CAE4 text, no border. Hover: Background #16304A. Active: Background #1B3B5C.
- **Button Destructive**: #F87171 fill, #0B1220 text, no border. Hover: Background #FCA5A5. Active: Background #FECACA.
- **Button Disabled**: Background #1B2740, text #8093AE, disabled cursor, no hover change.
- **Cards**: Surface (#152238) fill, 1px #2A3A55 border, Subtle (dark) shadow. Elevated: Surface Raised (#1E2D45) fill, 1px #33455F border, Medium (dark) shadow.
- **Text Input**: #152238 fill, 1.5px #7189AC border, #E8EEF7 text, #94A6BE placeholder. Focus: Border #48CAE4, Blue Focus (dark) ring. Error: Border #F87171, Error Halo (dark) ring. Disabled: Background #1B2740, border #2A3A55, 60% opacity. The fill is Surface on every rung of the ladder — an input inside a dropdown does not take the dropdown's fill, so the verified pairs hold wherever the field appears.
- **Label**: color #E8EEF7. Required fields append a red asterisk `*` in #FCA5A5 (Error Ink — the asterisk is text).
- **Helper Text**: color #AEBDD1. Error helper color #FCA5A5, prefixed with a warning icon.
- **Filter Chip**: #16304A fill, 1px #7189AC border (3.78:1 on the chip fill), #AEBDD1 text (7.07:1). Selected: Background #48CAE4, text #0B1220, border #48CAE4. Hover: Background #1B3B5C.
- **Status Chip**: Background #06281F, text #6EE7B7, border 1px #14513C success. Background #2A1F05, text #FCD34D, border 1px #5A4408 warning. Background #062231, text #90E0EF, border 1px #10465F info. Error: Background #2C1013, text #FCA5A5, border 1px #6B2226.
- **Default List Item**: 1px #2A3A55 border bottom, #E8EEF7 text, #AEBDD1 secondary text, #48CAE4 leading element. Hover: Background #1A2A42. Active: Background #1E3550.
- **Checkboxes / Radio Buttons**: 1.5px #7189AC border, #152238 fill. Checked/Selected: Background or dot #48CAE4, border #48CAE4, checkmark #0B1220 (9.67:1 — a white checkmark on this fill is 1.94:1 and fails the 3:1 of WCAG 1.4.11). Hover: Border #8CA2C4, background #16304A. Focus: Blue Focus (dark) ring. Disabled: Background #1B2740, 50% opacity.
- **Tooltips**: #E8EEF7 fill, #0B1220 text — inverted against the dark UI exactly as the light tooltip inverts against the light UI.

### Contrast Verification — Dark

Ratios computed with the WCAG 2.x relative-luminance formula (not estimated). Threshold is 4.5:1 for
text, 3:1 for interactive borders, focus rings and graphical objects. Every foreground is quoted on
the three rungs it can land on — Surface (S), Surface Raised (R) and Surface Overlay (O, the worst
case) — because a token that only passes on Surface is not a token, it is a coincidence.
- **Ink #E8EEF7 on Background #0B1220**: 16.05:1 (AAA)
- **Ink #E8EEF7**: S 13.66:1 · R 11.87:1 · O 10.34:1 (AAA)
- **Ink Secondary #AEBDD1**: S 8.35:1 · R 7.25:1 · O 6.32:1 (AAA) — on Background: 9.81:1 (AAA)
- **Ink Muted #94A6BE**: S 6.42:1 · R 5.58:1 · O 4.86:1 (AA) — placeholders only
- **Ink Disabled #8093AE on Surface Disabled #1B2740**: 4.75:1 (disabled text is exempt; light mode was 2.08:1)
- **Primary #48CAE4**: S 8.23:1 · R 7.15:1 · O 6.23:1 (AAA) — on Background: 9.67:1 (AAA)
- **Primary Hover #7FDBEE on Surface**: 10.07:1 (AAA)
- **Secondary #90E0EF on Surface**: 10.70:1 (AAA)
- **Tertiary #C2F0F7 on Surface**: 12.98:1 (AAA)
- **Text #0B1220 on Primary fill #48CAE4**: 9.67:1 (AAA)
- **Text #0B1220 on Destructive fill #F87171**: 6.77:1 (AA) — on hover fill #FCA5A5: 9.86:1 (AAA)
- **Success #34D399**: S 8.29:1 · R 7.20:1 · O 6.27:1 (AAA) — on Background: 9.74:1 (AAA)
- **Warning #FBBF24**: S 9.55:1 · R 8.30:1 · O 7.22:1 (AAA) — on Background: 11.22:1 (AAA)
- **Error #F87171** (fills, borders, icons; threshold 3:1): S 5.76:1 · R 5.01:1 · O 4.36:1 — as **text** it fails AA on Overlay, which is why red text is Error Ink
- **Error Ink #FCA5A5** (all red text): S 8.40:1 · R 7.30:1 · O 6.35:1 (AAA)
- **Status Chip success #6EE7B7 on #06281F**: 10.35:1 (AAA)
- **Status Chip warning #FCD34D on #2A1F05**: 11.23:1 (AAA)
- **Status Chip info #90E0EF on #062231**: 11.00:1 (AAA)
- **Status Chip error #FCA5A5 on #2C1013**: 9.29:1 (AAA)
- **Tooltip text #0B1220 on #E8EEF7**: 16.05:1 (AAA)
- **Border Strong #7189AC** (interactive border): S 4.46:1 · R 3.87:1 · O 3.37:1 (AA; light mode was 1.48:1) — on the Filter Chip fill #16304A: 3.78:1
- **Border Strong Hover #8CA2C4**: S 6.13:1 · R 5.33:1 · O 4.64:1 (AA)
- **Blue Focus ring #48CAE4 on Surface**: 8.23:1 — **Error Halo #F87171 on Surface**: 5.76:1 (graphical, threshold 3:1, and 4.36:1 on Overlay)
- **Border #2A3A55 on Surface** (decorative only): 1.39:1 — parity with light mode (1.23:1)
- **Elevation steps**: Surface on Background 1.17:1, Surface Raised on Surface 1.15:1, Surface Overlay on Surface Raised 1.15:1

Tones that failed and were lifted rather than accepted, with the ratio that rejected them:
- input border #55698A (2.86:1 on Surface) → #5B7091 (3.17:1 on Surface, but only 2.39:1 on Overlay) → **#7189AC** (3.37:1 on the worst rung);
- placeholder #7C8DA6 (4.72:1 on Surface) → #8798AF (5.42:1 on Surface, but 4.10:1 on Overlay) → **#94A6BE** (4.86:1 on the worst rung);
- white text on the Primary and Destructive fills (1.94:1 and 2.77:1) → dark ink **#0B1220** (9.67:1 and 6.77:1);
- Error text kept at #DC2626 (3.30:1 on Surface) → #F87171 (5.76:1 on Surface, but 4.36:1 on Overlay) → **#FCA5A5** for every text role, with #F87171 kept for fills, borders and icons, where the threshold is 3:1;
- Ink Disabled #7488A3 (4.11:1) → **#8093AE** (4.75:1), so that the grey ramp stays monotonic once Border Strong was lifted past it.

### Ramp Mapping — Dark

The panel indexes colours by ramp rung (`gray-900`, `gray-400`…), so the dark palette is not a set of
loose tokens: it is the grey ramp of § Color Ramps **re-pointed by role**, keeping the same monotonic
order (50 lightest, 950 darkest) so that no component that reads a rung sees its meaning inverted.
This table is the contract between § Dark Mode and the theme file.

| Rung | Dark value | Role |
|---|---|---|
| 50 | #FAFCFF | brightest ink, for text on a solid accent fill |
| 100 | #F1F5FB | interpolated — decorative only |
| 200 | #E8EEF7 | Ink — primary text and labels |
| 300 | #CBD8E8 | interpolated — hover/emphasis ink |
| 400 | #AEBDD1 | Ink Secondary |
| 500 | #94A6BE | Ink Muted — placeholders |
| 600 | #8093AE | Ink Disabled |
| 700 | #7189AC | Border Strong — interactive borders |
| 800 | #2A3A55 | Border — decorative borders, and the raised chrome fill |
| 900 | #152238 | Surface |
| 950 | #0B1220 | Background |

Rungs 100 and 300 are interpolated between their named neighbours by the rule of § Color Ramps, and
are therefore decorative-safe only: nothing whose legibility is verified may land on them.

**Reading a rung is not reading a role.** In light mode `gray-900` is the ink; in dark mode the same
rung is the surface. A class written for light mode without a dark counterpart — `text-gray-900` on a
card — therefore does not degrade, it inverts: the text takes the colour of the surface it sits on.
Any template that paints ink, borders or fills from the grey ramp must state both modes explicitly.

### Charts — Dark

Derived from § Components · Charts by the three rules above: chrome takes the dark ink and border
roles, series step one rung up the same ramps.
- **Plot surface**: Surface (#152238).
- **Grid lines / axis lines**: #2A3A55 (Border; 1.39:1, decorative, parity with the light 1.23:1).
- **Axis tick labels and chart caption**: #AEBDD1 (Ink Secondary, 8.35:1).
- **Point border**: the plot surface, #152238 — never #FFFFFF, which haloes every marker.
- **Tooltip**: #E8EEF7 fill, #0B1220 text (16.05:1), matching § Components — Dark · Tooltips.
- **Series, in order**: 1 #48CAE4 (8.23:1) · 2 #90E0EF (10.70:1) · 3 #34D399 (8.29:1) · 4 #FBBF24 (9.55:1).
  Same order and same rules as light: the first two are the neutral pair, a legend is mandatory from
  the third on, and red is never a series colour.

Charts are drawn on a `<canvas>`, so they cannot inherit the theme: the values must be read at draw
time from the CSS variables the theme publishes (`getComputedStyle(document.documentElement)`), never
copied into the module as literals — a literal cannot switch theme. And because Chart.js freezes its
colours when the canvas is built, a chart must also re-read them and redraw when the `.dark` class on
`<html>` changes; otherwise the whole panel switches theme except the charts.

## Do's and Don'ts

1. **Do** meet WCAG AA contrast ratios (4.5:1 body text, 3:1 large text) at minimum — aim for AAA where possible.
2. **Do** make all interactive elements at least 44px touch target size for bedside tablet use.
3. **Do** always pair color-coded status indicators with text labels and icons — never rely on color alone.
4. **Don't** use red for anything other than errors, critical alerts, and destructive actions — misuse creates alarm fatigue.
5. **Do** prefix required form fields with a visible asterisk and provide clear validation messages before submission.
6. **Don't** auto-dismiss important notifications — critical medical information must require manual acknowledgment.
7. **Do** use IBM Plex Mono for all medical record numbers, codes, and dosage values to prevent misreading.
8. **Don't** use placeholder text as a substitute for labels — labels must always be visible and persistent.
9. **Do** provide high-contrast focus indicators on every interactive element for keyboard and assistive device navigation.
10. **Don't** use low-contrast grays for important data — patient safety depends on every value being immediately legible.
