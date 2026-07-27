/**
 * Alpine component of the home dashboard (ADR 0002, ADR 0004, ADR 0006, ADR 0007, ADR 0008).
 *
 * **What is left here after the extraction.** Only what belongs to the patient panel: the Alpine
 * component, the `x-ref` of its template, the routes of its empty states and the **only** Livewire
 * call of the whole display path. What is painted —timeline, statistics cards and charts— now
 * lives in modules that take an array of decrypted events and return nodes (`timelineView.js`,
 * `statsView.js`, `chartsView.js`), and where those events come from is decided by an
 * interchangeable source (`eventSource.js`, `livewireEventSource.js`). That is the condition for the
 * professional opening a shared clipping to see the same interface with no account and no session:
 * if the painting were still tied to this component, the reader would have to reimplement it and
 * the two copies would diverge.
 *
 * **None of this goes through a Livewire component**, and that is not negotiable: everything that
 * touches a public property ends up in the snapshot, which travels to the server and stays there
 * (ADR 0002, with `App\Livewire\Hooks\EncryptedPayloadGuardHook` and the architecture tests
 * watching it). The only datum that goes up is the `fetchEvents` read request; decryption happens here, in the browser.
 *
 * **The period is chosen and by default it is the last day.** The range is applied by the server
 * and that is why it travels to `fetchEvents`: `occurred_at` is one of the three ADR 0006 columns
 * in the clear. It is the improvement that matters, because decrypting a year of events in the
 * browser is noticeable: with "last day" the envelopes of 24 hours are opened, not those of a
 * month. The range control is the one shared with the history screens (`health/dateRange.js`), not its own.
 *
 * **The server can neither filter by type nor search text** (ADR 0006), so both are done here, over
 * what is already decrypted, and they are free: ticking a type or typing in the search box
 * repaints without asking for or decrypting anything ({@see filterBySelectedTypes},
 * {@see searchEvents}). **They are not the same filter**: the types choose the population the cards
 * and the charts summarize, and the search only narrows the timeline (see {@see dashboardPage},
 * `render()`). An envelope that does not open does not take the panel down: it is counted and reported (ADR 0004).
 */

import { isUnlocked, ownerId } from '../auth/keyring.js';
import { SESSION_READY_EVENT } from '../auth/sessionBootstrap.js';
import { settings } from '../auth/settings.js';
import { EnvelopeError } from '../crypto/envelope.js';
import { t } from '../i18n/index.js';
import { observeThemeChange } from './chartTheme.js';
import { destroyCharts, renderCharts } from './chartsView.js';
import { dateRangeControl } from './dateRange.js';
import { searchEvents } from './eventSearch.js';
import { defaultSelectedTypes, filterBySelectedTypes } from './eventTypes.js';
import { createCallout } from './eventVisuals.js';
import { livewireEventSource } from './livewireEventSource.js';
import { renderStatsSections, resolveGlucoseTargetRange, targetRangeUnitMismatch } from './statsView.js';
import { renderTimelineSection } from './timelineView.js';

/** Default glucose display unit, the same as in `glucosePage.js` (ADR 0006). */
const DEFAULT_UNIT = 'mg/dL';

/**
 * Name of the `data-*` with the route of the screen of each type, for the empty state button. Blade
 * paints them on the container because `PhrPanelProvider` decides the route and a route duplicated
 * by hand in the client goes stale with nobody noticing until somebody presses the button.
 *
 * @type {Record<string, string>}
 */
const TYPE_URL_KEYS = Object.freeze({
    glucose: 'glucoseUrl',
    bloodPressure: 'bloodPressureUrl',
    insulin: 'insulinUrl',
    meal: 'mealsUrl',
    bodyWeight: 'bodyWeightUrl',
    temperature: 'temperatureUrl',
});

/**
 * Destination of a screen, read from the container Blade paints.
 *
 * It returns `null` if there is no document with `querySelector` —the tests mount a minimal
 * `document`— or if the attribute is missing. In that case the empty state is painted all the same,
 * only without a button: the sentence, which is what informs, does not depend on finding the route.
 *
 * @param {string} type
 * @returns {string|null}
 */
function urlForType(type) {
    const key = TYPE_URL_KEYS[type];

    if (key === undefined || typeof document?.querySelector !== 'function') {
        return null;
    }

    return document.querySelector('[data-glucose-url]')?.dataset?.[key] ?? null;
}

/**
 * @param {unknown} failure
 * @returns {string}
 */
function describeError(failure) {
    if (failure instanceof EnvelopeError) {
        return t('common.undecryptable');
    }

    if (failure instanceof Error && failure.message !== '') {
        return failure.message;
    }

    return t('dashboard.generic');
}

/**
 * Alpine component factory. Registered as `phrDashboardPage`.
 *
 * @returns {object}
 */
