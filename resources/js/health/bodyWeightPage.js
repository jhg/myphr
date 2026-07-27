/**
 * Alpine component of the weight and height screen (ADR 0002, ADR 0004, ADR 0005, ADR 0006,
 * ADR 0008).
 *
 * The DOM contract is fixed by `resources/views/phr/pages/body-weight.blade.php`: no `wire:model`
 * (ADR 0002), the fields are read through `x-ref` and the encrypted envelope goes up as an
 * argument of `storeEvent`, never as a Livewire property.
 *
 * **The component name is still `phrBodyWeightPage`** even though the screen now records two
 * quantities: that name lives in `resources/js/app.js`, and renaming it is a separate task (see
 * the PHPDoc of `App\Filament\Pages\BodyWeight`). The current rename is only of the visible
 * label.
 *
 * **No measurement method** (ADR 0008): a scale offers no variants that change the value in a
 * known way, unlike the arm and the posture of blood pressure or the measurement site of
 * temperature, so no method is asked for here and the LOINC codes are constant (see
 * `App\Catalog\BodyWeightLoincCode` and `App\Catalog\BodyHeightLoincCode`). They arrive already
 * resolved in `catalog.loinc` and `catalog.heightLoinc`.
 *
 * **Height is optional in each record and it carries over.** Whoever weighs themselves every week
 * writes it once and leaves it blank afterwards, so a record with no height is not an incomplete
 * record: BMI is computed with the last known height that is not later than that weighing (see
 * `bodyMassIndex.js`). With no height recorded at all there is no BMI and nothing is shown in its
 * place.
 *
 * **Nothing is converted between kilograms and pounds.** Each record keeps the unit it was written
 * in (ADR 0006) and the chart draws **one series per unit** instead of mixing them. It is the same
 * decision as in glucose, but resolved the other way round: glucose leaves out of the chart what
 * is not in the display unit because between mg/dL and mmol/L there is no exact equivalence and
 * there is a preference saved in the settings; weight has no such preference, so hiding records
 * would require inventing which unit is the "good" one. Two series tell the whole truth and hide
 * nothing.
 *
 * **The server cannot filter by type** (ADR 0006): `fetchEvents` brings every event of the user
 * and here each one is decrypted and whatever is not `type === 'bodyWeight'` is discarded. An
 * envelope that does not open does not take the screen down: it is counted and reported (ADR 0004).
 *
 * **The four fields common to every event** (origin, device, who records, note; ADR 0006) are not
 * built here: they live in `eventCommonFields.js` and `buildBodyWeightContent` receives them
 * already built, to spread them at the top level of the content, never inside `data`.
 *
 * **The origin is not asked for in the form.** `origin` tells apart how the datum entered —typed
 * versus imported from a device—, and here the insertion is always manual: the number is read on
 * the scale and typed in. `submit()` fixes it to `'manual'` without reading any DOM field; the
 * device (`device`) is useful (what it was weighed with) and keeps its field.
 *
 * **The event date is not converted here.** `datetimeLocalToCanonical` lives in `datetimeLocal.js`
 * because what it returns enters as AEAD associated data (ADR 0004): if each screen carried its
 * own copy and one drifted, its envelopes would stop opening.
 *
 * The functions exported before `bodyWeightPage()` are the pure logic of the component, so they
 * can be tested without mounting Alpine or Chart.js (`tests/js/bodyWeightPage.test.mjs`).
 */

import Chart from 'chart.js/auto';

import { isUnlocked, ownerId } from '../auth/keyring.js';
import { SESSION_READY_EVENT } from '../auth/sessionBootstrap.js';
import { EnvelopeError } from '../crypto/envelope.js';
import { formatDateTime, formatNumber, joinList, t } from '../i18n/index.js';
import { bodyMassIndex, heightKnownAt } from './bodyMassIndex.js';
import { legendElementFor, legendItems, renderLegend } from './chartLegend.js';
import { chartColors, observeThemeChange } from './chartTheme.js';
import { eventWallClockMs } from './dailyBands.js';
import { dateRangeControl } from './dateRange.js';
import { datetimeLocalToCanonical } from './datetimeLocal.js';
import { buildCommonEventFields } from './eventCommonFields.js';
import { openEvent, sealEvent } from './eventEnvelope.js';
import { parseNumericValue } from './numericValue.js';
import { savedNotice } from './savedNotice.js';
import { chartTimeFormat, splitOnGaps, timeAxisBounds, timeAxisScale, timeAxisTooltipTitle } from './timeAxis.js';
import { unitLabel } from './unitLabel.js';

