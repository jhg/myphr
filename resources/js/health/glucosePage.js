/**
 * Alpine component of the glucose screen (ADR 0002, ADR 0004, ADR 0005, ADR 0006, ADR 0008).
 *
 * The DOM contract is fixed by `resources/views/phr/pages/glucose.blade.php`: no `wire:model`
 * (ADR 0002), the fields are read through `x-ref` and the encrypted envelope goes up as an
 * argument of `storeEvent`, never as a Livewire property.
 *
 * **The server cannot filter by type** (ADR 0006, see the JSDoc of `Glucose::fetchEvents()`):
 * `fetchEvents` brings every event of the user and here each one is decrypted and whatever is not
 * `type === 'glucose'` is discarded. An envelope that does not open does not take the screen down:
 * it is counted and reported, because a silent decryption failure is exactly what ADR 0004 forbids.
 *
 * **The measurement method is never mixed in silence** (ADR 0008): the chart draws one series per
 * method and the chart caption always says which ones it includes.
 *
 * **Nothing is converted between mg/dL and mmol/L.** The unit is a display preference (ADR 0006,
 * "the unit of measure is a user preference"), not a requirement of the event: each record carries
 * its own. Converting to mix them into a single series would require fixing precision and rounding
 * (ADR 0007, "precision and rounding have to be fixed instead of left to chance"), which this
 * version does not tackle; events in another unit are left out of the chart and counted in the caption.
 *
 * **The four fields common to every event** (manual/device origin, device, who records, free note;
 * ADR 0006) are not built here: they live in `eventCommonFields.js`, in a pure function
 * (`buildCommonEventFields`) reusable by any event screen (blood pressure, meals, insulin), and
 * `buildGlucoseContent` receives them already built to spread them at the top level of the content,
 * next to `v`, `type` and `tz`, never inside `data`.
 *
 * **The event date is not converted here.** `datetimeLocalToCanonical` lives in `datetimeLocal.js`
 * because what it returns enters as AEAD associated data (ADR 0004): if each screen carried its
 * own copy and one drifted, its envelopes would stop opening.
 *
 * The functions exported before `glucosePage()` are the pure logic of the component, so they can
 * be tested without mounting Alpine or Chart.js (`tests/js/glucosePage.test.mjs`).
 */

import Chart from 'chart.js/auto';

import { isUnlocked, ownerId } from '../auth/keyring.js';
import { SESSION_READY_EVENT } from '../auth/sessionBootstrap.js';
import { settings } from '../auth/settings.js';
import { EnvelopeError } from '../crypto/envelope.js';
import { formatDateTime, joinList, t } from '../i18n/index.js';
import { legendElementFor, legendItems, renderLegend } from './chartLegend.js';
import { chartColors, observeThemeChange } from './chartTheme.js';
import { eventWallClockMs } from './dailyBands.js';
import { dateRangeControl } from './dateRange.js';
import { datetimeLocalToCanonical } from './datetimeLocal.js';
import { buildCommonEventFields } from './eventCommonFields.js';
import { openEvent, sealEvent } from './eventEnvelope.js';
import { MAX_READING_GAP_MS } from './glucoseContext.js';
import { parseNumericValue } from './numericValue.js';
import { savedNotice } from './savedNotice.js';
import { chartTimeFormat, splitOnGaps, timeAxisBounds, timeAxisScale, timeAxisTooltipTitle } from './timeAxis.js';

/** Default unit when there is no preference saved in the user settings (ADR 0006). */
const DEFAULT_UNIT = 'mg/dL';

/**
 * Resolves the LOINC code of (method, unit) against the table of the server catalog (ADR 0005,
 * ADR 0008). It never invents one: if the combination is missing, it fails visibly.
 *
 * @param {list<{method: string, unit: string, code: string}>} loincTable
 * @param {string} method
 * @param {string} unit
 * @returns {string}
 * @throws {Error} If there is no code for that combination.
 */
export function resolveLoincCode(loincTable, method, unit) {
    const entry = loincTable.find((row) => row.method === method && row.unit === unit);

    if (entry === undefined) {
        throw new Error(t('common.noLoincCode', { method, unit }));
    }

    return entry.code;
}

