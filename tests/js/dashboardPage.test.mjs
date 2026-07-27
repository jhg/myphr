/**
 * Checks of the pure logic of `health/dashboardPage.js` (ADR 0004, ADR 0006, ADR 0007,
 * ADR 0008).
 *
 * Alpine is not mounted: `dashboardPage()` only orchestrates DOM, and that orchestration is not
 * tested here. What is tested is the logic that does not depend on it, exported apart so it can be
 * called directly, plus the integration with `summarizeGlucosePeriod` of `statistics.js` for the
 * point that matters most (ADR 0007: with no target range configured, `inRangePercent` does not appear at all).
 *
 * Node's built-in runner, like the rest of `tests/js` (see `crypto.test.mjs`).
 *
 *     npm test
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';

/**
 * The assertions of this file have not changed: what has changed is where each function is
 * imported from. Display stopped belonging to the panel and lives in modules that take decrypted
 * events and return nodes (`timelineView.js`, `statsView.js`, `chartsView.js`), with the
 * vocabulary in `eventLabels.js` / `eventTypes.js` and the pagination in `eventSource.js`. The
 * patient panel is today one of its three consumers, not its owner.
 */
import {
    CHART_SECTIONS,
    chartCaptionText,
    chartElementIds,
    chartSeriesLabel,
    chartUnit,
} from '../../resources/js/health/chartsView.js';
import {
    formatMeasuredValue,
    formatMethodLabel,
    formatNumber,
} from '../../resources/js/health/eventLabels.js';
import {
    createSegmentedBar,
    createSparkline,
    createStatTile,
    SPARKLINE_MIN_POINTS,
} from '../../resources/js/health/eventVisuals.js';
import {
    flattenDecryptedEvent,
    needsAnotherPage,
    rangeStartMs,
} from '../../resources/js/health/eventSource.js';
import {
    defaultSelectedTypes,
    EVENT_TYPES,
    filterBySelectedTypes,
    selectedTypeTokens,
} from '../../resources/js/health/eventTypes.js';
import {
    describeExcludedByUnit,
    hasAnyGlucoseSignal,
    hasPeriodData,
    MEASUREMENT_SECTIONS,
    renderBloodPressureSection,
    renderGlucoseSection,
    renderMeasurementSection,
    renderStatsSections,
    resolveGlucoseTargetRange,
    sortedMethodEntries,
    targetRangeUnitMismatch,
} from '../../resources/js/health/statsView.js';
import {
    buildTimeline,
    describeTimelineEvent,
    groupEntriesByDay,
    localDayKey,
    renderTimelineSection,
    TIMELINE_MAX_ENTRIES,
} from '../../resources/js/health/timelineView.js';
import { summarizeGlucosePeriod } from '../../resources/js/health/statistics.js';
import { setLocale } from '../../resources/js/i18n/index.js';

/**
 * These tests assert the text **in Spanish**, so they set the language instead of assuming it: the
 * client default language is English (as in `config/app.php`), and in Node there is no
 * `<html lang>` to work it out from. Without this line, the text assertions below would be
 * checking the fallback catalog without saying so.
 */
setLocale('es');

// --- formatMethodLabel -------------------------------------------------------------------------

test('formatMethodLabel: translates the glucose tokens (ADR 0008)', () => {
    assert.equal(formatMethodLabel('capillary'), 'Capilar');
    assert.equal(formatMethodLabel('interstitial'), 'Intersticial');
});

test('formatMethodLabel: translates arm and posture of blood pressure (ADR 0008)', () => {
    assert.equal(formatMethodLabel('left_sitting'), 'Izquierdo, sentado');
    assert.equal(formatMethodLabel('right_standing'), 'Derecho, de pie');
    assert.equal(formatMethodLabel('left_lying'), 'Izquierdo, tumbado');
});

test('formatMethodLabel: a token it does not recognize is humanized instead of breaking', () => {
    assert.equal(formatMethodLabel('oral_axillary'), 'Oral Axillary');
    assert.equal(formatMethodLabel('unknown'), 'Unknown');
});

// --- formatNumber -------------------------------------------------------------------------------

test('formatNumber: localizes with at most two decimals', () => {
    assert.equal(formatNumber(140), '140');
    assert.equal(formatNumber(98.5), '98,5');
    assert.equal(formatNumber(98.456), '98,46');
});

// --- flattenDecryptedEvent ----------------------------------------------------------------------

test('flattenDecryptedEvent: joins occurredAt with the decrypted content', () => {
    const rawEvent = { id: 'abc', occurredAt: '2026-07-25T09:00:00.000000Z', payload: 'v1.xyz' };
    const content = { v: 1, type: 'glucose', tz: '+00:00', data: { value: '100', unit: 'mg/dL', method: 'capillary' } };

    const flattened = flattenDecryptedEvent(rawEvent, content);

    assert.equal(flattened.occurredAt, rawEvent.occurredAt);
    assert.equal(flattened.type, 'glucose');
    assert.deepEqual(flattened.data, content.data);
});

// --- resolveGlucoseTargetRange (ADR 0007) --------------------------------------------------------

test('resolveGlucoseTargetRange: with no settings, there is no range', () => {
    assert.equal(resolveGlucoseTargetRange(null), undefined);
    assert.equal(resolveGlucoseTargetRange(undefined), undefined);
});

test('resolveGlucoseTargetRange: settings with no glucoseTargetRange, there is no range', () => {
    assert.equal(resolveGlucoseTargetRange({ glucoseUnit: 'mg/dL' }), undefined);
});

test('resolveGlucoseTargetRange: non-numeric or inverted low/high, there is no range', () => {
    assert.equal(resolveGlucoseTargetRange({ glucoseTargetRange: { low: 'x', high: 180 } }), undefined);
    assert.equal(resolveGlucoseTargetRange({ glucoseTargetRange: { low: 200, high: 70 } }), undefined);
});

