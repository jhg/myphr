/**
 * Statistics of the health panel (ADR 0006, ADR 0007, ADR 0008).
 *
 * Pure logic: no DOM, no Chart.js, no Livewire, so it can be tested without mounting anything
 * (`tests/js/statistics.test.mjs`). All the computing happens in the browser over already
 * decrypted events, because the server cannot read them (ADR 0002, ADR 0006).
 *
 * **Input shape.** Each event is the already decrypted content of the envelope (ADR 0006:
 * `{v, type, tz, data: {...}}`) plus the instant it happened, flattened into the same object:
 * `{v, type, tz, data: {...}, occurredAt: '2026-07-25T09:08:07.000000Z'}`. `occurredAt` is the ADR
 * 0004 canonical date, the same `openEvent` brings (`resources/js/health/eventEnvelope.js`).
 *
 * **The measurement method is never mixed in silence** (ADR 0008): every summary function groups
 * before computing anything by the field that says how it was measured —`data.method` in glucose
 * and blood pressure, `data.site` in temperature, `data.insulinType` in insulin— and returns the
 * keys it grouped by so the view can always say what a number includes.
 *
 * **Fixed windows are no longer summarized.** These functions receive the events of the period the
 * person chose, clipped by the server with `[from, to)` (`occurred_at` is a column in the clear,
 * ADR 0006); nothing is clipped by date again here.
 *
 * **Nothing is converted between units.** Glucose is summarized for one single display unit, and
 * the events in another unit are counted apart instead of being mixed in (ADR 0007: "averaging
 * mg/dL with mmol/L without converting gives a meaningless number"; converting requires fixing
 * precision and rounding, a clinical decision no ADR has taken yet).
 *
 * **Precision of the computations.** The values arrive as strings (ADR 0004: decimals as a string)
 * and are converted to numbers only to compute. The mean, the median and the in-range percentage
 * these functions return are JavaScript numbers, not strings: they are not the ADR 0004 datum at
 * rest, but a derived and ephemeral result the view formats. So that result is reproducible, a
 * precision is fixed here and not left to how each browser adds up: mean and median with two
 * decimals (`STAT_DECIMALS`), rounding "half away from zero"; the in-range percentage, with one
 * decimal. It is not a clinical decision (it does not interpret whether the number is good or
 * bad), it is only display precision.
 */

/**
 * Length in days of the relative period shortcuts, shared by the home dashboard and the history
 * screens (`health/dateRange.js`, which imports them from here instead of copying them).
 *
 * `day` is the default period of the home dashboard: it is the last 24 hours, not "today" from
 * midnight, because the other shortcuts also count backwards from now and mixing the two criteria
 * would make "last day" and "last week" measure different things.
 */
export const WINDOW_DAYS = Object.freeze({ day: 1, week: 7, month: 30 });

/** Fixed decimals for mean and median (see the module JSDoc). */
const STAT_DECIMALS = 2;

/** Fixed decimals for the in-range percentage. */
const PERCENT_DECIMALS = 1;

/**
 * Rounds to a fixed number of decimals.
 *
 * @param {number} value
 * @param {number} decimals
 * @returns {number}
 */
function round(value, decimals) {
    const factor = 10 ** decimals;

    return Math.round(value * factor) / factor;
}

/**
 * Converts a value string into a finite number, or `null` if it does not represent one.
 *
 * It covers two reasons to discard at once: a qualitative result (ADR 0008, urine strip), which
 * carries no `data.value` but a `data.result`, and a malformed value that must not take the
 * summary down (robustness asked for explicitly).
 *
 * It is exported because the rule it applies —the clinical value travels as a string, with the
 * dot as decimal separator (ADR 0004)— is the same for whoever computes statistics and for
 * whoever builds the series of a chart (`health/dailyBands.js`). Duplicating it there would
 * duplicate the criterion of what is discarded, exactly what cannot diverge between the card and the chart next to it.
 *
 * @param {unknown} raw
 * @returns {number|null}
 */