/**
 * Builds the content in the clear of a glucose event, with the shape of ADR 0006 plus the method
 * of ADR 0008. The value travels as a string, never as a number (ADR 0004: decimals as a
 * string).
 *
 * `common` are the four fields any event type shares (origin, device, who records, note: see
 * `eventCommonFields.js`) and they go at the top level of the content, not inside `data`.
 * `mealContext` belongs to glucose and is optional: if it is not given (empty string or absent),
 * it does not enter `data` at all, instead of being stored as an empty string (ADR 0006, "a
 * dropdown that already comes with 'fasting' written turns an oversight into a false datum").
 *
 * @param {object} params
 * @param {string} params.value Exactly as the person typed it, already as a string.
 * @param {string} params.unit UCUM code.
 * @param {string} params.method `GlucoseMeasurementMethod` token.
 * @param {string} [params.mealContext] `MealContext` token, or empty/absent for "unspecified".
 * @param {string} params.tz `±HH:MM` offset of the moment of recording.
 * @param {list<{method: string, unit: string, code: string}>} params.loincTable
 * @param {{origin: string, recordedBy: string, device?: string, note?: string}} params.common
 *        Already built by `buildCommonEventFields`.
 * @returns {{v: 1, type: 'glucose', tz: string, origin: string, recordedBy: string, device?: string,
 *           note?: string, data: {value: string, unit: string, loinc: string, method: string, mealContext?: string}}}
 * @throws {Error} If the value is missing or there is no LOINC code for (method, unit).
 */
export function buildGlucoseContent({ value, unit, method, mealContext, tz, loincTable, common }) {
    if (typeof value !== 'string' || value.trim() === '') {
        throw new Error(t('glucose.missingValue'));
    }

    const loinc = resolveLoincCode(loincTable, method, unit);

    const data = { value, unit, loinc, method };

    if (typeof mealContext === 'string' && mealContext.trim() !== '') {
        data.mealContext = mealContext;
    }

    return {
        v: 1,
        type: 'glucose',
        tz,
        ...common,
        data,
    };
}

/**
 * Resolves the meal context label of an already decrypted event, tolerating that the field does
 * not exist (ADR 0006: the context is optional and left out of the content when not given).
 *
 * @param {{mealContexts: list<{token: string, label: string}>}} catalog
 * @param {{mealContext?: string}} data
 * @returns {string|null} `null` when the event brings no context.
 */
export function mealContextLabel(catalog, data) {
    if (typeof data.mealContext !== 'string' || data.mealContext === '') {
        return null;
    }

    return catalog.mealContexts.find((row) => row.token === data.mealContext)?.label ?? data.mealContext;
}

/**
 * Discards the decrypted events that are not of type `glucose`. The server cannot do this filter
 * because the type travels encrypted inside the envelope (ADR 0006): it is the client's job.
 *
 * @param {list<{id: string, occurredAt: string, content: object}>} events Already decrypted.
 * @returns {list<{id: string, occurredAt: string, content: object}>}
 */
export function filterGlucoseEvents(events) {
    return events.filter((event) => event.content?.type === 'glucose');
}

/**
 * Groups glucose events by measurement method for the chart (ADR 0008: "statistics do not mix
 * methods in silence"), and leaves out the ones that are not in the display unit (nothing is
 * converted between mg/dL and mmol/L, see the module JSDoc).
 *
 * The `x` of each point is the wall clock time of whoever measured ({@see eventWallClockMs}), not
 * the absolute instant: a reading taken before dinner at 21:00 stays at 21:00 when the chart is
 * opened from another time zone, which is the same rule the home dashboard follows.
 *
 * @param {list<{id: string, occurredAt: string, content: object}>} glucoseEvents Already filtered
 *        by `filterGlucoseEvents`.
 * @param {string} presentationUnit Unit being displayed (UCUM code).
 * @returns {{seriesByMethod: Record<string, list<{x: number, y: number}>>, excludedByUnit: number}}
 */
export function groupGlucoseByMethod(glucoseEvents, presentationUnit) {
    /** @type {Record<string, list<{x: number, y: number}>>} */
    const seriesByMethod = {};
    let excludedByUnit = 0;

    for (const event of glucoseEvents) {
        const { data } = event.content;

        if (data.unit !== presentationUnit) {
            excludedByUnit += 1;

            continue;
        }

        const at = eventWallClockMs(event.occurredAt, event.content.tz);

        /** An unreadable instant has no place on a time axis: it would land on 1970 or on `NaN`. */
        if (at === null) {
            continue;
        }

        if (seriesByMethod[data.method] === undefined) {
            seriesByMethod[data.method] = [];
        }

        seriesByMethod[data.method].push({ x: at, y: Number(data.value) });
    }

    for (const points of Object.values(seriesByMethod)) {
        points.sort((a, b) => a.x - b.x);
    }

    return { seriesByMethod, excludedByUnit };
}

