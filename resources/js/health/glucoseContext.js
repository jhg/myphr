/**
 * The glucose curve with the meal and insulin markers on top (ADR 0004, ADR 0006, ADR 0007,
 * ADR 0008).
 *
 * **Why it is the chart that matters most.** No per-type screen can show the relation between
 * eating, injecting and what the glucose does afterwards, and that is exactly what is looked at in
 * an appointment: not "how was yesterday's mean", but "what happened two hours after that meal".
 * It also comes almost free in requests: the server cannot filter by type (ADR 0006), so the
 * request already made for the summary brings down the three types of the period.
 *
 * Pure logic: no DOM and no Chart.js, so it can be tested without mounting anything
 * (`tests/js/glucoseContext.test.mjs`). `health/glucoseContextChart.js` paints it.
 *
 * Decisions this module implements and is not the place to revisit:
 *
 * - **One series per measurement method** (ADR 0008): a capillary glucose reading and an
 *   interstitial one are not the same datum and do not share a line.
 * - **Hours with no readings go as a gap**, never as a zero ({@see MAX_READING_GAP_MS}): a zero is
 *   a reading, and a false one. And a straight twelve-hour line between two points asserts a path
 *   nobody measured.
 * - **Nothing is converted between units** (ADR 0007): one single unit is drawn and the rest is
 *   counted in `excludedByUnit` so the caption can state it.
 * - **The time is the one on the clock of whoever recorded it** ({@see eventWallClockMs}), not the
 *   browser's.
 * - **Nothing is clipped in silence**: what does not fit is counted in `omittedReadings`,
 *   `omittedMarkers` and `groupedMarkers`.
 */

import { eventWallClockMs } from './dailyBands.js';
import { catalogLabel, formatMeasuredValue, INSULIN_TYPE_KEYS, MEAL_TYPE_KEYS } from './eventLabels.js';
import { t } from '../i18n/index.js';
import { toFiniteNumber } from './statistics.js';

/**
 * Cap on drawn readings.
 *
 * An interstitial sensor leaves one reading every five minutes: a month is more than eight
 * thousand points, which is a smudge before it is a curve. When it goes over, the **most recent**
 * ones are kept and how many were left out is stated, because a silent clip reads as "there was nothing before".
 */
export const MAX_CONTEXT_READINGS = 1500;

/**
 * Gap from which the line breaks.
 *
 * It is not a clinical threshold, it is graphical honesty: between two readings eight hours apart
 * there is no measurement, so joining them with a segment would draw a night-time glucose value
 * nobody took. Six hours keeps the readings of a normal day joined (before and after each meal)
 * and breaks the night, which is exactly the stretch nothing is known about.
 */
export const MAX_READING_GAP_MS = 6 * 3_600_000;

/**
 * Initial window to group neighbouring markers, and cap on drawn markers.
 *
 * With many events the markers turn into an unreadable fence stuck to the axis. The way out is not
 * hiding them: it is grouping the ones that fall together into a single marker that says how many
 * it carries inside ({@see clusterMarkers}), and stating the grouped total in the caption.
 */
export const MARKER_CLUSTER_MS = 20 * 60_000;
export const MAX_MARKERS = 90;

/** Cap on the grouping window: more than three hours is no longer "what happened at the same time". */
const MAX_CLUSTER_MS = 3 * 3_600_000;

/** How many concrete labels a grouped marker keeps; the rest is counted, not listed. */
const MAX_CLUSTER_ITEMS = 4;

/**
 * Label of a meal: the meal type, which is what is read at a glance. What was eaten is in the
 * timeline, which is where it fits.
 *
 * @param {object} data Decrypted envelope of the event.
 * @returns {string}
 */
function mealLabel(data) {
    return catalogLabel(MEAL_TYPE_KEYS, data?.mealType) || t('dashboard.timeline.type.meal');
}

/**
 * Label of an injection: **the dose with its unit**, which is the datum the marker has to carry,
 * and the insulin type behind it when the envelope brings it.
 *
 * An injection with no readable dose is still an injection and is drawn all the same: what
 * happened happened, and hiding the marker over a missing field would erase it from the chart.
 *
 * @param {object} data
 * @returns {string}
 */
function insulinLabel(data) {
    const dose = formatMeasuredValue(data?.dose);
    const type = catalogLabel(INSULIN_TYPE_KEYS, data?.insulinType);

    if (dose === '') {
        return { label: type || t('dashboard.timeline.type.insulin'), short: '' };
    }

    const measured = t('dashboard.timeline.measurement', { value: dose, unit: data?.unit ?? '' });

    /**
     * `short` is what is written **next to the marker** when few fit: the dose, which is the datum
     * the insulin marker has to carry on top without forcing anybody to hover over it.
     */
    return { label: type === '' ? measured : `${measured} · ${type}`, short: measured };
}

/**
 * Groups markers of the same kind that fall inside one window.
 *
 * The resulting marker is placed at the instant of the **first** of the group and not at the
 * average: an average would invent an instant when nothing happened. What it carries inside is
 * stated in the detail and in the count.
 *
 * @param {list<{x: number, label: string, short: string}>} marks Already sorted by instant.
 * @param {number} window Milliseconds.
 * @returns {list<{x: number, count: number, items: list<string>, short: string}>}
 */
function clusterMarkers(marks, window) {
    /** @type {list<{x: number, count: number, items: list<string>, short: string}>} */
    const clusters = [];

    for (const mark of marks) {
        const last = clusters[clusters.length - 1];

        if (last !== undefined && mark.x - last.x <= window) {
            last.count += 1;

            if (last.items.length < MAX_CLUSTER_ITEMS) {
                last.items.push(mark.label);
            }

            continue;
        }

        clusters.push({ x: mark.x, count: 1, items: [mark.label], short: mark.short });
    }

    return clusters;
}