export function toFiniteNumber(raw) {
    if (typeof raw !== 'string' || raw.trim() === '') {
        return null;
    }

    const value = Number(raw);

    return Number.isFinite(value) ? value : null;
}

/**
 * @param {string} occurredAt ISO canonical date (ADR 0004).
 * @returns {number} Milliseconds since epoch, or `NaN` if `occurredAt` could not be read.
 */
function toEpochMs(occurredAt) {
    return Date.parse(occurredAt);
}

/**
 * Mean and median of a list of numbers, with the fixed precision of the module.
 *
 * The median of an even number of samples is the average of the two central ones (with the list
 * already sorted), as in any standard definition; with an odd number it is the central sample.
 *
 * @param {list<number>} numbers Non-empty.
 * @returns {{mean: number, median: number}}
 */
function meanAndMedian(numbers) {
    const sum = numbers.reduce((total, value) => total + value, 0);

    return { mean: round(sum / numbers.length, STAT_DECIMALS), median: medianOf(numbers) };
}

/**
 * Median of a list of numbers, with the same fixed precision as the rest of the module.
 *
 * It lives here and not in whoever needs it so that the median of a statistics card and the one of
 * the chart next to it are **the same number**: two implementations with different rounding would
 * give two figures for the same datum on the same screen, and there is no way for the reader to
 * know which to believe.
 *
 * @param {list<number>} numbers Non-empty.
 * @returns {number}
 */
export function medianOf(numbers) {
    const sorted = [...numbers].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 === 1
        ? sorted[middle]
        : (sorted[middle - 1] + sorted[middle]) / 2;

    return round(median, STAT_DECIMALS);
}

/**
 * Unit a type of event is summarized in when the person has not chosen one anywhere: the one of
 * the **most recent** record with a numeric value.
 *
 * Glucose does not go through here because its display unit is an explicit profile setting (ADR
 * 0007). Weight, temperature and insulin have no such setting, and even so kilos cannot be
 * averaged with pounds, nor Celsius with Fahrenheit. The one of the last record is taken and not
 * the most frequent because it is the one the person is using now: if they have just changed
 * scales, the summary speaks of the new scale and the readings in the old unit are counted apart
 * (`excludedByUnit`) instead of disappearing.
 *
 * @param {list<{type: string, occurredAt: string, data: object}>} events
 * @param {string} type
 * @param {string} [valueKey] Numeric field of the envelope (`value`, `dose`, ...).
 * @returns {string|null} `null` if there is no usable record of that type.
 */
export function dominantUnit(events, type, valueKey = 'value') {
    let latest = null;

    for (const event of events) {
        if (event.type !== type || toFiniteNumber(event.data?.[valueKey]) === null) {
            continue;
        }

        if (typeof event.data.unit !== 'string' || event.data.unit === '') {
            continue;
        }

        if (latest === null || toEpochMs(event.occurredAt) > toEpochMs(latest.occurredAt)) {
            latest = event;
        }
    }

    return latest === null ? null : latest.data.unit;
}

/**
 * Unit a type is summarized in when what is being looked at is a **closed set belonging to
 * somebody else**: the one of the **majority** of the readings, not of the most recent one.
 *
 * {@see dominantUnit} picks by recency and is right in the patient panel: whoever has just changed
 * scales wants the summary in the unit they are using now, and knows they have changed. In a
 * shared clipping nobody knows that. A patient with a brand-new meter, with two readings in mmol/L
 * and two hundred earlier ones in mg/dL, would produce a card "Count 2 · Mean 7.4" and send the
 * remaining two hundred to a footnote: the professional would read a summary of two readings
 * believing it was the clipping's. By majority, the summary speaks of the two hundred and the two
 * are declared apart, which is the error you can actually see.
 *
 * Ties are resolved by the most recent unit, so as not to depend on the array order.
 *
 * @param {list<{type: string, occurredAt: string, data: object}>} events
 * @param {string} type
 * @param {string} [valueKey] Numeric field of the envelope (`value`, `dose`, ...).
 * @returns {string|null} `null` if there is no usable record of that type.
 */
