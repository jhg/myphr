/**
 * Alpine component of the blood pressure screen (ADR 0002, ADR 0004, ADR 0005, ADR 0006,
 * ADR 0008).
 *
 * The DOM contract is fixed by `resources/views/phr/pages/blood-pressure.blade.php`: no
 * `wire:model` (ADR 0002), the fields are read through `x-ref` and the encrypted envelope goes up
 * as an argument of `storeEvent`, never as a Livewire property.
 *
 * **One event, three values** (ADR 0006): systolic, diastolic and pulse travel together in the
 * same envelope, because that is what the device gives and what the patient lives. The pulse is
 * optional: not every monitor measures it.
 *
 * **The method is made of the arm and the posture** (ADR 0008): both change the value in a known
 * way and are only known at measuring time. Here they travel as two fields of their own
 * (`data.arm`, `data.posture`) instead of a single composite token, so that the list and the
 * selectors treat them separately, but they are **never grouped separately**: any series or
 * average always groups by the (arm, posture) pair together, as the ADR demands — mixing different
 * arms or postures in one series without saying so would be an average that means nothing.
 *
 * **The LOINC code does not depend on the method** (see the JSDoc of
 * `App\Catalog\BloodPressureLoincCode`): the three codes are constant and arrive already resolved
 * in `catalog.loinc`, so, unlike glucose, no (method, unit) → code table has to be resolved.
 *
 * **The server cannot filter by type** (ADR 0006): `fetchEvents` brings every event of the user
 * and here each one is decrypted and whatever is not `type === 'bloodPressure'` is discarded. An
 * envelope that does not open does not take the screen down: it is counted and reported (ADR 0004).
 *
 * **The four fields common to every event** (origin, device, who records, note; ADR 0006) are not
 * built here: they live in `eventCommonFields.js` and `buildBloodPressureContent` receives them
 * already built, to spread them at the top level of the content, never inside `data`.
 *
 * **The origin is not asked for in the form.** `origin` tells apart how the datum entered the
 * application —typed by a person versus imported automatically from a device—, and on this screen
 * the insertion is always manual: a value is read on a monitor and typed in, so asking has no real
 * answer and only invites a wrong one. `submit()` fixes it to `'manual'` without reading any DOM
 * field; the device (`device`) is useful (what it was measured with) and keeps its field. The day
 * an automatic import from a device exists, that flow will be the one setting `origin: 'device'`,
 * not this form.
 *
 * **The event date is not converted here.** `datetimeLocalToCanonical` lives in `datetimeLocal.js`
 * because what it returns enters as AEAD associated data (ADR 0004): if each screen carried its
 * own copy and one drifted, its envelopes would stop opening.
 *
 * The functions exported before `bloodPressurePage()` are the pure logic of the component, so they
 * can be tested without mounting Alpine or Chart.js (`tests/js/bloodPressurePage.test.mjs`).
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

/** Separator of {@see methodKey}. No arm token carries it, hence the split on the first one. */
const METHOD_KEY_SEPARATOR = '_';

/**
 * Stable token that groups a reading by method (ADR 0008): the (arm, posture) pair together,
 * never separately. It is not stored in the envelope in this form —`data.arm` and `data.posture`
 * travel as fields of their own— but it is the key the chart and any statistic group by.
 *
 * @param {string} arm `App\Catalog\BloodPressureArm` token.
 * @param {string} posture `App\Catalog\BloodPressurePosture` token.
 * @returns {string}
 */
export function methodKey(arm, posture) {
    return `${arm}${METHOD_KEY_SEPARATOR}${posture}`;
}

/**
 * Undoes {@see methodKey}. It splits on the **first** separator, not on every one: if some day a
 * posture token were composite (`semi_recumbent`), a plain `split('_')` would return three pieces
 * and the method label would come out wrong, in silence. The tokens cannot change once published
 * (see `App\Catalog\BloodPressureArm`), but new cases can appear.
 *
 * @param {string} key
 * @returns {[string, string]} `[arm, posture]`.
 */