test('resolveGlucoseTargetRange: a well-formed range resolves to numbers, with its unit', () => {
    const range = resolveGlucoseTargetRange(
        { glucoseTargetRange: { low: '70', high: '180', unit: 'mg/dL' } },
        'mg/dL',
    );

    assert.deepEqual(range, { low: 70, high: 180, unit: 'mg/dL' });
});

/**
 * ADR 0007: nothing is converted between mg/dL and mmol/L. The profile lets the unit of the range
 * and the display one be chosen separately, so a range of 3.9-10 mmol/L with readings in mg/dL is
 * a reachable state; comparing one set of numbers against the other would publish a "time in
 * range: 0%" that looks like a clinical datum and is not.
 */
test('resolveGlucoseTargetRange: a range in another unit is not applied', () => {
    const userSettings = { glucoseTargetRange: { low: 3.9, high: 10, unit: 'mmol/L' } };

    assert.equal(resolveGlucoseTargetRange(userSettings, 'mg/dL'), undefined);
    assert.deepEqual(resolveGlucoseTargetRange(userSettings, 'mmol/L'), { low: 3.9, high: 10, unit: 'mmol/L' });
});

test('a range in another unit produces no time-in-range percentage', () => {
    const reference = '2026-07-25T12:00:00.000000Z';
    const events = [
        {
            v: 1,
            type: 'glucose',
            tz: '+00:00',
            occurredAt: reference,
            data: { value: '140', unit: 'mg/dL', method: 'capillary', loinc: '41653-7' },
        },
    ];

    const targetRange = resolveGlucoseTargetRange(
        { glucoseTargetRange: { low: 3.9, high: 10, unit: 'mmol/L' } },
        'mg/dL',
    );
    const { byMethod } = summarizeGlucosePeriod(events, { unit: 'mg/dL', targetRange });

    assert.equal('inRangePercent' in byMethod.capillary, false);
});

// --- targetRangeUnitMismatch ---------------------------------------------------------------------

test('targetRangeUnitMismatch: it tells "there is no range" from "there is a range in another unit"', () => {
    assert.equal(targetRangeUnitMismatch(null, 'mg/dL'), false);
    assert.equal(targetRangeUnitMismatch({ glucoseUnit: 'mg/dL' }, 'mg/dL'), false);
    assert.equal(
        targetRangeUnitMismatch({ glucoseTargetRange: { low: 70, high: 180, unit: 'mg/dL' } }, 'mg/dL'),
        false,
    );
    assert.equal(
        targetRangeUnitMismatch({ glucoseTargetRange: { low: 3.9, high: 10, unit: 'mmol/L' } }, 'mg/dL'),
        true,
    );
});

/**
 * The case that matters most (ADR 0007): with no range configured, `summarizeGlucosePeriod` does
 * not compute `inRangePercent` in any group, neither with `null` nor with `0`, the key is not there.
 */
test('with no target range configured, inRangePercent appears in no group', () => {
    const reference = '2026-07-25T12:00:00.000000Z';
    const events = [
        {
            v: 1,
            type: 'glucose',
            tz: '+00:00',
            occurredAt: reference,
            data: { value: '140', unit: 'mg/dL', method: 'capillary', loinc: '41653-7' },
        },
    ];

    const targetRange = resolveGlucoseTargetRange(null);
    const { byMethod } = summarizeGlucosePeriod(events, { unit: 'mg/dL', targetRange });

    assert.equal('inRangePercent' in byMethod.capillary, false);
});

test('with a target range configured, inRangePercent does appear', () => {
    const reference = '2026-07-25T12:00:00.000000Z';
    const events = [
        {
            v: 1,
            type: 'glucose',
            tz: '+00:00',
            occurredAt: reference,
            data: { value: '140', unit: 'mg/dL', method: 'capillary', loinc: '41653-7' },
        },
    ];

    const targetRange = resolveGlucoseTargetRange(
        { glucoseTargetRange: { low: 70, high: 180, unit: 'mg/dL' } },
        'mg/dL',
    );
    const { byMethod } = summarizeGlucosePeriod(events, { unit: 'mg/dL', targetRange });

    assert.equal(byMethod.capillary.inRangePercent, 100);
});

// --- Filter by event type -------------------------------------------------------------------------

/**
 * Every type ticked by default: opening the panel with one left out would hide records that exist,
 * and in a clinical history "it does not show" reads as "it has been lost".
 */
test('defaultSelectedTypes: every type ticked', () => {
    const selected = defaultSelectedTypes();

    assert.deepEqual(Object.keys(selected).sort(), [...EVENT_TYPES].sort());
    assert.equal(Object.values(selected).every((value) => value === true), true);
});

test('selectedTypeTokens: only the ticked ones, in catalog order', () => {
    assert.deepEqual(selectedTypeTokens({ ...defaultSelectedTypes(), meal: false, insulin: false }), [
        'glucose',
        'bloodPressure',
        'bodyWeight',
        'temperature',
    ]);
    assert.deepEqual(selectedTypeTokens({}), []);
});

/** Filtering by type costs no request: the events are already decrypted (ADR 0006). */
test('filterBySelectedTypes: keeps only the ticked types', () => {
    const events = [
        { type: 'glucose', occurredAt: 't1' },
        { type: 'meal', occurredAt: 't2' },
        { type: 'bodyWeight', occurredAt: 't3' },
    ];

    const filtered = filterBySelectedTypes(events, { glucose: true, meal: false, bodyWeight: true });

    assert.deepEqual(filtered.map((event) => event.type), ['glucose', 'bodyWeight']);
});

// --- hasPeriodData -------------------------------------------------------------------------------

test('hasPeriodData: false when the period summary has no group', () => {
    assert.equal(hasPeriodData({ byMethod: {} }), false);
    assert.equal(hasPeriodData({ byGroup: {} }), false);
    assert.equal(hasPeriodData({ byMethod: { capillary: {} } }), true);
    assert.equal(hasPeriodData({ byGroup: { '': {} } }), true);
});

// --- Pagination of fetchEvents ---------------------------------------------------------------------

