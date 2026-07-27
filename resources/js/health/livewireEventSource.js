/**
 * The event source of the **patient panel**: it asks Livewire for pages and opens them here.
 *
 * It lives apart from `eventSource.js` for perimeter reasons, not size. `eventSource.js` is
 * imported by the professional's reader (`reader.js`), and Rollup drags into the shared chunk the
 * whole import chain of everything two entry points reach: with `livewireEventSource` in there,
 * the reader took `eventEnvelope.js` → `auth/keyring.js` —the master key ring, with its
 * `sessionStorage`— to the browser of somebody else's clinic (ADR 0011). This file is the half
 * that **can** depend on the key ring, and that is why only the screens with a session import it.
 *
 * The shape of the abstraction and the why of the three response keys are documented in
 * `eventSource.js`.
 */

import { openEvent } from './eventEnvelope.js';
import { FETCH_PAGE_SIZE, flattenDecryptedEvent, MAX_FETCH_PAGES, needsAnotherPage, rangeStartMs } from './eventSource.js';

/**
 * Panel source: it asks the server for pages and opens them here, in the browser.
 *
 * `fetchPage` is injected and is the **only** door to the server on the whole display path: the
 * caller passes `(cursor, limit, range) => this.$wire.fetchEvents(cursor, limit, range.from,
 * range.to)`, so this module does not depend on Livewire. The range travels to the server because
 * `occurred_at` is one of the three columns in the clear (ADR 0006) and narrowing it is the only
 * optimization that really matters here: with "last day" the envelopes of 24 hours are opened, not those of a month.
 *
 * `truncated` warns that the page cap ran out before reaching the start of the range: the summary
 * is still the one of the most recent records, but it cannot be presented as if it were the one of
 * the whole period.
 *
 * @param {object} params
 * @param {(cursor: string|null, limit: number, range: object) => Promise<list<object>>} params.fetchPage
 * @param {string} params.userId Associated data of the envelope (ADR 0004).
 * @param {number} [params.pageSize]
 * @param {number} [params.maxPages]
 * @returns {(range: {from: string|null, to: string|null}) => Promise<{events: list<object>, failedToOpen: number, truncated: boolean}>}
 */
export function livewireEventSource({ fetchPage, userId, pageSize = FETCH_PAGE_SIZE, maxPages = MAX_FETCH_PAGES }) {
    return async (range) => {
        const windowStartMs = rangeStartMs(range);
        const rawEvents = [];
        let cursor = null;
        let truncated = true;

        for (let page = 0; page < maxPages; page += 1) {
            const pageEvents = await fetchPage(cursor, pageSize, range);

            rawEvents.push(...pageEvents);

            if (!needsAnotherPage(pageEvents, pageSize, windowStartMs)) {
                truncated = false;

                break;
            }

            /**
             * The cursor is the date of the oldest event of the page and the server applies it with
             * a strict `<`, so every round really moves forward.
             */
            cursor = pageEvents[pageEvents.length - 1].occurredAt;
        }

        return { ...openAll(rawEvents, userId), truncated };
    };
}

/**
 * Opens every envelope of a list, counting the ones that do not open.
 *
 * An envelope that does not open **does not take the screen down** (ADR 0004): it is counted and
 * the caller says so. Dropping it in silence would leave a history with a gap that reads as "there
 * was no measurement".
 * @param {list<{occurredAt: string, payload: string}>} rawEvents
 * @param {string} userId
 * @returns {{events: list<object>, failedToOpen: number}}
 */
function openAll(rawEvents, userId) {
    let failedToOpen = 0;
    const events = [];

    for (const rawEvent of rawEvents) {
        try {
            const content = openEvent({
                userId,
                occurredAt: rawEvent.occurredAt,
                envelope: rawEvent.payload,
            });

            events.push(flattenDecryptedEvent(rawEvent, content));
        } catch {
            failedToOpen += 1;
        }
    }

    return { events, failedToOpen };
}

