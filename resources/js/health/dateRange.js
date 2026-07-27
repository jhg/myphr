/**
 * History date range, shared by the four event screens (ADR 0002, ADR 0004,
 * ADR 0006).
 *
 * **Why the server can narrow the range.** `occurred_at` is one of the three ADR 0006 columns in
 * the clear and the server already uses it to sort and paginate, so filtering by it reveals nothing
 * new; the event type, on the other hand, travels inside the envelope and is still discarded here.
 * The range is computed in the browser and travels as an argument of `fetchEvents`, never as a
 * Livewire property: a public property would enter the snapshot, which is what ADR 0002 forbids.
 *
 * **The range does NOT go in the URL, and that is no oversight.** Spec 0001 §9 and
 * `App\Filament\Pages\PhrPage` forbid `#[Url]` properties in the panel screens, to the point of
 * redeclaring without the attribute the six Filament ships, and
 * `tests/Feature/PanelUrlPropertiesTest.php` fails if any comes back. The reason is exactly the one
 * that applies here: a URL ends up written in the browser history, in the provider access log and
 * in the `Referer` of any external resource the page loads. And `?from=2026-03-03&to=2026-03-10`
 * on the insulin screen is not an interface detail: it says that person records insulin and which
 * stretch they were reviewing, without decrypting anything. Besides, publishing in the URL requires
 * a public Livewire property, which is exactly what ADR 0002 wants out of the snapshot. The price
 * is that the range cannot be shared by link and does not survive an F5, and neither is worth that
 * risk: picking "last week" again costs one click.
 *
 * **The range is half-open `[from, to)`**, as in `HealthEventPage::fetchEvents()`: the start is in
 * and the end is out. That is why "up to 20 March" translates to midnight on the 21st in local
 * time, and not to a `23:59:59.999999` that would leave out any record from the last fraction of
 * a second of the day.
 *
 * **Both ends are LOCAL midnights**, converted to the UTC instant that matches them. The person
 * picks a calendar day on their own clock, not an instant in UTC: clipping by UTC midnight would
 * move the cut by several hours and would hide —or slip in— the records on the edge.
 *
 * **The shortcuts speak the same vocabulary as the home dashboard**: "last day", "last week" and
 * "last month" are the same windows of `statistics.js` (`WINDOW_DAYS`), imported from there and not
 * copied, so that a summary and a history saying the same thing count the same days.
 *
 * The functions exported before `dateRangeControl()` are pure logic, testable without Alpine and
 * without a DOM (`tests/js/dateRange.test.mjs`).
 */

import { canonicalDate } from '../crypto/canonicalDate.js';
import { t } from '../i18n/index.js';
import { WINDOW_DAYS } from './statistics.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Value of an `<input type="date">`: calendar day, with no time and no offset. */
const DATE_INPUT_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Shortcuts of the dropdown, in the order they are offered. The tokens are the contract with the
 * `<option value="...">` that `resources/views/phr/partials/date-range.blade.php` renders.
 *
 * @type {Readonly<list<string>>}
 */
export const RANGE_PRESETS = Object.freeze(['all', 'day', 'week', 'month', 'custom']);

/**
 * Default shortcut **of the history**: `day`, the last 24 hours.
 *
 * **Why it clips by default.** Without clipping, opening a history screen brings down and decrypts
 * everything that fits in the page, and here decryption happens in the browser: with a history of
 * years that is download, memory and CPU of the device of whoever is looking, and the cost grows
 * on its own with time. The default period has to be the cheap one, and the expensive one is asked for.
 *
 * **The objection that led to the original `all` still holds and is not dismissed, it is
 * mitigated.** In a clinical history, "it does not show" reads as "it has been lost", so a filter
 * applied by default is only acceptable if it is impossible to miss. Hence the two conditions
 * `resources/views/phr/partials/date-range.blade.php` meets and
 * `tests/Feature/HealthEventRangeTest.php` fixes:
 *
 * 1. The period in force is read **next to the history**, in a permanent notice and in words
 *    ("currently showing: last day"), not only as an option chosen inside a dropdown, which is
 *    exactly what nobody looks at.
 * 2. Reaching the whole history is **a visible button** ("see every record", see
 *    {@see dateRangeControl}), not an option buried in that dropdown, and the notice says
 *    explicitly that what is missing is hidden by the period, not lost.
 *
 * `day` and not `week` or `month` because it is the same period the home dashboard starts with, and
 * two screens that open on their own should not disagree about what "recent" is; raising the
 * default is one click, and the click is in plain sight.
 */
