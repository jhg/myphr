/**
 * Alpine component of the body temperature screen (ADR 0002, ADR 0004, ADR 0005, ADR 0006,
 * ADR 0008).
 *
 * The DOM contract is fixed by `resources/views/phr/pages/temperature.blade.php`: no `wire:model`
 * (ADR 0002), the fields are read through `x-ref` and the encrypted envelope goes up as an
 * argument of `storeEvent`, never as a Livewire property.
 *
 * **The measurement site is the method** (ADR 0008): the axillary and the rectal of the same
 * person at the same moment do not give the same number, so the site is asked for, travels as a
 * field of its own (`data.site`) and is **never mixed in silence** with another: each site is a
 * separate series and the chart caption says which ones it includes.
 *
 * **Here the site also decides the LOINC code**, unlike the arm and the posture of blood pressure:
 * LOINC publishes one code per measurement site, so this screen resolves the code against the
 * `catalog.loinc` table the server emits, in the style of glucose (see
 * `App\Catalog\TemperatureLoincCode`).
 *
 * **Nothing is converted between Celsius and Fahrenheit.** Each record keeps the unit it was
 * written in (ADR 0006) and the series is grouped by the (site, unit) pair: a single line with
 * 36.8 and 98.2 in a row would not be a trend, it would be a scale jump disguised as a fever.
 * Converting would also require fixing precision and rounding, which this version does not tackle.
 *
 * **The server cannot filter by type** (ADR 0006): `fetchEvents` brings every event of the user
 * and here each one is decrypted and whatever is not `type === 'temperature'` is discarded. An
 * envelope that does not open does not take the screen down: it is counted and reported (ADR 0004).
 *
 * **The four fields common to every event** (origin, device, who records, note; ADR 0006) are not
 * built here: they live in `eventCommonFields.js` and `buildTemperatureContent` receives them
 * already built, to spread them at the top level of the content, never inside `data`.
 *
 * **The origin is not asked for in the form.** `origin` tells apart how the datum entered —typed
 * versus imported from a device—, and here the insertion is always manual: the number is read on
 * the thermometer and typed in. `submit()` fixes it to `'manual'` without reading any DOM field;
 * the device (`device`) is useful (what it was measured with) and keeps its field.
 *
 * **The event date is not converted here.** `datetimeLocalToCanonical` lives in `datetimeLocal.js`
 * because what it returns enters as AEAD associated data (ADR 0004): if each screen carried its
 * own copy and one drifted, its envelopes would stop opening.
 *
 * The functions exported before `temperaturePage()` are the pure logic of the component, so they
 * can be tested without mounting Alpine or Chart.js (`tests/js/temperaturePage.test.mjs`).
 */

import Chart from 'chart.js/auto';

import { isUnlocked, ownerId } from '../auth/keyring.js';
import { SESSION_READY_EVENT } from '../auth/sessionBootstrap.js';
import { EnvelopeError } from '../crypto/envelope.js';
import { formatDateTime, joinList, t } from '../i18n/index.js';
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
 * Resolves the LOINC code of a measurement site against the table of the server catalog (ADR 0005,
 * ADR 0008). It never invents one and never falls back to the generic "body temperature" code: if
 * the site is not in the table, it fails visibly, because a wrong LOINC code is a wrong clinical
 * datum and, once encrypted, it cannot be corrected.
 *
 * @param {list<{site: string, code: string}>} loincTable
 * @param {string} site
 * @returns {string}
 * @throws {Error} If there is no code for that site.
 */
export function resolveLoincCode(loincTable, site) {
    const entry = loincTable.find((row) => row.site === site);

    if (entry === undefined) {
        throw new Error(t('temperature.noLoincCode', { site }));
    }

    return entry.code;
}

/**
 * Readable label of a measurement site out of the server catalog.
 *
 * @param {{sites: list<{token: string, label: string}>}} catalog
 * @param {string} site
 * @returns {string}
 */
export function siteLabel(catalog, site) {
    return catalog.sites.find((row) => row.token === site)?.label ?? site;
}

/**
 * Separator of {@see seriesKey}. It splits on the first one, as in blood pressure: no site token
 * carries a vertical bar, but UCUM codes do carry brackets and slashes (`[degF]`), so the
 * separator has to be a character that does not appear in the first piece.
 */
const SERIES_KEY_SEPARATOR = '|';

