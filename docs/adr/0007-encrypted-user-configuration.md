# ADR 0007: Encrypted user configuration

* **Status**: Accepted
* **Date**: 2026-07-25
* **Updated**: 2026-07-26
* **Decider**: Development Team

## Context

The application needs per-user settings from the very first screen. The most immediate one is the unit of
measure, which ADR 0006 (`docs/adr/0006-encrypted-event-model.md`) established as a preference and not as a
per-record choice, because it determines which LOINC code is stored (ADR 0005). The next one is the blood
glucose target range, which lets us show what percentage of the time was spent inside it.

That second case carries a weight the first one doesn't. A blood glucose target range is a clinical
indication: if the application ships one by default, it is telling the user what values they should have, and
that is interpreting, not presenting. The European medical devices regulation excludes wellness software as
long as it limits itself to recording and displaying, and ADR 0006 already places export and statistics on
the descriptive side. Shipping default ranges would cross that line for no reason.

On top of that, the configuration is the user's data and the server must not be able to read it: knowing that
someone has a blood glucose range configured says the same as knowing that they record blood glucose.

## Decision

The configuration lives in a single `text` column on the user's row, which stores the encrypted envelope
under the same rules as any other data at rest (ADR 0004): version prefix, padding to fixed sizes, key
identifier, and content version inside the envelope. Decrypting it yields JSON, just like with events and for
the same reason: the column can't be of type JSON because the server can't query what it can't decrypt.

What identifies this envelope for the AEAD associated data and for deriving its key is the `user_id` and a
fixed column discriminator. That way, moving the envelope to another column, another table, or another user
makes decryption fail, just as with events.

**No setting with clinical content ships with a default value from the application.** The blood glucose
target range starts empty, and while it stays empty the percentage in range is not shown: the view simply
doesn't offer that statistic. When the user configures it, with whatever criterion their doctor gave them,
the application computes and displays, without adding any judgment of its own about whether the result is
good or bad.

This is distinct from settings that aren't clinical, such as the language or the display format, which can
have a sensible default because they say nothing about anyone's health.

**The interface language is the only exception to the envelope: it lives in the clear in `users.locale`.**
The application speaks English, Spanish, and Simplified Chinese, with English as the default, and the server
has to know which one to use before any key exists: Filament resolves the navigation menu, the user menu, the
breadcrumbs, the page title and, above all, the login screen on the server, and that screen is painted when
the master key has not been born yet. A preference stored inside the envelope could never be read at the
moment it is needed.

The column is nullable and `NULL` means "I haven't chosen": the language is then negotiated using the
`Accept-Language` header, restricted to the three supported ones, and English is the last resort. When the
person picks one on their profile page, their choice wins. `PUT /phr/settings` accepts that `locale` field
alongside the encrypted envelope, outside it, and writes it only after validating the envelope format and the
`If-Match` precondition, which protects the envelope and not the column: that way a 412 doesn't leave the
language changed and the settings unchanged. The list is closed because the value ends up in
`App::setLocale()` and accepting any string would be letting the client pick a translation file.

The cost is knowingly accepted: the server learns which language an account prefers, and in a Spanish
deployment choosing Simplified Chinese allows inferring origin or ties to China. What makes it acceptable is
that the browser already sends `Accept-Language` on every request, so that inference is available today with
no column at all; storing it adds persistence, not revelation. It is the same kind of deliberate, narrowly
scoped exception that ADR 0009 (`docs/adr/0009-user-provisioning-and-session-lifecycle.md`) makes with the
user's name, and it doesn't extend to any other setting: the language goes in the column and not in the
envelope, because storing it in both places would end with the menu in one language and the body of the page
in another.

The percentage in range calculation, like the rest of the statistics, happens in the browser over the already
decrypted events, as ADR 0002 requires.

## Rationale

We rejected a settings table with one row per key. It would have forced leaving the name of every setting in
the clear to query it, and the name already leaks: a row called `glucose_target_range` says that
person watches their blood glucose. With a single envelope, the server sees that there is configuration and
nothing more.

