---
name: email-html
description: HTML email limitations and best practices
user-invocable: false
---

# HTML email

Rules for hand-writing HTML emails so they render correctly in every mail client.

## The one principle

Do not write per-client code. No conditional comments, no `<!--[if mso]>` hacks, no
media queries, no client detection. Write instead to the most restrictive common
denominator: the rules below produce output that renders the same in Outlook, Gmail,
Apple Mail, Yahoo, mobile clients and the rest. If a feature is unreliable in even one
mainstream client, treat it as unavailable.

Always send the message as multipart: an HTML part built with these rules and a
plain-text part. Never ship HTML alone. Some people and clients read the text part, and
an HTML-only email scores worse with spam filters. In this repo the HTML body is a
Blade view rendered by a Laravel `Mailable`; provide both parts via `->view()` (HTML) and
`->text()` (plain-text alternative) so every message ships multipart.

## Document structure

- Doctype: XHTML 1.0 Transitional. Do not use the HTML5 doctype.
- Do not use HTML5 elements (`<section>`, `<article>`, `<aside>`, `<header>`, `<nav>`).
  Older clients do not understand them.
- All tags and attributes lowercase. All attribute values quoted. Close every tag.
  Self-close empty elements (`<br />`, `<img ... />`, `<hr />`).
- Keep the whole HTML under 100 KB. Gmail clips anything larger and hides the rest
  behind a "View entire message" link, which breaks the layout and any tracking. If an
  email approaches the limit, minify the HTML before sending.

## Preheader

The preheader is the short text the inbox shows next to or below the subject line. If
you do not set one, the client pulls the first words it finds (often "View in browser"
or a stray link), which looks careless.

Place it as the very first element inside `<body>`, in a hidden block. This hidden block
is the one non-table element allowed in the body: it carries no layout, only a line of
text.

```html
<div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:#ffffff;opacity:0;">
  One line summarising the email, roughly 40 to 100 characters.
</div>
```

Keep it to one sentence that complements the subject line rather than repeating it, and
update it whenever the email content changes.

## Layout: tables only

- Build every layout with nested `<table>` elements. Never use `<div>` for structure,
  and never use `float`, `position`, `display` tricks, flexbox or grid.
- One single column, fixed at 600 px wide. A 600 px single-column email adapts to mobile
  on its own, with no media queries.
- On every layout table set `border="0" cellpadding="0" cellspacing="0" role="presentation"`.
- Put an explicit `width` on tables and on cells. Use the HTML attributes `align` and
  `valign` for alignment, not their CSS equivalents.
- For side-by-side content use several `<td>` cells in one row, each with an explicit
  `width`. On very narrow screens they may not stack, so keep such designs simple enough
  that it does not matter.

## CSS

- Inline every style, on every element, with the `style` attribute. Do not use a
  `<style>` block: Gmail strips the `<head>` and `<style>` entirely, and drops class and
  id selectors with it.
- No CSS shorthand. Write `margin-top`, `padding-left` and so on, never `margin: 0 auto`
  or `padding: 10px 20px`. Shorthand is parsed inconsistently.
- Use only well-supported properties: `font-family`, `font-size`, `font-weight`,
  `color`, `line-height`, `text-align`, `width`, `height`, `padding-*`,
  `background-color`, `border`, `border-*`.
- Avoid `margin`: Outlook ignores it. Do all spacing with `padding` on `<td>`, or with
  empty spacer rows.
- Forbidden CSS: `position`, `float`, `clear`, `display` tricks, flexbox, grid,
  transitions, animations, transforms, pseudo-classes and pseudo-elements (`:hover`,
  `::before`), and any selector beyond plain element, class or id. None of it is reliable.

## Spacing

Space content with `padding` on table cells, or with a dedicated spacer row: an empty
`<td>` that has an explicit pixel `height`. Do not rely on `margin`, and do not stack
`<br />` tags to create vertical space.

## Typography

- Web-safe font stacks only. Pick one and always give fallbacks:
  - `Arial, Helvetica, sans-serif`
  - `'Helvetica Neue', Helvetica, Arial, sans-serif`
  - `Georgia, Times, 'Times New Roman', serif`
  - `'Courier New', Courier, monospace`
- Do not use web fonts (`@font-face`, Google Fonts). Outlook, Gmail and Yahoo ignore
  them, so the fallback is what most readers see. Design for the fallback.