/**
 * Groups until they fit, widening the window. Returns the grouped markers of both kinds.
 *
 * @param {Record<string, list<{x: number, label: string}>>} byKind
 * @returns {{markers: list<object>, grouped: number}}
 */
function foldMarkers(byKind) {
    const total = Object.values(byKind).reduce((count, marks) => count + marks.length, 0);
    let window = MARKER_CLUSTER_MS;
    let markers = [];

    do {
        markers = Object.entries(byKind).flatMap(([kind, marks]) => clusterMarkers(marks, window)
            .map((cluster) => ({ kind, ...cluster })));
        window *= 2;
    } while (markers.length > MAX_MARKERS && window <= MAX_CLUSTER_MS);

    return { markers, grouped: total - markers.length };
}

/**
 * Splits a sorted series wherever the gap between two readings goes over {@see MAX_READING_GAP_MS}.
 *
 * The cut is made with a point of value `null` in the middle, which is what Chart.js draws as a
 * break with `spanGaps` false.
 *
 * @param {list<{x: number, y: number}>} points
 * @returns {list<{x: number, y: number|null}>}
 */
function splitOnGaps(points) {
    const withGaps = [];

    for (const [index, point] of points.entries()) {
        const previous = points[index - 1];

        if (previous !== undefined && point.x - previous.x > MAX_READING_GAP_MS) {
            withGaps.push({ x: (previous.x + point.x) / 2, y: null });
        }

        withGaps.push(point);
    }

    return withGaps;
}

/**
 * Builds the glucose curve of the period and the meal and insulin markers that go with it.
 *
 * @param {list<{type: string, tz?: string, occurredAt: string, data: object}>} events Already
 *        decrypted events of the period, of **every** type: the markers come from there.
 * @param {object} params
 * @param {string} [params.unit] Glucose display unit (ADR 0007). Whatever is in another one is
 *        counted in `excludedByUnit` and not drawn.
 * @param {number} [params.maxReadings]
 * @returns {{
 *   series: list<{group: string, points: list<{x: number, y: number|null}>}>,
 *   markers: list<{kind: string, x: number, count: number, items: list<string>, short: string}>,
 *   excludedByUnit: number,
 *   discarded: number,
 *   omittedReadings: number,
 *   omittedMarkers: number,
 *   groupedMarkers: number,
 * }}
 */
export function buildGlucoseContext(events, { unit, maxReadings = MAX_CONTEXT_READINGS } = {}) {
    /** @type {list<{x: number, y: number, group: string}>} */
    const readings = [];
    /** @type {Record<string, list<{x: number, label: string}>>} */
    const byKind = { meal: [], insulin: [] };
    let excludedByUnit = 0;
    let discarded = 0;

    for (const event of events) {
        const at = eventWallClockMs(event?.occurredAt, event?.tz);

        if (event?.type === 'glucose') {
            const value = toFiniteNumber(event.data?.value);

            if (value === null || at === null) {
                discarded += 1;
            } else if (unit !== undefined && unit !== null && event.data?.unit !== unit) {
                excludedByUnit += 1;
            } else {
                readings.push({ x: at, y: value, group: event.data?.method ?? '' });
            }

            continue;
        }

        if (event?.type !== 'meal' && event?.type !== 'insulin') {
            continue;
        }

        if (at === null) {
            discarded += 1;

            continue;
        }

        byKind[event.type].push(event.type === 'meal'
            ? { x: at, label: mealLabel(event.data), short: '' }
            : { x: at, ...insulinLabel(event.data) });
    }

    readings.sort((left, right) => left.x - right.x);

    /** The most recent readings are kept: the stretch being looked at is the one at the end. */
    const kept = readings.slice(-maxReadings);
    const omittedReadings = readings.length - kept.length;

    if (kept.length === 0) {
        return {
            series: [],
            markers: [],
            excludedByUnit,
            discarded,
            omittedReadings,
            omittedMarkers: 0,
            groupedMarkers: 0,
        };
    }

    /**
     * The markers earlier than the first drawn reading would fall off the axis. They are not thrown
     * away in silence: they are counted, because a meal that is not seen is a meal the eye takes as
     * not having happened.
     */
    const from = kept[0].x;
    let omittedMarkers = 0;

    for (const kind of Object.keys(byKind)) {
        const visible = byKind[kind].filter((mark) => mark.x >= from);

        omittedMarkers += byKind[kind].length - visible.length;
        byKind[kind] = visible.sort((left, right) => left.x - right.x);
    }

    /** @type {Map<string, list<{x: number, y: number}>>} */
    const byGroup = new Map();

    for (const reading of kept) {
        if (!byGroup.has(reading.group)) {
            byGroup.set(reading.group, []);
        }

        byGroup.get(reading.group).push({ x: reading.x, y: reading.y });
    }

    /** Stable order by token, as in `dailyBands.js`: the colour of a method cannot dance around. */
    const series = [...byGroup.keys()].sort((a, b) => a.localeCompare(b))
        .map((group) => ({ group, points: splitOnGaps(byGroup.get(group)) }));

    const { markers, grouped } = foldMarkers(byKind);

    return {
        series,
        markers: markers.sort((left, right) => left.x - right.x),
        excludedByUnit,
        discarded,
        omittedReadings,
        omittedMarkers,
        groupedMarkers: grouped,
    };
}
