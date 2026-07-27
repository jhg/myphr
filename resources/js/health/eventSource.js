/**
 * Where the decrypted events of a period come from (ADR 0002, ADR 0004, ADR 0006).
 *
 * **The abstraction is one single async function**, not a class and not an interface with methods:
 *
 *     (range) => Promise<{events, failedToOpen, truncated}>
 *
 * and `range` is the `{from, to}` `dateRange.js` already produces. The smallest shape that answers
 * the only question the views ask —"give me the events of this range"— was chosen because any
 * extra method would tie the screens back to a concrete source: a `hasMore()` or a `refresh()` only
 * make sense with a server behind, and the professional's reader has none. With a function,
 * building a new source is writing a function.
 *
 * The three keys of the response are the ones the screen **has to be able to say out loud**: how
 * many events there are, how many envelopes did not open (ADR 0004: a broken envelope is counted
 * and reported, never swallowed) and whether the read fell short. A shortened summary presented as
 * complete is the worst possible failure in a clinical history.
 *
 * Two implementations, in **two different files**:
 *
 * - {@see memoryEventSource}, here: the one of the professional's reader and of the share preview.
 *   The events are already decrypted in memory (they come from the `s1.` package or from the
 *   screen about to create it), so they only have to be clipped by range. Not one request.
 * - `livewireEventSource`, in `livewireEventSource.js`: the panel one, which asks the server for
 *   pages and **decrypts in the browser**.
 *
 * **They are split for a perimeter reason, not a tidiness one.** This file is reachable from the
 * Vite entry point of the reader (`reader.js`), and Rollup puts into the shared chunk everything
 * both entry points reach, with its whole import chain. While the panel source lived here, the
 * reader dragged `eventEnvelope.js` → `auth/keyring.js`, that is the module that stores and opens
 * the master key in `sessionStorage`, all the way to the browser of somebody else's clinic. It was
 * not exploitable —there is no key to open there—, but the stated invariant of ADR 0011 ("the
 * reader drags nothing of the panel", "it writes nothing on the device") stopped being structural.
 *
 * That is why **this file imports nothing**: no `eventEnvelope.js`, no Livewire, no DOM. It is
 * watched by `tests/js/clippingExplorer.test.mjs`, which walks the **transitive** import graph from
 * `reader.js`; a direct-import test cannot watch a perimeter Vite decides by reachability.
 * alcanzabilidad.
 */

/**
 * Page size: the hard ceiling of `HealthEventPage::MAX_FETCH_LIMIT`, which clips any larger value.
 * Asking for less would only multiply the round trips.
 */
export const FETCH_PAGE_SIZE = 500;

/**
 * Page cap per load. With 500 events per page that is 5,000 events, well above what fits in 30
 * days of human recording; it exists only so that a cursor that failed to advance could not leave
 * the browser asking for pages forever.
 */
export const MAX_FETCH_PAGES = 10;

/**
 * Flattens a decrypted event into the shape `statistics.js` expects: the content in the clear
 * (`{v, type, tz, data, ...}`) plus `occurredAt` at the same level (see the JSDoc of the
 * `statistics.js` module, "Input shape").
 *
 * @param {{occurredAt: string}} rawEvent Exactly as `fetchEvents` returns it (undecrypted).
 * @param {object} content Content already decrypted with `openEvent`.
 * @returns {object}
 */
export function flattenDecryptedEvent(rawEvent, content) {
    return { ...content, occurredAt: rawEvent.occurredAt };
}

/**
 * Instant the requested range starts at, in milliseconds since epoch, or `-Infinity` when the
 * range is open at the bottom ("every record").
 *
 * @param {{from: string|null}} range
 * @returns {number}
 */
export function rangeStartMs(range) {
    if (range?.from === null || range?.from === undefined) {
        return -Infinity;
    }

    const startMs = Date.parse(range.from);

    return Number.isNaN(startMs) ? -Infinity : startMs;
}

/**
 * End of the requested range, exclusive, or `Infinity` when it is open at the top.
 *
 * @param {{to: string|null}} range
 * @returns {number}
 */
export function rangeEndMs(range) {
    if (range?.to === null || range?.to === undefined) {
        return Infinity;
    }

    const endMs = Date.parse(range.to);

    return Number.isNaN(endMs) ? Infinity : endMs;
}

/**
 * Do we need to ask for another page of events?
 *
 * `fetchEvents` returns **every** event type of the user (the server cannot filter by type, ADR
 * 0006) sorted from most recent to oldest and with a limit. With a single page of 100 —the server
 * default— somebody who records glucose, blood pressure, meals and insulin several times a day
 * does not even reach ten days back, and the summary of a long period would come out clipped
 * without saying so. So it pages with a cursor until the chosen range is covered.
 *
 * It stops when the page comes back incomplete (there are no more events) or when the oldest of
 * the page already falls before the start of the range. An unreadable date also stops the loop,
 * instead of leaving it asking for pages blindly.
 *
 * @param {list<{occurredAt: string}>} page Exactly as `fetchEvents` returns it (undecrypted).
 * @param {number} pageSize Limit asked of the server.
 * @param {number} windowStartMs See {@see rangeStartMs}.
 * @returns {boolean}
 */
export function needsAnotherPage(page, pageSize, windowStartMs) {
    if (page.length < pageSize) {
        return false;
    }

    const oldestMs = Date.parse(page[page.length - 1].occurredAt);

    return Number.isNaN(oldestMs) ? false : oldestMs >= windowStartMs;
}

/**
 * Source of the reader and of the share preview: the events are already decrypted in memory.
 *
 * It clips with the **same criterion as the server**, `[from, to)` (see
 * `HealthEventPage::fetchEvents`, which applies `>=` at the start and `<` at the end), and returns
 * the same order, most recent to oldest. That is what keeps the views from noticing the
 * difference: changing source cannot change which events enter a summary, or patient and doctor
 * would see different means for the same period.
 *
 * `failedToOpen` arrives as a parameter and is not computed: in the reader the envelopes are
 * opened while unpacking the package, long before this function, and the count of the failed ones
 * has to survive all the way to the screen (ADR 0004).
 *
 * @param {list<object>} events Events already decrypted and flattened.
 * @param {{failedToOpen?: number}} [options]
 * @returns {(range: {from: string|null, to: string|null}) => Promise<{events: list<object>, failedToOpen: number, truncated: boolean}>}
 */
export function memoryEventSource(events, { failedToOpen = 0 } = {}) {
    return async (range) => {
        const startMs = rangeStartMs(range);
        const endMs = rangeEndMs(range);

        const inRange = events
            .filter((event) => {
                const occurredMs = Date.parse(event?.occurredAt);

                /**
                 * An unreadable date is not dropped: it is let through. Dropping it would hide a
                 * record that exists, and hiding is worse than showing something badly placed.
                 */
                return Number.isNaN(occurredMs) || (occurredMs >= startMs && occurredMs < endMs);
            })
            .sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt));

        /** Nothing is truncated: there is no pagination to exhaust, they are all right here. */
        return { events: inRange, failedToOpen, truncated: false };
    };
}