/**
 * The same as `unitLabel` (see `unitLabel.js`), but for the height units, which are another list
 * of the catalog: the inch is stored as `[in_i]` (UCUM tells the international one from the US
 * survey one) and shown as `in`. It stays here because only this screen uses it.
 *
 * @param {{heightUnits: list<{code: string, label: string}>}} catalog
 * @param {string} code
 * @returns {string}
 */
export function heightUnitLabel(catalog, code) {
    return catalog.heightUnits.find((row) => row.code === code)?.label ?? code;
}

/**
 * Builds the content in the clear of a weight event, with the shape of ADR 0006. The values travel
 * as strings, never as numbers (ADR 0004: decimals as a string).
 *
 * `common` are the four fields any event type shares (see `eventCommonFields.js`) and they go at
 * the top level of the content, not inside `data`.
 *
 * **Height is optional and, when it is missing, the `height` key is not written.** No `null`, no
 * empty string, and no height copied from the previous record: an envelope only asserts what was
 * measured that day. Copying it would turn every weighing into a measurement, and then the date of
 * the height —the only thing that lets a growing person be followed— would stop meaning anything.
 *
 * @param {object} params
 * @param {string} params.value Weight, exactly as the person typed it, already as a string.
 * @param {string} params.unit UCUM code of the weight.
 * @param {string} [params.height] Height; empty string or absent when it is not filled in.
 * @param {string} [params.heightUnit] UCUM code of the height; it only matters if there is a height.
 * @param {string} params.tz `±HH:MM` offset of the moment of recording.
 * @param {{loinc: string, heightLoinc: string}} params.catalog
 * @param {{origin: string, recordedBy: string, device?: string, note?: string}} params.common
 *        Already built by `buildCommonEventFields`.
 * @returns {{v: 1, type: 'bodyWeight', tz: string, origin: string, recordedBy: string,
 *           device?: string, note?: string, data: {value: string, unit: string, loinc: string,
 *           height?: {value: string, unit: string, loinc: string}}}}
 * @throws {Error} If the weight, its unit, or the unit of a height that was written is missing.
 */
export function buildBodyWeightContent({ value, unit, height, heightUnit, tz, catalog, common }) {
    if (typeof value !== 'string' || value.trim() === '') {
        throw new Error(t('bodyWeight.missingValue'));
    }

    if (typeof unit !== 'string' || unit.trim() === '') {
        throw new Error(t('bodyWeight.missingUnit'));
    }

    const data = {
        value,
        unit,
        loinc: catalog.loinc,
    };

    if (typeof height === 'string' && height.trim() !== '') {
        if (typeof heightUnit !== 'string' || heightUnit.trim() === '') {
            throw new Error(t('bodyWeight.missingHeightUnit'));
        }

        data.height = {
            value: height,
            unit: heightUnit,
            loinc: catalog.heightLoinc,
        };
    }

    return {
        v: 1,
        type: 'bodyWeight',
        tz,
        ...common,
        data,
    };
}

/**
 * Discards the decrypted events that are not of type `bodyWeight`. The server cannot do this
 * filter because the type travels encrypted inside the envelope (ADR 0006): it is the client's job.
 *
 * @param {list<{id: string, occurredAt: string, content: object}>} events Already decrypted.
 * @returns {list<{id: string, occurredAt: string, content: object}>}
 */
export function filterBodyWeightEvents(events) {
    return events.filter((event) => event.content?.type === 'bodyWeight');
}

/**
 * Gap from which the weight line breaks.
 *
 * Weighing is the most sporadic record of them all —three days in a row and then nothing for two
 * months is the normal pattern—, so the threshold is generous: joining two weighings a fortnight
 * apart is a legitimate trend, and the proportional axis already shows how far apart they are.
 * Beyond a month the segment stops being a trend and becomes an invented one, drawn over a stretch
 * where nobody knows what the weight did.
 */
export const MAX_WEIGHT_GAP_MS = 31 * 86_400_000;