export function splitMethodKey(key) {
    const separatorIndex = key.indexOf(METHOD_KEY_SEPARATOR);

    if (separatorIndex === -1) {
        return [key, ''];
    }

    return [key.slice(0, separatorIndex), key.slice(separatorIndex + 1)];
}

/**
 * Readable label of a method (arm + posture), out of the server catalog.
 *
 * @param {{arms: list<{token: string, label: string}>, postures: list<{token: string, label: string}>}} catalog
 * @param {string} arm
 * @param {string} posture
 * @returns {string}
 */
export function methodLabel(catalog, arm, posture) {
    const armLabel = catalog.arms.find((row) => row.token === arm)?.label ?? arm;
    const postureLabel = catalog.postures.find((row) => row.token === posture)?.label ?? posture;

    return `${armLabel}, ${postureLabel}`;
}

/**
 * Builds the content in the clear of a blood pressure event, with the shape of ADR 0006 plus the
 * method of ADR 0008. The three values travel as strings, never as numbers (ADR 0004: decimals as
 * a string).
 *
 * `common` are the four fields any event type shares (see `eventCommonFields.js`) and they go at
 * the top level of the content, not inside `data`. The pulse is optional: if it is not given
 * (empty string or absent), neither `data.pulse` nor `data.pulseUnit` nor `data.loinc.pulse` enter
 * the content, instead of being stored as an empty string.
 *
 * `data.loinc` brings the three LOINC codes already resolved by the server (`catalog.loinc`),
 * because they do not depend on the method (see the JSDoc of `bloodPressurePage.js`).
 *
 * @param {object} params
 * @param {string} params.systolic Exactly as the person typed it, already as a string.
 * @param {string} params.diastolic Exactly as the person typed it, already as a string.
 * @param {string} [params.pulse] Exactly as the person typed it, already as a string, or empty/absent.
 * @param {string} params.arm `App\Catalog\BloodPressureArm` token.
 * @param {string} params.posture `App\Catalog\BloodPressurePosture` token.
 * @param {string} params.tz `±HH:MM` offset of the moment of recording.
 * @param {{units: {pressure: string, pulse: string}, loinc: {systolic: string, diastolic: string, pulse: string}}} params.catalog
 * @param {{origin: string, recordedBy: string, device?: string, note?: string}} params.common
 *        Already built by `buildCommonEventFields`.
 * @returns {{v: 1, type: 'bloodPressure', tz: string, origin: string, recordedBy: string,
 *           device?: string, note?: string, data: {systolic: string, diastolic: string,
 *           pulse?: string, unit: string, pulseUnit?: string,
 *           loinc: {systolic: string, diastolic: string, pulse?: string},
 *           arm: string, posture: string}}}
 * @throws {Error} If the systolic, the diastolic, the arm or the posture is missing.
 */
export function buildBloodPressureContent({ systolic, diastolic, pulse, arm, posture, tz, catalog, common }) {
    if (typeof systolic !== 'string' || systolic.trim() === '') {
        throw new Error(t('bloodPressure.missingSystolic'));
    }

    if (typeof diastolic !== 'string' || diastolic.trim() === '') {
        throw new Error(t('bloodPressure.missingDiastolic'));
    }

    if (typeof arm !== 'string' || arm.trim() === '') {
        throw new Error(t('bloodPressure.missingArm'));
    }

    if (typeof posture !== 'string' || posture.trim() === '') {
        throw new Error(t('bloodPressure.missingPosture'));
    }

    const data = {
        systolic,
        diastolic,
        unit: catalog.units.pressure,
        loinc: {
            systolic: catalog.loinc.systolic,
            diastolic: catalog.loinc.diastolic,
        },
        arm,
        posture,
    };

    const trimmedPulse = typeof pulse === 'string' ? pulse.trim() : '';

    if (trimmedPulse !== '') {
        data.pulse = trimmedPulse;
        data.pulseUnit = catalog.units.pulse;
        data.loinc.pulse = catalog.loinc.pulse;
    }

    return {
        v: 1,
        type: 'bloodPressure',
        tz,
        ...common,
        data,
    };
}