export const DEFAULT_RANGE_PRESET = 'day';

/**
 * Range error, told apart from a crypto or network failure: it is caused by what was typed into
 * the control, so the screen shows it next to the control and not as a loading failure.
 */
export class DateRangeError extends Error {
    /** @param {string} message */
    constructor(message) {
        super(message);
        this.name = 'DateRangeError';
    }
}

/**
 * UTC instant of the local midnight of a calendar day, with the offset **of that day** and not
 * today's, so that daylight saving does not move the cut.
 *
 * `dayOffset` is added to the day before resolving the offset (`Date.UTC` normalizes month and
 * year overflow), which is how the excluded upper end is obtained: the midnight of the next
 * day.
 *
 * @param {string} value Value of an `<input type="date">` (`YYYY-MM-DD`).
 * @param {object} [options]
 * @param {number} [options.dayOffset] Days to add to the given day.
 * @param {number} [options.timezoneOffsetMinutes] Offset to use instead of the device one, with
 *        the `Date.prototype.getTimezoneOffset()` convention (UTC minus local). It exists only to
 *        test this with a non-zero offset without depending on the zone of whoever runs it.
 * @returns {string} ADR 0004 canonical date.
 * @throws {DateRangeError} If the value is not a valid calendar day.
 */
export function localDayStartToCanonical(value, { dayOffset = 0, timezoneOffsetMinutes } = {}) {
    const match = DATE_INPUT_PATTERN.exec(value ?? '');

    if (match === null) {
        throw new DateRangeError(t('range.error.badDate'));
    }

    const [, year, month, day] = match.map(Number);

    /**
     * `Date.UTC` silently normalizes a month 13 or a day 32, so an impossible day is rejected here,
     * before converting it: accepting the normalization would mean showing the range of another
     * month without saying so.
     */
    if (month < 1 || month > 12 || day < 1 || day > 31) {
        throw new DateRangeError(t('range.error.badDate'));
    }

    const shiftedDay = day + dayOffset;

    const offsetMinutes = timezoneOffsetMinutes
        ?? new Date(year, month - 1, shiftedDay).getTimezoneOffset();

    const utcMilliseconds = Date.UTC(year, month - 1, shiftedDay) + offsetMinutes * 60_000;

    return canonicalDate(new Date(utcMilliseconds));
}

/**
 * Range of a relative shortcut (`day`, `week`, `month`) or of the absence of one (`all`).
 *
 * Both relative ones leave the upper end open (`to === null`) instead of pinning it to "now": a
 * record dated a few minutes ahead of the server clock —clocks that disagree, or a dose written
 * down before taking it— would disappear from the history right after saving it, which is the
 * worst possible way to introduce a filter.
 *
 * @param {string} preset
 * @param {Date} [referenceInstant] "Now", parameterized so it can be tested.
 * @returns {{from: string|null, to: string|null}}
 * @throws {DateRangeError} If the shortcut is neither one of the relative ones nor `all`.
 */
export function presetRange(preset, referenceInstant = new Date()) {
    if (preset === 'all') {
        return { from: null, to: null };
    }

    const days = WINDOW_DAYS[preset];

    if (days === undefined) {
        throw new DateRangeError(t('range.error.badPreset', { preset }));
    }

    return { from: canonicalDate(new Date(referenceInstant.getTime() - days * MS_PER_DAY)), to: null };
}

/**
 * Custom range out of the two `<input type="date">`.
 *
 * Both dates are required: with only one, "from the 3rd" and "up to the 3rd" are different
 * requests and guessing which one was meant produces a history that is not the one asked for.
 *
 * @param {string} fromDay `YYYY-MM-DD`, included.
 * @param {string} toDay `YYYY-MM-DD`, included (translated to the midnight of the next day).
 * @param {object} [options]
 * @param {number} [options.timezoneOffsetMinutes] See {@see localDayStartToCanonical}.
 * @returns {{from: string, to: string}}
 * @throws {DateRangeError} If a date is missing, is invalid, or the start comes after the end.
 */