/**
 * Groups the weighings by unit for the chart: one series per unit, never a single series with
 * kilograms and pounds mixed (see the module JSDoc). Each series comes out sorted by date.
 *
 * The `x` of each point is the wall clock time of whoever weighed themselves ({@see eventWallClockMs}),
 * not the absolute instant: a weighing recorded at 08:00 in Madrid stays at 08:00 when the chart is
 * opened from another time zone. It is the same rule the home dashboard follows, and the labels are
 * formatted in UTC for that very reason (`timeAxis.js`).
 *
 * @param {list<{id: string, occurredAt: string, content: object}>} weightEvents Already filtered
 *        by `filterBodyWeightEvents`.
 * @returns {Record<string, list<{x: number, y: number}>>} Indexed by UCUM code.
 */
export function groupBodyWeightByUnit(weightEvents) {
    /** @type {Record<string, list<{x: number, y: number}>>} */
    const seriesByUnit = {};

    for (const event of weightEvents) {
        const { data } = event.content;
        const at = eventWallClockMs(event.occurredAt, event.content.tz);

        /** An unreadable instant has no place on a time axis: it would land on 1970 or on `NaN`. */
        if (at === null) {
            continue;
        }

        if (seriesByUnit[data.unit] === undefined) {
            seriesByUnit[data.unit] = [];
        }

        seriesByUnit[data.unit].push({ x: at, y: Number(data.value) });
    }

    for (const points of Object.values(seriesByUnit)) {
        points.sort((a, b) => a.x - b.x);
    }

    return seriesByUnit;
}

/**
 * Text of the chart caption: which units it includes, because they are different series and not
 * comparable with each other.
 *
 * @param {list<string>} unitLabels Labels of the units with data in the chart.
 * @returns {string}
 */
