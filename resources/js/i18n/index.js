/**
 * Translation of the strings the client writes on screen.
 *
 * **Why it exists.** The panel screens build much of their text in JavaScript (history, notices,
 * chart captions, progress bar stages), and that text does not go through Laravel `__()`: until
 * now it was frozen in Spanish inside each module. This module is the client equivalent of
 * `lang/`, with **English by default** just like `config/app.php`, plus Spanish and simplified
 * Chinese.
 *
 * **Why the three catalogs are imported statically and not with a dynamic `import()`.** Almost all
 * of these strings are error messages coming out of pure and **synchronous** functions
 * (`buildGlucoseContent`, `parseNumericValue`, `chartCaptionText`, ...). With lazy loading, `t()`
 * would have to be async or return the key while the catalog travels, and a clinical validation
 * message showing up in English for the first few milliseconds is exactly the silent failure we do
 * not want. The three catalogs together are a few kilobytes of text, less than one icon, so the
 * saving does not pay for the risk.
 *
 * **Where the language comes from.** From `document.documentElement.lang`, which the server
 * already emits out of `app()->getLocale()`. No new endpoint and no new metadata. In Node (the
 * tests) there is no `document`, so the effective language is the default, `en`; a test that wants
 * to check the Spanish text calls `setLocale('es')`, which also makes explicit which language it
 * is asserting on.
 *
 * **Plurals.** Neither `record(s)` nor `day(s)`: English pluralizes for real and Chinese does not
 * pluralize at all. A catalog entry may be `{one, other}` and `t()` picks with `Intl.PluralRules`,
 * which the browser already ships.
 */

import { EN } from './en.js';
import { ES } from './es.js';
import { ZH_CN } from './zh_CN.js';

/** Fallback language, the same as `config/app.php` (`APP_LOCALE=en`). */
export const DEFAULT_LOCALE = 'en';

/**
 * Closed list of catalogs. The names are those of the Laravel and Filament translation folders
 * (`zh_CN`, not `zh-CN` and not `zh`), so ours line up with theirs.
 */
const CATALOGS = Object.freeze({ en: EN, es: ES, zh_CN: ZH_CN });

/** @type {list<string>} */
export const SUPPORTED_LOCALES = Object.freeze(Object.keys(CATALOGS));

/** BCP 47 tag of each catalog, the one `Intl.*` and `Date.prototype.toLocaleString` understand. */
const INTL_TAGS = Object.freeze({ en: 'en', es: 'es', zh_CN: 'zh-CN' });

/** @type {string|null} Resolved the first time it is needed, not when the module is evaluated. */
let activeLocale = null;

/**
 * Normalizes any language tag to the catalog it belongs to.
 *
 * It accepts both forms in circulation in the project (Laravel `zh_CN` and the `zh-CN` of the HTML
 * `lang` attribute) and falls back to the default language for anything unsupported: the list is
 * closed on purpose, because the value ends up choosing a catalog.
 *
 * @param {unknown} tag
 * @returns {'en'|'es'|'zh_CN'}
 */
export function resolveLocale(tag) {
    if (typeof tag !== 'string' || tag.trim() === '') {
        return DEFAULT_LOCALE;
    }

    const normalized = tag.trim().replace('-', '_').toLowerCase();
    const [language] = normalized.split('_');

    if (language === 'zh') {
        return 'zh_CN';
    }

    if (language === 'es') {
        return 'es';
    }

    return DEFAULT_LOCALE;
}

/** @returns {'en'|'es'|'zh_CN'} */
function detectLocale() {
    if (typeof document === 'undefined' || document.documentElement === null) {
        return DEFAULT_LOCALE;
    }

    return resolveLocale(document.documentElement.getAttribute('lang'));
}

/**
 * Active language. The first call works it out from the document and remembers it: the language
 * does not change without reloading the page (the server fixes it in the `<html lang>`), so
 * re-reading it on every `t()` would be wasted work.
 *
 * @returns {'en'|'es'|'zh_CN'}
 */
export function currentLocale() {
    if (activeLocale === null) {
        activeLocale = detectLocale();
    }

    return activeLocale;
}

/**
 * Sets the language by hand. `app.js` uses it at startup (to avoid depending on module evaluation
 * order) and so do the tests, which thereby declare which language they assert in.
 *
 * @param {string} locale
 * @returns {'en'|'es'|'zh_CN'} The one that ended up active.
 */
export function setLocale(locale) {
    activeLocale = SUPPORTED_LOCALES.includes(locale) ? locale : resolveLocale(locale);

    return activeLocale;
}

/** @returns {string} BCP 47 tag of the active language, for `Intl` and `toLocaleString`. */
export function intlLocale() {
    return INTL_TAGS[currentLocale()];
}

/**
 * Replaces the `{name}` placeholders with their values.
 *
 * Sentences are translated **whole and with placeholders**, never by concatenation: in Chinese
 * the order of the fragments and the punctuation (`。`, `，`) are not the Spanish ones, and a
 * sentence assembled from pieces cannot be translated without rewriting the code.
 *
 * @param {string} template
 * @param {Record<string, string|number>} params
 * @returns {string}
 */
function interpolate(template, params) {
    return template.replace(/\{(\w+)\}/g, (placeholder, name) => (
        Object.hasOwn(params, name) ? String(params[name]) : placeholder
    ));
}