/**
 * Discards the decrypted events that are not of type `bloodPressure`. The server cannot do this
 * filter because the type travels encrypted inside the envelope (ADR 0006): it is the client's
 * job.
 *
 * @param {list<{id: string, occurredAt: string, content: object}>} events Already decrypted.
 * @returns {list<{id: string, occurredAt: string, content: object}>}
 */
export function filterBloodPressureEvents(events) {
    return events.filter((event) => event.content?.type === 'bloodPressure');
}

/**
 * Gap from which the pressure and pulse lines break.
 *
 * Blood pressure is taken in bursts: two or three readings one morning, and the next ones days
 * later. Joining the readings of one same day is right —that is the burst— and so is joining two
 * consecutive days; from three days on, the segment crosses a stretch where nothing was measured
 * and starts stating a change nobody took.
 */
export const MAX_BLOOD_PRESSURE_GAP_MS = 3 * 86_400_000;

/**
 * Groups the systolic and diastolic readings by method —arm and posture together (ADR 0008)— for
 * the main chart. It never groups by arm or posture separately.
 *
 * The `x` of each point is the wall clock time of whoever measured ({@see eventWallClockMs}), not
 * the absolute instant: a reading taken at 08:00 stays at 08:00 whatever zone the chart is opened
 * from, which is the same rule the home dashboard follows.
 *
 * @param {list<{id: string, occurredAt: string, content: object}>} bpEvents Already filtered by
 *        `filterBloodPressureEvents`.
 * @returns {Record<string, {systolic: list<{x: number, y: number}>, diastolic: list<{x: number, y: number}>}>}
 */
export function groupBloodPressureByMethod(bpEvents) {
    /** @type {Record<string, {systolic: list<{x: number, y: number}>, diastolic: list<{x: number, y: number}>}>} */
    const seriesByMethod = {};

    for (const event of bpEvents) {
        const { data } = event.content;
        const key = methodKey(data.arm, data.posture);
        const x = eventWallClockMs(event.occurredAt, event.content.tz);

        /** An unreadable instant has no place on a time axis: it would land on 1970 or on `NaN`. */
        if (x === null) {
            continue;
        }

        if (seriesByMethod[key] === undefined) {
            seriesByMethod[key] = { systolic: [], diastolic: [] };
        }

        seriesByMethod[key].systolic.push({ x, y: Number(data.systolic) });
        seriesByMethod[key].diastolic.push({ x, y: Number(data.diastolic) });
    }

    for (const group of Object.values(seriesByMethod)) {
        group.systolic.sort((a, b) => a.x - b.x);
        group.diastolic.sort((a, b) => a.x - b.x);
    }

    return seriesByMethod;
}

/**
 * Groups the pulse by method —arm and posture together, same criterion as
 * `groupBloodPressureByMethod`— for the pulse chart, apart from the pressure one. The pulse is
 * optional (not every device gives it), so readings with no pulse are counted and left out instead
 * of entering as a zero.
 *
 * @param {list<{id: string, occurredAt: string, content: object}>} bpEvents Already filtered by
 *        `filterBloodPressureEvents`.
 * @returns {{seriesByMethod: Record<string, list<{x: number, y: number}>>, missingPulseCount: number}}
 */