We also rejected splitting the settings between plaintext and encrypted columns according to their
sensitivity. That's a boundary you have to redraw with every new setting, and the first time someone gets it
wrong the failure will be silent. A single encrypted column doesn't have that failure mode.

On not shipping default values, the alternative was to offer the usual ranges and let the user change them.
It would have been more convenient, and it's what almost every application in the sector does, but it turns
the application into a source of clinical criteria at exactly the point where we want it to be a diary. The
inconvenience of configuring it once is small compared to the change in the nature of the product.

For the language we rejected three alternatives. Storing it only on the client leaves the Filament shell in
English and the body of the pages translated, a permanently bilingual interface that is a worse product than
not translating at all. Storing it inside the envelope and re-translating the shell in the browser after
opening it forces rewriting the DOM that Filament paints after decrypting, which is exactly what Livewire's
`morph` undoes under ADR 0002, and it leaves out the login screen and the initial password setup anyway,
where there is no key. And negotiating with `Accept-Language` alone, with no stored preference, costs nothing in
privacy but makes choosing impossible: someone with their system in Chinese can't use the application in
Spanish.

* **Pros**: the server doesn't know what anyone has configured; adding a setting doesn't touch the schema;
  the percentage in range statistic belongs to the user and not to the application; and the failure mode from
  carelessness disappears because there is no boundary to redraw.
* **Cons**: no configuration can be queried or aggregated on the server, not even to know how many users have
  something turned on; the configuration has to be decrypted before painting the first useful screen; and the
  user has to configure the target range before seeing the statistic they probably expected to find already
  done.

## Consequences

The configuration is decrypted at session startup, together with the master key.

The envelope is written empty at sign-up, even when nothing is configured, so that the server can't tell
apart who has configuration from who doesn't.

The unit of measure stored here is the preference set by ADR 0006: it is chosen once and decides which unit
data is recorded and displayed in. Each event stores its own as well, because the LOINC code depends on it,
so changing the preference leaves a history with two units mixed together.

From that comes an obligation for the statistics layer: averaging mg/dL with mmol/L without converting gives
a meaningless number. And since converting requires fixing precision and rounding, which is a clinical
decision no ADR has made, we don't convert: each summary is computed in a single display unit and events in
another are counted separately so they can be stated on screen, instead of just disappearing.

Any setting added later goes into this envelope, and the question to ask is always the same: if it has
clinical content, it starts empty and with no suggested value.

The server activity log records that a user was modified, without knowing what changed or what configuration
they have, as ADR 0006 requires.

The interface has to handle gracefully the state in which there is still no configured range, which will be
the state of every new user. It's the part of the product that needs the most care, because a screen showing
a gap where a statistic should be invites filling it with any number at all.

Three obligations come out of the language. Translation keys are written in English, which is the default
language, so that a missing translation falls back to English and not to Spanish; the catalogs live in
one JSON file per non-English locale under `lang/`, and a test checks that they have exactly the same set of keys, which is
the only way for a gap to fail in continuous integration and not in front of the user. The patient-facing
labels of the `app/Catalog` enums exist in every supported language, and a language we don't recognize falls back
to English instead of throwing an exception, because someone with a stale preference is someone who doesn't
understand the screen, not an error to find out about through a 500. The official term from the terminology
is never translated, not even into Chinese: ADR 0005 reserves it for `coding.display` and LOINC publishes no
Chinese translation of those terms, which is precisely why our own label is the only layer we can offer
complete across all supported languages.

## Decision History

### 2026-07-26 — The interface language leaves the envelope and moves to a plaintext column
Previously decided: all user configuration lived inside the encrypted envelope, with no exceptions, and the
language was mentioned only as an example of a non-clinical setting that can have a default value.
Changed because: adding Simplified Chinese forced deciding where the preference lives, and Filament paints
the menu, the breadcrumbs, and the login screen on the server, before any key exists. Inside the envelope
that preference can't be read when it's needed.
