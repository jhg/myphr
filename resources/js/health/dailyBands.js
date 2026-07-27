/**
 * Daily median series with a minimum and maximum band (ADR 0004, ADR 0006, ADR 0007, ADR 0008).
 *
 * Pure logic: no DOM and no Chart.js, so it can be tested without mounting anything
 * (`tests/js/dailyBands.test.mjs`). `health/medianBandChart.js` paints it; the home dashboard
 * feeds it, with the events it already has decrypted in memory.
 *
 * **Why the median and not the mean.** A day with one hypoglycaemia and five normal readings has a
 * mean dragged by the extreme value; the median says how the typical day went and the band says
 * how far it reached. Both together answer the question the project has been asking from the start
 * —"how am I doing?"— without hiding the extreme, which is what a plain mean would do.
 *
 * Decisions this module implements and is not the place to revisit:
 *
 * - **One series per measurement method** (ADR 0008): a capillary glucose reading and an
 *   interstitial one are not the same datum, so they share neither line nor band. The grouping
 *   field is stated by the caller (`groupBy`), as in `statistics.js`.
 * - **Days with no readings go as a gap**, never as a zero: a zero is a reading, and a false one.
 *   That is why `days` covers the whole stretch between the first and the last day with data, and
 *   days with nothing carry `null` in every series, which is what Chart.js draws as a break.
 * - **A day with a single reading collapses the band into a point** (median = minimum = maximum),
 *   and it is right that it looks like that: it is exactly what is known about that day.
 * - **Nothing is converted between units** (ADR 0007): the series of one single unit is built and
 *   the rest is counted in `excludedByUnit` so the view can say so.
 * - **The day is computed with the time zone of the event itself**, not with that of the browser
 *   looking at it ({@see eventDayKey}).
 */

import { medianOf, toFiniteNumber } from './statistics.js';

/**
 * Cap on the days of the axis.
 *
 * The axis is filled day by day so that gaps are real gaps, so a period of "every record" over
 * several years would ask for thousands of labels and as many points per series: the chart becomes
 * unreadable long before it becomes slow. When the stretch goes over, the **most recent** days are
 * kept and how many were left out is returned (`omittedDays`), which the view states in the
 * caption: a silent clip would make people read "there is nothing before" where there is.
 */
export const MAX_CHART_DAYS = 180;

/**
 * Separator of the composite group + quantity key.
 *
 * It is the null character and not a space or a dash because catalog tokens are free to carry
 * either (`left_sitting` today, another tomorrow): a key that could be split wrongly would mix two
 * different clinical series into a single line.
 */
const SERIES_KEY_SEPARATOR = '\u0000';

/**
 * Day an event belongs to, in the time zone **it was recorded in**.
 *
 * The calendar of the machine looking is no good: a dinner at 23:30 in Madrid was recorded on the
 * 4th for whoever ate it, and opening the application from another time zone would move it to the
 * 5th without the datum having changed. Plain UTC is no good either, because the day that matters
 * is the person's. The offset travels inside the envelope itself, in `tz` (ADR 0006), so it rules.
 *
 * With no `tz`, or with one that cannot be read, it falls back to UTC explicitly: it is the only
 * value that does not depend on the device it is looked at from.
 *
 * @param {string} occurredAt Instant in canonical form (ADR 0004).
 * @param {string} [tz] Offset of the form `+02:00`, `-05:30` or `Z`.
 * @returns {string} `YYYY-MM-DD`, or an empty string if the instant could not be read.
 */
export function eventDayKey(occurredAt, tz) {
    const shifted = eventWallClockMs(occurredAt, tz);

    if (shifted === null) {
        return '';
    }

    return utcDayKey(new Date(shifted));
}

/**
 * Instant of the event **on the wall clock of whoever recorded it**, expressed as milliseconds
 * since epoch read in UTC.
 *
 * It is the same computation {@see eventDayKey} does and it exists apart because the charts that
 * place each reading on a time axis —the curve with meal and insulin markers, and the overlay of
 * days over 24 hours— need the time, not just the day. The rule is the same and for the same
 * reason: a dinner at 23:30 in Madrid happened at 23:30 for whoever ate it, and placing it at
 * 21:30 because the viewer is in London would move the post-meal peak to another band of the day.
 *
 * What it returns **is not an absolute instant** and cannot be compared with `Date.now()`: it is a
 * wall clock time encoded as if it were UTC, so whoever formats it has to do so with
 * `timeZone: 'UTC'` or it will be shifted a second time.
 *
 * @param {string} occurredAt Instant in canonical form (ADR 0004).
 * @param {string} [tz] Offset of the form `+02:00`, `-05:30` or `Z`.
 * @returns {number|null} `null` if the instant could not be read (never a zero, which would be 1970).
 */
export function eventWallClockMs(occurredAt, tz) {
    const shifted = new Date(occurredAt).getTime() + tzOffsetMinutes(tz) * 60_000;

    return Number.isNaN(shifted) ? null : shifted;
}

/**
 * @param {string} [tz] Offset of the form `+02:00`, `-05:30` or `Z`.
 * @returns {number} Offset minutes. Zero if it is missing or unreadable, never the local zone.
 */
export function tzOffsetMinutes(tz) {
    const match = /^([+-])(\d{2}):(\d{2})$/.exec(tz ?? '');

    if (match === null) {
        return 0;
    }

    const magnitude = Number(match[2]) * 60 + Number(match[3]);

    return match[1] === '-' ? -magnitude : magnitude;
}

/**
 * @param {Date} date
 * @returns {string} `YYYY-MM-DD` of the UTC components of the date.
 */
