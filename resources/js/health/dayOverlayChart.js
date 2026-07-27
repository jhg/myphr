/**
 * Drawing of the overlay of days on a 24-hour axis.
 *
 * It takes what `health/dayOverlay.js` builds and returns the Chart.js instance: it neither
 * computes nor reads events, which is why it comes out the same in the patient panel, in the
 * professional's reader and in the share preview.
 *
 * **What is seen and why in two weights.** Each day is a thin translucent line: alone it says
 * nothing, and together they draw the cloud of what usually happens at each hour. On top, the
 * hourly median in a thick stroke, which is the one that is read. If both had the same weight,
 * forty lines would cover the only one that summarizes, the failure that makes this format unreadable.
 *
 * **The target range goes as a background band** (ADR 0007), when the person has it configured:
 * it is what turns a cloud of points into information, because it says at a glance what part of
 * the day is spent outside. A range of another unit is never drawn: the caller decides that, and
 * here it arrives resolved or it does not arrive.
 */

import Chart from 'chart.js/auto';

import { formatNumber, t } from '../i18n/index.js';
import { legendElementFor, legendItems, renderLegend } from './chartLegend.js';
import { chartColors, CHART_FONTS } from './chartTheme.js';
import { wallClockFormat } from './chartTime.js';
import { withAlpha } from './medianBandChart.js';

/** Opacity of the line of a single day: context, not datum. */
const DAY_ALPHA = 0.22;

/** Opacity of the target range band: it has to let everything above it be read. */
const TARGET_ALPHA = 0.14;

/** Shapes of the median of each group, the second encoding of Do's #3. */
const MEDIAN_SHAPES = Object.freeze([
    Object.freeze({ borderDash: [], pointStyle: 'circle' }),
    Object.freeze({ borderDash: [6, 4], pointStyle: 'triangle' }),
    Object.freeze({ borderDash: [2, 3], pointStyle: 'rect' }),
]);

/**
 * Hour of the axis, written in the active language.
 *
 * It is formatted over an epoch instant in UTC because what is shown is a wall clock time, not an
 * instant ({@see wallClockFormat}).
 *
 * @param {Intl.DateTimeFormat} format
 * @param {number} hour Between 0 and 24, with decimals.
 * @returns {string}
 */
export function hourLabel(format, hour) {
    return format.format(new Date(Math.round(hour * 3_600_000)));
}

/**
 * Background band of the target range.
 *
 * It goes in `beforeDatasetsDraw` so it stays **below** every line: painted on top it would tint
 * the data and change the colour a glucose reading is read in.
 *
 * @param {{low: number, high: number}|undefined} targetRange
 * @param {{series: list<string>}} colors
 * @returns {object|null}
 */
function targetRangePlugin(targetRange, colors) {
    if (targetRange === undefined || targetRange === null) {
        return null;
    }

    return {
        id: 'phrTargetRange',
        beforeDatasetsDraw(chart) {
            const { ctx, chartArea, scales } = chart;
            const top = scales.y.getPixelForValue(targetRange.high);
            const bottom = scales.y.getPixelForValue(targetRange.low);

            ctx.save();
            /** Clipped to the data area: outside it the band would invade the axis labels. */
            ctx.beginPath();
            ctx.rect(chartArea.left, chartArea.top, chartArea.right - chartArea.left, chartArea.bottom - chartArea.top);
            ctx.clip();
            /** Success with transparency: the shade of "in range", never an invented colour. */
            ctx.fillStyle = withAlpha(colors.series[2], TARGET_ALPHA);
            ctx.fillRect(chartArea.left, top, chartArea.right - chartArea.left, bottom - top);
            ctx.restore();
        },
    };
}

/**
 * Paints the chart and returns the instance, or `null` if there is no day to overlay.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {object} params
 * @param {list<{group: string, label: string, days: list<object>, median: list<object>}>} params.groups
 *        Already labelled and translated by the caller.
 * @param {string} params.unit UCUM code (ADR 0005: not translated).
 * @param {string} params.legendId
 * @param {{low: number, high: number, unit: string}} [params.targetRange] Already checked to be in
 *        the same unit (ADR 0007: nothing is converted).
 * @returns {Chart|null}
 */
export function renderDayOverlayChart(canvas, { groups, unit, legendId, targetRange }) {
    const colors = chartColors();
    const described = groups.map((group, index) => ({
        ...group,
        color: colors.series[index % colors.series.length],
        ...MEDIAN_SHAPES[index % MEDIAN_SHAPES.length],
    }));

    renderLegend(legendElementFor(canvas, legendId), legendItems(described.map((group) => ({
        label: t('dashboard.chart.overlay.medianLabel', { group: group.label }),
        color: group.color,
        borderDash: group.borderDash,
        pointStyle: group.pointStyle,
    }))));

    if (described.length === 0) {
        return null;
    }

    const hourFormat = wallClockFormat({ hour: '2-digit', minute: '2-digit' });
    const dayFormat = wallClockFormat({ month: 'short', day: 'numeric' });

    const datasets = described.flatMap((group) => [
        /**
         * One dataset per day. A high `order` sends them to the back: Chart.js draws the ones with
         * a higher order first, so the median ends up above its own cloud.
         */
        ...group.days.map((day) => ({
            label: dayFormat.format(new Date(`${day.day}T00:00:00Z`)),
            data: day.points,
            borderColor: withAlpha(group.color, DAY_ALPHA),
            borderWidth: 1,
            pointRadius: 0,
            pointHitRadius: 6,
            tension: 0.25,
            order: 2,
            isDay: true,
        })),
        {
            label: t('dashboard.chart.overlay.medianLabel', { group: group.label }),
            data: group.median,
            borderColor: group.color,
            backgroundColor: group.color,
            pointBackgroundColor: group.color,
            pointBorderColor: colors.surface,
            pointBorderWidth: 2,
            pointRadius: 4,
            pointHoverRadius: 6,
            borderWidth: 3,
            borderDash: [...group.borderDash],
            pointStyle: group.pointStyle,
            tension: 0.3,
            order: 1,
            /** `spanGaps` false out of the box: an hour with no readings has no median and looks like it. */
        },
    ]);

    const plugin = targetRangePlugin(targetRange, colors);

    return new Chart(canvas, {
        type: 'line',
        data: { datasets },
        options: {
            maintainAspectRatio: false,
            color: colors.tick,
            interaction: { mode: 'nearest', intersect: false },
            scales: {
                x: {
                    type: 'linear',
                    min: 0,
                    max: 24,
                    grid: { color: colors.grid },
                    border: { color: colors.tick },
                    ticks: {
                        color: colors.tick,
                        font: { family: CHART_FONTS.mono, size: 12 },
                        stepSize: 3,
                        maxRotation: 0,
                        callback: (value) => hourLabel(hourFormat, value),
                    },
                },
                y: {
                    grid: { color: colors.grid },
                    border: { color: colors.tick },
                    ticks: { color: colors.tick, font: { family: CHART_FONTS.mono, size: 12 } },
                    title: {
                        display: true,
                        text: unit,
                        color: colors.tick,
                        font: { family: CHART_FONTS.mono, size: 13, weight: 400 },
                    },
                },
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        title: (items) => hourLabel(hourFormat, items[0].parsed.x),
                        label: (item) => t('dashboard.chart.overlay.tooltip', {
                            label: item.dataset.label,
                            value: formatNumber(item.parsed.y),
                            unit,
                        }),
                    },
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
        plugins: plugin === null ? [] : [plugin],
    });
}