export function majorityUnit(events, type, valueKey = 'value') {
    /** @type {Map<string, number>} */
    const counts = new Map();

    for (const event of events) {
        if (event.type !== type || toFiniteNumber(event.data?.[valueKey]) === null) {
            continue;
        }

        if (typeof event.data.unit !== 'string' || event.data.unit === '') {
            continue;
        }

        counts.set(event.data.unit, (counts.get(event.data.unit) ?? 0) + 1);
    }

    if (counts.size === 0) {
        return null;
    }

    const mostRecent = dominantUnit(events, type, valueKey);
    let winner = mostRecent;

    for (const [unit, count] of counts) {
        if (count > counts.get(winner) || (count === counts.get(winner) && unit === mostRecent)) {
            winner = unit;
        }
    }

    return winner;
}

/**
 * How many different units are there in the readings of a type?
 *
 * It decides whether the exclusion by unit deserves a real warning or a footnote: with a single
 * unit there is nothing to warn about, and with two the number shown describes a part of the
 * clipping, not the clipping.
 *
 * @param {list<{type: string, data: object}>} events
 * @param {string} type
 * @param {string} [valueKey]
 * @returns {number}
 */
export function unitCount(events, type, valueKey = 'value') {
    const units = new Set();

    for (const event of events) {
        if (event.type !== type || toFiniteNumber(event.data?.[valueKey]) === null) {
            continue;
        }

        if (typeof event.data.unit === 'string' && event.data.unit !== '') {
            units.add(event.data.unit);
        }
    }

    return units.size;
}

/**
 * Summary of an event type with **one single numeric quantity** (glucose, weight, temperature,
 * insulin dose) over a period, grouped by the field that tells how it was measured.
 *
 * It is the same computation for all four, so it lives once: what changes between them is the name
 * of the field with the value (`value`, `dose`) and of the grouping field (`method`, `site`,
 * `insulinType`, or none in weight, which is measured one single way). A type with no grouping
 * field falls whole into the `''` group, and whoever paints decides to write no heading.
 *
 * The two exclusions are the same glucose already documented and for the same reasons: what brings
 * no number (`discarded`, including the ADR 0008 qualitative results) and what is in another unit
 * (`excludedByUnit`, ADR 0007: nothing is converted).
 *
 * @param {list<{type: string, occurredAt: string, data: object}>} events Events of the period,
 *        already clipped by date (today the server does it with `[from, to)`, not the client).
 * @param {object} params
 * @param {string} params.type Event type token (`glucose`, `bodyWeight`, ...).
 * @param {string} [params.valueKey] Numeric field of the envelope. `value` by default.
 * @param {string} [params.groupBy] Grouping field. Without it, a single `''` group.
 * @param {string} params.unit Unit it is summarized in; the rest is counted in `excludedByUnit`.
 * @param {{low: string|number, high: string|number}} [params.targetRange] See
 *        {@see summarizeGlucosePeriod}: **with no range there is no `inRangePercent` key**.
 * @returns {{
 *   byGroup: Record<string, {
 *     count: number, mean: number, median: number, min: number, max: number,
 *     last: {value: number, occurredAt: string},
 *     inRangePercent?: number, belowRangePercent?: number, aboveRangePercent?: number
 *   }>,
 *   excludedByUnit: number,
 *   discarded: number,
 * }}
 */