/**
 * Stable token that groups a reading by measurement site **and** unit. It is not stored in the
 * envelope in this form —`data.site` and `data.unit` travel as fields of their own— but it is the
 * key the chart groups by: the site because ADR 0008 demands it, and the unit because Celsius and
 * Fahrenheit do not share a scale and are not converted (see the module JSDoc).
 *
 * @param {string} site `App\Catalog\TemperatureMeasurementSite` token.
 * @param {string} unit UCUM code.
 * @returns {string}
 */
export function seriesKey(site, unit) {
    return `${site}${SERIES_KEY_SEPARATOR}${unit}`;
}

/**
 * Undoes {@see seriesKey}. It splits on the **first** separator, not on every one.
 *
 * @param {string} key
 * @returns {[string, string]} `[site, unit]`.
 */
export function splitSeriesKey(key) {
    const separatorIndex = key.indexOf(SERIES_KEY_SEPARATOR);

    if (separatorIndex === -1) {
        return [key, ''];
    }

    return [key.slice(0, separatorIndex), key.slice(separatorIndex + 1)];
}

/**
 * Label of a series: measurement site and unit, in that order. Both, and not just the site,
 * because two series of the same site in different units would be indistinguishable.
 *
 * @param {{sites: list<{token: string, label: string}>, units: list<{code: string, label: string}>}} catalog
 * @param {string} key Key of {@see seriesKey}.
 * @returns {string}
 */
export function seriesLabel(catalog, key) {
    const [site, unit] = splitSeriesKey(key);

    return t('temperature.series', {
        site: siteLabel(catalog, site),
        unit: unitLabel(catalog, unit),
    });
}

/**
 * Builds the content in the clear of a temperature event, with the shape of ADR 0006 plus the
 * method of ADR 0008. The value travels as a string, never as a number (ADR 0004: decimals as a
 * string).
 *
 * `common` are the four fields any event type shares (see `eventCommonFields.js`) and they go at
 * the top level of the content, not inside `data`.
 *
 * @param {object} params
 * @param {string} params.value Exactly as the person typed it, already as a string.
 * @param {string} params.unit UCUM code.
 * @param {string} params.site `App\Catalog\TemperatureMeasurementSite` token.
 * @param {string} params.tz `±HH:MM` offset of the moment of recording.
 * @param {{loinc: list<{site: string, code: string}>}} params.catalog
 * @param {{origin: string, recordedBy: string, device?: string, note?: string}} params.common
 *        Already built by `buildCommonEventFields`.
 * @returns {{v: 1, type: 'temperature', tz: string, origin: string, recordedBy: string,
 *           device?: string, note?: string,
 *           data: {value: string, unit: string, loinc: string, site: string}}}
 * @throws {Error} If the value, the unit or the site is missing, or if the site has no LOINC code.
 */
export function buildTemperatureContent({ value, unit, site, tz, catalog, common }) {
    if (typeof value !== 'string' || value.trim() === '') {
        throw new Error(t('temperature.missingValue'));
    }

    if (typeof unit !== 'string' || unit.trim() === '') {
        throw new Error(t('temperature.missingUnit'));
    }

    if (typeof site !== 'string' || site.trim() === '') {
        throw new Error(t('temperature.missingSite'));
    }

    return {
        v: 1,
        type: 'temperature',
        tz,
        ...common,
        data: {
            value,
            unit,
            loinc: resolveLoincCode(catalog.loinc, site),
            site,
        },
    };
}

/**
 * Discards the decrypted events that are not of type `temperature`. The server cannot do this
 * filter because the type travels encrypted inside the envelope (ADR 0006): it is the client's job.
 *
 * @param {list<{id: string, occurredAt: string, content: object}>} events Already decrypted.
 * @returns {list<{id: string, occurredAt: string, content: object}>}
 */
export function filterTemperatureEvents(events) {
    return events.filter((event) => event.content?.type === 'temperature');
}

/**
 * Gap from which the temperature line breaks.
 *
 * A fever is read by the cadence of the readings: five taken every four hours through a bad night
 * are a curve, and the two loose ones of the following week are not its continuation. A full day
 * with nothing measured is exactly the stretch nobody knows anything about, so the line is cut
 * there instead of drawing a slow slide from the fever to the convalescence.
 */
export const MAX_TEMPERATURE_GAP_MS = 24 * 3_600_000;

