/**
 * Alpine component of the injected insulin screen (ADR 0002, ADR 0004, ADR 0005, ADR 0006).
 *
 * The DOM contract is fixed by `resources/views/phr/pages/insulin.blade.php`: no `wire:model`
 * (ADR 0002), the fields are read through `x-ref` and the encrypted envelope goes up as an
 * argument of `storeEvent` (the `HealthEventPage` action, the same one any event screen uses),
 * never as a Livewire property.
 *
 * **The server cannot filter by type** (ADR 0006, see the JSDoc of `HealthEventPage::fetchEvents()`):
 * `fetchEvents` brings every event of the user and here each one is decrypted and whatever is not
 * `type === 'insulin'` is discarded. An envelope that does not open does not take the screen down:
 * it is counted and reported, because a silent decryption failure is exactly what ADR 0004 forbids.
 *
 * **The real risk of this screen**: a misread dose is a misgiven dose. The dose is always shown in
 * monospace, in the main text (never in light grey) and in the largest type size available in the
 * list, following DESIGN.md to the letter.
 *
 * **It carries no LOINC code** (ADR 0006): an insulin event is a medication administration, not an
 * observation of a quantity, so there is no (type, unit) → code table to resolve here, unlike
 * `glucosePage.js`.
 *
 * **The dose travels as a string, never as a number** (ADR 0004: "decimals as a string"): half a
 * unit is a real dose in paediatric patients and `parseFloat` or arithmetic would round it or
 * represent it with floating point errors.
 *
 * **The four fields common to every event** (manual/device origin, device, who records, free note;
 * ADR 0006) are not built here: they live in `eventCommonFields.js`, in a pure function
 * (`buildCommonEventFields`) reusable by any event screen, and `buildInsulinContent` receives them
 * already built to spread them at the top level of the content, next to `v`, `type` and `tz`,
 * never inside `data`.
 *
 * **The form does not ask for the origin of the datum.** `origin` tells apart how the datum
 * entered the application: typed by a person (`manual`) versus imported automatically from a
 * device (`device`). Today there is no device integration on this screen, so the entry is always
 * manual and asking has no real answer; the field still travels in the encrypted content because
 * ADR 0006 demands it and it cannot be recovered later over already encrypted data, but here it is
 * fixed to `manual` without showing any `<select>` — it is the default value of
 * `buildCommonEventFields` when no `origin` is passed. The day an automatic import from a device
 * exists (say a connected pen or pump), that will be the one passing `device` explicitly. The
 * device field (`device`), on the other hand, is asked for: it is useful even with manual entry,
 * to note which pen or pump the dose was given with.
 *
 * **The event date is not converted here.** `datetimeLocalToCanonical` lives in `datetimeLocal.js`
 * because what it returns enters as AEAD associated data (ADR 0004): if each screen carried its
 * own copy and one drifted, its envelopes would stop opening.
 *
 * The functions exported before `insulinPage()` are the pure logic of the component, so they can
 * be tested without mounting Alpine or Chart.js (`tests/js/insulinPage.test.mjs`).
 */

import Chart from 'chart.js/auto';

import { isUnlocked, ownerId } from '../auth/keyring.js';
import { SESSION_READY_EVENT } from '../auth/sessionBootstrap.js';
import { EnvelopeError } from '../crypto/envelope.js';
import { formatChartDay, formatDateTime, t } from '../i18n/index.js';
import { legendElementFor, legendItems, renderLegend } from './chartLegend.js';
import { chartColors, observeThemeChange } from './chartTheme.js';
import { enumerateDays, eventDayKey, MAX_CHART_DAYS } from './dailyBands.js';
import { dateRangeControl } from './dateRange.js';
import { datetimeLocalToCanonical } from './datetimeLocal.js';
import { buildCommonEventFields } from './eventCommonFields.js';
import { openEvent, sealEvent } from './eventEnvelope.js';
import { parseNumericValue } from './numericValue.js';
import { savedNotice } from './savedNotice.js';

/** UCUM code of the international insulin unit (ADR 0005): `Insulin::UNIT_INTERNATIONAL_UNIT`. */
export const INSULIN_UNIT = '[iU]';

