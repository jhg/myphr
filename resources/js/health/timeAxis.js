/**
 * Horizontal axis of every chart that places each reading at the instant it happened.
 *
 * **Why linear and not category.** On a category axis every reading takes the same width, so three
 * glucose readings at 00:00, 12:00 and 12:30 come out equally spaced and the twelve hours between
 * the first two vanish. That hole is a clinical datum, not decoration: three readings crammed into
 * half an hour say something very different from three spread over a day, and a week with nothing
 * recorded has to look wide. Of the two axes, only the linear one over the instant tells the truth.
 *
 * **Why not the `time` scale of Chart.js.** It needs a date adapter and none is installed (the
 * project brings `chart.js` and no date library at all). `linear` over epoch milliseconds plus a
 * `callback` that formats each label covers the whole case with no new dependency, and it is what
 * the glucose context chart has been doing since it was written.
 *
 * **The instant is the wall clock of whoever recorded it** ({@see eventWallClockMs}), never an
 * absolute one: a dinner at 23:30 in Madrid stays at 23:30 when the app is opened from London. That
 * is why the labels are formatted in UTC ({@see wallClockFormat}); formatting them in the browser
 * zone would shift them a second time.
 *
 * Pure enough to be tested without a canvas (`tests/js/timeAxis.test.mjs`): it builds objects and
 * lists, it does not paint.
 */

import { CHART_FONTS } from './chartTheme.js';
import { wallClockFormat } from './chartTime.js';

/**
 * Narrowest span the axis is allowed to cover.
 *
 * A chart with a single reading, or with several recorded at the same minute, has a range of zero.
 * Chart.js survives it —it widens the range by half a unit, half a millisecond here— but every tick
 * then falls inside the same minute and the axis comes out as a row of identical labels around a
 * point stuck to the edge. Half an hour of margin gives the point air and readable ticks without
 * touching the proportion between readings, which stays exactly as it is: the padding is added on
 * both sides.
 */
export const MIN_TIME_AXIS_SPAN_MS = 30 * 60_000;

/**
 * Label formatter of the time axis, in the active language and in UTC (see the module JSDoc).
 *
 * One is built per draw and not one per label, for the reason {@see wallClockFormat} explains.
 *
 * @returns {Intl.DateTimeFormat}
 */
export function chartTimeFormat() {
    return wallClockFormat({ month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/**
 * Bounds to force on the axis, or an empty object to let Chart.js fit the data.
 *
 * It only speaks up in the degenerate case ({@see MIN_TIME_AXIS_SPAN_MS}). Whenever the readings
 * already span more than the minimum, nothing is imposed: pinning `min` and `max` to the data would
 * take away the margin Chart.js leaves and the first and last points would be drawn cut in half by
 * the edge of the canvas.
 *
 * @param {list<number>} instants Every X of the chart, in any order. Non-finite values are ignored.
 * @returns {{min?: number, max?: number}}
 */
export function timeAxisBounds(instants) {
    let min = Infinity;
    let max = -Infinity;

    for (const instant of instants) {
        if (!Number.isFinite(instant)) {
            continue;
        }

        min = Math.min(min, instant);
        max = Math.max(max, instant);
    }

    if (min === Infinity || max - min >= MIN_TIME_AXIS_SPAN_MS) {
        return {};
    }

    const padding = (MIN_TIME_AXIS_SPAN_MS - (max - min)) / 2;

    return { min: min - padding, max: max + padding };
}

/**
 * Splits a series sorted by instant wherever the gap between two readings goes over `maxGapMs`.
 *
 * With a category axis a gap looked short and joining across it went unnoticed. With a proportional
 * axis it does not: a straight segment crossing two empty months states a change nobody measured.
 * The cut is a point of value `null` halfway, which is what Chart.js draws as a break when
 * `spanGaps` is left at its default `false`.
 *
 * The threshold is not global because it is not the same for every quantity: what is a hole in a
 * fever curve is a normal cadence in a weight one. Each screen states its own and says why.
 *
 * @param {list<{x: number, y: number}>} points Sorted ascending by `x`.
 * @param {number} maxGapMs
 * @returns {list<{x: number, y: number|null}>}
 */
export function splitOnGaps(points, maxGapMs) {
    const withGaps = [];

    for (const [index, point] of points.entries()) {
        const previous = points[index - 1];

        if (previous !== undefined && point.x - previous.x > maxGapMs) {
            withGaps.push({ x: (previous.x + point.x) / 2, y: null });
        }

        withGaps.push(point);
    }

    return withGaps;
}

/**
 * The `x` scale, ready to drop into the `scales` of any chart of readings over time.
 *
 * `maxRotation: 0` and `autoSkipPadding` are what keeps the labels readable with irregular spacing:
 * Chart.js decides how many fit and drops the rest, instead of writing one per reading and piling
 * them on top of each other.
 *
 * @param {object} params
 * @param {{grid: string, tick: string}} params.colors Theme colours, read at draw time (`chartTheme.js`).
 * @param {Intl.DateTimeFormat} params.format {@see chartTimeFormat}.
 * @param {{min?: number, max?: number}} [params.bounds] {@see timeAxisBounds}.
 * @returns {object}
 */
export function timeAxisScale({ colors, format, bounds = {} }) {
    return {
        type: 'linear',
        ...bounds,
        /**
         * The grid may be faint, but the AXIS LINE may not: it is the reference the reading is read
         * against, and in the grid shade it was nearly invisible (Don'ts #10). It goes in the same
         * shade as the labels.
         */
        grid: { color: colors.grid },
        border: { color: colors.tick },
        ticks: {
            /** The axis labels are dates and times: values, not prose (Do's #7). */
            color: colors.tick,
            font: { family: CHART_FONTS.mono, size: 12 },
            maxRotation: 0,
            autoSkipPadding: 16,
            callback: (value) => format.format(new Date(value)),
        },
    };
}

/**
 * Tooltip title: the instant of the point, in the same format as the axis.
 *
 * It exists so that no screen forgets it. With a category axis the title came free from the label;
 * with a linear one, whoever does not set it gets the raw epoch number (`1753574400000`) as the
 * heading of every tooltip.
 *
 * @param {Intl.DateTimeFormat} format {@see chartTimeFormat}.
 * @returns {(items: list<{parsed: {x: number}}>) => string}
 */
export function timeAxisTooltipTitle(format) {
    return (items) => format.format(new Date(items[0].parsed.x));
}