export function groupPulseByMethod(bpEvents) {
    /** @type {Record<string, list<{x: number, y: number}>>} */
    const seriesByMethod = {};
    let missingPulseCount = 0;

    for (const event of bpEvents) {
        const { data } = event.content;

        if (typeof data.pulse !== 'string' || data.pulse === '') {
            missingPulseCount += 1;

            continue;
        }

        const key = methodKey(data.arm, data.posture);
        const at = eventWallClockMs(event.occurredAt, event.content.tz);

        /** An unreadable instant has no place on a time axis: it would land on 1970 or on `NaN`. */
        if (at === null) {
            continue;
        }

        if (seriesByMethod[key] === undefined) {
            seriesByMethod[key] = [];
        }

        seriesByMethod[key].push({ x: at, y: Number(data.pulse) });
    }

    for (const points of Object.values(seriesByMethod)) {
        points.sort((a, b) => a.x - b.x);
    }

    return { seriesByMethod, missingPulseCount };
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
 * Second encoding of the method, besides the colour (Do's #3): the dash pattern. Whoever does not
 * tell colours apart —colour blindness, black and white screen, printing— can still say which line
 * is which method, and ADR 0008 forbids mixing methods in silence.
 *
 * One colour per method (ADR 0008), not per quantity, and they come from `chartColors()`, which
 * reads them from the theme on every draw (see `chartTheme.js`).
 */
const CHART_METHOD_DASHES = Object.freeze([
    Object.freeze([]),
    Object.freeze([6, 4]),
    Object.freeze([2, 3]),
]);

/**
 * Third encoding, this one for the quantity inside one same method: the systolic goes as a circle
 * and the diastolic as a triangle. That way, in the pressure chart, neither the method nor the
 * quantity depends on colour alone.
 */
const CHART_POINT_STYLES = Object.freeze({ systolic: 'circle', diastolic: 'triangle', pulse: 'circle' });

/** Families of DESIGN.md § Typography, declared by name because a `<canvas>` reads no CSS variables. */
const CHART_FONTS = Object.freeze({
    body: "'Open Sans', ui-sans-serif, system-ui, sans-serif",
    mono: "'IBM Plex Mono', ui-monospace, monospace",
});

/**
 * Default family and size of the whole canvas, in the only place Chart.js accepts them:
 * `Chart.defaults.font`. There is no `font` key at the root of `options` —there used to be one
 * here and it was dead configuration pretending to cover what it did not—, because Chart.js
 * resolves the typography of each element against these defaults.
 */
Chart.defaults.font.family = CHART_FONTS.body;
Chart.defaults.font.size = 13;

/**
 * Heroicons v2 paths (outline, 24×24), the same family the panel uses. The one in the history is
 * the heart of `BloodPressure::$navigationIcon`, so the guide icon of each record is the same as
 * the one of the section.
 */
const ICON_PATHS = Object.freeze({
    warning: 'M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 '
        + '1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z',
    info: 'm11.25 11.25.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 '
        + '12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z',
    heart: 'M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 '
        + '3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12Z',
});

/**
 * Decorative 20px icon (DESIGN.md § Lists: "20px icon"). It goes with `aria-hidden`: it never
 * carries information that is not also in the text (Do's #3).
 *
 * @param {'warning'|'info'|'heart'} name
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
 * Block notice with an icon (DESIGN.md § Chips (Status Chip)): colour + icon + text, never colour
 * alone (Do's #3).
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
     * the `danger`/`primary` ramps: those ramps are not reassigned in dark, so the notice came out
     * in dark theme as a light pink rectangle with pink ink. Besides, the error ink of the tokens
     * is #B91C1C and not the #DC2626 of § Chips, which over #FEF2F2 gives 4.41:1 and does not
     * reach the 4.5:1 of Do's #1. Same tokens and same classes as `glucosePage.js`.
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
 * Status chip (DESIGN.md § Chips · Status Chip, info variant): 12px bold in uppercase, 4px radius.
 * It is the chip of the **measurement method**, as in `glucosePage.js`: arm and posture are what
 * ADR 0008 calls the method, so they get the same visual treatment as the glucose method and not
 * that of a secondary filter.
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
 * passing the cursor and the limit too, and the usual value is repeated here so as not to change
 * in passing how many events come down on each load.
 */
const HISTORY_FETCH_LIMIT = 100;

/**
 * Alpine component factory. Registered as `phrBloodPressurePage`.
 *
 * @returns {object}
 */
export function bloodPressurePage() {
    return {
        ...savedNotice(),
        ...dateRangeControl(),

        error: '',
        catalog: null,
        loading: false,

        /** Decrypted envelopes that failed to open on the last load (they do not take the screen down). */
        failedToOpenCount: 0,

        /** Live Chart.js instances, so they can be destroyed before repainting. */
        chart: null,
        pulseChart: null,

        /**
         * Last events that were painted. It is not a data cache: it is what lets both charts be
         * rebuilt when the theme changes without asking for or decrypting anything again (`chartTheme.js`).
         */
        chartEvents: [],

        init() {
            this.catalog = JSON.parse(document.querySelector('[data-phr-blood-pressure-catalog]').textContent);

            /**
             * DESIGN.md § Charts — Dark: the chart has to re-read the colours and repaint when
             * `<html>` enters or leaves dark mode, or the whole panel switches except the charts.
             */
            observeThemeChange(() => {
                if (this.chart !== null || this.pulseChart !== null) {
                    this.renderCharts(this.chartEvents);
                }
            });

            /**
             * The options of `arm` and `posture` are rendered by the server in Blade (ADR 0002,
             * ADR 0005): they are not filled in here. See the comment at the start of
             * `blood-pressure.blade.php`.
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
         * means a duplicated reading in the history. The template uses it to disable the button, set
         * `aria-busy` and change the text (Do's #3), as glucose does.
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

                // Validates the numeric format and normalizes the comma to a dot (see the JSDoc of
                // `numericValue.js`); the empty string passes untouched and is detected as "missing
                // datum" by `buildBloodPressureContent` below. The result is still a string: it is
                // not converted to a number (ADR 0004).
                const systolic = parseNumericValue(this.$refs.systolic.value.trim(), t('field.systolic'));
                const diastolic = parseNumericValue(this.$refs.diastolic.value.trim(), t('field.diastolic'));
                const pulse = parseNumericValue(this.$refs.pulse.value.trim(), t('field.pulse'));

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

                const content = buildBloodPressureContent({
                    systolic,
                    diastolic,
                    pulse,
                    arm: this.$refs.arm.value,
                    posture: this.$refs.posture.value,
                    tz,
                    catalog: this.catalog,
                    common,
                });

                const payload = sealEvent({ userId, occurredAt, content });

                await this.$wire.storeEvent(payload, occurredAt);

                this.$refs.systolic.value = '';
                this.$refs.diastolic.value = '';
                this.$refs.pulse.value = '';

                await this.loadHistory();

                /** At the very end: the notice confirms the whole operation, not just the POST. */
                this.confirmSaved();
            } catch (failure) {
                this.error = describeError(failure);
            } finally {
                this.loading = false;
            }
        },

        /** Downloads, decrypts, filters and paints the history (list and charts). */
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

                const bpEvents = filterBloodPressureEvents(opened);

                this.renderList(bpEvents);
                this.renderCharts(bpEvents);
            } catch (failure) {
                this.error = describeError(failure);
            } finally {
                this.loading = false;
            }
        },

        /** With no key nothing can be decrypted: it is said, no empty list is painted. */
        renderLocked() {
            this.$refs.list.replaceChildren(createCallout({ tone: 'info', message: t('common.locked.history') }));
        },

        /** @param {list<{id: string, occurredAt: string, content: object}>} bpEvents */
        renderList(bpEvents) {
            const fragment = document.createDocumentFragment();

            if (this.failedToOpenCount > 0) {
                const warning = createCallout({
                    tone: 'error',
                    message: t('common.recordsUndecrypted', { count: this.failedToOpenCount }),
                });
                warning.classList.add('mb-4');
                fragment.appendChild(warning);
            }

            if (bpEvents.length === 0) {
                const empty = document.createElement('p');
                empty.className = 'text-body text-ink-secondary';
                empty.textContent = t('bloodPressure.empty');
                fragment.appendChild(empty);
            } else {
                const list = document.createElement('ul');
                list.className = 'flex flex-col';

                for (const event of bpEvents) {
                    list.appendChild(this.renderListItem(event));
                }

                fragment.appendChild(list);
            }

            this.$refs.list.replaceChildren(fragment);
        },

        /**
         * History item with the shape of DESIGN.md § Lists, the same as glucose. The value goes in
         * IBM Plex Mono (Do's #7); the method (arm + posture) becomes a status chip, so it does not
         * get lost in concatenated text.
         *
         * The `<li>` does NOT carry `hover:` or `active:`: DESIGN.md § Lists reserves those two
         * states for a pressable list element, and this is neither link nor button —it has no
         * destination, no handler and no focus—. Promising an interaction that does not happen is
         * worse than not promising it; same criterion as in `glucosePage.js`.
         *
         * @param {{id: string, occurredAt: string, content: object}} event
         * @returns {HTMLLIElement}
         */
        renderListItem(event) {
            const { data } = event.content;

            const item = document.createElement('li');
            item.className = 'flex min-h-12 items-start gap-4 border-b border-border px-4 py-3.5 last:border-b-0';

            item.appendChild(createIcon('heart', 'mt-0.5 size-5 shrink-0 text-accent'));

            const body = document.createElement('div');
            body.className = 'flex flex-1 flex-col gap-2';

            /** First line: the measurement. It goes in monospace and in the main text #0F172A. */
            const measurement = document.createElement('p');
            measurement.className = 'font-mono text-body text-ink';

            /**
             * No `font-semibold`: only weight 400 of IBM Plex Mono is bundled (§ Typography · Code
             * defines it as "regular"), so asking for 600 would make the browser synthesize a fake
             * bold, fattening exactly the numeric glyphs Do's #7 wants unmistakable. Same reason as
             * in `glucosePage.js`.
             */
            const values = document.createElement('span');
            values.textContent = `${data.systolic}/${data.diastolic}`;
            measurement.appendChild(values);

            const unit = document.createElement('span');
            unit.className = 'ml-1 text-ink-secondary';
            unit.textContent = data.unit;
            measurement.appendChild(unit);

            /**
             * The pulse used to carry a `♥` in front. A symbol is not a label: a screen reader
             * reads it "black heart" and whoever does not recognize it does not know what that
             * third number is (Do's #3, meaning never travels alone in an ornament). It goes with its word.
             */
            if (typeof data.pulse === 'string' && data.pulse !== '') {
                const pulse = document.createElement('span');
                pulse.className = 'ml-3 text-ink-secondary';
                pulse.textContent = t('bloodPressure.pulseInline', {
                    value: data.pulse,
                    unit: data.pulseUnit ?? '',
                }).trim();
                measurement.appendChild(pulse);
            }

            body.appendChild(measurement);

            const chips = document.createElement('div');
            chips.className = 'flex flex-wrap items-center gap-2';
            chips.appendChild(createStatusChip(methodLabel(this.catalog, data.arm, data.posture)));
            body.appendChild(chips);

            /**
             * Secondary text: timestamp and LOINC codes, both numeric → monospace, and in the Code
             * size of § Typography (14px), which is the role DESIGN.md defines for "medical codes,
             * IDs, data fields". Same date format as the other screens: `formatDateTime`, in the
             * active language.
             */
            const loincCodes = [data.loinc?.systolic, data.loinc?.diastolic, data.loinc?.pulse]
                .filter((code) => typeof code === 'string' && code !== '')
                .join(', ');

            const meta = document.createElement('p');
            meta.className = 'font-mono text-code text-ink-secondary';
            meta.textContent = `${formatDateTime(event.occurredAt)} · LOINC ${loincCodes}`;
            body.appendChild(meta);

            item.appendChild(body);

            return item;
        },

        /**
         * Paints both charts: pressure (systolic and diastolic) and pulse, apart from each other
         * (the pulse does not share a scale with the pressure). Neither mixes different arms or
         * postures in one same series without saying so (ADR 0008): each method has its own pair of
         * coloured series and its label says so in the legend.
         *
         * Both use the shared linear X axis over the instant (`timeAxis.js`), never a category one:
         * three readings of one same morning and one from a month ago used to come out evenly
         * spaced, and the burst —which is what makes those three readings one single measurement—
         * looked exactly like four loose ones.
         *
         * @param {list<{id: string, occurredAt: string, content: object}>} bpEvents
         */
        renderCharts(bpEvents) {
            /** They are stored so the chart can be repainted on theme switch (see `init()` and `chartTheme.js`). */
            this.chartEvents = bpEvents;

            /** Colours of the active theme, read now and not when the module loaded (`chartTheme.js`). */
            const colors = chartColors();

            const seriesByMethod = groupBloodPressureByMethod(bpEvents);
            const { seriesByMethod: pulseSeriesByMethod, missingPulseCount } = groupPulseByMethod(bpEvents);

            const methods = Object.keys(seriesByMethod);
            const pulseMethods = Object.keys(pulseSeriesByMethod);

            if (this.chart !== null) {
                this.chart.destroy();
                this.chart = null;
            }

            if (this.pulseChart !== null) {
                this.pulseChart.destroy();
                this.pulseChart = null;
            }

            this.chart = this.buildLineChart({
                canvas: this.$refs.chart,
                legendElement: legendElementFor(this.$refs.chart, 'blood-pressure-chart-legend'),
                methods,
                labelFor: (method, index) => {
                    const label = methodLabel(this.catalog, ...splitMethodKey(method));
                    const color = colors.series[index % colors.series.length];
                    const borderDash = CHART_METHOD_DASHES[index % CHART_METHOD_DASHES.length];

                    return [
                        {
                            label: t('bloodPressure.series.systolic', { method: label }),
                            points: seriesByMethod[method].systolic,
                            color,
                            borderDash,
                            pointStyle: CHART_POINT_STYLES.systolic,
                        },
                        {
                            label: t('bloodPressure.series.diastolic', { method: label }),
                            points: seriesByMethod[method].diastolic,
                            color,
                            borderDash,
                            pointStyle: CHART_POINT_STYLES.diastolic,
                        },
                    ];
                },
                yTitle: this.catalog.units.pressure,
            });

            this.pulseChart = this.buildLineChart({
                canvas: this.$refs.pulseChart,
                legendElement: legendElementFor(this.$refs.pulseChart, 'blood-pressure-pulse-chart-legend'),
                methods: pulseMethods,
                labelFor: (method, index) => [
                    {
                        label: methodLabel(this.catalog, ...splitMethodKey(method)),
                        points: pulseSeriesByMethod[method],
                        color: colors.series[index % colors.series.length],
                        borderDash: CHART_METHOD_DASHES[index % CHART_METHOD_DASHES.length],
                        pointStyle: CHART_POINT_STYLES.pulse,
                    },
                ],
                yTitle: this.catalog.units.pulse,
            });

            this.renderChartCaption({ methods, pulseMethods, missingPulseCount });
        },

        /**
         * Builds a line chart over the shared linear time axis, or paints nothing if there are no
         * points (a canvas with empty axes looks like a bug, not a legitimate empty state).
         *
         * @param {object} params
         * @param {HTMLCanvasElement} params.canvas
         * @param {HTMLElement|null} params.legendElement Legend node in HTML, outside the canvas
         *        (see `chartLegend.js`). It is always repainted, including when there is no data: a
         *        legend outliving an empty chart would describe lines that are not there.
         * @param {list<string>} params.methods
         * @param {(method: string, index: number) => list<{label: string, points: list<{x: number, y: number}>, color: string, borderDash: list<number>, pointStyle: string}>} params.labelFor
         * @param {string} params.yTitle
         * @returns {Chart|null}
         */
        buildLineChart({ canvas, legendElement, methods, labelFor, yTitle }) {
            /** Colours of the active theme, read now and not when the module loaded (`chartTheme.js`). */
            const colors = chartColors();

            const allSeries = methods.flatMap((method, index) => labelFor(method, index));
            const timeFormat = chartTimeFormat();
            const instants = allSeries.flatMap((series) => series.points.map((point) => point.x));

            if (instants.length === 0) {
                renderLegend(legendElement, []);

                return null;
            }

            /**
             * `allSeries` is at once what Chart.js consumes and what labels the legend: one single
             * source, so neither of the two can end up with a colour, a dash or a shape different
             * from the other's.
             */
            renderLegend(legendElement, legendItems(allSeries));

            const datasets = allSeries.map((series) => ({
                label: series.label,
                /**
                 * Each series carries its own points: with a linear axis there is nothing to line
                 * up by position, so the padding `null`s that only existed because another method
                 * had no reading at that instant are gone.
                 */
                data: splitOnGaps(series.points, MAX_BLOOD_PRESSURE_GAP_MS),
                borderColor: series.color,
                backgroundColor: series.color,
                pointBackgroundColor: series.color,
                pointBorderColor: colors.surface,
                pointBorderWidth: 2,
                pointRadius: 4,
                pointHoverRadius: 6,
                borderWidth: 2,
                /** Second and third encoding, besides the colour (Do's #3). */
                borderDash: [...series.borderDash],
                pointStyle: series.pointStyle,
                tension: 0.3,
                /** `spanGaps` false (out of the box): the breaks `splitOnGaps` opened are breaks. */
            }));

            return new Chart(canvas, {
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
                                text: yTitle,
                                color: colors.tick,
                                /**
                                 * Weight 400: only that one of IBM Plex Mono is bundled, and
                                 * asking for 600 would force the browser to synthesize a fake bold
                                 * over the UCUM code of the unit.
                                 */
                                font: { family: CHART_FONTS.mono, size: 13, weight: 400 },
                            },
                        },
                    },
                    plugins: {
                        /**
                         * The legend lives outside the canvas, in HTML (see `chartLegend.js`). This
                         * is the screen that took it worst: each method generates TWO series
                         * ("Systolic · Left, sitting" and its diastolic), so three methods are six
                         * long entries and their height —which Chart.js subtracts from the data
                         * area— depended on the window width.
                         */
                        legend: { display: false },
                        /**
                         * The background/ink pair comes from the theme: the tooltip is the only
                         * component that inverts against the interface (§ Charts — Dark).
                         */
                        tooltip: {
                            /**
                             * With a linear axis the title has to be stated: the free one of the
                             * category axis is gone, and without this the heading would be the raw
                             * epoch number.
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
        },

        /**
         * Captions of both charts: which methods each one includes (ADR 0008) and how many records
         * had no pulse and were left out of the pulse one.
         *
         * Both `<p>` are painted by Blade, not by this method. They used to be created here and
         * inserted `afterend` of the `<canvas>`, that is INSIDE the fixed-height container:
         * Chart.js demands that the parent of the canvas be exclusively its own when it runs with
         * `maintainAspectRatio: false`, and a sibling inside can trigger the resize loop. Besides,
         * being painted by Blade they have a stable `id` and can be the `aria-describedby` of the
         * canvas, which is the only way the trend reaches whoever does not see the chart (Do's #3).
         *
         * @param {object} params
         * @param {list<string>} params.methods Methods with data in the pressure chart.
         * @param {list<string>} params.pulseMethods Methods with data in the pulse chart.
         * @param {number} params.missingPulseCount
         */
        renderChartCaption({ methods, pulseMethods, missingPulseCount }) {
            const labelsOf = (keys) => keys.map((key) => methodLabel(this.catalog, ...splitMethodKey(key)));

            const methodLabels = labelsOf(methods);

            this.$refs.chartCaption.textContent = methodLabels.length > 0
                ? t('bloodPressure.caption.includes', { methods: joinList(methodLabels) })
                : t('bloodPressure.caption.empty');

            const pulseMethodLabels = labelsOf(pulseMethods);

            /**
             * With no pulse recorded at all the caption used to say "Every record with a pulse is
             * shown", which over an empty chart reads as there being nothing to see when there may
             * well be pressures recorded without a pulse. Both things are said.
             */
            const includedText = pulseMethodLabels.length > 0
                ? t('bloodPressure.pulseCaption.includes', { methods: joinList(pulseMethodLabels) })
                : t('bloodPressure.pulseCaption.empty');

            const missingText = missingPulseCount > 0
                ? t('bloodPressure.pulseCaption.missing', { count: missingPulseCount })
                : '';

            this.$refs.pulseChartCaption.textContent = `${includedText}${missingText}`;
        },
    };
}