/**
 * Builds the content in the clear of an insulin event, with the shape of ADR 0006. The dose
 * travels as a string, never as a number (ADR 0004: decimals as a string), and the event carries
 * no LOINC code because it is a medication administration, not an observation.
 *
 * `common` are the four fields any event type shares (origin, device, who records, note: see
 * `eventCommonFields.js`) and they go at the top level of the content, not inside `data`. `product`
 * (brand name, free text) and `site` (injection site) belong to insulin and are optional: if they
 * are not given (empty string or absent), they do not enter `data` at all, instead of being stored
 * as an empty string (same criterion as `mealContext` in
 * `glucosePage.js`).
 *
 * @param {object} params
 * @param {string} params.dose Exactly as the person typed it, already as a string (e.g. "0.5").
 * @param {string} params.insulinType `App\Catalog\InsulinType` token.
 * @param {string} [params.product] Brand name as free text, or empty/absent.
 * @param {string} [params.site] `App\Catalog\InjectionSite` token, or empty/absent.
 * @param {string} params.tz `±HH:MM` offset of the moment of recording.
 * @param {{origin: string, recordedBy: string, device?: string, note?: string}} params.common
 *        Already built by `buildCommonEventFields`.
 * @returns {{v: 1, type: 'insulin', tz: string, origin: string, recordedBy: string, device?: string,
 *           note?: string, data: {insulinType: string, dose: string, unit: string, product?: string,
 *           site?: string}}}
 * @throws {Error} If the dose or the insulin type is missing.
 */
export function buildInsulinContent({ dose, insulinType, product, site, tz, common }) {
    if (typeof dose !== 'string' || dose.trim() === '') {
        throw new Error(t('insulin.missingDose'));
    }

    if (typeof insulinType !== 'string' || insulinType.trim() === '') {
        throw new Error(t('insulin.missingInsulinType'));
    }

    const data = { insulinType, dose, unit: INSULIN_UNIT };

    if (typeof product === 'string' && product.trim() !== '') {
        data.product = product.trim();
    }

    if (typeof site === 'string' && site.trim() !== '') {
        data.site = site;
    }

    return {
        v: 1,
        type: 'insulin',
        tz,
        ...common,
        data,
    };
}

/**
 * Resolves the injection site label of an already decrypted event, tolerating that the field does
 * not exist (optional, left out of the content when not given).
 *
 * @param {{injectionSites: list<{token: string, label: string}>}} catalog
 * @param {{site?: string}} data
 * @returns {string|null} `null` when the event brings no site.
 */
export function injectionSiteLabel(catalog, data) {
    if (typeof data.site !== 'string' || data.site === '') {
        return null;
    }

    return catalog.injectionSites.find((row) => row.token === data.site)?.label ?? data.site;
}

/**
 * Resolves the product label of an already decrypted event, tolerating that the field does not
 * exist (optional free text, ADR 0006).
 *
 * @param {{product?: string}} data
 * @returns {string|null} `null` when the event brings no product.
 */
export function productLabel(data) {
    if (typeof data.product !== 'string' || data.product === '') {
        return null;
    }

    return data.product;
}

/**
 * Discards the decrypted events that are not of type `insulin`. The server cannot do this filter
 * because the type travels encrypted inside the envelope (ADR 0006): it is the client's job.
 *
 * @param {list<{id: string, occurredAt: string, content: object}>} events Already decrypted.
 * @returns {list<{id: string, occurredAt: string, content: object}>}
 */
export function filterInsulinEvents(events) {
    return events.filter((event) => event.content?.type === 'insulin');
}

/**
 * Groups insulin events by local calendar day and type, adding up the dose of the day (decimal
 * doses added with string precision, see `sumDoses`), for the bar chart.
 *
 * A dose is not a continuous quantity like glucose: there is no value "between" two injections, so
 * a line chart has no place here (it would suggest continuity where there is none). It is grouped
 * by day and insulin type instead of drawing each injection, because what is clinically relevant
 * is the total daily dose of each type, not the isolated reading of one injection.
 *
 * **The axis covers every calendar day of the stretch, not only the days with injections**
 * ({@see enumerateDays}, the same the dashboard band chart uses). With one bar per day with data,
 * injections on the 1st, the 2nd and the 20th came out as three touching bars: an eighteen-day
 * break in the therapy was drawn exactly like three consecutive days, and adherence —which is the
 * most important thing this chart could say— was invisible.
 *
 * **A day with no injection is a gap (`null`), never a zero.** A zero here is a reading, and a
 * false one: "that day the dose was nil" is a clinical statement, and what is actually known is
 * that nothing was written down. Inside a day that does have records the zero is right, and it
 * stays: a type not injected that day really did add up to nothing.
 *
 * @param {list<{id: string, occurredAt: string, content: object}>} insulinEvents Already filtered
 *        by `filterInsulinEvents`.
 * @returns {{days: list<string>, totalsByType: Record<string, list<number|null>>, omittedDays: number}}
 *          `days` are `YYYY-MM-DD` keys in ascending order, with no holes;
 *          `totalsByType[insulinType][i]` is the total dose of that type on `days[i]`, 0 if that
 *          day had records of another type and `null` if it had none at all.
 */