export function summarizeMeasurementPeriod(events, { type, valueKey = 'value', groupBy, unit, targetRange } = {}) {
    /** @type {Record<string, list<{value: number, occurredAt: string}>>} */
    const readingsByGroup = {};
    let excludedByUnit = 0;
    let discarded = 0;

    for (const event of events) {
        if (event.type !== type) {
            continue;
        }

        const value = toFiniteNumber(event.data?.[valueKey]);

        if (value === null) {
            discarded += 1;

            continue;
        }

        if (event.data.unit !== unit) {
            excludedByUnit += 1;

            continue;
        }

        const group = groupBy === undefined ? '' : (event.data[groupBy] ?? '');

        (readingsByGroup[group] ??= []).push({ value, occurredAt: event.occurredAt });
    }

    const hasTargetRange = targetRange !== undefined && targetRange !== null;
    const low = hasTargetRange ? Number(targetRange.low) : null;
    const high = hasTargetRange ? Number(targetRange.high) : null;

    /** @type {Record<string, object>} */
    const byGroup = {};

    for (const [group, readings] of Object.entries(readingsByGroup)) {
        const values = readings.map((reading) => reading.value);
        const { mean, median } = meanAndMedian(values);
        const last = readings.reduce((latest, reading) => (
            toEpochMs(reading.occurredAt) > toEpochMs(latest.occurredAt) ? reading : latest
        ));

        const summary = {
            count: readings.length,
            mean,
            median,
            min: Math.min(...values),
            max: Math.max(...values),
            last,
        };

        if (hasTargetRange) {
            /**
             * The three bands, not only the one inside.
             *
             * "68% in range" does not say whether the remaining 32% are hypoglycaemias or
             * hyperglycaemias, and those are two opposite clinical situations. With the three
             * percentages the view can paint the segmented bar that is the standard way of reading
             * this, and whoever looks knows which way it is going.
             *
             * The split is exhaustive and without overlap —the range limits count as inside—, so
             * each reading falls into one and only one of the three bands.
             *
             * The three are rounded separately with the module precision, so the sum may stay at
             * 99.9 or reach 100.1. That is deliberate: forcing the sum to 100 would mean inflating
             * one of the three, and that band would stop being the percentage that was computed.
             */
            const belowCount = values.filter((value) => value < low).length;
            const aboveCount = values.filter((value) => value > high).length;
            const inRangeCount = values.length - belowCount - aboveCount;

            summary.inRangePercent = round((inRangeCount / values.length) * 100, PERCENT_DECIMALS);
            summary.belowRangePercent = round((belowCount / values.length) * 100, PERCENT_DECIMALS);
            summary.aboveRangePercent = round((aboveCount / values.length) * 100, PERCENT_DECIMALS);
        }

        byGroup[group] = summary;
    }

    return { byGroup, excludedByUnit, discarded };
}

/**
 * Glucose summary of a period, grouped by measurement method (ADR 0008) within one single display
 * unit (ADR 0007: nothing is converted between units).
 *
 * Discarded, without taking the summary down: events that are not of type `glucose`; qualitative
 * results (urine strip, ADR 0008: "they do not enter range statistics and have no average"), which
 * carry no numeric `data.value`; and any non-numeric value. All of them add to the same `discarded`
 * counter, because as far as the summary is concerned they are the same case: there is no number
 * to compute.
 *
 * Events in a unit other than `unit` are counted apart in `excludedByUnit` and enter no group, so
 * the view can say so (ADR 0007).
 *
 * @param {list<{type: string, occurredAt: string, data: object}>} events Events of the chosen
 *        period, already clipped by date by the server (`[from, to)`).
 * @param {object} params
 * @param {string} params.unit Display unit (UCUM code, e.g. `"mg/dL"`).
 * @param {{low: string|number, high: string|number}} [params.targetRange] Target range configured
 *        by the user (ADR 0007). **If it is not passed, no group carries `inRangePercent`**:
 *        neither `null` nor `0`, the key is simply not there, because the application ships no
 *        default ranges and does not disguise their absence as data.
 * @returns {{
 *   byMethod: Record<string, {
 *     count: number, mean: number, median: number, min: number, max: number,
 *     last: {value: number, occurredAt: string},
 *     inRangePercent?: number, belowRangePercent?: number, aboveRangePercent?: number
 *   }>,
 *   excludedByUnit: number,
 *   discarded: number,
 * }}
 */