function utcDayKey(date) {
    const pad = (value) => String(value).padStart(2, '0');

    return [date.getUTCFullYear(), pad(date.getUTCMonth() + 1), pad(date.getUTCDate())].join('-');
}

/**
 * Every calendar day between two keys, both included.
 *
 * It counts with `Date.UTC` and not with the local calendar: the keys already come resolved in the
 * time zone of the event, and reading them again in the browser's would move them by a day as soon
 * as the offset was negative.
 *
 * @param {string} first `YYYY-MM-DD`.
 * @param {string} last `YYYY-MM-DD`, not earlier than `first`.
 * @returns {list<string>}
 */
export function enumerateDays(first, last) {
    const toUtc = (key) => {
        const [year, month, day] = key.split('-').map(Number);

        return Date.UTC(year, month - 1, day);
    };

    const days = [];
    const lastMs = toUtc(last);

    for (let cursor = toUtc(first); cursor <= lastMs; cursor += 86_400_000) {
        days.push(utcDayKey(new Date(cursor)));
    }

    return days;
}

/**
 * Builds the daily series of an event type.
 *
 * The grouping and value keys are the same `statistics.js` uses for that type, and that is on
 * purpose: the statistics card and the chart next to it have to be counting the same thing. A type
 * with several quantities in the same event (blood pressure: systolic and diastolic) asks for
 * several `valueKeys` and comes out with one series per quantity inside each group.
 *
 * An event goes in whole or does not go in: if any of the requested quantities is missing it is
 * counted in `discarded` and contributes to no series, just as `summarizeBloodPressurePeriod` does.
 * Half a reading is not a reading.
 *
 * @param {list<{type: string, tz?: string, occurredAt: string, data: object}>} events Events
 *        already decrypted and flattened, of the chosen period (the server clips it, ADR 0006).
 * @param {object} params
 * @param {string} params.type Event type token.
 * @param {list<string>} [params.valueKeys] Numeric fields of the envelope. `['value']` by default.
 * @param {string} [params.groupBy] Field that says how it was measured. Without it, a single `''` group.
 * @param {string} [params.unit] Display unit; the rest is counted in `excludedByUnit`. With no
 *        unit nothing is excluded (types whose envelope does not carry one).
 * @returns {{
 *   days: list<string>,
 *   series: list<{
 *     group: string,
 *     valueKey: string,
 *     points: list<{median: number, min: number, max: number, count: number}|null>,
 *   }>,
 *   excludedByUnit: number,
 *   discarded: number,
 *   omittedDays: number,
 * }}
 */
export function buildDailyBands(events, { type, valueKeys = ['value'], groupBy, unit } = {}) {
    /** @type {Map<string, Map<string, list<number>>>} Series → day → values of that day. */
    const readings = new Map();
    const dayKeys = new Set();
    let excludedByUnit = 0;
    let discarded = 0;

    for (const event of events) {
        if (event?.type !== type) {
            continue;
        }

        const values = valueKeys.map((valueKey) => toFiniteNumber(event.data?.[valueKey]));

        if (values.some((value) => value === null)) {
            discarded += 1;

            continue;
        }

        if (unit !== undefined && unit !== null && event.data?.unit !== unit) {
            excludedByUnit += 1;

            continue;
        }

        const day = eventDayKey(event.occurredAt, event.tz);

        if (day === '') {
            discarded += 1;

            continue;
        }

        dayKeys.add(day);

        const group = groupBy === undefined ? '' : (event.data?.[groupBy] ?? '');

        values.forEach((value, index) => {
            const seriesKey = [group, valueKeys[index]].join(SERIES_KEY_SEPARATOR);

            if (!readings.has(seriesKey)) {
                readings.set(seriesKey, new Map());
            }

            const byDay = readings.get(seriesKey);

            if (!byDay.has(day)) {
                byDay.set(day, []);
            }

            byDay.get(day).push(value);
        });
    }

    if (dayKeys.size === 0) {
        return { days: [], series: [], excludedByUnit, discarded, omittedDays: 0 };
    }

    const observed = [...dayKeys].sort();
    const spanned = enumerateDays(observed[0], observed[observed.length - 1]);
    const days = spanned.slice(-MAX_CHART_DAYS);

    /**
     * Stable order of the series: by group (alphabetical by token) and, inside the group, in the
     * order the quantities were asked for. Without this, the chart would hand out the colours
     * differently between loads, and the colour of a clinical series would stop meaning anything.
     */
    const series = [...readings.keys()]
        .sort((a, b) => {
            const [groupA, keyA] = a.split(SERIES_KEY_SEPARATOR);
            const [groupB, keyB] = b.split(SERIES_KEY_SEPARATOR);

            return groupA.localeCompare(groupB) || valueKeys.indexOf(keyA) - valueKeys.indexOf(keyB);
        })
        .map((seriesKey) => {
            const [group, valueKey] = seriesKey.split(SERIES_KEY_SEPARATOR);
            const byDay = readings.get(seriesKey);

            return { group, valueKey, points: days.map((day) => dayPoint(byDay.get(day))) };
        });

    return { days, series, excludedByUnit, discarded, omittedDays: spanned.length - days.length };
}

/**
 * Point of one day: median, minimum and maximum, or a gap.
 *
 * A day with no readings returns `null` —a gap—, never a zero: a zero is a reading, and a false
 * one. A day with a single reading returns the three values equal, and the band looks collapsed
 * into a point, which is exactly what is known about that day.
 *
 * @param {list<number>|undefined} values
 * @returns {{median: number, min: number, max: number, count: number}|null}
 */
function dayPoint(values) {
    if (values === undefined) {
        return null;
    }

    return {
        median: medianOf(values),
        min: Math.min(...values),
        max: Math.max(...values),
        count: values.length,
    };
}
