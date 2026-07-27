/**
 * Checks of `health/timeAxis.js`, the horizontal axis shared by every chart that places each
 * reading at the instant it happened.
 *
 * What is being defended here is the reason the axis was rewritten: **the hole between two readings
 * is a datum**. A reading at 00:00, one at 12:00 and one at 12:30 have to come out with the first
 * gap twenty-four times wider than the second, and on a category axis they came out identical. The
 * assertions below are on the numbers the axis consumes, which is what decides the position of
 * every point; the drawing itself belongs to Chart.js.
 *
 * Node's built-in runner, like the rest of `tests/js`:
 *
 *     npm test
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    chartTimeFormat,
    MIN_TIME_AXIS_SPAN_MS,
    splitOnGaps,
    timeAxisBounds,
    timeAxisScale,
    timeAxisTooltipTitle,
} from '../../resources/js/health/timeAxis.js';

/** Theme colours, in the shape `chartColors()` returns them. */
const COLORS = Object.freeze({ grid: '#e2e8f0', tick: '#475569' });

const HOUR = 3_600_000;

test('the axis is linear over the instant, so the distance between readings is the real one', () => {
    const scale = timeAxisScale({ colors: COLORS, format: chartTimeFormat() });

    assert.equal(scale.type, 'linear');
    /** Chart.js has to choose how many labels fit: one per reading would pile them up. */
    assert.equal(scale.ticks.maxRotation, 0);
    assert.equal(typeof scale.ticks.autoSkipPadding, 'number');
    assert.equal(typeof scale.ticks.callback, 'function');
});

test('the axis labels are formatted, never the raw epoch number', () => {
    const scale = timeAxisScale({ colors: COLORS, format: chartTimeFormat() });
    const label = scale.ticks.callback(Date.UTC(2026, 6, 25, 12, 30));

    assert.notEqual(label, String(Date.UTC(2026, 6, 25, 12, 30)));
    assert.match(label, /25/);
});

test('the tooltip title exists and is the same format as the axis: without it, a raw epoch shows', () => {
    const format = chartTimeFormat();
    const title = timeAxisTooltipTitle(format);
    const instant = Date.UTC(2026, 6, 25, 12, 30);

    assert.equal(title([{ parsed: { x: instant } }]), format.format(new Date(instant)));
});

test('the label is the wall clock of the event, so it does not move with the zone of whoever looks', () => {
    /**
     * The value is a wall clock time encoded as if it were UTC (`eventWallClockMs`), so the axis
     * has to format it in UTC. Reading it in the browser zone would shift a 23:30 dinner.
     */
    const format = chartTimeFormat();

    assert.equal(format.resolvedOptions().timeZone, 'UTC');
});

test('two nearby readings and one far away keep their real proportion', () => {
    const midnight = Date.UTC(2026, 6, 25, 0, 0);
    const noon = Date.UTC(2026, 6, 25, 12, 0);
    const afterNoon = Date.UTC(2026, 6, 25, 12, 30);

    const points = [
        { x: midnight, y: 90 },
        { x: noon, y: 140 },
        { x: afterNoon, y: 155 },
    ];

    /** The example that motivated all this: twelve hours against half an hour, 24 times wider. */
    assert.equal((noon - midnight) / (afterNoon - noon), 24);

    /**
     * On the axis the points travel with their own `x`, not with their position in a list: that is
     * what keeps the proportion. With six hours of threshold the night gap is a break, and the two
     * readings half an hour apart stay joined.
     */
    const drawn = splitOnGaps(points, 6 * HOUR);

    assert.deepEqual(drawn.map((point) => point.y), [90, null, 140, 155]);
    assert.deepEqual(drawn.map((point) => point.x), [midnight, (midnight + noon) / 2, noon, afterNoon]);
});

test('splitOnGaps: with no gap over the threshold it touches nothing', () => {
    const points = [{ x: 0, y: 1 }, { x: HOUR, y: 2 }, { x: 2 * HOUR, y: 3 }];

    assert.deepEqual(splitOnGaps(points, 6 * HOUR), points);
});

test('splitOnGaps: the threshold is a parameter, because a hole is not the same in a fever as in a weight', () => {
    const points = [{ x: 0, y: 1 }, { x: 48 * HOUR, y: 2 }];

    assert.equal(splitOnGaps(points, 24 * HOUR).length, 3);
    assert.equal(splitOnGaps(points, 31 * 24 * HOUR).length, 2);
});

test('splitOnGaps: an empty series or a single point comes out untouched', () => {
    assert.deepEqual(splitOnGaps([], HOUR), []);
    assert.deepEqual(splitOnGaps([{ x: 5, y: 1 }], HOUR), [{ x: 5, y: 1 }]);
});

test('a single reading does not leave the chart blank: the axis is given a span', () => {
    const bounds = timeAxisBounds([Date.UTC(2026, 6, 25, 9, 0)]);

    assert.equal(bounds.max - bounds.min, MIN_TIME_AXIS_SPAN_MS);
    /** Centred on the reading: it is not pushed against either edge. */
    assert.equal((bounds.min + bounds.max) / 2, Date.UTC(2026, 6, 25, 9, 0));
});

test('several readings at the same instant are a zero range and are widened just the same', () => {
    const instant = Date.UTC(2026, 6, 25, 9, 0);
    const bounds = timeAxisBounds([instant, instant, instant]);

    assert.equal(bounds.max - bounds.min, MIN_TIME_AXIS_SPAN_MS);
});

test('with a real span nothing is imposed, so Chart.js keeps its margin', () => {
    const bounds = timeAxisBounds([Date.UTC(2026, 6, 25), Date.UTC(2026, 6, 26)]);

    assert.deepEqual(bounds, {});
});

test('with no readings, or with unreadable ones, no bounds are invented', () => {
    assert.deepEqual(timeAxisBounds([]), {});
    assert.deepEqual(timeAxisBounds([Number.NaN, undefined, null]), {});
});