/** With "every record" there is no floor: it pages until the server stops giving events. */
test('rangeStartMs: a range open at the bottom sets no floor', () => {
    assert.equal(rangeStartMs({ from: null, to: null }), -Infinity);
    assert.equal(rangeStartMs({}), -Infinity);
    assert.equal(rangeStartMs({ from: 'no es una fecha' }), -Infinity);
});

test('rangeStartMs: the start of the range is how far back to go', () => {
    assert.equal(
        rangeStartMs({ from: '2026-07-24T12:00:00.000000Z', to: null }),
        Date.parse('2026-07-24T12:00:00.000000Z'),
    );
});

test('needsAnotherPage: an incomplete page means there are no events left', () => {
    const page = [{ occurredAt: '2026-07-25T09:00:00.000000Z' }];

    assert.equal(needsAnotherPage(page, 500, Date.parse('2026-06-25T00:00:00Z')), false);
});

test('needsAnotherPage: a full page that has not reached the start of the window yet, another one is asked for', () => {
    const windowStartMs = Date.parse('2026-06-25T00:00:00Z');
    const page = [
        { occurredAt: '2026-07-25T09:00:00.000000Z' },
        { occurredAt: '2026-07-20T09:00:00.000000Z' },
    ];

    assert.equal(needsAnotherPage(page, 2, windowStartMs), true);
});

test('needsAnotherPage: a full page that already crosses the start of the window, no other is asked for', () => {
    const windowStartMs = Date.parse('2026-06-25T00:00:00Z');
    const page = [
        { occurredAt: '2026-07-25T09:00:00.000000Z' },
        { occurredAt: '2026-06-01T09:00:00.000000Z' },
    ];

    assert.equal(needsAnotherPage(page, 2, windowStartMs), false);
});

test('needsAnotherPage: an unreadable date stops the loop instead of asking for pages blindly', () => {
    const page = [{ occurredAt: 'no es una fecha' }, { occurredAt: 'tampoco' }];

    assert.equal(needsAnotherPage(page, 2, Date.parse('2026-06-25T00:00:00Z')), false);
});

// --- sortedMethodEntries --------------------------------------------------------------------------

test('sortedMethodEntries: stable alphabetical order', () => {
    const entries = sortedMethodEntries({ interstitial: { a: 1 }, capillary: { b: 2 } });

    assert.deepEqual(entries.map(([method]) => method), ['capillary', 'interstitial']);
});

// --- describeExcludedByUnit -----------------------------------------------------------------------

test('describeExcludedByUnit: null with no excluded events', () => {
    assert.equal(describeExcludedByUnit(0, 'mg/dL'), null);
});

test('describeExcludedByUnit: it mentions the count and the display unit', () => {
    const text = describeExcludedByUnit(3, 'mg/dL');

    assert.match(text, /3 registro/);
    assert.match(text, /mg\/dL/);
});

// --- hasAnyGlucoseSignal ---------------------------------------------------------------------------

test('hasAnyGlucoseSignal: it counts what is excluded by unit too', () => {
    const empty = { week: { byMethod: {}, excludedByUnit: 0 }, month: { byMethod: {}, excludedByUnit: 0 } };
    const onlyExcluded = { week: { byMethod: {}, excludedByUnit: 0 }, month: { byMethod: {}, excludedByUnit: 30 } };

    assert.equal(hasAnyGlucoseSignal(empty.month), false);
    assert.equal(hasPeriodData(onlyExcluded.month), false);
    assert.equal(hasAnyGlucoseSignal(onlyExcluded.month), true);
});

// --- Painting of the glucose section ---------------------------------------------------------------

/**
 * These four tests mount a minimal `document`, like `chartLegend.test.mjs`: exactly what the
 * module touches (`createElement`, `createElementNS`, `createDocumentFragment`) and nothing else.
 */
class FakeElement {
    constructor(tagName, namespace = null) {
        this.tagName = tagName;
        this.namespace = namespace;
        this.attributes = {};
        this.children = [];
        this.className = '';
        this.textContent = '';
        this.classList = { add: (...names) => { this.className = `${this.className} ${names.join(' ')}`.trim(); } };
    }

    setAttribute(name, value) {
        this.attributes[name] = String(value);
    }

    appendChild(child) {
        this.children.push(child);

        return child;
    }

    /** All the text of the subtree, which is what the person ends up reading. */
    get text() {
        return [this.textContent, ...this.children.map((child) => child.text)].join(' ').trim();
    }
}

beforeEach(() => {
    globalThis.document = {
        createElement: (tagName) => new FakeElement(tagName),
        createElementNS: (namespace, tagName) => new FakeElement(tagName, namespace),
        createDocumentFragment: () => new FakeElement('#fragment'),
    };
});

afterEach(() => {
    delete globalThis.document;
});

/** A method summary with the shape `summarizeGlucosePeriod` returns, to paint with data. */
const GLUCOSE_METHOD_SUMMARY = Object.freeze({
    count: 2,
    mean: 110,
    median: 110,
    min: 100,
    max: 120,
    last: { value: 120, occurredAt: '2026-07-25T09:00:00.000000Z' },
});

/**
 * How many times a text appears in the subtree. The empty state is the same sentence in each card,
 * so `assert.match` does not tell one from two: they have to be counted.
 *
 * @param {string} haystack
 * @param {RegExp} pattern Without the `g` flag: it is added here.
 * @returns {number}
 */
function countMatches(haystack, pattern) {
    return [...haystack.matchAll(new RegExp(pattern.source, 'g'))].length;
}

/**
 * The case the notice exists to cover: thirty glucose readings in mg/dL and the display unit
 * changed to mmol/L. Without the notice, the panel claims there is no record and gives no hint
 * that the data exists and is only in another unit.
 */
test('renderGlucoseSection: it warns about the ones excluded by unit even if no method is left', () => {
    const fragment = renderGlucoseSection({ byMethod: {}, excludedByUnit: 30 }, 'mmol/L', undefined, false);

    assert.match(fragment.text, /Todavía no hay registros/);
    assert.match(fragment.text, /30 registros/);
    assert.match(fragment.text, /mmol\/L/);
});

