/**
 * Overlay of days on a 24-hour axis: the ambulatory glucose profile (ADR 0004, ADR 0006,
 * ADR 0007, ADR 0008).
 *
 * **What it shows that no chronological series shows.** Every reading of the period falls on one
 * single axis from 0 to 24 h, one translucent line per day, and on top the median of each hour in
 * a thick stroke. It is the format of the standard clinic report, and it reveals what repeats
 * every day —the dawn rise, the post-meal peak— which in a continuous timeline is dissolved among weeks.
 *
 * Pure logic: no DOM and no Chart.js (`tests/js/dayOverlay.test.mjs`). `health/dayOverlayChart.js`
 * paints it.
 *
 * Decisions it implements and is not the place to revisit:
 *
 * - **One series per measurement method** (ADR 0008): capillary and interstitial each have their
 *   own days and **their own hourly median**; averaging them together would mix two ways of measuring.
 * - **The hour of the day is the one on the clock of whoever recorded it** ({@see eventWallClockMs}),
 *   not the browser's: with the browser's, a breakfast in Madrid seen from Mexico would show up at
 *   dawn and the daily pattern this is after would be shifted whole.
 * - **Hours with no readings go as a gap**, never as a zero: the hourly median of an hour with no
 *   readings does not exist, and a zero would be an invented hypoglycaemia.
 * - **Nothing is converted between units** (ADR 0007): what is excluded is counted in `excludedByUnit`.
 * - **Nothing is clipped in silence**: the days that do not fit are counted in `omittedDays`.
 */

import { eventDayKey, eventWallClockMs } from './dailyBands.js';
import { medianOf, toFiniteNumber } from './statistics.js';

/**
 * Cap on overlaid days.
 *
 * Each day is one more translucent line; past a few dozen, the background saturates and the median
 * stops standing out against it, which is exactly what makes this format readable. The **most
 * recent** days are kept and how many were left out is stated: a silent clip would read as "there
 * was nothing before". The hourly median is computed only with the days drawn, so the thick line
 * describes exactly the cloud underneath it.
 */
export const MAX_OVERLAY_DAYS = 45;

const DAY_MS = 86_400_000;

/**
 * Hour of the day, with decimals, on the clock of whoever recorded the event.
 *
 * @param {number} wallClockMs
 * @returns {number} Between 0 and 24.
 */
export function hourOfDay(wallClockMs) {
    return (((wallClockMs % DAY_MS) + DAY_MS) % DAY_MS) / 3_600_000;
}

/**
 * Builds the day overlay of an event type.
 *
 * @param {list<{type: string, tz?: string, occurredAt: string, data: object}>} events
 * @param {object} params
 * @param {string} [params.type] Type token. Glucose by default, which is what this format exists
 *        for.
 * @param {string} [params.valueKey]
 * @param {string} [params.groupBy] Field that says how it was measured. Without it, a single `''` group.
 * @param {string} [params.unit] Display unit; the rest is counted in `excludedByUnit`.
 * @param {number} [params.maxDays]
 * @returns {{
 *   groups: list<{
 *     group: string,
 *     days: list<{day: string, points: list<{x: number, y: number}>}>,
 *     median: list<{x: number, y: number|null}>,
 *   }>,
 *   dayCount: number,
 *   excludedByUnit: number,
 *   discarded: number,
 *   omittedDays: number,
 * }}
 */
export function buildDayOverlay(events, {
    type = 'glucose',
    valueKey = 'value',
    groupBy = 'method',
    unit,
    maxDays = MAX_OVERLAY_DAYS,
} = {}) {
    /** @type {list<{group: string, day: string, x: number, y: number}>} */
    const readings = [];
    const dayKeys = new Set();
    let excludedByUnit = 0;
    let discarded = 0;

    for (const event of events) {
        if (event?.type !== type) {
            continue;
        }

        const value = toFiniteNumber(event.data?.[valueKey]);
        const at = eventWallClockMs(event.occurredAt, event.tz);

        if (value === null || at === null) {
            discarded += 1;

            continue;
        }

        if (unit !== undefined && unit !== null && event.data?.unit !== unit) {
            excludedByUnit += 1;

            continue;
        }

        const day = eventDayKey(event.occurredAt, event.tz);

        dayKeys.add(day);
        readings.push({
            group: groupBy === undefined ? '' : (event.data?.[groupBy] ?? ''),
            day,
            x: hourOfDay(at),
            y: value,
        });
    }

    if (dayKeys.size === 0) {
        return { groups: [], dayCount: 0, excludedByUnit, discarded, omittedDays: 0 };
    }

    /**
     * Unlike the band chart, the intermediate days are **not** filled in here: the axis is one of
     * hours and a day with no readings simply contributes no line. What is kept is the most recent
     * stretch, and what falls outside is counted.
     */
    const observed = [...dayKeys].sort();
    const kept = new Set(observed.slice(-maxDays));

    /** @type {Map<string, Map<string, list<{x: number, y: number}>>>} Group → day → points. */
    const byGroup = new Map();

    for (const reading of readings) {
        if (!kept.has(reading.day)) {
            continue;
        }

        if (!byGroup.has(reading.group)) {
            byGroup.set(reading.group, new Map());
        }

        const byDay = byGroup.get(reading.group);

        if (!byDay.has(reading.day)) {
            byDay.set(reading.day, []);
        }

        byDay.get(reading.day).push({ x: reading.x, y: reading.y });
    }

    /** Stable order by token, so the colour of a method does not change between two loads. */
    const groups = [...byGroup.keys()].sort((a, b) => a.localeCompare(b)).map((group) => {
        const byDay = byGroup.get(group);
        const days = [...byDay.keys()].sort().map((day) => ({
            day,
            points: byDay.get(day).sort((left, right) => left.x - right.x),
        }));

        return { group, days, median: hourlyMedian(days) };
    });

    return {
        groups,
        dayCount: kept.size,
        excludedByUnit,
        discarded,
        omittedDays: observed.length - kept.size,
    };
}

/**
 * Median of each hour of the day, with the 24 slots always present.
 *
 * An hour with no reading at all comes out with `y` at `null` —a gap—, never with a zero: in
 * glucose a zero is a lethal hypoglycaemia, so drawing one where nothing was measured is no detail.
 *
 * The point is placed at the **centre** of the slot (`hour + 0.5`) because it stands for the whole
 * hour, not its start; placing it at the beginning would shift the peak half an hour to the left.
 *
 * @param {list<{points: list<{x: number, y: number}>}>} days
 * @returns {list<{x: number, y: number|null}>}
 */
function hourlyMedian(days) {
    /** @type {list<list<number>>} */
    const buckets = Array.from({ length: 24 }, () => []);

    for (const day of days) {
        for (const point of day.points) {
            buckets[Math.min(23, Math.floor(point.x))].push(point.y);
        }
    }

    return buckets.map((values, hour) => ({
        x: hour + 0.5,
        y: values.length === 0 ? null : medianOf(values),
    }));
}