- Body text at least 14 px. Line height 1.4 to 1.6 times the font size. Left-align body
  copy. Keep a contrast ratio of at least 4.5:1 between text and background.

## Images

- Every `<img>` needs a descriptive `alt`, an explicit `width` and `height`,
  `border="0"`, and `style="display:block;"`.
- Use absolute `https://` URLs from a stable host. Relative paths and `cid:` references
  are unreliable.
- Use `.png` for flat graphics and logos, `.jpg` for photographs at roughly 70 to 80
  percent quality. Avoid other formats.
- Assume images are blocked. Many clients hide them by default, so the email must be
  fully understandable with no images loaded. Never put essential text or the call to
  action inside an image; use real HTML text.
- Do not use background images. Support is poor and uneven. For a coloured panel use a
  solid `background-color` on the cell instead.

## Dark mode

Some clients render a dark theme and may invert or re-tint your colours. The restrictive
approach does not ship a separate dark theme, since that needs media queries some clients
ignore. It makes the single design survive inversion instead:

- Do not depend on the page background staying white. Put content in its own cell with
  an explicit `background-color`.
- Give logos and any dark-on-transparent image a solid or light background so they stay
  visible if the surrounding area is darkened.
- Keep strong text-to-background contrast that holds up whether the background ends up
  light or dark.

## Forbidden outright

These do not work in enough clients to be usable, and several are stripped as security
risks:

- JavaScript. Nearly every client removes it.
- `<iframe>`.
- `<form>` and form controls. Clients show them but submission fails. Link to a hosted
  page instead.
- Embedded `<video>` and `<audio>`, and Flash. Link to an external page instead.
- Image maps.
- Background images (see above).
- Animated GIFs as the only way to convey something: some clients show the first frame
  only.

## Accessibility

- Layout tables carry `role="presentation"`.
- Use real semantic tags for content: `<p>`, `<h1>`, `<h2>`, `<a>`, in a sensible
  heading order.
- Decorative images get an empty `alt=""`; meaningful images get a real description.
- Do not convey meaning with colour alone. Links need visible, distinct styling and
  descriptive text, never "click here".
- Touch targets such as buttons and links should be at least 44 by 44 px.

## Buttons

There is no reliable styled `<button>`. Build a button as a table cell with a
`background-color` and `padding`, containing an `<a>`:

```html
<table role="presentation" border="0" cellpadding="0" cellspacing="0">
  <tr>
    <td bgcolor="#1a1a2e" style="padding-top:12px;padding-bottom:12px;padding-left:24px;padding-right:24px;">
      <a href="https://example.com/..." style="color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:16px;text-decoration:none;">Descargar el informe</a>
    </td>
  </tr>
</table>
```

## Minimal skeleton

Start from this and fill the content cell. It already follows every rule above.

```html
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="es">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
  <title>...</title>
</head>
<body style="margin-top:0;margin-bottom:0;background-color:#f4f4f4;">

  <div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:#f4f4f4;opacity:0;">
    One line summarising the email.
  </div>

  <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color:#f4f4f4;">
    <tr>
      <td align="center" valign="top" style="padding-top:24px;padding-bottom:24px;">

        <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="600" style="background-color:#ffffff;">
          <tr>
            <td align="left" valign="top" style="padding-top:32px;padding-bottom:32px;padding-left:32px;padding-right:32px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:24px;color:#1a1a2e;">

              <!-- content here -->

            </td>
          </tr>
        </table>

      </td>
    </tr>
  </table>
</body>
</html>
```

`<body>` uses `margin-top` and `margin-bottom` separately, not the `margin` shorthand,
per the CSS rule above.

## Checklist before sending

- [ ] HTML part built from the skeleton, plus a plain-text part (multipart).
- [ ] A preheader line is set as the first element in `<body>`.
- [ ] Layout is nested tables: single 600 px column, no `<div>` structure.
- [ ] Every style is inline. No `<style>` block. No shorthand.
- [ ] No `margin`. Spacing is `padding` on cells or spacer rows.
- [ ] Web-safe fonts with fallbacks. Body text at least 14 px.
- [ ] Every image has `alt`, `width`, `height` and an absolute https URL; the email
      reads fine with images off.
- [ ] No JavaScript, iframe, form, embedded media or background image.
- [ ] Total size under 100 KB.