export function groupInsulinByDay(insulinEvents) {
    /** @type {Map<string, Map<string, number>>} */
    const byDay = new Map();

    for (const event of insulinEvents) {
        const { data } = event.content;
        const day = eventDayKey(event.occurredAt, event.content.tz);

        /** An unreadable instant has no day to be attributed to, and would break the stretch. */
        if (day === '') {
            continue;
        }

        if (!byDay.has(day)) {
            byDay.set(day, new Map());
        }

        const byType = byDay.get(day);
        const previous = byType.get(data.insulinType) ?? 0;
        byType.set(data.insulinType, sumDoses(previous, data.dose));
    }

    if (byDay.size === 0) {
        return { days: [], totalsByType: {}, omittedDays: 0 };
    }

    const observed = [...byDay.keys()].sort();
    const spanned = enumerateDays(observed[0], observed[observed.length - 1]);
    /** The same cap as the dashboard, and for the same reason: the most recent days are kept. */
    const days = spanned.slice(-MAX_CHART_DAYS);
    const types = [...new Set(observed.flatMap((day) => [...byDay.get(day).keys()]))].sort();

    /** @type {Record<string, list<number|null>>} */
    const totalsByType = {};

    for (const type of types) {
        totalsByType[type] = days.map((day) => (byDay.has(day) ? (byDay.get(day).get(type) ?? 0) : null));
    }

    return { days, totalsByType, omittedDays: spanned.length - days.length };
}

/**
 * Text of the chart caption: which insulin types go in, how many days it covers and how much dose
 * each type adds up to.
 *
 * It is not decoration. The chart is a graphical object with no text, so colour cannot be the only
 * carrier of the information (DESIGN.md § Do's #3): whoever does not tell the shades apart —or
 * uses a screen reader, or sees the screen in black and white— reads here the same as the bars
 * say. And when there is no record yet —the case of any new user— it says what will appear here,
 * instead of leaving a card with a blank canvas that looks like a bug.
 *
 * The count it states is of **days with records**, not of days on the axis: since the axis covers
 * the whole stretch (see {@see groupInsulinByDay}), the two stopped being the same number, and
 * saying "20 days with records" over three bars would be false.
 *
 * @param {list<string>} days `YYYY-MM-DD` keys, exactly as `groupInsulinByDay` returns them.
 * @param {Record<string, list<number|null>>} totalsByType Dose per type and day; `null` on the days
 *        with no record at all.
 * @param {(type: string) => string} labelFor Label of an insulin type token, in the active
 *        language (it comes from the server catalog).
 * @param {number} [omittedDays] Older days of the stretch left out of the chart. A silent clip
 *        would read as "there was nothing before", which is the very mistake this chart avoids.
 * @returns {string}
 */
export function summarizeDailyDoses(days, totalsByType, labelFor, omittedDays = 0) {
    if (days.length === 0) {
        return t('insulin.chartEmpty');
    }

    const recordedDays = days.filter(
        (day, index) => Object.values(totalsByType).some((doses) => doses[index] !== null),
    ).length;

    const totals = Object.entries(totalsByType)
        .map(([type, doses]) => {
            const total = doses.reduce(
                (accumulated, dose) => Math.round((accumulated + (dose ?? 0)) * 1000) / 1000,
                0,
            );

            return `${labelFor(type)}: ${total} ${INSULIN_UNIT}`;
        })
        .join('; ');

    const caption = t('insulin.caption', { count: recordedDays, totals });

    return omittedDays === 0 ? caption : `${caption} ${t('insulin.omittedDays', { count: omittedDays })}`;
}