test('renderGlucoseSection: a single empty state when the period brings nothing', () => {
    const fragment = renderGlucoseSection({ byMethod: {}, excludedByUnit: 0 }, 'mg/dL', undefined, false);

    assert.equal(countMatches(fragment.text, /Todavía no hay registros/), 1);
    assert.doesNotMatch(fragment.text, /no se muestra/);
});

test('renderGlucoseSection: with a range in another unit it warns, and does not invite configuring what already exists', () => {
    const fragment = renderGlucoseSection({ byMethod: {}, excludedByUnit: 30 }, 'mg/dL', undefined, true);

    assert.match(fragment.text, /otra unidad/);
    assert.doesNotMatch(fragment.text, /Configura tu rango objetivo/);
});

test('renderGlucoseSection: with no range, it invites whoever only has excluded records too', () => {
    const fragment = renderGlucoseSection({ byMethod: {}, excludedByUnit: 30 }, 'mg/dL', undefined, false);

    assert.match(fragment.text, /Configura tu rango objetivo/);
});

/**
 * The statistics of the chosen period are the same the two fixed windows used to have: count,
 * mean, median, minimum, maximum and last reading, one card per method (ADR 0008).
 */
test('renderGlucoseSection: one card per method, with every statistic', () => {
    const summary = {
        byMethod: { capillary: { ...GLUCOSE_METHOD_SUMMARY }, interstitial: { ...GLUCOSE_METHOD_SUMMARY } },
        excludedByUnit: 0,
    };

    const fragment = renderGlucoseSection(summary, 'mg/dL', undefined, false);

    assert.match(fragment.text, /Capilar/);
    assert.match(fragment.text, /Intersticial/);
    assert.equal(countMatches(fragment.text, /Recuento/), 2);
    assert.match(fragment.text, /Mediana/);
    assert.match(fragment.text, /Última lectura/);
    assert.doesNotMatch(fragment.text, /Todavía no hay registros/);
});

/** There are no two fixed windows any more: what is summarized is the period the person chose. */
test('renderGlucoseSection: no "last week" or "last month" headings are left', () => {
    const summary = { byMethod: { capillary: { ...GLUCOSE_METHOD_SUMMARY } }, excludedByUnit: 0 };

    const fragment = renderGlucoseSection(summary, 'mg/dL', undefined, false);

    assert.doesNotMatch(fragment.text, /Última semana/);
    assert.doesNotMatch(fragment.text, /Último mes/);
});

// --- Time in range as a segmented bar -------------------------------------------------------------

/** The three bands exactly as `summarizeGlucosePeriod` returns them with a target range configured. */
const GLUCOSE_WITH_RANGE = Object.freeze({
    ...GLUCOSE_METHOD_SUMMARY,
    inRangePercent: 68,
    belowRangePercent: 12,
    aboveRangePercent: 20,
});

/**
 * What the bar has to leave readable without looking at any colour (DESIGN.md, Do's #3): the three
 * written labels and the three percentages as numbers.
 */
test('renderGlucoseSection: time in range is painted in three bands, each with its figure', () => {
    const summary = { byMethod: { capillary: { ...GLUCOSE_WITH_RANGE } }, excludedByUnit: 0 };
    const targetRange = { low: 80, high: 130, unit: 'mg/dL' };

    const fragment = renderGlucoseSection(summary, 'mg/dL', targetRange, false);

    assert.match(fragment.text, /Tiempo en rango/);
    assert.match(fragment.text, /Por debajo/);
    assert.match(fragment.text, /En rango/);
    assert.match(fragment.text, /Por encima/);
    assert.match(fragment.text, /12 %/);
    assert.match(fragment.text, /68 %/);
    assert.match(fragment.text, /20 %/);
});

/** An empty band stays in the legend: "no reading below" is information, not a gap. */
test('renderGlucoseSection: a band at 0% is declared all the same', () => {
    const summary = {
        byMethod: {
            capillary: { ...GLUCOSE_WITH_RANGE, belowRangePercent: 0, inRangePercent: 80, aboveRangePercent: 20 },
        },
        excludedByUnit: 0,
    };

    const fragment = renderGlucoseSection(summary, 'mg/dL', { low: 80, high: 130, unit: 'mg/dL' }, false);

    assert.match(fragment.text, /Por debajo/);
    assert.match(fragment.text, /0 %/);
});

/**
 * With no target range there is no bar to paint, and what takes its place is the invitation to
 * configure it, which is the only thing the person can do about it (ADR 0007).
 */
test('renderGlucoseSection: with no target range there is no bar, and the invitation is kept', () => {
    const summary = { byMethod: { capillary: { ...GLUCOSE_METHOD_SUMMARY } }, excludedByUnit: 0 };

    const fragment = renderGlucoseSection(summary, 'mg/dL', undefined, false);

    assert.doesNotMatch(fragment.text, /Tiempo en rango/);
    assert.doesNotMatch(fragment.text, /Por debajo/);
    assert.match(fragment.text, /Configura tu rango objetivo/);
});

/**
 * A range stored in another unit: nothing is converted (ADR 0007), so there are no percentages and
 * therefore no bar either. The notice specific to that case is what cannot be lost.
 */
test('renderGlucoseSection: with the range in another unit there is no bar and the notice is still there', () => {
    const summary = { byMethod: { capillary: { ...GLUCOSE_METHOD_SUMMARY } }, excludedByUnit: 0 };

    const fragment = renderGlucoseSection(summary, 'mg/dL', undefined, true);

    assert.match(fragment.text, /otra unidad/);
    assert.doesNotMatch(fragment.text, /Por debajo/);
    assert.doesNotMatch(fragment.text, /Configura tu rango objetivo/);
});