/**
 * Text of the chart caption: which methods it includes (ADR 0008) and what was left out for being
 * in another unit (nothing is converted, see the module JSDoc).
 *
 * With no glucose record at all —the case of any new user— it says the same as the list ("No
 * glucose records yet.") instead of "No data to show in this unit", which suggests there are
 * records stored in another unit when there are none.
 *
 * @param {object} params
 * @param {list<string>} params.methodLabels Labels of the methods that do enter the chart.
 * @param {string} params.presentationUnit Unit being displayed (UCUM code).
 * @param {number} params.excludedByUnit Records left out for being in another unit.
 * @param {boolean} params.hasEvents Whether there is any glucose record, in any unit.
 * @returns {string}
 */
export function chartCaptionText({ methodLabels, presentationUnit, excludedByUnit, hasEvents }) {
    if (!hasEvents) {
        return t('glucose.empty');
    }

    const methodsText = methodLabels.length > 0
        ? t('glucose.caption.includes', { methods: joinList(methodLabels) })
        : t('glucose.caption.noneInUnit', { unit: presentationUnit });

    const excludedText = excludedByUnit > 0
        ? t('glucose.caption.excluded', { count: excludedByUnit, unit: presentationUnit })
        : '';

    return `${methodsText}${excludedText}`;
}

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
 * Second encoding of each series, besides the colour: dash pattern and point shape. Whoever does
 * not tell colours apart —colour blindness, black and white screen, printing— can still say which
 * line is which method by the shape (Do's #3). The colours come from `chartColors()`, which reads
 * them from the theme on every draw (see `chartTheme.js`).
 */
const CHART_SERIES_SHAPES = Object.freeze([
    Object.freeze({ borderDash: [], pointStyle: 'circle' }),
    Object.freeze({ borderDash: [6, 4], pointStyle: 'triangle' }),
    Object.freeze({ borderDash: [2, 3], pointStyle: 'rect' }),
]);

/**
 * Families of DESIGN.md § Typography. Same reason as `CHART_COLORS`: in a `<canvas>` the font is
 * declared by name, not by CSS variable.
 */
const CHART_FONTS = Object.freeze({
    body: "'Open Sans', ui-sans-serif, system-ui, sans-serif",
    mono: "'IBM Plex Mono', ui-monospace, monospace",
});

/**
 * Default family and size of the whole canvas, in the only place Chart.js accepts them:
 * `Chart.defaults.font`. There is no `font` key at the root of `options` —Chart.js resolves the
 * typography of each element against these defaults—, so putting it there would be dead
 * configuration pretending to cover what it does not: any element added later (a subtitle, data
 * labels) would inherit the library factory font instead of the DESIGN.md one.
 */
Chart.defaults.font.family = CHART_FONTS.body;
Chart.defaults.font.size = 13;

/**
 * Heroicons v2 paths (outline, 24×24), the same family the panel uses. The one in the list is the
 * flask of `Glucose::$navigationIcon`, so the guide icon of each record is the same as the one of
 * the section.
 */
const ICON_PATHS = Object.freeze({
    warning: 'M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 '
        + '1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z',
    info: 'm11.25 11.25.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 '
        + '12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z',
    beaker: 'M9.75 3.104v5.714a2.25 2.25 0 0 1-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 '
        + '24.301 0 0 1 4.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 '
        + '15.3l-1.57.393A9.065 9.065 0 0 1 12 15a9.065 9.065 0 0 0-6.23-.693L5 14.5m14.8.8 1.402 1.402c1.232 1.232.65 '
        + '3.318-1.067 3.611A48.309 48.309 0 0 1 12 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5',
});

/**
 * Decorative 20px icon (DESIGN.md § Lists: "20px icon"). It goes with `aria-hidden`: it never
 * carries information that is not also in the text (Do's #3, the colour and the icon accompany, they
 * do not replace).
 *
 * @param {'warning'|'info'|'beaker'} name
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
 * Block notice with an icon, of the kind DESIGN.md § Chips (Status Chip) fixes for states: colour
 * + icon + text, never colour alone (Do's #3).
 *
 * @param {object} params
 * @param {'error'|'info'} params.tone
 * @param {string} params.message
 * @returns {HTMLDivElement}
 */
function createCallout({ tone, message }) {
    const callout = document.createElement('div');

    /**
     * The two tones come from the notice tokens (`error-*` / `info-*`, see `theme.css`), which
     * already carry inside the § Chips pair corrected to AA —the error ink is #B91C1C and not
     * #DC2626, which over #FEF2F2 gives 4.41:1— and its § Dark Mode equivalent. The error also
     * carries the Large elevation, which DESIGN.md reserves for "modals, critical alerts": a
     * clinical record that cannot be shown is one. The info goes in Body Large because it is an actionable instruction.
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
 * Status chip (DESIGN.md § Chips · Status Chip, info variant): 12px bold in uppercase, 4px radius,
 * 4px/12px padding.
 *
 * The size goes in `text-status-chip` and not in `text-caption`: both are 12px, but the second is
 * the role of timestamps and drags its 0.01em tracking, which serves nothing here.
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
 * Filter chip (DESIGN.md § Chips · Filter Chip): #F0F7FF pill with a #CBD5E1 border and #475569
 * 13px semibold text, 6px/14px padding. It is used for the meal context, which is not a clinical
 * state but a circumstance of the measurement.
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
 * Alpine component factory. Registered as `phrGlucosePage`.
 *
 * @returns {object}
 */
export function glucosePage() {
    return {
        ...savedNotice(),
        ...dateRangeControl(),

        error: '',
        catalog: null,
        loading: false,

        /** Decrypted envelopes that failed to open on the last load (they do not take the screen down). */
        failedToOpenCount: 0,

        /** Glucose events in another unit the chart left out on the last load. */
        excludedByUnitCount: 0,

        /** Live Chart.js instance, so it can be destroyed before repainting. */
        chart: null,

        /**
         * Last events that were painted. It is not a data cache: it is what lets the chart be
         * rebuilt when the theme changes without asking for or decrypting anything again (see
         * `chartTheme.js`; Chart.js freezes the colours when the canvas is built).
         */
        chartEvents: [],

        init() {
            this.catalog = JSON.parse(document.querySelector('[data-phr-glucose-catalog]').textContent);

            /**
             * DESIGN.md § Charts — Dark: "a chart must also re-read them and redraw when the `.dark`
             * class on `<html>` changes; otherwise the whole panel switches theme except the
             * charts". It only repaints if there already is a chart: with the session locked there
             * is nothing to draw and `renderChart` would ask for refs that are not there.
             */
            observeThemeChange(() => {
                if (this.chart !== null) {
                    this.renderChart(this.chartEvents);
                }
            });

            /**
             * The options of `unit`, `method` and `mealContext` are rendered by the server in Blade
             * (ADR 0002, ADR 0005): they are not filled in here. See the comment at the start of
             * `glucose.blade.php`.
             *
             * The preselected unit is the client's business: it is a display preference (ADR 0006)
             * that lives in the encrypted settings, so the server cannot read it.
             */
            this.$refs.unit.value = settings()?.glucoseUnit ?? DEFAULT_UNIT;

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
         * no signal at all the person presses the button again. The template uses it to disable it,
         * set `aria-busy` and change the text (Do's #3), like the sign-in screens.
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

                const rawValue = this.$refs.value.value.trim();

                if (rawValue === '') {
                    throw new Error(t('glucose.missingValue'));
                }

                // Validates the numeric format and normalizes the comma to a dot (see the JSDoc of
                // `numericValue.js`). The result is still a string: it is not converted to a number
                // (ADR 0004).
                const value = parseNumericValue(rawValue, t('field.value'));

                const localDatetime = this.$refs.occurredAt.value;

                if (localDatetime === '') {
                    throw new Error(t('common.missingDate'));
                }

                const { occurredAt, tz } = datetimeLocalToCanonical(localDatetime);

                // `origin` is not asked for: the insertion here is always manual (the person reads
                // the value on their meter or sensor and types it in), so `buildCommonEventFields`
                // fixes it to `manual` by default (see the JSDoc of `eventCommonFields.js`).
                const common = buildCommonEventFields({
                    device: this.$refs.device.value,
                    recordedBy: this.$refs.recordedBy.value,
                    note: this.$refs.note.value,
                });

                const content = buildGlucoseContent({
                    value,
                    unit: this.$refs.unit.value,
                    method: this.$refs.method.value,
                    mealContext: this.$refs.mealContext.value,
                    tz,
                    loincTable: this.catalog.loinc,
                    common,
                });

                const payload = sealEvent({ userId, occurredAt, content });

                await this.$wire.storeEvent(payload, occurredAt);

                this.$refs.value.value = '';

                /**
                 * The date goes back to "now": if it kept the one of the record just saved, the
                 * next value would be silently written to a past instant, and a glucose reading
                 * with the wrong time is a false clinical datum that can no longer be told from a good one.
                 */
                this.$refs.occurredAt.value = nowAsDatetimeLocalValue();

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

                const glucoseEvents = filterGlucoseEvents(opened);

                this.renderList(glucoseEvents);
                this.renderChart(glucoseEvents);
            } catch (failure) {
                this.error = describeError(failure);
            } finally {
                this.loading = false;
            }
        },

        /**
         * With no key nothing can be decrypted: it is said, no empty list is painted.
         *
         * Losing the key mid-session is normal (ADR 0003), so the chart is destroyed too: leaving
         * the lines of the previous load on screen would show decrypted values of a session that is
         * no longer unlocked, and the caption would keep saying which methods a chart that can no
         * longer be refreshed "includes".
         */
        renderLocked() {
            this.$refs.list.replaceChildren(createCallout({ tone: 'info', message: t('common.locked.history') }));

            this.failedToOpenCount = 0;
            this.excludedByUnitCount = 0;
            this.chartEvents = [];

            if (this.chart !== null) {
                this.chart.destroy();
                this.chart = null;
            }

            this.paintLegend([]);
            this.$refs.chartCaption.textContent = t('common.locked.history');
        },

        /** @param {list<{id: string, occurredAt: string, content: object}>} glucoseEvents */
        renderList(glucoseEvents) {
            const fragment = document.createDocumentFragment();

            if (this.failedToOpenCount > 0) {
                const warning = createCallout({
                    tone: 'error',
                    message: t('common.recordsUndecrypted', { count: this.failedToOpenCount }),
                });
                warning.classList.add('mb-4');
                fragment.appendChild(warning);
            }

            if (glucoseEvents.length === 0) {
                const empty = document.createElement('p');
                /** #475569, the secondary text of DESIGN.md; never a dull grey (Don'ts #10). */
                empty.className = 'text-body text-ink-secondary';
                empty.textContent = t('glucose.empty');
                fragment.appendChild(empty);
            } else {
                const list = document.createElement('ul');
                /** The border goes on each item (DESIGN.md § Lists), not on a container divider. */
                list.className = 'flex flex-col';

                for (const event of glucoseEvents) {
                    list.appendChild(this.renderListItem(event));
                }

                fragment.appendChild(list);
            }

            this.$refs.list.replaceChildren(fragment);
        },

        /**
         * History item with the shape of DESIGN.md § Lists: #E2E8F0 bottom border, 14px/16px
         * padding, 48px minimum height (touch target, Do's #2), 20px guide icon in #0077B6 and
         * #475569 13px secondary text.
         *
         * The value, the unit and the LOINC code go in IBM Plex Mono (`font-mono`) because they are
         * a medical value and a code: Do's #7 demands it so they are not misread. The method and the
         * context stop being concatenated text and become chips.
         *
         * The `<li>` does NOT carry `hover:` or `active:`: DESIGN.md § Lists reserves those two
         * states for a pressable list element, and this is neither link nor button —it has no
         * destination, no handler and no focus—. Promising an interaction that does not happen is
         * worse than not promising it; the day the item leads to a detail, they will come back
         * along with the `<a>`, its touch target (Do's #2) and its focus indicator (Do's #9).
         *
         * @param {{id: string, occurredAt: string, content: object}} event
         * @returns {HTMLLIElement}
         */
        renderListItem(event) {
            const { data } = event.content;

            const item = document.createElement('li');
            item.className = 'flex min-h-12 items-start gap-4 border-b border-border px-4 py-3.5 last:border-b-0';

            item.appendChild(createIcon('beaker', 'mt-0.5 size-5 shrink-0 text-accent'));

            const body = document.createElement('div');
            body.className = 'flex flex-1 flex-col gap-2';

            /** First line: the measurement. It goes in monospace and in the main text #0F172A. */
            const measurement = document.createElement('p');
            measurement.className = 'font-mono text-body text-ink';

            /**
             * No `font-semibold`: only weight 400 of IBM Plex Mono is bundled (§ Typography · Code
             * defines it as "regular"), so asking for 600 would make the browser synthesize a fake
             * bold, fattening and deforming exactly the numeric glyphs Do's #7 wants unmistakable.
             * The value stands out by being first on the line and carrying the main ink, against the
             * secondary grey of the unit.
             */
            const value = document.createElement('span');
            value.textContent = data.value;
            measurement.appendChild(value);

            const unit = document.createElement('span');
            unit.className = 'ml-1 text-ink-secondary';
            unit.textContent = data.unit;
            measurement.appendChild(unit);

            body.appendChild(measurement);

            const methodLabel = this.catalog.methods.find((row) => row.token === data.method)?.label ?? data.method;
            const contextLabel = mealContextLabel(this.catalog, data);

            const chips = document.createElement('div');
            chips.className = 'flex flex-wrap items-center gap-2';
            chips.appendChild(createStatusChip(methodLabel));

            /** With no meal context (ADR 0006, optional): no chip is shown in its place. */
            if (contextLabel !== null) {
                chips.appendChild(createFilterChip(contextLabel));
            }

            body.appendChild(chips);

            /**
             * Secondary text: timestamp and LOINC code, both numeric → monospace, and in the Code
             * size of § Typography (14px), which is the role DESIGN.md defines for "medical codes,
             * IDs, data fields".
             */
            const meta = document.createElement('p');
            meta.className = 'font-mono text-code text-ink-secondary';
            meta.textContent = `${formatDateTime(event.occurredAt)} · LOINC ${data.loinc}`;
            body.appendChild(meta);

            item.appendChild(body);

            return item;
        },

        /**
         * Paints the chart, or paints nothing if there is no data to show (a canvas with empty axes
         * looks like a bug, not a legitimate empty state).
         *
         * The X axis is the shared linear one over the instant (`timeAxis.js`), never a category
         * one: glucose is the most irregularly measured quantity of them all, and with equal
         * columns a reading at 00:00, one at 12:00 and one at 12:30 came out at even thirds, which
         * erased the twelve hours of the first gap and the half hour of the second.
         *
         * @param {list<{id: string, occurredAt: string, content: object}>} glucoseEvents
         */
        renderChart(glucoseEvents) {
            /**
             * They are stored so the chart can be repainted when the theme changes (see `init()`):
             * Chart.js freezes the colours when the canvas is built, so the only way to switch is
             * rebuilding the chart with the same data.
             */
            this.chartEvents = glucoseEvents;

            /** Colours of the active theme, read now and not when the module loaded (`chartTheme.js`). */
            const colors = chartColors();

            const presentationUnit = this.$refs.unit.value;
            const { seriesByMethod, excludedByUnit } = groupGlucoseByMethod(glucoseEvents, presentationUnit);

            this.excludedByUnitCount = excludedByUnit;

            const methods = Object.keys(seriesByMethod);

            if (this.chart !== null) {
                this.chart.destroy();
                this.chart = null;
            }

            const timeFormat = chartTimeFormat();
            const instants = methods.flatMap((method) => seriesByMethod[method].map((point) => point.x));

            if (instants.length === 0) {
                this.paintLegend([]);
            } else {
                /**
                 * Series descriptors, one per method. They are at once what Chart.js consumes and
                 * what paints the legend in HTML (see `chartLegend.js`): one single source, so the
                 * legend cannot end up with a colour or a shape different from the line's.
                 */
                const series = methods.map((method, index) => ({
                    label: this.catalog.methods.find((row) => row.token === method)?.label ?? method,
                    color: colors.series[index % colors.series.length],
                    ...CHART_SERIES_SHAPES[index % CHART_SERIES_SHAPES.length],
                }));

                const datasets = series.map((entry, index) => ({
                    label: entry.label,
                    /**
                     * Each method carries its own points: with a linear axis there is nothing to
                     * line up by position, so the padding `null`s that only existed because another
                     * method had no reading at that instant are gone. The threshold that does break
                     * the line is the clinical one, shared with the dashboard curve.
                     */
                    data: splitOnGaps(seriesByMethod[methods[index]], MAX_READING_GAP_MS),
                    borderColor: entry.color,
                    backgroundColor: entry.color,
                    pointBackgroundColor: entry.color,
                    pointBorderColor: colors.surface,
                    pointBorderWidth: 2,
                    pointRadius: 4,
                    pointHoverRadius: 6,
                    borderWidth: 2,
                    /** Second encoding, besides the colour (Do's #3): dash and point shape. */
                    borderDash: [...entry.borderDash],
                    pointStyle: entry.pointStyle,
                    tension: 0.3,
                    /** `spanGaps` false (out of the box): the breaks `splitOnGaps` opened are breaks. */
                }));

                this.paintLegend(series);

                this.chart = new Chart(this.$refs.chart, {
                    type: 'line',
                    data: { datasets },
                    options: {
                        maintainAspectRatio: false,
                        color: colors.tick,
                        scales: {
                            x: timeAxisScale({ colors, format: timeFormat, bounds: timeAxisBounds(instants) }),
                            y: {
                                grid: { color: colors.grid },
                                border: { color: colors.tick },
                                /** Do's #7: measurement values, in IBM Plex Mono. */
                                ticks: { color: colors.tick, font: { family: CHART_FONTS.mono, size: 12 } },
                                title: {
                                    display: true,
                                    text: presentationUnit,
                                    color: colors.tick,
                                    /**
                                     * Weight 400: only that one of IBM Plex Mono is bundled
                                     * (§ Typography · Code says "regular"), and asking for 600
                                     * would force the browser to synthesize a fake bold over the unit code.
                                     */
                                    font: { family: CHART_FONTS.mono, size: 13, weight: 400 },
                                },
                            },
                        },
                        plugins: {
                            /**
                             * The legend lives outside the canvas, in HTML (see `chartLegend.js`).
                             * `display: false` instead of `legend: false`: with `false` Chart.js
                             * drops the whole plugin and `chart.legend` stops existing; this way the
                             * plugin stays up, its `fit()` returns height 0 and steals nothing from
                             * the 320px of the container, which is exactly what was overflowing.
                             */
                            legend: { display: false },
                            /**
                             * DESIGN.md § Tooltips: 8px radius, 13px, 8/14px padding. The
                             * background/ink pair comes from the theme, because the tooltip is the
                             * only component that inverts against the interface: in light #0F172A
                             * over #FFFFFF and in dark #E8EEF7 over #0B1220 (§ Charts — Dark).
                             */
                            tooltip: {
                                /**
                                 * With a linear axis the title has to be stated: the free one of the
                                 * category axis is gone, and without this the heading would be the
                                 * raw epoch number.
                                 */
                                callbacks: { title: timeAxisTooltipTitle(timeFormat) },
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
            }

            this.renderChartCaption(methods, presentationUnit, excludedByUnit, glucoseEvents.length > 0);
        },

        /**
         * Paints the legend in HTML, outside the canvas (see the JSDoc of `chartLegend.js` for the
         * why). With an empty list it leaves the node empty, which is what fits when there is no
         * chart: an orphan legend would describe lines that are not there.
         *
         * @param {list<{label: string, color: string, borderDash: list<number>, pointStyle: string}>} series
         */
        paintLegend(series) {
            renderLegend(
                legendElementFor(this.$refs.chart, 'glucose-chart-legend'),
                legendItems(series),
            );
        },

        /**
         * Chart caption: which methods it includes (ADR 0008) and how many records were left out for
         * being in another unit (nothing is converted, see the module JSDoc).
         *
         * The `<p>` is painted by Blade, not by this method: it is the `aria-describedby` of the
         * `<canvas>` —the only way the trend reaches whoever does not see the chart— and it needs a
         * stable `id`. It also has to live OUTSIDE the fixed-height container: Chart.js demands that
         * the parent of the canvas be exclusively its own, and a sibling inside would have
         * overflowed below and could trigger the canvas resize loop.
         *
         * @param {list<string>} methods
         * @param {string} presentationUnit
         * @param {number} excludedByUnit
         * @param {boolean} hasEvents
         */
        renderChartCaption(methods, presentationUnit, excludedByUnit, hasEvents) {
            const methodLabels = methods
                .map((method) => this.catalog.methods.find((row) => row.token === method)?.label ?? method);

            this.$refs.chartCaption.textContent = chartCaptionText({
                methodLabels,
                presentationUnit,
                excludedByUnit,
                hasEvents,
            });
        },
    };
}