export function summarizeGlucosePeriod(events, { unit, targetRange } = {}) {
    /**
     * The computation is the generic one; the only glucose-specific things are what its fields are
     * called and that the result key keeps being called `byMethod`, which is what ADR 0008 names
     * and what the view reads.
     */
    const { byGroup, excludedByUnit, discarded } = summarizeMeasurementPeriod(events, {
        type: 'glucose',
        groupBy: 'method',
        unit,
        targetRange,
    });

    return { byMethod: byGroup, excludedByUnit, discarded };
}

/**
 * Statistics of a single quantity (systolic, diastolic or pulse) inside a group.
 *
 * @param {list<{value: number, occurredAt: string}>} readings
 * @returns {{mean: number, median: number, min: number, max: number, last: number}}
 */
function magnitudeSummary(readings) {
    const values = readings.map((reading) => reading.value);
    const { mean, median } = meanAndMedian(values);
    const last = readings.reduce((latest, reading) => (
        toEpochMs(reading.occurredAt) > toEpochMs(latest.occurredAt) ? reading : latest
    ));

    return { mean, median, min: Math.min(...values), max: Math.max(...values), last: last.value };
}

/**
 * Blood pressure summary of a period, grouped by method (arm and posture, ADR 0008: one single
 * token per event, e.g. `left_sitting`).
 *
 * A blood pressure event is a single one with systolic, diastolic and pulse together (ADR 0006):
 * if any of the three lacks a numeric value, the whole event is discarded instead of computing
 * with partial data, and it counts as discarded without taking the summary down.
 *
 * @param {list<{type: string, occurredAt: string, data: object}>} events Events of a period,
 *        already clipped by date by the server (`[from, to)`).
 * @returns {{
 *   byMethod: Record<string, {
 *     systolic: {mean: number, median: number, min: number, max: number, last: number},
 *     diastolic: {mean: number, median: number, min: number, max: number, last: number},
 *     pulse: {mean: number, median: number, min: number, max: number, last: number},
 *     count: number,
 *     lastReading: {systolic: number, diastolic: number, pulse: number, occurredAt: string},
 *   }>,
 *   discarded: number,
 * }}
 */
export function summarizeBloodPressurePeriod(events) {
    /** @type {Record<string, list<{systolic: number, diastolic: number, pulse: number, occurredAt: string}>>} */
    const readingsByMethod = {};
    let discarded = 0;

    for (const event of events) {
        if (event.type !== 'bloodPressure') {
            continue;
        }

        const systolic = toFiniteNumber(event.data?.systolic);
        const diastolic = toFiniteNumber(event.data?.diastolic);
        const pulse = toFiniteNumber(event.data?.pulse);

        if (systolic === null || diastolic === null || pulse === null) {
            discarded += 1;

            continue;
        }

        const method = event.data.method;

        (readingsByMethod[method] ??= []).push({ systolic, diastolic, pulse, occurredAt: event.occurredAt });
    }

    /** @type {Record<string, object>} */
    const byMethod = {};

    for (const [method, readings] of Object.entries(readingsByMethod)) {
        const lastReading = readings.reduce((latest, reading) => (
            toEpochMs(reading.occurredAt) > toEpochMs(latest.occurredAt) ? reading : latest
        ));

        byMethod[method] = {
            systolic: magnitudeSummary(readings.map((r) => ({ value: r.systolic, occurredAt: r.occurredAt }))),
            diastolic: magnitudeSummary(readings.map((r) => ({ value: r.diastolic, occurredAt: r.occurredAt }))),
            pulse: magnitudeSummary(readings.map((r) => ({ value: r.pulse, occurredAt: r.occurredAt }))),
            count: readings.length,
            lastReading,
        };
    }

    return { byMethod, discarded };
}