/** The proportions are distributed with `flex-grow`, and an empty band paints no strip. */
test('createSegmentedBar: it only paints a strip for the bands with a percentage', () => {
    const bar = createSegmentedBar([
        { label: 'Por debajo', percent: 0, value: '0 %', tone: 'warning' },
        { label: 'En rango', percent: 80, value: '80 %', tone: 'good' },
        { label: 'Por encima', percent: 20, value: '20 %', tone: 'warning' },
    ]);

    const [track, legend] = bar.children;

    assert.equal(track.children.length, 2);
    assert.deepEqual(track.children.map((fill) => fill.attributes.style), ['flex-grow:80', 'flex-grow:20']);
    assert.equal(legend.children.length, 3);
});

// --- Trend sparklines --------------------------------------------------------------------------

/**
 * Two points always make a perfect straight line: drawing it would assert a trend that has not
 * been observed. Days with no readings do not count as a point, so a long series of gaps with two
 * readings paints nothing either.
 */
test('createSparkline: with fewer than three readings it draws no trend', () => {
    assert.equal(SPARKLINE_MIN_POINTS, 3);
    assert.equal(createSparkline([100, 110]), null);
    assert.equal(createSparkline([100, null, null, null, 110]), null);
    assert.equal(createSparkline([]), null);
});

test('createSparkline: with three consecutive readings it draws a single three-point stroke', () => {
    const svg = createSparkline([100, 120, 110]);

    assert.notEqual(svg, null);
    assert.equal(svg.attributes['aria-hidden'], 'true');
    assert.equal(svg.children.length, 1);
    assert.equal(svg.children[0].tagName, 'polyline');
    assert.equal(svg.children[0].attributes.points.split(' ').length, 3);
});

/**
 * A day with no readings is a gap, never a zero: the stroke breaks there instead of crossing it,
 * because joining over the gap would draw a slope nobody measured.
 */
test('createSparkline: a day with no readings breaks the stroke instead of crossing it', () => {
    const svg = createSparkline([100, 120, null, 110, 105]);

    assert.equal(svg.children.length, 2);
    assert.deepEqual(svg.children.map((shape) => shape.tagName), ['polyline', 'polyline']);
    assert.equal(svg.children[0].attributes.points.split(' ').length, 2);
});

/** A lone day between two gaps is not a stroke: it is a point, and that is exactly what is known. */
test('createSparkline: a reading isolated between gaps is marked as a point', () => {
    const svg = createSparkline([100, null, 120, null, 110, 118]);

    assert.deepEqual(svg.children.map((shape) => shape.tagName), ['circle', 'circle', 'polyline']);
});

/** A flat series has no range to scale: it is centred, and there is no division by zero. */
test('createSparkline: a series with no variation is drawn centred, with no NaN', () => {
    const svg = createSparkline([90, 90, 90]);

    assert.doesNotMatch(svg.children[0].attributes.points, /NaN/);
});

/** The tile with no series is exactly the one it already was: whoever calls it today does not change. */
test('createStatTile: with no trend, or with one that does not amount to a trend, the tile does not grow', () => {
    const plain = createStatTile({ label: 'Mediana', value: '110', unit: 'mg/dL' });
    const short = createStatTile({ label: 'Mediana', value: '110', unit: 'mg/dL', trend: [100, 110] });
    const drawn = createStatTile({ label: 'Mediana', value: '110', unit: 'mg/dL', trend: [100, 120, 110] });

    assert.equal(plain.children.length, 2);
    assert.equal(short.children.length, 2);
    assert.equal(drawn.children.length, 3);
});

test('renderBloodPressureSection: a single empty state when the period brings nothing', () => {
    const fragment = renderBloodPressureSection({ byMethod: {} });

    assert.equal(countMatches(fragment.text, /Todavía no hay registros/), 1);
    assert.doesNotMatch(fragment.text, /Última semana/);
});

// --- Statistics of weight, temperature and insulin ------------------------------------------------

/**
 * @param {string} type
 * @param {string} occurredAt
 * @param {object} data
 * @returns {object}
 */
function statsEvent(type, occurredAt, data) {
    return { v: 1, type, tz: '+00:00', occurredAt, data };
}

/** Weight is measured one single way: a single card, with no group heading. */
test('renderMeasurementSection: weight summarizes the same statistics of the period', () => {
    const events = [
        statsEvent('bodyWeight', '2026-07-24T08:00:00.000000Z', { value: '72.4', unit: 'kg' }),
        statsEvent('bodyWeight', '2026-07-25T08:00:00.000000Z', { value: '71.6', unit: 'kg' }),
    ];

    const fragment = renderMeasurementSection({ type: 'bodyWeight' }, events);

    assert.match(fragment.text, /Recuento/);
    assert.match(fragment.text, /Media/);
    assert.match(fragment.text, /Mediana/);
    assert.match(fragment.text, /Última lectura/);
    assert.match(fragment.text, /kg/);
    assert.match(fragment.text, /72/);
});

/** The measurement site is never mixed in silence (ADR 0008), like the method in glucose. */
test('renderMeasurementSection: temperature carries one card per site, with its label', () => {
    const events = [
        statsEvent('temperature', '2026-07-25T08:00:00.000000Z', { value: '36.5', unit: 'Cel', site: 'axillary' }),
        statsEvent('temperature', '2026-07-25T09:00:00.000000Z', { value: '37.1', unit: 'Cel', site: 'oral' }),
    ];

    /** The real configuration of the module, not a copy: the site and its labels are its contract. */
    const section = MEASUREMENT_SECTIONS.find((candidate) => candidate.type === 'temperature');

    const fragment = renderMeasurementSection(section, events);

    assert.match(fragment.text, /Axilar/);
    assert.match(fragment.text, /Oral/);
});

test('renderMeasurementSection: with no record of the type, the empty state and not a card of zeros', () => {
    const fragment = renderMeasurementSection({ type: 'bodyWeight' }, []);

    assert.match(fragment.text, /Todavía no hay registros/);
    assert.doesNotMatch(fragment.text, /Recuento/);
});

// --- Statistics sections -------------------------------------------------------------------------