export function chartCaptionText(unitLabels) {
    return unitLabels.length > 0
        ? t('bodyWeight.caption.includes', { units: joinList(unitLabels) })
        : t('bodyWeight.caption.empty');
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
 * Second encoding of each series, besides the colour (Do's #3): dash pattern and point shape.
 * Whoever does not tell colours apart —colour blindness, black and white screen, printing— can
 * still say which line is which unit. The colours come from `chartColors()`, which reads them from
 * the theme on every draw (see `chartTheme.js`).
 */
const CHART_SERIES_SHAPES = Object.freeze([
    Object.freeze({ borderDash: [], pointStyle: 'circle' }),
    Object.freeze({ borderDash: [6, 4], pointStyle: 'triangle' }),
    Object.freeze({ borderDash: [2, 3], pointStyle: 'rect' }),
]);

/** Families of DESIGN.md § Typography, declared by name because a `<canvas>` reads no CSS variables. */
const CHART_FONTS = Object.freeze({
    body: "'Open Sans', ui-sans-serif, system-ui, sans-serif",
    mono: "'IBM Plex Mono', ui-monospace, monospace",
});

/**
 * Default family and size of the whole canvas, in the only place Chart.js accepts them:
 * `Chart.defaults.font`. Chart.js resolves the typography of each element against these values, so
 * a `font` key at the root of `options` would be dead configuration.
 */
Chart.defaults.font.family = CHART_FONTS.body;
Chart.defaults.font.size = 13;

/**
 * Heroicons v2 paths (outline, 24×24), the same family the panel uses. The one in the history is
 * the scale of `BodyWeight::$navigationIcon`, so the guide icon of each record is the same as the
 * one of the section.
 */
const ICON_PATHS = Object.freeze({
    warning: 'M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 '
        + '1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z',
    info: 'm11.25 11.25.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 '
        + '12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z',
    scale: 'M12 3v17.25m0 0c-1.472 0-2.882.265-4.185.75M12 20.25c1.472 0 2.882.265 4.185.75M18.75 '
        + '4.97A48.416 48.416 0 0 0 12 4.5c-2.291 0-4.545.16-6.75.47m13.5 0c1.01.143 2.01.317 3 .52m-3-.52 '
        + '2.62 10.726c.122.499-.106 1.028-.589 1.202a5.988 5.988 0 0 1-2.031.352 5.988 5.988 0 0 '
        + '1-2.031-.352c-.483-.174-.711-.703-.59-1.202L18.75 4.971Zm-16.5.52c.99-.203 1.99-.377 3-.52m0 0 '
        + '2.62 10.726c.122.499-.106 1.028-.589 1.202a5.989 5.989 0 0 1-2.031.352 5.989 5.989 0 0 '
        + '1-2.031-.352c-.483-.174-.711-.703-.59-1.202L5.25 4.971Z',
});

/**
 * Decorative 20px icon (DESIGN.md § Lists: "20px icon"). It goes with `aria-hidden`: it never
 * carries information that is not also in the text (Do's #3).
 *
 * @param {'warning'|'info'|'scale'} name
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
 * Block notice with an icon (DESIGN.md § Chips · Status Chip): colour + icon + text, never colour
 * alone (Do's #3). Same notice tokens (`error-*` / `info-*`) as the other event screens, which
 * switch on their own with the theme.
 *
 * @param {object} params
 * @param {'error'|'info'} params.tone
 * @param {string} params.message
 * @returns {HTMLDivElement}
 */
function createCallout({ tone, message }) {
    const callout = document.createElement('div');

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
 * passing the cursor and the limit too, and the usual value is repeated here.
 */
const HISTORY_FETCH_LIMIT = 100;

/**
 * Alpine component factory. Registered as `phrBodyWeightPage`.
 *
 * @returns {object}
 */
export function bodyWeightPage() {
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
            this.catalog = JSON.parse(document.querySelector('[data-phr-body-weight-catalog]').textContent);

            /**
             * DESIGN.md § Charts — Dark: the chart has to re-read the colours and repaint when
             * `<html>` enters or leaves dark mode, or the whole panel switches except the charts.
             */
            observeThemeChange(() => {
                if (this.chart !== null) {
                    this.renderChart(this.chartEvents);
                }
            });

            /**
             * The options of `unit` are rendered by the server in Blade (ADR 0002, ADR 0005): they
             * are not filled in here. See the comment at the start of `body-weight.blade.php`.
             */
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
         * no signal at all the person presses the button again, which on a clinical recording screen
         * means a duplicated weighing in the history.
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

                // Validates the numeric format and normalizes the comma to a dot (see the JSDoc of
                // `numericValue.js`); the empty string passes untouched and is detected as "missing
                // datum" by `buildBodyWeightContent`. The result is still a string: it is not
                // converted to a number (ADR 0004).
                const value = parseNumericValue(this.$refs.value.value.trim(), t('field.weight'));

                /**
                 * The height goes through the same validation, and its empty string passes
                 * untouched: leaving it blank is the normal case, not an error (see the module JSDoc).
                 */
                const height = parseNumericValue(this.$refs.height.value.trim(), t('field.height'));

                const localDatetime = this.$refs.occurredAt.value;

                if (localDatetime === '') {
                    throw new Error(t('common.missingDate'));
                }

                const { occurredAt, tz } = datetimeLocalToCanonical(localDatetime);

                const common = buildCommonEventFields({
                    /** Always manual: see the module JSDoc, "The origin is not asked for...". */
                    origin: 'manual',
                    device: this.$refs.device.value,
                    recordedBy: this.$refs.recordedBy.value,
                    note: this.$refs.note.value,
                });

                const content = buildBodyWeightContent({
                    value,
                    unit: this.$refs.unit.value,
                    height,
                    heightUnit: this.$refs.heightUnit.value,
                    tz,
                    catalog: this.catalog,
                    common,
                });

                const payload = sealEvent({ userId, occurredAt, content });

                await this.$wire.storeEvent(payload, occurredAt);

                this.$refs.value.value = '';

                /**
                 * The height is emptied too. It is not left in place "for convenience": the next
                 * record would store it as if it had been measured again, and a height repeated
                 * without measuring is an invented datum with today's date.
                 */
                this.$refs.height.value = '';

                /**
                 * The date goes back to "now": if it kept the one of the record just saved, the
                 * next weighing would be silently written to a past instant, and a weight with the
                 * wrong time can no longer be told from a good one.
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

                const weightEvents = filterBodyWeightEvents(opened);

                this.renderList(weightEvents);
                this.renderChart(weightEvents);
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
         * the lines of the previous load would show decrypted values of a session that is no longer
         * unlocked.
         */
        renderLocked() {
            this.$refs.list.replaceChildren(createCallout({ tone: 'info', message: t('common.locked.history') }));

            this.failedToOpenCount = 0;
            this.chartEvents = [];

            if (this.chart !== null) {
                this.chart.destroy();
                this.chart = null;
            }

            this.paintLegend([]);
            this.$refs.chartCaption.textContent = t('common.locked.history');
        },

        /** @param {list<{id: string, occurredAt: string, content: object}>} weightEvents */
        renderList(weightEvents) {
            const fragment = document.createDocumentFragment();

            if (this.failedToOpenCount > 0) {
                const warning = createCallout({
                    tone: 'error',
                    message: t('common.recordsUndecrypted', { count: this.failedToOpenCount }),
                });
                warning.classList.add('mb-4');
                fragment.appendChild(warning);
            }

            if (weightEvents.length === 0) {
                const empty = document.createElement('p');
                empty.className = 'text-body text-ink-secondary';
                empty.textContent = t('bodyWeight.empty');
                fragment.appendChild(empty);
            } else {
                const list = document.createElement('ul');
                list.className = 'flex flex-col';

                for (const event of weightEvents) {
                    /**
                     * The height that applies to this weighing: the one of the record itself if
                     * it brings one and, if not, the last known one that is not later
                     * (`bodyMassIndex.js`). Resolved here and not inside the `<li>`: the whole list is needed.
                     */
                    const ownHeight = event.content?.data?.height ?? null;
                    const height = ownHeight ?? heightKnownAt(weightEvents, event.occurredAt);

                    list.appendChild(this.renderListItem(event, { height, isOwnHeight: ownHeight !== null }));
                }

                fragment.appendChild(list);
            }

            this.$refs.list.replaceChildren(fragment);
        },

        /**
         * History item with the shape of DESIGN.md § Lists, the same as the other screens. The
         * value goes in IBM Plex Mono (Do's #7).
         *
         * The `<li>` does NOT carry `hover:` or `active:`: DESIGN.md § Lists reserves those two
         * states for a pressable list element, and this is neither link nor button. Promising an
         * interaction that does not happen is worse than not promising it.
         *
         * @param {{id: string, occurredAt: string, content: object}} event
         * @param {object} applicableHeight
         * @param {{value: string, unit: string, occurredAt?: string}|null} applicableHeight.height
         *        Height the BMI of this row is computed with, already resolved by `renderList`.
         * @param {boolean} applicableHeight.isOwnHeight Whether that height was measured in this record.
         * @returns {HTMLLIElement}
         */
        renderListItem(event, { height, isOwnHeight }) {
            const { data } = event.content;

            const item = document.createElement('li');
            item.className = 'flex min-h-12 items-start gap-4 border-b border-border px-4 py-3.5 last:border-b-0';

            item.appendChild(createIcon('scale', 'mt-0.5 size-5 shrink-0 text-accent'));

            const body = document.createElement('div');
            body.className = 'flex flex-1 flex-col gap-2';

            const measurement = document.createElement('p');
            measurement.className = 'font-mono text-body text-ink';

            /**
             * No `font-semibold`: only weight 400 of IBM Plex Mono is bundled (§ Typography · Code
             * defines it as "regular"), so asking for 600 would make the browser synthesize a fake
             * bold, fattening exactly the numeric glyphs Do's #7 wants
             * unmistakable.
             */
            const value = document.createElement('span');
            value.textContent = data.value;
            measurement.appendChild(value);

            const unit = document.createElement('span');
            unit.className = 'ml-1 text-ink-secondary';
            unit.textContent = unitLabel(this.catalog, data.unit);
            measurement.appendChild(unit);

            /**
             * The height, only when it was measured in this record. The carried-over one is NOT
             * repeated here: writing it on a row where it was not measured would make people
             * believe the height was taken that day. Where it comes from is said, next to the BMI, which is what uses it.
             */
            if (isOwnHeight && height !== null) {
                const heightLine = document.createElement('span');
                heightLine.className = 'ml-3 text-ink-secondary';
                heightLine.textContent = t('bodyWeight.heightInline', {
                    value: height.value,
                    unit: heightUnitLabel(this.catalog, height.unit),
                });
                measurement.appendChild(heightLine);
            }

            body.appendChild(measurement);

            /**
             * BMI, as a figure and nothing else: no category ("overweight"...) and no judgement
             * colour. The why, which is long, is in the JSDoc of `bodyMassIndex.js`; the summary is
             * that in children it is read by percentiles of age and sex, which this application does
             * not have, and that a threshold painted red reads as a diagnosis nobody made here.
             *
             * With no height nothing is painted. There is no "BMI —" and no "not computed": a
             * silent gap says less than a line suggesting something mandatory is missing, and height is not.
             */
            const bmi = bodyMassIndex({ weight: { value: data.value, unit: data.unit }, height });

            if (bmi !== null) {
                const bmiLine = document.createElement('p');
                bmiLine.className = 'font-mono text-code text-ink-secondary';
                bmiLine.textContent = isOwnHeight
                    ? t('bodyWeight.bmi', { value: formatNumber(bmi) })
                    : t('bodyWeight.bmiWithHeightFrom', {
                        value: formatNumber(bmi),
                        date: formatDateTime(height.occurredAt),
                    });
                body.appendChild(bmiLine);
            }

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
         * Paints the chart, or paints nothing if there is no data (a canvas with empty axes looks
         * like a bug, not a legitimate empty state). One series per unit, never kilograms and pounds
         * on the same line (see the module JSDoc).
         *
         * The X axis is the shared linear one over the instant (`timeAxis.js`), never a category
         * one: on this screen more than on any other, distance is the datum. Three weighings in one
         * week and then nothing for two months used to be drawn as four evenly spaced points, and
         * the slope between the last two —which is the only thing anybody reads in a weight chart—
         * was a made-up one.
         *
         * @param {list<{id: string, occurredAt: string, content: object}>} weightEvents
         */
        renderChart(weightEvents) {
            /** They are stored so the chart can be repainted on theme switch (see `init()` and `chartTheme.js`). */
            this.chartEvents = weightEvents;

            /** Colours of the active theme, read now and not when the module loaded (`chartTheme.js`). */
            const colors = chartColors();

            const seriesByUnit = groupBodyWeightByUnit(weightEvents);
            const units = Object.keys(seriesByUnit);
            const labels = units.map((code) => unitLabel(this.catalog, code));

            if (this.chart !== null) {
                this.chart.destroy();
                this.chart = null;
            }

            const timeFormat = chartTimeFormat();
            const instants = units.flatMap((code) => seriesByUnit[code].map((point) => point.x));

            if (instants.length === 0) {
                this.paintLegend([]);
            } else {
                /**
                 * Series descriptors: they are at once what Chart.js consumes and what labels the
                 * legend in HTML (see `chartLegend.js`), so neither of the two can end up with a
                 * colour or a shape different from the other's.
                 */
                const series = units.map((code, index) => ({
                    label: labels[index],
                    color: colors.series[index % colors.series.length],
                    ...CHART_SERIES_SHAPES[index % CHART_SERIES_SHAPES.length],
                }));

                const datasets = series.map((entry, index) => ({
                    /**
                     * Each series carries its own points: with a linear axis there is nothing to
                     * line up by position, so the padding `null`s that only existed because the
                     * other unit had no weighing at that instant are gone.
                     */
                    data: splitOnGaps(seriesByUnit[units[index]], MAX_WEIGHT_GAP_MS),
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
                                ticks: { color: colors.tick, font: { family: CHART_FONTS.mono, size: 12 } },
                                title: {
                                    display: true,
                                    /**
                                     * With both units at once the label names both: writing only
                                     * one would say the whole chart is in it, which is exactly what
                                     * does not happen.
                                     */
                                    text: joinList(labels),
                                    color: colors.tick,
                                    /**
                                     * Weight 400: only that one of IBM Plex Mono is bundled, and
                                     * asking for 600 would force the browser to synthesize a fake
                                     * bold over the unit.
                                     */
                                    font: { family: CHART_FONTS.mono, size: 13, weight: 400 },
                                },
                            },
                        },
                        plugins: {
                            /** The legend lives outside the canvas, in HTML (see `chartLegend.js`). */
                            legend: { display: false },
                            /**
                             * The background/ink pair comes from the theme: the tooltip is the only
                             * component that inverts against the interface (§ Charts — Dark).
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

            this.$refs.chartCaption.textContent = chartCaptionText(labels);
        },

        /**
         * Paints the legend in HTML, outside the canvas (see the JSDoc of `chartLegend.js` for the
         * why). With an empty list it leaves the node empty: an orphan legend would describe lines
         * that are not there.
         *
         * @param {list<{label: string, color: string, borderDash: list<number>, pointStyle: string}>} series
         */
        paintLegend(series) {
            renderLegend(
                legendElementFor(this.$refs.chart, 'body-weight-chart-legend'),
                legendItems(series),
            );
        },
    };
}
