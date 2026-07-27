/**
 * Vocabulary of event types and filtering by type (ADR 0006).
 *
 * **Why it lives outside any screen.** The same six types govern the patient panel, the
 * professional's reader and the preview of the share screen. While the list and the filter lived
 * inside `dashboardPage.js`, any new consumer had to copy them, and two copies of a list of
 * clinical types diverge as soon as a seventh is added: one screen would stop showing a record
 * type with nobody noticing, which is the worst kind of failure in a history (an absence reads as
 * "there is none", not as "it is not painted").
 *
 * Nothing of Livewire, of `$wire` or of the DOM is imported here: these are data and pure functions.
 */

/**
 * Known event types, in the order they are offered in the filters.
 *
 * The tokens are the ones that travel inside the encrypted envelope (ADR 0006) and they are the
 * contract with the `<input type="checkbox">` that `resources/views/phr/pages/dashboard.blade.php`
 * renders: the same token is written there in the `x-model`, because the server paints the options
 * (the DOM morph would wipe any option written by JavaScript).
 *
 * @type {Readonly<list<string>>}
 */
export const EVENT_TYPES = Object.freeze([
    'glucose',
    'bloodPressure',
    'insulin',
    'meal',
    'bodyWeight',
    'temperature',
]);

/**
 * Initial state of the filter: **every type ticked**.
 *
 * Opening a screen with a type unticked would hide records that exist without anybody asking, and
 * in a clinical history "it does not show" reads as "it has been lost". Whoever wants to look at a
 * single type unticks the rest; nobody should have to discover why something is missing.
 *
 * @returns {Record<string, boolean>}
 */
export function defaultSelectedTypes() {
    return Object.fromEntries(EVENT_TYPES.map((type) => [type, true]));
}

/**
 * Types ticked right now, in the order of {@see EVENT_TYPES}.
 *
 * @param {Record<string, boolean>} selectedTypes
 * @returns {list<string>}
 */
export function selectedTypeTokens(selectedTypes) {
    return EVENT_TYPES.filter((type) => selectedTypes?.[type] === true);
}

/**
 * Keeps only the events of the ticked types.
 *
 * It costs no request and no decryption: the events arrive here already open, because the server
 * cannot filter by type (ADR 0006) and brings down all of them in the range anyway. That is why
 * the filter is applied when painting and not when asking, and why it serves the reader equally,
 * which has no server to ask anything of.
 *
 * @param {list<{type?: string}>} events
 * @param {Record<string, boolean>} selectedTypes
 * @returns {list<object>}
 */
export function filterBySelectedTypes(events, selectedTypes) {
    return events.filter((event) => selectedTypes?.[event?.type] === true);
}
