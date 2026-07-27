# Adding an interface language

This is the maintenance procedure for adding a language to the application. It covers the server,
the browser, the clinical vocabulary and the shared-record reader. A language is supported only when
all of those surfaces are complete.

The application has two translation systems:

* Laravel translates Blade and PHP strings from the JSON files in `lang/`.
* JavaScript translates messages, chart text and other text painted after the page loads from the
  catalogs in `resources/js/i18n/`.

The English text is the fallback in both systems. There is no `lang/en.json`: the English source text
passed to `__()` is its own catalog. JavaScript does have `resources/js/i18n/en.js`, because those
messages are defined as data rather than as PHP source strings.

The language preference is deliberately stored in clear text in `users.locale`. It is not clinical
data and must be available before a browser key exists, so the login screen and the Filament shell can
be rendered in the chosen language. See [ADR 0007](adr/0007-encrypted-user-configuration.md) for the
decision and its privacy trade-off.

## Before starting

Choose one canonical Laravel locale code and its BCP 47 form. Use the Laravel code everywhere the
application identifies a catalog, and use the BCP 47 form for HTML and `Intl` APIs when they differ.
For example:

| Language | Laravel/catalog code | BCP 47 code |
| --- | --- | --- |
| English | `en` | `en` |
| Spanish | `es` | `es` |
| Simplified Chinese | `zh_CN` | `zh-CN` |

If two supported locales share the same base language, such as `pt_BR` and `pt_PT`, an unspecific
`pt` browser preference is ambiguous. The resolver must then require a regional tag instead of silently
choosing one.

Do not change existing locale codes. They are stored in `users.locale` and may already be present in
accounts. Adding a new code is safe; renaming or removing one requires a separate compatibility and
migration decision.

## Implementation checklist

Use `fr` below as an example; replace it with the chosen code.

### 1. Register the locale on the server

Add the code to `SupportedLocale::All` in
[`app/Support/SupportedLocale.php`](../app/Support/SupportedLocale.php). Keep English first so it
remains the default. `config/app.php` reads the same constant, so it should not receive a second,
independent list.

Check the following behaviours:

* an account with `users.locale = fr` uses the new language;
* an unauthenticated request negotiates it from `Accept-Language`;
* a regional header such as `fr-CA` resolves as intended;
* an unknown or stale locale still falls back to English;
* an unsupported value is rejected by `PUT /phr/settings`.

The PHP resolver already normalizes dashes, underscores and case. If the new locale needs a special
mapping, update `SupportedLocale::match()` rather than adding ad hoc handling to controllers.

### 2. Add the Laravel catalog

Create `lang/fr.json` by copying the shape of an existing catalog. Every key used by `__()` must be
present, including keys used by Filament, authentication, the profile, the sharing flow and the
`noscript` messages.

Rules for the catalog:

* Keep every key in English. Do not use translated text as a key.
* Keep placeholders exactly as written, such as `:count`, `:unit` and `:value`.
* Do not leave values empty.
* Translate complete sentences rather than assembling translated fragments in PHP or Blade.
* Keep official LOINC terms in English. Translate only the application's patient-facing labels; see
  [ADR 0005](adr/0005-clinical-vocabulary-loinc-snomed.md).

The catalog tests compare key sets and scan literal `__()` calls, so a missing entry should fail the
test suite.

### 3. Add the JavaScript catalog

Create `resources/js/i18n/fr.js` with the same keys as `en.js`, then update
[`resources/js/i18n/index.js`](../resources/js/i18n/index.js):

* import the new catalog;
* add it to `CATALOGS`;
* add its BCP 47 tag to `INTL_TAGS`;
* teach `resolveLocale()` to resolve the canonical code and the browser forms;
* update the JSDoc locale unions if they list the supported codes explicitly.

The JavaScript catalog must preserve the English catalog's placeholders. For entries with plural
variants, provide the categories required by the language's `Intl.PluralRules` behaviour. English and
Spanish use `one` and `other`; Chinese currently uses only `other` because it does not pluralize in the
same way. Verify the new language rather than copying those categories blindly.