/**
 * Groups the readings by the (site, unit) pair for the chart. Never by site alone —two scales on
 * one line are not a trend— and never by unit alone, which would mix sites in silence and is
 * exactly what ADR 0008 forbids.
 *
 * The `x` of each point is the wall clock time of whoever took the reading
 * ({@see eventWallClockMs}), not the absolute instant: a temperature taken at 03:00 stays at 03:00
 * whatever zone the chart is opened from, which is what makes a night-time fever readable.
 *
 * @param {list<{id: string, occurredAt: string, content: object}>} temperatureEvents Already
 *        filtered by `filterTemperatureEvents`.
 * @returns {Record<string, list<{x: number, y: number}>>} Indexed by {@see seriesKey}.
 */
export function groupTemperatureBySiteAndUnit(temperatureEvents) {
    /** @type {Record<string, list<{x: number, y: number}>>} */
    const seriesByKey = {};

    for (const event of temperatureEvents) {
        const { data } = event.content;
        const key = seriesKey(data.site, data.unit);
        const at = eventWallClockMs(event.occurredAt, event.content.tz);

        /** An unreadable instant has no place on a time axis: it would land on 1970 or on `NaN`. */
        if (at === null) {
            continue;
        }

        if (seriesByKey[key] === undefined) {
            seriesByKey[key] = [];
        }

        seriesByKey[key].push({ x: at, y: Number(data.value) });
    }

    for (const points of Object.values(seriesByKey)) {
        points.sort((a, b) => a.x - b.x);
    }

    return seriesByKey;
}

/**
 * Text of the chart caption: which series it includes, site and unit, because they are not
 * comparable with each other (ADR 0008).
 *
 * @param {list<string>} labels Labels of the series with data.
 * @returns {string}
 */
