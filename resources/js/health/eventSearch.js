/**
 * Free text search over **already decrypted** events.
 *
 * ## Why this can exist here while the global panel search is switched off on purpose
 *
 * The Filament search resolves on the server: it writes a `where ... like` against database
 * columns. In this project the columns of an event are `user_id`, `occurred_at` and an encrypted
 * blob (ADR 0006), so that search would either never find anything or —worse— push somebody into
 * storing something searchable in the clear. An index of "foods this person eats" or of "device
 * they measure with" in the database is exactly the metadata ADR 0006 encrypted; reading
 * `["fast insulin"]` is knowing that person is diabetic without decrypting a byte. That is why it
 * is disabled and why it has to stay disabled.
 *
 * This search is the opposite: it runs **entirely in the browser**, over the events already
 * downloaded and opened to paint the screen. There is no request, no query parameter, no `$wire`,
 * no public Livewire property (the snapshot travels to the server and stays there, ADR 0002) and
 * the typed text never leaves the device. It is free for the same reason as the type filter: the
 * data is already decrypted in memory.
 *
 * The honest consequence, written down so nobody is surprised: **it only searches what is
 * loaded**. If the chosen period is the last day, it does not find the note from a month ago. The
 * way out is widening the period, which does travel to the server through `occurred_at`, a column
 * in the clear. Any attempt to fix it by "searching the whole history" without widening the period
 * would mean downloading and decrypting all of it, or asking the server, and the second is not possible without breaking the encryption.
 *
 * ## What is searched
 *
 * The text the person **sees**: the type, the summary and the detail of the timeline (which
 * already translate the catalog tokens, so "capillary" finds a `capillary`), plus every string of
 * the decrypted content —note, device, food names, units, values—. Searching over what is read is
 * the only thing that does not surprise: if it shows on screen, it is found.
 */

import { typeLabel } from './eventLabels.js';
import { describeTimelineEvent } from './timelineView.js';

/**
 * Maximum depth when walking the content looking for strings. ADR 0006 events are flat or nearly
 * so (`data.foods[].name` is the deepest); the cap exists so that unexpected content cannot send
 * the walk into a loop.
 */
const MAX_DEPTH = 4;

/**
 * Normalizes for comparison: no uppercase and no accents.
 *
 * Without stripping accents, searching "desayuno" would not find "Desayúno" and, above all,
 * whoever types without accents —the normal thing in a search box— would not find "Café". It is
 * text comparison, not storage: the datum is not touched.
 *
 * @param {string} text
 * @returns {string}
 */
export function normalizeForSearch(text) {
    return text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

/**
 * Splits what was typed into terms. Several terms are **all** required (AND, not OR): whoever
 * writes "capillary 140" is looking for the capillary reading of 140, not everything capillary
 * plus everything worth 140.
 *
 * @param {unknown} query
 * @returns {list<string>} Empty if there is nothing to search for.
 */
export function searchTerms(query) {
    if (typeof query !== 'string') {
        return [];
    }

    return normalizeForSearch(query).split(/\s+/).filter((term) => term !== '');
}

/**
 * Every string of any value, recursively. Numbers count too: the value of a glucose reading
 * travels as a string (ADR 0004), but a numeric `quantity` of a future event type would be found
 * all the same.
 *
 * @param {unknown} value
 * @param {number} depth
 * @param {list<string>} into
 */
function collectStrings(value, depth, into) {
    if (typeof value === 'string') {
        into.push(value);

        return;
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
        into.push(String(value));

        return;
    }

    if (depth >= MAX_DEPTH || value === null || typeof value !== 'object') {
        return;
    }

    for (const nested of Object.values(value)) {
        collectStrings(nested, depth + 1, into);
    }
}

/**
 * Text an event is searched against: what is seen on screen plus the content in the clear.
 *
 * @param {object} event Decrypted and flattened event.
 * @returns {string} Already normalized.
 */
export function searchableText(event) {
    /** @type {list<string>} */
    const parts = [];

    if (typeof event?.type === 'string') {
        parts.push(event.type, typeLabel(event.type));
    }

    const entry = describeTimelineEvent(event);

    if (entry !== null) {
        parts.push(entry.summary);

        if (entry.detail !== null) {
            parts.push(entry.detail);
        }
    }

    /**
     * The common fields (`note`, `device`, `origin`, `recordedBy`) live at the top level of the
     * content and `data` carries what belongs to the type, so the whole event is walked except the
     * date, which already has its own period control and would only add noise: searching "11" must
     * not bring back everything that happened at 11:00.
     */
    for (const [key, value] of Object.entries(event ?? {})) {
        if (key === 'occurredAt' || key === 'tz' || key === 'v') {
            continue;
        }

        collectStrings(value, 0, parts);
    }

    return normalizeForSearch(parts.join(' '));
}

/**
 * Does this event match every term?
 *
 * @param {object} event
 * @param {list<string>} terms Already normalized ({@see searchTerms}).
 * @returns {boolean}
 */
export function matchesSearch(event, terms) {
    if (terms.length === 0) {
        return true;
    }

    const haystack = searchableText(event);

    return terms.every((term) => haystack.includes(term));
}

/**
 * Filters by free text. An empty query returns **the same list**, not a filtered copy: searching
 * for nothing cannot hide anything.
 *
 * @param {list<object>} events Decrypted and flattened events.
 * @param {unknown} query What was typed.
 * @returns {list<object>}
 */
export function searchEvents(events, query) {
    const terms = searchTerms(query);

    if (terms.length === 0) {
        return events;
    }

    return events.filter((event) => matchesSearch(event, terms));
}