/**
 * Adds two doses, tolerating that the JavaScript decimal representation is not exact: it rounds to
 * three decimals, more than enough for insulin doses (half a unit is the finest case in clinical
 * practice) and it keeps the sum from accumulating floating point noise visible in the chart.
 *
 * @param {number} accumulated
 * @param {string} dose
 * @returns {number}
 */
function sumDoses(accumulated, dose) {
    return Math.round((accumulated + Number(dose)) * 1000) / 1000;
}

/**
 * The day of an event comes from `health/dailyBands.js` ({@see eventDayKey}) and not from a local
 * copy: the rule —the day is the one of the zone the event was recorded in, which travels in `tz`
 * (ADR 0006), never that of the device looking— is the same the band chart of the home dashboard
 * needs, and two implementations would end up attributing a 23:30 injection to different days on
 * two screens of the same application.
 */

/** @returns {string} Right now, in the shape an `<input type="datetime-local" step="1">` expects. */
function nowAsDatetimeLocalValue() {
    return toDatetimeLocalValue(new Date());
}

/**
 * @param {Date} date
 * @returns {string}
 */
function toDatetimeLocalValue(date) {
    const pad = (value) => String(value).padStart(2, '0');

    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
        + `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/**
 * Order in which the insulin types take the series of `chartColors()` (§ Components · Charts,
 * "Series, in order"). The order is fixed and does not depend on which types the history brings:
 * that way the same type keeps its colour even if one day there are no records of another.
 */
const CHART_SERIES_BY_TYPE = Object.freeze({ rapid: 0, long: 1, mixed: 2 });

/**
 * Marker of each legend entry, in the order the insulin types appear. It is the second encoding
 * Do's #3 demands when colour is not enough: on a black and white screen, or printed, the series
 * are told apart by shape.
 */
const CHART_LEGEND_SHAPES = Object.freeze(['rect', 'circle', 'triangle']);

const CHART_FONTS = Object.freeze({
    body: "'Open Sans', ui-sans-serif, system-ui, sans-serif",
    mono: "'IBM Plex Mono', ui-monospace, monospace",
});

/** Heroicons v2 paths (outline, 24×24): the dropper of `Insulin::$navigationIcon`. */
const ICON_PATHS = Object.freeze({
    warning: 'M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 '
        + '1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z',
    info: 'm11.25 11.25.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 '
        + '12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z',
    drop: 'M12 3.75a.75.75 0 0 1 .671.415l4.5 9a.75.75 0 0 1 .079.335 5.25 5.25 0 1 1-10.5 0 .75.75 0 0 1 '
        + '.08-.335l4.5-9A.75.75 0 0 1 12 3.75Z',
});

/**
 * Decorative 20px icon (DESIGN.md § Lists). It goes with `aria-hidden`: it never carries
 * information that is not also in the text (Do's #3).
 *
 * @param {'warning'|'info'|'drop'} name
 * @param {string} className
 * @returns {SVGSVGElement}
 */
function createIcon(name, className) {
    const namespace = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(namespace, 'svg');

    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.5');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('class', className);

    const path = document.createElementNS(namespace, 'path');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    path.setAttribute('d', ICON_PATHS[name]);
    svg.appendChild(path);

    return svg;
}

/**
 * Block notice with an icon (DESIGN.md § Chips): colour + icon + text, never colour alone.
 *
 * @param {object} params
 * @param {'error'|'info'} params.tone
 * @param {string} params.message
 * @returns {HTMLDivElement}
 */
function createCallout({ tone, message }) {
    const callout = document.createElement('div');

    /**
     * The two tones come from the notice tokens (`error-*` / `info-*`, see `theme.css`), not from
     * the `danger-*`/`primary-*` ramp: the tokens already carry inside the § Chips pair corrected
     * to AA and its § Dark Mode equivalent, while a fixed `bg-danger-50` stays an almost white
     * rectangle in dark theme. Same tokens as `glucosePage.js`.
     */
    callout.className = tone === 'error'
        ? 'flex items-start gap-3 rounded-control border border-error-outline bg-error-surface p-pad-md '
            + 'text-body text-error-ink shadow-large'
        : 'flex items-start gap-3 rounded-control border border-info-outline bg-info-surface p-pad-md '
            + 'text-body-lg text-info-ink';

    if (tone === 'error') {
        callout.setAttribute('role', 'alert');
    }

    callout.appendChild(createIcon(tone === 'error' ? 'warning' : 'info', 'size-5 shrink-0'));

    const text = document.createElement('p');
    text.textContent = message;
    callout.appendChild(text);

    return callout;
}

/**
 * Status chip (DESIGN.md § Chips · Status Chip), for the insulin type: it is the most important
 * thing to tell apart at a glance, like the measurement method in `glucosePage.js`.
 *
 * @param {string} label
 * @returns {HTMLSpanElement}
 */
function createStatusChip(label) {
    const chip = document.createElement('span');
    chip.className = 'inline-flex items-center rounded-chip border border-info-outline bg-info-surface '
        + 'px-3 py-1 text-status-chip uppercase text-info-ink';
    chip.textContent = label;

    return chip;
}

/**
 * Filter chip (DESIGN.md § Chips · Filter Chip), for the injection site: it is not a clinical
 * state but a circumstance of the dose.
 *
 * @param {string} label
 * @returns {HTMLSpanElement}
 */
function createFilterChip(label) {
    const chip = document.createElement('span');
    chip.className = 'inline-flex items-center rounded-full border border-chip-outline bg-chip-surface '
        + 'px-3.5 py-1.5 text-helper font-semibold text-chip-ink';
    chip.textContent = label;

    return chip;
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

    return t('common.saveFailed');
}

/**
 * History page size. It is the same value as the default `$limit` of
 * `HealthEventPage::fetchEvents()`: the arguments are positional, so passing the range forces
 * passing the cursor and the limit too, and the usual value is repeated here so as not to change
 * in passing how many events come down on each load.
 */
const HISTORY_FETCH_LIMIT = 100;

/**
 * Alpine component factory. Registered as `phrInsulinPage`.
 *
 * @returns {object}
 */
export function insulinPage() {
    return {
        ...savedNotice(),
        ...dateRangeControl(),

        error: '',
        catalog: null,
        loading: false,

        /** Decrypted envelopes that failed to open on the last load (they do not take the screen down). */
        failedToOpenCount: 0,

        /** Live Chart.js instance, so it can be destroyed before repainting. */
        chart: null,

        /**
         * Last events that were painted. It is not a data cache: it is what lets the chart be
         * rebuilt when the theme changes without asking for or decrypting anything again (`chartTheme.js`).
         */
        chartEvents: [],

        init() {
            this.catalog = JSON.parse(document.querySelector('[data-phr-insulin-catalog]').textContent);

            /**
             * DESIGN.md § Charts — Dark: the chart has to re-read the colours and repaint when
             * `<html>` enters or leaves dark mode, or the whole panel switches except the charts.
             */
            observeThemeChange(() => {
                if (this.chart !== null) {
                    this.renderChart(this.chartEvents);
                }
            });

            this.$refs.occurredAt.value = nowAsDatetimeLocalValue();

            if (isUnlocked()) {
                void this.loadHistory();

                return;
            }

            this.renderLocked();
            document.addEventListener(SESSION_READY_EVENT, () => void this.loadHistory(), { once: true });
        },

        /**
         * Saves the record.
         *
         * `loading` covers the WHOLE operation, not just the history download: between the click and
         * the repaint there is key derivation, AEAD sealing and a round trip to Livewire, and with
         * no signal at all the person presses the button again —and on this screen pressing twice
         * saves two doses—. The template uses it to disable the button, set `aria-busy` and change
         * the text (Do's #3), like the glucose screen.
         *
         * @param {SubmitEvent} [event]
         */
        async submit() {
            this.error = '';
            this.clearSaved();
            this.loading = true;

            try {
                const userId = ownerId();

                if (!isUnlocked() || userId === null) {
                    throw new Error(t('common.noSession'));
                }

                const rawDose = this.$refs.dose.value.trim();

                if (rawDose === '') {
                    throw new Error(t('insulin.missingDose'));
                }

                /**
                 * The dose goes through the same validation as any other clinical value: at most
                 * two decimals and the separator normalized to a dot before encrypting. It is the
                 * field where a reading error does the most damage in the whole application, because
                 * a badly written dose is a badly given dose, and once the envelope is sealed it can no longer be corrected.
                 */
                const dose = parseNumericValue(rawDose, t('field.dose'));

                const insulinType = this.$refs.insulinType.value;

                if (insulinType === '') {
                    throw new Error(t('insulin.missingInsulinType'));
                }

                const localDatetime = this.$refs.occurredAt.value;

                if (localDatetime === '') {
                    throw new Error(t('common.missingDate'));
                }

                const { occurredAt, tz } = datetimeLocalToCanonical(localDatetime);

                /**
                 * No `origin`: there is no data-origin `<select>` in the form (see the module
                 * JSDoc), so `buildCommonEventFields` applies its default value, `manual`, which is
                 * the only possible entry today.
                 */
                const common = buildCommonEventFields({
                    device: this.$refs.device.value,
                    recordedBy: this.$refs.recordedBy.value,
                    note: this.$refs.note.value,
                });

                const content = buildInsulinContent({
                    dose,
                    insulinType,
                    product: this.$refs.product.value,
                    site: this.$refs.site.value,
                    tz,
                    common,
                });

                const payload = sealEvent({ userId, occurredAt, content });

                /** `HealthEventPage` action, shared by any event screen (ADR 0006). */
                await this.$wire.storeEvent(payload, occurredAt);

                this.$refs.dose.value = '';

                await this.loadHistory();

                /** At the very end: the notice confirms the whole operation, not just the POST. */
                this.confirmSaved();
            } catch (failure) {
                this.error = describeError(failure);
            } finally {
                this.loading = false;
            }
        },

        /** Downloads, decrypts, filters and paints the history (list and chart). */
        async loadHistory() {
            this.loading = true;

            try {
                const userId = ownerId();

                if (!isUnlocked() || userId === null) {
                    this.renderLocked();

                    return;
                }

                /**
                 * The range is applied by the server: `occurred_at` is a column in the clear (ADR
                 * 0006) and narrowing it saves downloading and decrypting months of events of other
                 * types this module would throw away anyway. The type is still discarded here,
                 * which is what the server cannot do.
                 */
                const range = this.historyRange();
                const rawEvents = await this.$wire.fetchEvents(null, HISTORY_FETCH_LIMIT, range.from, range.to);

                let failedToOpen = 0;
                const opened = [];

                for (const rawEvent of rawEvents) {
                    try {
                        const content = openEvent({
                            userId,
                            occurredAt: rawEvent.occurredAt,
                            envelope: rawEvent.payload,
                        });

                        opened.push({ id: rawEvent.id, occurredAt: rawEvent.occurredAt, content });
                    } catch {
                        /** An envelope that does not open does not take the screen down (ADR 0004): it is counted and reported. */
                        failedToOpen += 1;
                    }
                }

                this.failedToOpenCount = failedToOpen;

                const insulinEvents = filterInsulinEvents(opened);

                this.renderList(insulinEvents);
                this.renderChart(insulinEvents);
            } catch (failure) {
                this.error = describeError(failure);
            } finally {
                this.loading = false;
            }
        },

        /**
         * With no key nothing can be decrypted: it is said, no empty list is painted.
         *
         * Losing the key in memory is normal and frequent (ADR 0003), so this state has to leave
         * the whole screen coherent: besides the notice in the list, the previous chart (if there
         * was one) is thrown away and its caption explains it. A chart with the bars of the
         * previous session next to a "you need to sign in" is a contradiction in plain sight.
         */
        renderLocked() {
            this.failedToOpenCount = 0;
            this.chartEvents = [];
            this.$refs.list.replaceChildren(createCallout({ tone: 'info', message: t('common.locked.history') }));
            this.destroyChart();
            this.paintLegend([]);
            this.$refs.chartCaption.textContent = t('insulin.chartLocked');
        },

        /** Destroys the live Chart.js instance, if there is one. Repainting without destroying duplicates it. */
        destroyChart() {
            if (this.chart !== null) {
                this.chart.destroy();
                this.chart = null;
            }
        },

        /** @param {list<{id: string, occurredAt: string, content: object}>} insulinEvents */
        renderList(insulinEvents) {
            const fragment = document.createDocumentFragment();

            if (this.failedToOpenCount > 0) {
                const warning = createCallout({
                    tone: 'error',
                    message: t('common.recordsUndecrypted', { count: this.failedToOpenCount }),
                });
                warning.classList.add('mb-4');
                fragment.appendChild(warning);
            }

            if (insulinEvents.length === 0) {
                const empty = document.createElement('p');
                empty.className = 'text-body text-ink-secondary';
                empty.textContent = t('insulin.empty');
                fragment.appendChild(empty);
            } else {
                const list = document.createElement('ul');
                list.className = 'flex flex-col';

                /** Most recent first, as it comes from `fetchEvents` (descending order from the server). */
                for (const event of insulinEvents) {
                    list.appendChild(this.renderListItem(event));
                }

                fragment.appendChild(list);
            }

            this.$refs.list.replaceChildren(fragment);
        },

        /**
         * History item with the shape of DESIGN.md § Lists. The dose is the highest-risk datum of
         * this screen (a misread dose is a misgiven dose): it goes in `font-mono`, `text-body-lg`
         * and the main text `#0F172A`, never in a dull grey, so it is the first and most legible
         * thing in the row.
         *
         * @param {{id: string, occurredAt: string, content: object}} event
         * @returns {HTMLLIElement}
         */
        renderListItem(event) {
            const { data } = event.content;

            /**
             * No `hover:` and no `active:`: DESIGN.md § Lists reserves those two states for a
             * pressable list element, and this is neither link nor button —it has no destination,
             * no handler and no focus—. Promising an interaction that does not happen is worse than
             * not promising it. Same criterion as `glucosePage.js`.
             */
            const item = document.createElement('li');
            item.className = 'flex min-h-12 items-start gap-4 border-b border-border px-4 py-3.5 last:border-b-0';

            item.appendChild(createIcon('drop', 'mt-0.5 size-5 shrink-0 text-accent'));

            const body = document.createElement('div');
            body.className = 'flex flex-1 flex-col gap-2';

            /** First line: the dose. Monospace, large and in the main text. */
            const dose = document.createElement('p');
            dose.className = 'font-mono text-body-lg text-ink';

            /**
             * No `font-bold`: only weight 400 of IBM Plex Mono is bundled (§ Typography · Code
             * defines it as "regular"), so asking for 700 would make the browser synthesize a fake
             * bold, fattening and deforming exactly the numeric glyphs Do's #7 wants unmistakable
             * —and here the deformed glyph would be a dose—. The dose stands out by being first in
             * the row, going in the largest size of the list and carrying the main ink, against the
             * secondary grey of the unit.
             */
            const doseValue = document.createElement('span');
            doseValue.textContent = data.dose;
            dose.appendChild(doseValue);

            const doseUnit = document.createElement('span');
            doseUnit.className = 'ml-1 text-ink-secondary';
            doseUnit.textContent = data.unit;
            dose.appendChild(doseUnit);

            body.appendChild(dose);

            const typeLabel = this.catalog.insulinTypes.find((row) => row.token === data.insulinType)?.label
                ?? data.insulinType;
            const siteLabel = injectionSiteLabel(this.catalog, data);
            const product = productLabel(data);

            const chips = document.createElement('div');
            chips.className = 'flex flex-wrap items-center gap-2';
            chips.appendChild(createStatusChip(typeLabel));

            /** With no injection site (optional): no chip is shown in its place. */
            if (siteLabel !== null) {
                chips.appendChild(createFilterChip(siteLabel));
            }

            body.appendChild(chips);

            /** Secondary text: timestamp and, if there is one, the product as free text. */
            const meta = document.createElement('p');
            /** Code size of § Typography, the role of "medical codes, IDs, data fields". */
            meta.className = 'font-mono text-code text-ink-secondary';
            meta.textContent = product !== null
                ? `${formatDateTime(event.occurredAt)} · ${product}`
                : formatDateTime(event.occurredAt);
            body.appendChild(meta);

            item.appendChild(body);

            return item;
        },

        /**
         * Paints the bar chart of daily dose per insulin type, or paints nothing if there is no
         * data. It is bars and not lines on purpose: a dose is not a continuous quantity like
         * glucose, and a line would suggest there is a value between two injections that does not
         * exist (see the JSDoc of `groupInsulinByDay`).
         *
         * @param {list<{id: string, occurredAt: string, content: object}>} insulinEvents
         */
        renderChart(insulinEvents) {
            /** They are stored so the chart can be repainted on theme switch (see `init()` and `chartTheme.js`). */
            this.chartEvents = insulinEvents;

            /** Colours of the active theme, read now and not when the module loaded (`chartTheme.js`). */
            const colors = chartColors();

            const { days, totalsByType, omittedDays } = groupInsulinByDay(insulinEvents);

            this.destroyChart();
            this.renderChartCaption(days, totalsByType, omittedDays);

            if (days.length === 0) {
                this.paintLegend([]);

                return;
            }

            const labels = days.map((day) => formatChartDay(`${day}T00:00:00`));
            const types = Object.keys(totalsByType);

            /**
             * In the legend each type also carries its own marker —square, circle, triangle—, which
             * is the second encoding Do's #3 asks for. The bars cannot carry that marker (a bar is
             * a rectangle), so whoever reads the chart without telling the shades apart still leans
             * on the caption, which states in text the accumulated dose of each type.
             */
            const series = types.map((type, index) => ({
                label: this.catalog.insulinTypes.find((row) => row.token === type)?.label ?? type,
                color: colors.series[CHART_SERIES_BY_TYPE[type] ?? index % colors.series.length],
                pointStyle: CHART_LEGEND_SHAPES[index % CHART_LEGEND_SHAPES.length],
            }));

            this.paintLegend(series);

            const datasets = series.map((entry, index) => ({
                label: entry.label,
                data: totalsByType[types[index]],
                backgroundColor: entry.color,
                borderColor: entry.color,
                borderRadius: 4,
            }));

            this.chart = new Chart(this.$refs.chart, {
                type: 'bar',
                data: { labels, datasets },
                options: {
                    maintainAspectRatio: false,
                    color: colors.tick,
                    scales: {
                        x: {
                            /**
                             * A category axis, and here that is not the same mistake as on the
                             * charts of readings: one category is one calendar day and every day of
                             * the stretch is there (`groupInsulinByDay`), so equal widths already
                             * are proportional to time and an eighteen-day break comes out eighteen
                             * bars wide. Going linear would only mean guessing the width of a bar.
                             *
                             * `autoSkip` is left as it comes: with 180 days Chart.js writes the
                             * labels that fit and drops the rest, instead of piling them up.
                             */
                            stacked: false,
                            grid: { display: false },
                            border: { color: colors.grid },
                            ticks: {
                                color: colors.tick,
                                font: { family: CHART_FONTS.mono, size: 12 },
                                maxRotation: 0,
                            },
                        },
                        y: {
                            beginAtZero: true,
                            grid: { color: colors.grid },
                            border: { color: colors.grid },
                            ticks: { color: colors.tick, font: { family: CHART_FONTS.mono, size: 12 } },
                            title: {
                                display: true,
                                text: t('insulin.yAxisTitle', { unit: INSULIN_UNIT }),
                                color: colors.tick,
                                font: { family: CHART_FONTS.mono, size: 13, weight: 600 },
                            },
                        },
                    },
                    plugins: {
                        /**
                         * The legend lives outside the canvas, in HTML (see `chartLegend.js`):
                         * inside it reserved height of the 320px container and, with a fixed
                         * `pointStyle: 'circle'`, its three entries were told apart by colour alone.
                         */
                        legend: { display: false },
                        /**
                         * The background/ink pair comes from the theme: the tooltip is the only
                         * component that inverts against the interface (§ Charts — Dark).
                         */
                        tooltip: {
                            backgroundColor: colors.tooltipSurface,
                            titleColor: colors.tooltipInk,
                            bodyColor: colors.tooltipInk,
                            cornerRadius: 8,
                            padding: { top: 8, bottom: 8, left: 14, right: 14 },
                            titleFont: { family: CHART_FONTS.body, size: 13, weight: 500 },
                            bodyFont: { family: CHART_FONTS.mono, size: 13 },
                        },
                    },
                },
            });
        },

        /**
         * Paints the legend in HTML, outside the canvas (see the JSDoc of `chartLegend.js`).
         *
         * @param {list<{label: string, color: string, pointStyle: string}>} series
         */
        paintLegend(series) {
            renderLegend(
                legendElementFor(this.$refs.chart, 'insulin-chart-legend'),
                legendItems(series),
            );
        },

        /**
         * Writes the chart caption, which is the accessible name of what the bars paint (see
         * `summarizeDailyDoses`).
         *
         * @param {list<string>} days
         * @param {Record<string, list<number|null>>} totalsByType
         * @param {number} [omittedDays]
         */
        renderChartCaption(days, totalsByType, omittedDays = 0) {
            this.$refs.chartCaption.textContent = summarizeDailyDoses(
                days,
                totalsByType,
                (type) => this.catalog.insulinTypes.find((row) => row.token === type)?.label ?? type,
                omittedDays,
            );
        },
    };
}