test('renderStatsSections: it only paints the cards of the ticked types', () => {
    const events = [
        statsEvent('glucose', '2026-07-25T09:00:00.000000Z', { value: '112', unit: 'mg/dL', method: 'capillary' }),
        statsEvent('bodyWeight', '2026-07-25T08:00:00.000000Z', { value: '72.4', unit: 'kg' }),
    ];

    const fragment = renderStatsSections(events, {
        selectedTypes: { glucose: true, bodyWeight: true },
        unit: 'mg/dL',
        targetRange: undefined,
        unitMismatch: false,
    });

    assert.match(fragment.text, /Glucemia/);
    assert.match(fragment.text, /Peso corporal/);
    assert.doesNotMatch(fragment.text, /Tensión arterial/);
    assert.doesNotMatch(fragment.text, /Temperatura/);
});

/**
 * The sparkline reaches the tile through the real path, not faked in the test: decrypted events →
 * `dailyTrends` (which reuses `buildDailyBands`, with the day in the time zone of the event itself
 * and days with no readings as a gap) → the median tile.
 *
 * Two days of readings give no trend and three do, which is the same rule in the card as in the
 * module.
 */
test('renderStatsSections: the median sparkline appears when there are enough days', () => {
    const params = { selectedTypes: { glucose: true }, unit: 'mg/dL', targetRange: undefined, unitMismatch: false };
    const glucose = (day, value) => statsEvent(
        'glucose',
        `2026-07-${day}T09:00:00.000000Z`,
        { value, unit: 'mg/dL', method: 'capillary' },
    );

    const svgsOf = (fragment) => JSON.stringify(fragment).match(/"tagName":"(polyline|circle)"/g) ?? [];

    assert.equal(svgsOf(renderStatsSections([glucose('23', '112'), glucose('24', '128')], params)).length, 0);
    assert.equal(
        svgsOf(renderStatsSections([glucose('23', '112'), glucose('24', '128'), glucose('25', '104')], params)).length,
        1,
    );
});

/**
 * An empty screen with no explanation reads as "I have no records", and that is not what happened:
 * it is that no type is ticked.
 */
test('renderStatsSections: with no type ticked it says so, instead of staying blank', () => {
    const fragment = renderStatsSections([], {
        selectedTypes: {},
        unit: 'mg/dL',
        targetRange: undefined,
        unitMismatch: false,
    });

    assert.match(fragment.text, /ningún tipo de evento marcado/);
});

// --- Unified timeline ------------------------------------------------------------------------------

/**
 * Reference date of the timeline tests. The event dates are written at UTC noon on purpose: the
 * grouping by day uses the device zone, and at 12:00Z the local date matches the UTC one in any
 * reasonable zone, so these tests do not change result depending on where they run.
 */
const TIMELINE_REFERENCE = '2026-07-25T18:00:00.000000Z';

/**
 * @param {string} type
 * @param {string} occurredAt
 * @param {object} data
 * @returns {object} A decrypted and flattened event, like the ones `flattenDecryptedEvent` produces.
 */
function timelineEvent(type, occurredAt, data) {
    return { v: 1, type, tz: '+00:00', occurredAt, data };
}

test('describeTimelineEvent: it summarizes a glucose reading with its value, its unit and its method', () => {
    const entry = describeTimelineEvent(timelineEvent('glucose', TIMELINE_REFERENCE, {
        value: '112', unit: 'mg/dL', method: 'capillary', loinc: '41653-7',
    }));

    assert.equal(entry.typeLabel, 'Glucemia');
    assert.equal(entry.summary, '112 mg/dL');
    assert.equal(entry.detail, 'Capilar');
});

test('describeTimelineEvent: blood pressure carries systolic, diastolic and pulse on one line', () => {
    const entry = describeTimelineEvent(timelineEvent('bloodPressure', TIMELINE_REFERENCE, {
        systolic: '120', diastolic: '80', pulse: '68', unit: 'mm[Hg]', arm: 'left', posture: 'sitting',
    }));

    assert.equal(entry.typeLabel, 'Tensión arterial');
    assert.equal(entry.summary, '120/80 mm[Hg] · 68 lpm');
    assert.equal(entry.detail, 'Izquierdo, sentado');
});

/** The pulse is optional (ADR 0006): without it the line writes no zero and leaves no gap. */
test('describeTimelineEvent: a blood pressure with no pulse invents none', () => {
    const entry = describeTimelineEvent(timelineEvent('bloodPressure', TIMELINE_REFERENCE, {
        systolic: '118', diastolic: '76', unit: 'mm[Hg]', arm: 'right', posture: 'lying',
    }));

    assert.equal(entry.summary, '118/76 mm[Hg]');
    assert.doesNotMatch(entry.summary, /lpm/);
});

test('describeTimelineEvent: insulin carries the dose and the type', () => {
    const entry = describeTimelineEvent(timelineEvent('insulin', TIMELINE_REFERENCE, {
        insulinType: 'rapid', dose: '6', unit: '[iU]',
    }));

    assert.equal(entry.typeLabel, 'Insulina');
    assert.equal(entry.summary, '6 [iU]');
    assert.equal(entry.detail, 'Rápida');
});

test('describeTimelineEvent: the meal carries its type and the foods', () => {
    const entry = describeTimelineEvent(timelineEvent('meal', TIMELINE_REFERENCE, {
        mealType: 'breakfast',
        foods: [{ name: 'Tostada', quantity: '2', unit: '{unidad}' }, { name: 'Café', quantity: '1', unit: '{unidad}' }],
    }));

    assert.equal(entry.typeLabel, 'Comida');
    assert.equal(entry.summary, 'Desayuno');
    assert.equal(entry.detail, 'Tostada, Café');
});