export function customRange(fromDay, toDay, { timezoneOffsetMinutes } = {}) {
    if (typeof fromDay !== 'string' || typeof toDay !== 'string' || fromDay === '' || toDay === '') {
        throw new DateRangeError(t('range.error.incomplete'));
    }

    /** String comparison: `YYYY-MM-DD` sorts the same as text as it does as a date. */
    if (fromDay > toDay) {
        throw new DateRangeError(t('range.error.order'));
    }

    return {
        from: localDayStartToCanonical(fromDay, { timezoneOffsetMinutes }),
        to: localDayStartToCanonical(toDay, { dayOffset: 1, timezoneOffsetMinutes }),
    };
}

/**
 * Effective range of the control, whichever shortcut is chosen.
 *
 * @param {object} params
 * @param {string} params.preset One of {@see RANGE_PRESETS}.
 * @param {string} [params.fromDay] Only read with the `custom` shortcut.
 * @param {string} [params.toDay] Only read with the `custom` shortcut.
 * @param {Date} [params.referenceInstant]
 * @param {number} [params.timezoneOffsetMinutes]
 * @returns {{from: string|null, to: string|null}}
 * @throws {DateRangeError}
 */
export function resolveRange({ preset, fromDay, toDay, referenceInstant, timezoneOffsetMinutes }) {
    if (preset === 'custom') {
        return customRange(fromDay, toDay, { timezoneOffsetMinutes });
    }

    return presetRange(preset, referenceInstant);
}

/**
 * State and behaviour of the range control, to mix into the Alpine component of each history
 * screen (`...dateRangeControl()`).
 *
 * **Contract with the screen that mixes it in**: it has to expose a `loadHistory()`, which is what
 * `applyRange()` calls again, and its `loadHistory()` has to pass `historyRange()` to
 * `fetchEvents`. In exchange, this object provides the three properties the shared template
 * `phr.partials.date-range` binds with `x-model` (`rangePreset`, `rangeFromDay`, `rangeToDay`) and
 * the error slot `rangeError`.
 *
 * The three go with `x-model` and not with `x-ref`: they are client state, not clinical data, and
 * they need to be reactive so the two date fields appear only with the `custom` shortcut.
 * `x-model` is Alpine's and uploads nothing to the server; the one ADR 0002 forbids is `wire:model`.
 *
 * @param {object} [options]
 * @param {string} [options.preset] Shortcut the screen starts with. The history ones and the home
 *        dashboard keep the default (see {@see DEFAULT_RANGE_PRESET}); only the share screen asks
 *        for another, because there the range is what is going to be shared.
 * @returns {object}
 */
export function dateRangeControl({ preset = DEFAULT_RANGE_PRESET } = {}) {
    return {
        rangePreset: preset,
        rangeFromDay: '',
        rangeToDay: '',

        /** Message of the last malformed range; it is cleared as soon as one is valid. */
        rangeError: '',

        /**
         * Range to apply right now. If what was typed is not valid, it returns the open range and
         * leaves the reason in `rangeError`: better to show the whole history with a warning than
         * to leave the screen blank.
         *
         * @returns {{from: string|null, to: string|null}}
         */
        historyRange() {
            try {
                const range = resolveRange({
                    preset: this.rangePreset,
                    fromDay: this.rangeFromDay,
                    toDay: this.rangeToDay,
                });

                this.rangeError = '';

                return range;
            } catch (failure) {
                this.rangeError = failure instanceof DateRangeError ? failure.message : t('range.error.badDate');

                return { from: null, to: null };
            }
        },

        /**
         * Loads the history again with the range in force. Both the dropdown (when the shortcut
         * changes) and the apply button of the custom range call it.
         */
        applyRange() {
            void this.loadHistory();
        },

        /**
         * Way out to "the whole history" in a single gesture.
         *
         * It is the executable half of the mitigation that justifies clipping by default (see
         * {@see DEFAULT_RANGE_PRESET}): since the default is no longer `all`, removing the clip
         * cannot cost opening a dropdown and finding the right option. The template puts it as a
         * visible button in the period notice itself, next to the history.
         *
         * It also clears the custom range: leaving two dates written in the fields after saying
         * "see every record" invites believing they still apply.
         */
        showAllRecords() {
            this.rangePreset = 'all';
            this.rangeFromDay = '';
            this.rangeToDay = '';

            this.applyRange();
        },
    };
}