/**
 * Builds an `Intl` formatter memoized **per BCP 47 tag**, not per module.
 *
 * Building an `Intl.NumberFormat` or an `Intl.DateTimeFormat` is the expensive part (it loads the
 * language tables); formatting with one already built is cheap. Hence one is kept per language.
 *
 * **The key has to be the language active on each call, never the one of the first use.** The
 * language changes hot: `syncLocale()` in `app.js` re-reads it from the `<html lang>` on every
 * Livewire navigation, so a formatter captured when the module loaded would keep writing `7,8`
 * after switching to English. That is why `intlLocale()` is consulted inside the returned formatter.
 *
 * It exists so that the six formatters below do not each repeat their own `Map`, their own check
 * and their own `new`: six copies of the same pattern are six places to forget re-reading the
 * language again.
 *
 * @template {new (locale: string, options?: object) => {format?: Function, select?: Function}} T
 * @param {T} Formatter `Intl` constructor (`NumberFormat`, `DateTimeFormat`, `PluralRules`).
 * @param {object} [options] Fixed formatter options.
 * @returns {() => InstanceType<T>} Returns the formatter of the active language.
 */
function memoizedFormatter(Formatter, options = undefined) {
    /** @type {Map<string, InstanceType<T>>} */
    const cache = new Map();

    return () => {
        const tag = intlLocale();

        if (!cache.has(tag)) {
            cache.set(tag, new Formatter(tag, options));
        }

        return cache.get(tag);
    };
}

const pluralRules = memoizedFormatter(Intl.PluralRules);

/**
 * @param {number} count
 * @returns {string} Plural category (`one`, `other`, ...) of the active language.
 */
function pluralCategory(count) {
    return pluralRules().select(count);
}

/**
 * Translates a key.
 *
 * A key missing in the active language falls back to the English catalog, and one that is not
 * there either is returned as is: a dotted identifier on screen is ugly, but it is visible, while
 * returning an empty string would hide the gap. `tests/js/i18n.test.mjs` checks that the three
 * catalogs have exactly the same key set, so that fallback never gets used.
 *
 * @param {string} key
 * @param {Record<string, string|number>} [params] Placeholder values; `count` also picks the
 *        plural form when the entry has variants.
 * @returns {string}
 */
export function t(key, params = {}) {
    const entry = CATALOGS[currentLocale()][key] ?? CATALOGS[DEFAULT_LOCALE][key];

    if (entry === undefined) {
        return key;
    }

    if (typeof entry === 'object') {
        const variant = entry[pluralCategory(Number(params.count ?? 0))] ?? entry.other;

        return interpolate(variant, params);
    }

    return interpolate(entry, params);
}

/**
 * Joins a list of labels with the language separator (`, ` in the West, `、` in Chinese).
 *
 * @param {list<string>} items
 * @returns {string}
 */
export function joinList(items) {
    return items.join(t('common.listSeparator'));
}

const numberFormat = memoizedFormatter(Intl.NumberFormat, { maximumFractionDigits: 2 });

/**
 * Number with the decimal and thousands separators of the active language. In Spanish `7,8`; in
 * English and Chinese `7.8`, which is what the glucose meter says for whoever reads in those languages.
 *
 * @param {number} value
 * @returns {string}
 */
export function formatNumber(value) {
    return numberFormat().format(value);
}

/**
 * Full date and time for the history, in the active language.
 *
 * @param {Date|string|number} value
 * @returns {string}
 */
export function formatDateTime(value) {
    return new Date(value).toLocaleString(intlLocale());
}

const dayHeadingFormat = memoizedFormatter(Intl.DateTimeFormat, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
});

/**
 * Long date with weekday, for the heading of a day in the panel timeline.
 *
 * It carries the weekday because the heading groups what happened in one day, and "Tuesday" places
 * you far faster than "28/07". It carries no year: the timeline only covers the last month, and
 * repeating the year in every heading is noise.
 *
 * @param {Date|string|number} value
 * @returns {string}
 */
export function formatDayHeading(value) {
    return dayHeadingFormat().format(new Date(value));
}

const timeOfDayFormat = memoizedFormatter(Intl.DateTimeFormat, { hour: '2-digit', minute: '2-digit' });

/**
 * Only hour and minute, for each timeline entry: the day is already said by the group heading, so
 * repeating the date on every line would be noise.
 *
 * @param {Date|string|number} value
 * @returns {string}
 */
export function formatTimeOfDay(value) {
    return timeOfDayFormat().format(new Date(value));
}

const chartDayFormat = memoizedFormatter(Intl.DateTimeFormat, { dateStyle: 'short' });

/**
 * Only the date, no time, for the axis of the insulin chart, which groups by day.
 *
 * @param {Date|string|number} value
 * @returns {string}
 */
export function formatChartDay(value) {
    return chartDayFormat().format(new Date(value));
}

/**
 * There is no `formatChartDate()` here any more, and it is not an oversight. The axis of the charts
 * that place each reading in time is the linear one of `health/timeAxis.js`, and it formats its own
 * labels **in UTC**, because the value it draws is the wall clock time of whoever recorded the
 * event (`eventWallClockMs`) and not an absolute instant. A formatter in the browser zone —which is
 * what this one was— would shift that value a second time and move a 23:30 dinner to another hour.
 */