/** A long meal cannot take five lines: a few are named and the rest is counted. */
test('describeTimelineEvent: a meal with many foods summarizes the rest with a count', () => {
    const entry = describeTimelineEvent(timelineEvent('meal', TIMELINE_REFERENCE, {
        mealType: 'lunch',
        foods: ['Arroz', 'Pollo', 'Ensalada', 'Pan', 'Fruta'].map((name) => ({ name, quantity: '1', unit: 'g' })),
    }));

    assert.equal(entry.detail, 'Arroz, Pollo, Ensalada, +2');
});

test('describeTimelineEvent: a meal with no foods says so, it does not fake a list', () => {
    const entry = describeTimelineEvent(timelineEvent('meal', TIMELINE_REFERENCE, { mealType: 'snack', foods: [] }));

    assert.equal(entry.detail, 'sin alimentos anotados');
});

test('describeTimelineEvent: weight and temperature, the two new types', () => {
    const weight = describeTimelineEvent(timelineEvent('bodyWeight', TIMELINE_REFERENCE, {
        value: '72.4', unit: 'kg', loinc: '3141-9',
    }));
    const temperature = describeTimelineEvent(timelineEvent('temperature', TIMELINE_REFERENCE, {
        value: '36.8', unit: 'Cel', site: 'axillary', loinc: '8310-5',
    }));

    assert.equal(weight.typeLabel, 'Peso corporal');
    assert.equal(weight.summary, '72,4 kg');
    assert.equal(temperature.typeLabel, 'Temperatura');
    assert.equal(temperature.summary, '36,8 Cel');
    assert.equal(temperature.detail, 'Axilar');
});

/** The decimal separator is the one of the language: in Spanish `36,8`, not `36.8` (see `formatNumber`). */
test('formatMeasuredValue: it localizes the decimal separator and respects what is not a number', () => {
    assert.equal(formatMeasuredValue('36.8'), '36,8');
    assert.equal(formatMeasuredValue('120'), '120');
    assert.equal(formatMeasuredValue('positivo'), 'positivo');
    assert.equal(formatMeasuredValue(''), '');
    assert.equal(formatMeasuredValue(undefined), '');
});

test('describeTimelineEvent: a type it cannot summarize returns null instead of an empty line', () => {
    assert.equal(describeTimelineEvent(timelineEvent('futureType', TIMELINE_REFERENCE, { value: '1' })), null);
    assert.equal(describeTimelineEvent({ occurredAt: TIMELINE_REFERENCE }), null);
});

/** The reason for the screen: meal, insulin and glucose of the same day, together and in order. */
test('buildTimeline: it mixes every type and sorts them from most recent to oldest', () => {
    const events = [
        timelineEvent('glucose', '2026-07-25T09:30:00.000000Z', { value: '145', unit: 'mg/dL', method: 'capillary' }),
        timelineEvent('meal', '2026-07-25T08:00:00.000000Z', { mealType: 'breakfast', foods: [] }),
        timelineEvent('insulin', '2026-07-25T08:05:00.000000Z', { insulinType: 'rapid', dose: '6', unit: '[iU]' }),
    ];

    const { entries, hidden, unsupported } = buildTimeline(events);

    assert.deepEqual(entries.map((entry) => entry.type), ['glucose', 'insulin', 'meal']);
    assert.equal(hidden, 0);
    assert.equal(unsupported, 0);
});

/**
 * It no longer clips by window, and that is no oversight: the period is applied by the server when
 * asking for the events (`[from, to)`) and the type by the caller, so what arrives is what is
 * painted. A second clip on the client would hide records the chosen period does include.
 */
test('buildTimeline: it does not clip by date again what the server already narrowed', () => {
    const events = [
        timelineEvent('glucose', '2026-07-24T12:00:00.000000Z', { value: '100', unit: 'mg/dL', method: 'capillary' }),
        timelineEvent('glucose', '2026-01-01T12:00:00.000000Z', { value: '100', unit: 'mg/dL', method: 'capillary' }),
    ];

    const { entries } = buildTimeline(events);

    assert.equal(entries.length, 2);
    assert.equal(entries[0].occurredAt, '2026-07-24T12:00:00.000000Z');
});

test('buildTimeline: it counts the types it cannot describe instead of swallowing them', () => {
    const events = [
        timelineEvent('glucose', '2026-07-24T12:00:00.000000Z', { value: '100', unit: 'mg/dL', method: 'capillary' }),
        timelineEvent('futureType', '2026-07-24T13:00:00.000000Z', { value: '1' }),
    ];

    const { entries, unsupported } = buildTimeline(events);

    assert.equal(entries.length, 1);
    assert.equal(unsupported, 1);
});

/**
 * The cap exists because of the cost of painting, not of decrypting (the events already arrive
 * decrypted). What this test fixes is that it clips by the most recent and that it says how many
 * it left out: a silent clip would make the timeline read as if it were complete.
 */
test('buildTimeline: it clips by the most recent and declares how many entries were left out', () => {
    const total = TIMELINE_MAX_ENTRIES + 7;
    const events = Array.from({ length: total }, (_, index) => timelineEvent(
        'glucose',
        new Date(Date.parse(TIMELINE_REFERENCE) - (index * 60 * 60 * 1000)).toISOString(),
        { value: String(100 + index), unit: 'mg/dL', method: 'capillary' },
    ));

    const { entries, hidden } = buildTimeline(events);

    assert.equal(entries.length, TIMELINE_MAX_ENTRIES);
    assert.equal(hidden, 7);
    assert.equal(entries[0].summary, '100 mg/dL');
});

test('groupEntriesByDay: it groups by day and keeps the order of the entries', () => {
    const entries = [
        { occurredAt: '2026-07-25T18:00:00.000000Z' },
        { occurredAt: '2026-07-25T09:00:00.000000Z' },
        { occurredAt: '2026-07-24T21:00:00.000000Z' },
    ];

    const days = groupEntriesByDay(entries);

    assert.equal(days.length, 2);
    assert.equal(days[0].entries.length, 2);
    assert.equal(days[1].entries.length, 1);
    assert.equal(days[0].dayKey, localDayKey('2026-07-25T18:00:00.000000Z'));
});