export function chartCaptionText(labels) {
    return labels.length > 0
        ? t('temperature.caption.includes', { series: joinList(labels) })
        : t('temperature.caption.empty');
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
 * Whoever does not tell colours apart can still say which line is which measurement site. The
 * colours come from `chartColors()`, which reads them from the theme on every draw (see `chartTheme.js`).
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
 * the flame of `Temperature::$navigationIcon`, so the guide icon of each record is the same as the
 * one of the section. Only the outer outline of the icon is taken: `createIcon` draws a single
 * `<path>` and at 20px the inner flame cannot be told apart, so adding a second stroke would
 * complicate the helper without changing anything visible.
 */
const ICON_PATHS = Object.freeze({
    warning: 'M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 '
        + '1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z',
    info: 'm11.25 11.25.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 '
        + '12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z',
    fire: 'M15.362 5.214A8.252 8.252 0 0 1 12 21 8.25 8.25 0 0 1 6.038 7.047 8.287 8.287 0 0 0 9 '
        + '9.601a8.983 8.983 0 0 1 3.361-6.867 8.21 8.21 0 0 0 3 2.48Z',
});

/**
 * Decorative 20px icon (DESIGN.md § Lists: "20px icon"). It goes with `aria-hidden`: it never
 * carries information that is not also in the text (Do's #3).
 *
 * @param {'warning'|'info'|'fire'} name
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
 * Status chip (DESIGN.md § Chips · Status Chip, info variant): 12px bold in uppercase, 4px radius.
 * It is the chip of the **measurement site**, which is the method of this quantity (ADR 0008), so
 * it gets the same visual treatment as the glucose method or the arm and posture of blood
 * pressure.
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
 * Alpine component factory. Registered as `phrTemperaturePage`.
 *
 * @returns {object}
 */
export function temperaturePage() {
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
            this.catalog = JSON.parse(document.querySelector('[data-phr-temperature-catalog]').textContent);

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
             * The options of `unit` and `site` are rendered by the server in Blade (ADR 0002, ADR
             * 0005): they are not filled in here. See the comment at the start of `temperature.blade.php`.
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
         * means a duplicated reading in the history.
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
                // datum" by `buildTemperatureContent`. The result is still a string: it is not
                // converted to a number (ADR 0004).
                const value = parseNumericValue(this.$refs.value.value.trim(), t('field.temperature'));

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

                const content = buildTemperatureContent({
                    value,
                    unit: this.$refs.unit.value,
                    site: this.$refs.site.value,
                    tz,
                    catalog: this.catalog,
                    common,
                });

                const payload = sealEvent({ userId, occurredAt, content });

                await this.$wire.storeEvent(payload, occurredAt);

                this.$refs.value.value = '';

                /**
                 * The date goes back to "now": if it kept the one of the record just saved, the
                 * next reading would be silently written to a past instant, and a fever with the
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

                const temperatureEvents = filterTemperatureEvents(opened);

                this.renderList(temperatureEvents);
                this.renderChart(temperatureEvents);
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

        /** @param {list<{id: string, occurredAt: string, content: object}>} temperatureEvents */
        renderList(temperatureEvents) {
            const fragment = document.createDocumentFragment();

            if (this.failedToOpenCount > 0) {
                const warning = createCallout({
                    tone: 'error',
                    message: t('common.recordsUndecrypted', { count: this.failedToOpenCount }),
                });
                warning.classList.add('mb-4');
                fragment.appendChild(warning);
            }

            if (temperatureEvents.length === 0) {
                const empty = document.createElement('p');
                empty.className = 'text-body text-ink-secondary';
                empty.textContent = t('temperature.empty');
                fragment.appendChild(empty);
            } else {
                const list = document.createElement('ul');
                list.className = 'flex flex-col';

                for (const event of temperatureEvents) {
                    list.appendChild(this.renderListItem(event));
                }

                fragment.appendChild(list);
            }

            this.$refs.list.replaceChildren(fragment);
        },

        /**
         * History item with the shape of DESIGN.md § Lists, the same as the other screens. The
         * value goes in IBM Plex Mono (Do's #7) and the measurement site is a status chip, so it
         * does not get lost in concatenated text.
         *
         * The `<li>` does NOT carry `hover:` or `active:`: DESIGN.md § Lists reserves those two
         * states for a pressable list element, and this is neither link nor button.
         *
         * @param {{id: string, occurredAt: string, content: object}} event
         * @returns {HTMLLIElement}
         */
        renderListItem(event) {
            const { data } = event.content;

            const item = document.createElement('li');
            item.className = 'flex min-h-12 items-start gap-4 border-b border-border px-4 py-3.5 last:border-b-0';

            item.appendChild(createIcon('fire', 'mt-0.5 size-5 shrink-0 text-accent'));

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

            body.appendChild(measurement);

            const chips = document.createElement('div');
            chips.className = 'flex flex-wrap items-center gap-2';
            chips.appendChild(createStatusChip(siteLabel(this.catalog, data.site)));
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
         * Paints the chart, or paints nothing if there is no data (a canvas with empty axes looks
         * like a bug, not a legitimate empty state). One series per (site, unit) pair, never two
         * sites and never two scales on the same line (see the module JSDoc).
         *
         * The X axis is the shared linear one over the instant (`timeAxis.js`), never a category
         * one: a fever curve is read by the rhythm of the readings, and evenly spaced columns made
         * five readings of one bad night and two of the following week look like the same cadence.
         *
         * @param {list<{id: string, occurredAt: string, content: object}>} temperatureEvents
         */
        renderChart(temperatureEvents) {
            /** They are stored so the chart can be repainted on theme switch (see `init()` and `chartTheme.js`). */
            this.chartEvents = temperatureEvents;

            /** Colours of the active theme, read now and not when the module loaded (`chartTheme.js`). */
            const colors = chartColors();

            const seriesByKey = groupTemperatureBySiteAndUnit(temperatureEvents);
            const keys = Object.keys(seriesByKey);
            const labels = keys.map((key) => seriesLabel(this.catalog, key));

            if (this.chart !== null) {
                this.chart.destroy();
                this.chart = null;
            }

            const timeFormat = chartTimeFormat();
            const instants = keys.flatMap((key) => seriesByKey[key].map((point) => point.x));

            if (instants.length === 0) {
                this.paintLegend([]);
            } else {
                /**
                 * Series descriptors: they are at once what Chart.js consumes and what labels the
                 * legend in HTML (see `chartLegend.js`), so neither of the two can end up with a
                 * colour or a shape different from the other's.
                 */
                const series = keys.map((key, index) => ({
                    label: labels[index],
                    color: colors.series[index % colors.series.length],
                    ...CHART_SERIES_SHAPES[index % CHART_SERIES_SHAPES.length],
                }));

                const datasets = series.map((entry, index) => ({
                    label: entry.label,
                    /**
                     * Each series carries its own points: with a linear axis there is nothing to
                     * line up by position, so the padding `null`s that only existed because another
                     * site had no reading at that instant are gone.
                     */
                    data: splitOnGaps(seriesByKey[keys[index]], MAX_TEMPERATURE_GAP_MS),
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

                /**
                 * Units present, without repeating: the axis label names them all, because with two
                 * scales at once writing only one would say the whole chart is in it.
                 */
                const unitLabels = [...new Set(keys.map((key) => unitLabel(this.catalog, splitSeriesKey(key)[1])))];

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
                                    text: joinList(unitLabels),
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
                legendElementFor(this.$refs.chart, 'temperature-chart-legend'),
                legendItems(series),
            );
        },
    };
}