Use `Intl` for number formatting, dates and plural selection. Do not encode decimal separators or
plural grammar in application logic.

### 4. Add patient-facing clinical labels

Patient-facing clinical vocabulary is intentionally not stored in `lang/`. It lives in the catalog
enums under [`app/Catalog`](../app/Catalog), because the stable clinical token and its label must stay
reviewable together. Add the new locale branch to every relevant `label()` or `patientLabel()` match.

Search for all implementations before editing:

```sh
rg -n "function (label|patientLabel)\(|implements PatientLabelled" app/Catalog
```

This includes labels used by the panel and by the shared-record reader. Every case needs a real label
in the new language. Do not rename enum cases or backed values: those tokens are already inside
encrypted event payloads.

### 5. Add the language to selectors and the shared reader

Add the language's self-name to both selectors:

* `Profile::locales()` in `app/Filament/Pages/Profile.php`;
* the language-name map in `app/Sharing/ReaderCatalog.php`.

The name should be written in the language itself, as with `English`, `Español` and `简体中文`. The
reader publishes all supported clinical labels in one public catalog so its selector can change
language without another request. `ReaderCatalog` already loops over `SupportedLocale::all()`; the
manual language-name map still needs the new entry.

### 6. Update tests that describe the supported set

Some tests intentionally assert the exact current list or catalog shape. Update their expectations for
the new language instead of weakening them. Search for both the locale code and the old list:

```sh
rg -n "en.*es.*zh_CN|SupportedLocale|SUPPORTED_LOCALES|CATALOGS|labels.*zh_CN|three languages" \
    app resources/js resources/views tests docs .ai/guidelines
```

At minimum, review:

* `tests/Feature/LocaleTest.php`;
* `tests/Unit/CatalogLabelsTest.php`;
* `tests/js/i18n.test.mjs`;
* `tests/Feature/ShareReaderPageTest.php`;
* `tests/Feature/SharingPageTest.php`;
* `tests/Feature/PanelLocaleAttributeTest.php` where the HTML and canonical locale are asserted.

Keep the tests that prove all catalogs have the same keys, all clinical cases have labels, unknown
locales fall back to English and the shared reader exposes every supported language.

### 7. Update repository guidance

Update `.ai/guidelines/ai.md` so it no longer describes the old fixed language list. If the guideline
change is part of a normal repository change, regenerate the derived `AGENTS.md`/`CLAUDE.md` files with
the project's Boost command; do not edit generated files directly.

Also search `docs/`, comments and tests for phrases such as “three languages” and update only the places
where the phrase describes the supported set. Do not change unrelated uses of the number three.

## Verification

Run the focused PHP tests:

```sh
php artisan test --compact \
    tests/Feature/LocaleTest.php \
    tests/Unit/CatalogLabelsTest.php \
    tests/Feature/ShareReaderPageTest.php \
    tests/Feature/SharingPageTest.php \
    tests/Feature/PanelLocaleAttributeTest.php
```

Run the browser-side tests:

```sh
npm test
```

Build the production assets as a final check that the new static catalog is included:

```sh
npm run build
```

Manually verify at least the login page, profile selector, one health-entry screen, the dashboard and
the shared-record reader. Check translated text, date formatting, decimal formatting, plural forms,
`<html lang>`, and the language selector after client-side navigation.

## Data and compatibility notes

Adding a language does not require a database migration and does not require decrypting or rewriting
existing health events. Existing accounts with `NULL` locale continue to negotiate from the browser;
accounts with the new locale use it after they save their settings.

The exception is a change to an existing locale code. Because that code is persisted in
`users.locale`, changing it without a compatibility plan would make existing preferences stale and
would change the meaning of data sent to `App::setLocale()`. Treat renames and removals as separate
changes, with an explicit migration or fallback plan.