/**
 * The same empty state the other two sections use (`renderEmptyState`). The button leading to
 * creating the first record does not appear here because the destination is read from the `data-*`
 * Blade paints, and the `document` of these tests has no `querySelector`: the sentence, which is
 * what informs, does not depend on finding the route.
 */
/**
 * The empty state has to be able to say **which of the two things** happened. "No records in this
 * period yet" over records that are in the period and merely filtered by the search box is an
 * absence read as a clinical zero, which is the error this project cannot afford.
 * puede permitirse.
 */
test('renderTimelineSection and renderStatsSections accept the sentence of the empty state', () => {
    const timeline = renderTimelineSection([], { emptyText: 'Nada coincide con lo buscado.' });

    assert.match(timeline.text, /Nada coincide con lo buscado\./);

    const stats = renderStatsSections([], {
        selectedTypes: { glucose: true },
        unit: 'mg/dL',
        targetRange: undefined,
        unitMismatch: false,
        emptyText: 'Este recorte no trae nada de este tipo.',
    });

    assert.match(stats.text, /Este recorte no trae nada de este tipo\./);
});

test('renderTimelineSection: with no record at all, the empty state coherent with the rest', () => {
    const fragment = renderTimelineSection([]);

    assert.match(fragment.text, /Todavía no hay registros/);
});

test('renderTimelineSection: it paints the time, the type and the datum of each entry', () => {
    const events = [
        timelineEvent('glucose', '2026-07-25T09:30:00.000000Z', { value: '112', unit: 'mg/dL', method: 'capillary' }),
        timelineEvent('insulin', '2026-07-25T08:05:00.000000Z', { insulinType: 'rapid', dose: '6', unit: '[iU]' }),
    ];

    const fragment = renderTimelineSection(events);

    assert.match(fragment.text, /Glucemia/);
    assert.match(fragment.text, /112 mg\/dL/);
    assert.match(fragment.text, /Insulina/);
    assert.match(fragment.text, /6 \[iU\]/);
});

test('renderTimelineSection: it says how many entries were left out when it clips', () => {
    const total = TIMELINE_MAX_ENTRIES + 3;
    const events = Array.from({ length: total }, (_, index) => timelineEvent(
        'glucose',
        new Date(Date.parse(TIMELINE_REFERENCE) - (index * 60 * 60 * 1000)).toISOString(),
        { value: '100', unit: 'mg/dL', method: 'capillary' },
    ));

    const fragment = renderTimelineSection(events);

    assert.match(fragment.text, new RegExp(String(TIMELINE_MAX_ENTRIES)));
    assert.match(fragment.text, /3 más antiguas no aparecen/);
});

test('renderTimelineSection: it warns about the records of a type it cannot summarize', () => {
    const events = [timelineEvent('futureType', '2026-07-25T09:00:00.000000Z', { value: '1' })];

    const fragment = renderTimelineSection(events);

    assert.match(fragment.text, /todavía no sabe resumir/);
});

// --- Charts of the period -----------------------------------------------------------------------

test('chartElementIds: the identifiers are the ones the template writes', () => {
    assert.deepEqual(chartElementIds('glucose'), {
        block: 'dashboard-chart-glucose',
        canvas: 'dashboard-chart-glucose-canvas',
        caption: 'dashboard-chart-glucose-caption',
        legend: 'dashboard-chart-glucose-legend',
    });
});

test('CHART_SECTIONS: there is no meals chart, they have no quantity to average', () => {
    assert.deepEqual(
        CHART_SECTIONS.map((section) => section.type),
        ['glucose', 'bloodPressure', 'insulin', 'bodyWeight', 'temperature'],
    );
});

test('chartSeriesLabel: a lone quantity is named by its measurement method (ADR 0008)', () => {
    const glucose = CHART_SECTIONS.find((section) => section.type === 'glucose');

    assert.equal(chartSeriesLabel(glucose, { group: 'capillary', valueKey: 'value' }), 'Capilar');
});

test('chartSeriesLabel: blood pressure also says which of the two quantities it is', () => {
    const bloodPressure = CHART_SECTIONS.find((section) => section.type === 'bloodPressure');

    assert.equal(
        chartSeriesLabel(bloodPressure, { group: 'left_sitting', valueKey: 'systolic' }),
        'Izquierdo, sentado · Sistólica',
    );
});

test('chartSeriesLabel: a type that does not group takes the name of the type, never an unnamed entry', () => {
    const bodyWeight = CHART_SECTIONS.find((section) => section.type === 'bodyWeight');

    assert.equal(chartSeriesLabel(bodyWeight, { group: '', valueKey: 'value' }), 'Peso corporal');
});

test('chartUnit: glucose takes the display unit and the others the one of the most recent record', () => {
    const events = [
        {
            type: 'bodyWeight',
            tz: '+00:00',
            occurredAt: '2026-07-25T09:00:00.000000Z',
            data: { value: '70', unit: 'kg' },
        },
    ];

    assert.equal(chartUnit({ type: 'glucose' }, events, 'mmol/L'), 'mmol/L');
    assert.equal(chartUnit({ type: 'bodyWeight' }, events, 'mmol/L'), 'kg');
    assert.equal(chartUnit({ type: 'temperature' }, events, 'mmol/L'), null);
});

test('chartCaptionText: with no series it says there is nothing to draw, not an empty list', () => {
    const caption = chartCaptionText({ seriesLabels: [], unit: 'mg/dL', excludedByUnit: 0, omittedDays: 0 });

    assert.match(caption, /No hay lecturas/);
});

test('chartCaptionText: it names the series, the unit and everything that was left out', () => {
    const caption = chartCaptionText({
        seriesLabels: ['Capilar', 'Intersticial'],
        unit: 'mg/dL',
        excludedByUnit: 2,
        omittedDays: 5,
    });

    assert.match(caption, /Capilar/);
    assert.match(caption, /Intersticial/);
    assert.match(caption, /mg\/dL/);
    assert.match(caption, /5/);
    assert.match(caption, /2 registros/);
});