export function dashboardPage() {
    return {
        /**
         * The period control shared with the history screens: it provides `rangePreset`,
         * `rangeFromDay`, `rangeToDay` and `rangeError` (the first three with `x-model` in the
         * shared template) and calls `loadHistory()` on apply.
         *
         * It starts at `day` and not at `all` like the history: the panel is the entry screen, it
         * has to open fast and show what happened today. The history, on the other hand, is opened
         * to search, and clipping by default there would hide old records nobody asked to hide.
         */
        ...dateRangeControl({ preset: 'day' }),

        /**
         * Ticked event types. It is client interface state (`x-model`, never `wire:model`: ADR
         * 0002) and it travels nowhere.
         */
        selectedTypes: defaultSelectedTypes(),

        /**
         * What is typed in the search box. Like the checkboxes: `x-model`, never `wire:model`. The
         * search text of somebody over their own history is a clinical datum in itself
         * ("hypoglycaemia", a drug name) and has no business leaving the device; see the header of
         * `eventSearch.js`.
         */
        searchQuery: '',

        /**
         * The already decrypted events of the last load.
         *
         * It is not a cache and not a shortcut: it is what lets the type filter and the search
         * repaint **without asking for or decrypting anything again**. Same pattern as `chartEvents`
         * in `glucosePage.js`, and with the same limit: it is emptied when the session locks,
         * because they are values in the clear of a session that is no longer unlocked (ADR 0003).
         *
         * @type {list<object>}
         */
        decryptedEvents: [],

        /** State of the last load, so it can repaint without asking again. */
        failedToOpen: 0,
        truncated: false,

        /**
         * Live Chart.js instances, one per type with a chart. They are stored so they can be
         * destroyed before repainting: two charts on the same canvas leave the old one underneath
         * and the tooltips of both responding to the mouse.
         *
         * @type {Record<string, object>}
         */
        charts: {},

        init() {
            /**
             * DESIGN.md § Charts — Dark: "a chart must also re-read them and redraw when the `.dark`
             * class on `<html>` changes". Chart.js freezes the colours when the canvas is built, so
             * the only way to switch theme is rebuilding the chart with the same data, and
             * repainting here costs neither a request nor a decryption: the events are already open
             * in memory. With no data there is nothing to repaint.
             */
            observeThemeChange(() => {
                if (this.decryptedEvents.length > 0) {
                    this.render();
                }
            });

            if (isUnlocked()) {
                void this.loadSummary();

                return;
            }

            this.renderLocked();
            document.addEventListener(SESSION_READY_EVENT, () => void this.loadSummary(), { once: true });
        },

        /**
         * Contract of `dateRangeControl`: applying a period loads again through here. It is a real
         * load —the server applies the range— unlike the type filter and the search, which only
         * repaint.
         */
        loadHistory() {
            return this.loadSummary();
        },

        /**
         * The data source of the panel: it asks Livewire for pages and opens them here.
         *
         * It is the **only** border with the server of the whole display. The professional's reader
         * mounts `memoryEventSource(...)` in its place over the already decrypted package and the
         * views notice no difference; that is why the request is passed as a function and not
         * written inside the painting modules.
         *
         * @param {string} userId
         * @returns {(range: object) => Promise<{events: list<object>, failedToOpen: number, truncated: boolean}>}
         */
        eventSource(userId) {
            return livewireEventSource({
                userId,
                /** Same argument order as `HealthEventPage::fetchEvents(?string, int, ?string, ?string)`. */
                fetchPage: (cursor, limit, range) => this.$wire.fetchEvents(cursor, limit, range.from, range.to),
            });
        },

        /** Downloads and decrypts the events of the chosen period, and paints with whatever is ticked. */
        async loadSummary() {
            try {
                const userId = ownerId();

                if (!isUnlocked() || userId === null) {
                    this.renderLocked();

                    return;
                }

                const { events, failedToOpen, truncated } = await this.eventSource(userId)(this.historyRange());

                this.decryptedEvents = events;
                this.failedToOpen = failedToOpen;
                this.truncated = truncated;

                this.render();
            } catch (failure) {
                this.renderNoticeError(failure);
            }
        },

        /**
         * Repaints with what is already decrypted. The load, the type filter and the search box call
         * it; the last two ask for and decrypt nothing, which is what allows ticking, unticking and
         * typing without waits.
         */
        render() {
            const userSettings = settings();
            const unit = userSettings?.glucoseUnit ?? DEFAULT_UNIT;
            const targetRange = resolveGlucoseTargetRange(userSettings, unit);
            const unitMismatch = targetRangeUnitMismatch(userSettings, unit);

            /**
             * **The period and the types are the population; the search is not.** The charts and the
             * cards are computed over `selected`, and what is typed only narrows the timeline, which
             * is where searching means "find this".
             *
             * While the search was the last filter of everything, typing "morning" —or "140"—
             * rewrote the mean, the median and the time in range over the subset of records whose
             * **text** contained that string, with the "Mean" label untouched. A mean over a string
             * match is not a clinical population.
             */
            const selected = filterBySelectedTypes(this.decryptedEvents, this.selectedTypes);
            const shown = searchEvents(selected, this.searchQuery);

            this.renderNotice(this.failedToOpen, this.truncated, selected.length, selected.length - shown.length);
            /**
             * The three views are painted with the **same** list of already decrypted events: not
             * one extra request and not one extra decryption.
             */
            this.$refs.timeline.replaceChildren(renderTimelineSection(shown, {
                emptyStateUrl: urlForType('glucose'),
                /**
                 * If what empties the list is the search box, it is said that it is the search box:
                 * "no records in this period" over records that are there and merely filtered is an
                 * absence read as a clinical zero.
                 */
                emptyText: this.searchQuery.trim() === '' ? undefined : t('dashboard.empty.search'),
            }));
            this.$refs.stats.replaceChildren(renderStatsSections(selected, {
                selectedTypes: this.selectedTypes,
                unit,
                targetRange,
                unitMismatch,
                urlForType,
            }));
            /**
             * The chart blocks are painted by Blade and live **outside** the islands, with
             * `wire:ignore`: inside an `@island`, the server re-emits them after any Livewire
             * request and the `<canvas>` disappears with everything drawn on it.
             */
            renderCharts(selected, {
                glucoseUnit: unit,
                charts: this.charts,
                includesType: (type) => this.selectedTypes[type] === true,
                /**
                 * The target range paints the background band of the 24-hour overlay, which is what
                 * turns that cloud of points into information. It arrives already resolved and
                 * already checked in the display unit (ADR 0007: nothing is converted), so if it is
                 * in another unit it arrives as `undefined` and the chart is drawn with no band,
                 * instead of with a false reference.
                 */
                targetRange,
            });
        },

        /**
         * Ticking or unticking a type, or typing in the search box, only repaints: the data is
         * already decrypted in memory. Without an unlocked session there is nothing to repaint and
         * the lock notice is left on screen.
         */
        applyFilters() {
            if (!isUnlocked()) {
                this.renderLocked();

                return;
            }

            this.render();
        },

        /** Name the template has used for the type checkboxes since before the search box. */
        applyTypeFilter() {
            this.applyFilters();
        },

        /**
         * With no key nothing can be decrypted: it is said in both regions, no empty summary is
         * painted that would be mistaken for "you have no records" (ADR 0003: losing the key is normal).
         *
         * The decrypted events of the previous load are thrown away: they are values in the clear
         * of a session that is no longer unlocked.
         */
        renderLocked() {
            this.decryptedEvents = [];
            this.failedToOpen = 0;
            this.truncated = false;
            /** The charts draw values in the clear: with the session locked they cannot stay. */
            destroyCharts(this.charts);

            this.$refs.notice.replaceChildren();
            this.$refs.timeline.replaceChildren(createCallout('info', t('common.locked.summary')));
            this.$refs.stats.replaceChildren(createCallout('info', t('common.locked.summary')));
        },

        /**
         * Notices of the load: envelopes that did not open, a clipped summary, how many records are
         * behind what is being shown and how many the search left out.
         *
         * The count is always stated, not only when something is clipped: it is the reference that
         * lets "100 entries" of the timeline be read knowing how many there were. And what the
         * search box hides is stated too, for the same reason: a shortened list with no explanation
         * reads as "there are no more records".
         *
         * @param {number} failedToOpen
         * @param {boolean} truncated
         * @param {number} shownCount Events of the period that pass the type filter.
         * @param {number} hiddenBySearch How many of those the searched text leaves out.
         */
        renderNotice(failedToOpen, truncated, shownCount, hiddenBySearch = 0) {
            const callouts = [];

            if (failedToOpen > 0) {
                callouts.push(createCallout(
                    'warning',
                    t('dashboard.recordsUndecrypted', { count: failedToOpen }),
                ));
            }

            if (truncated) {
                callouts.push(createCallout('warning', t('dashboard.truncated')));
            }

            if (shownCount > 0) {
                callouts.push(createCallout('info', t('dashboard.loadedCount', { count: shownCount })));
            }

            if (hiddenBySearch > 0) {
                callouts.push(createCallout('info', t('dashboard.search.hidden', { count: hiddenBySearch })));
            }

            for (const callout of callouts.slice(0, -1)) {
                callout.classList.add('mb-4');
            }

            this.$refs.notice.replaceChildren(...callouts);
        },

        /** @param {unknown} failure */
        renderNoticeError(failure) {
            this.$refs.notice.replaceChildren(createCallout('warning', describeError(failure)));
        },
    };
}
