/**
 * Drawing of the glucose curve with the meal and insulin markers on top.
 *
 * It takes what `health/glucoseContext.js` builds —already grouped, already clipped and already
 * labelled— and returns the Chart.js instance. It computes nothing and reads no events: that is
 * why the same chart comes out in the patient panel, in the professional's reader and in the share preview.
 *
 * **The X axis is linear, not category and not time.** It is the shared axis of `timeAxis.js`, the
 * same one every screen of readings over time uses: distances mean something here, so two readings
 * ten minutes apart and two ten hours apart cannot end up equally far, or the post-meal rise would
 * read as an invented slope. The axis values are wall clock times (`eventWallClockMs`), which is
 * why the labels are formatted in UTC.
 *
 * **The markers live on their own vertical axis, invisible and fixed from 0 to 1.** That way they
 * stay stuck at the bottom whatever the glucose does: hanging them off the mg/dL axis would move
 * them with every scale change and a meal would end up drawn at the height of a hyperglycaemia.
 */

import Chart from 'chart.js/auto';

import { formatNumber, t } from '../i18n/index.js';
import { legendElementFor, legendItems, renderLegend } from './chartLegend.js';
import { chartColors, CHART_FONTS } from './chartTheme.js';
import { chartTimeFormat, timeAxisBounds, timeAxisScale, timeAxisTooltipTitle } from './timeAxis.js';

/**
 * Height of each marker kind on the auxiliary axis (0 bottom, 1 top).
 *
 * Two lanes and not one: stacked at the same height, a meal and its injection —which usually go
 * together— would cover each other, and what we want to see is precisely that they go together.
 */
const MARKER_LEVELS = Object.freeze({ meal: 0.06, insulin: 0.16 });

/**
 * Shape of each marker kind. It is the second encoding Do's #3 asks for: the meal marker and the
 * insulin one are told apart by silhouette, not by colour alone.
 */
const MARKER_SHAPES = Object.freeze({ meal: 'rectRot', insulin: 'triangle' });

/**
 * How many insulin markers can carry the dose written next to them.
 *
 * Past that number, the labels overlap each other and the curve: they stop being information and
 * become the unreadable fence this limit exists to avoid. The dose is not lost —it stays on the
 * marker on hover or tap, and in the timeline—, it just stops being written out.
 */
const MAX_DOSE_LABELS = 10;

/** Radius of a marker, which grows a little with the ones grouped inside it. */
const MARKER_RADIUS = 6;

/**
 * Descriptors of the glucose series: colour and shape by position.
 *
 * **Only the first two colours** of DESIGN.md § Charts are handed out, the two neutral blues of
 * the system: the other two are the Success and Warning shades and here they are reserved for the
 * meal and insulin markers, which really are something else. Two methods with the same blue are
 * still told apart by dash pattern and point shape.
 *
 * @param {list<string>} labels
 * @param {{series: list<string>}} colors
 * @returns {list<{label: string, color: string, borderDash: list<number>, pointStyle: string}>}
 */
export function describeGlucoseSeries(labels, colors) {
    const shapes = [
        { borderDash: [], pointStyle: 'circle' },
        { borderDash: [6, 4], pointStyle: 'triangle' },
        { borderDash: [2, 3], pointStyle: 'rect' },
    ];

    return labels.map((label, index) => ({
        label,
        color: colors.series[index % 2],
        ...shapes[index % shapes.length],
    }));
}

/**
 * Text of a marker on hover: what it carries inside and, if it groups several, how many.
 *
 * @param {{count: number, items: list<string>}} marker
 * @returns {list<string>}
 */
export function markerTooltipLines(marker) {
    const lines = [...marker.items];
    const hidden = marker.count - marker.items.length;

    if (hidden > 0) {
        lines.push(t('dashboard.chart.context.moreGrouped', { count: hidden }));
    }

    return lines;
}

/**
 * Chart.js dataset of one marker kind.
 *
 * @param {string} kind `meal` or `insulin`.
 * @param {list<object>} markers Only the ones of that kind.
 * @param {{color: string, label: string}} style
 * @returns {object}
 */
function markerDataset(kind, markers, style) {
    return {
        type: 'scatter',
        label: style.label,
        yAxisID: 'marks',
        data: markers.map((marker) => ({ x: marker.x, y: MARKER_LEVELS[kind] })),
        /** The details travel with the dataset, for the tooltip and for the dose labels. */
        markers,
        markerKind: kind,
        backgroundColor: style.color,
        borderColor: style.color,
        pointStyle: MARKER_SHAPES[kind],
        pointRadius: (context) => MARKER_RADIUS + Math.min(4, (markers[context.dataIndex]?.count ?? 1) - 1),
        pointHoverRadius: (context) => MARKER_RADIUS + 2 + Math.min(4, (markers[context.dataIndex]?.count ?? 1) - 1),
        showLine: false,
    };
}

/**
 * Writes the dose above each insulin marker, as long as they fit.
 *
 * It is a Chart.js plugin and not a DOM label because it has to follow the marker on every redraw
 * (resizing the window moves every position). The colour is the axis label one, read from the
 * theme at draw time like everything else (§ Charts — Dark).
 *
 * @param {{tick: string}} colors
 * @returns {object}
 */
function doseLabelPlugin(colors) {
    return {
        id: 'phrDoseLabels',
        afterDatasetsDraw(chart) {
            for (const [index, dataset] of chart.data.datasets.entries()) {
                if (dataset.markerKind !== 'insulin' || dataset.markers.length > MAX_DOSE_LABELS) {
                    continue;
                }

                const { ctx } = chart;

                ctx.save();
                ctx.fillStyle = colors.tick;
                ctx.font = `12px ${CHART_FONTS.mono}`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'bottom';

                for (const [position, element] of chart.getDatasetMeta(index).data.entries()) {
                    const marker = dataset.markers[position];
                    const text = marker.count > 1
                        ? t('dashboard.chart.context.groupedShort', { count: marker.count })
                        : marker.short;

                    if (text !== '') {
                        ctx.fillText(text, element.x, element.y - MARKER_RADIUS - 3);
                    }
                }

                ctx.restore();
            }
        },
    };
}

/**
 * Paints the chart and returns the instance, or `null` if there is no glucose reading.
 *
 * With no glucose the canvas is not drawn even if there are meals and insulin: this chart is the
 * relation between the three things, and a few loose markers over empty axes say nothing the
 * timeline does not say better.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {object} params
 * @param {list<{label: string, points: list<{x: number, y: number|null}>}>} params.series
 * @param {list<{kind: string, x: number, count: number, items: list<string>, short: string}>} params.markers
 * @param {string} params.unit UCUM code (ADR 0005: not translated).
 * @param {string} params.legendId
 * @returns {Chart|null}
 */
export function renderGlucoseContextChart(canvas, { series, markers, unit, legendId }) {
    const colors = chartColors();
    const described = describeGlucoseSeries(series.map((entry) => entry.label), colors);

    const markerStyles = {
        meal: { color: colors.series[2], label: t('dashboard.chart.context.meals') },
        insulin: { color: colors.series[3], label: t('dashboard.chart.context.injections') },
    };

    const presentKinds = Object.keys(markerStyles).filter(
        (kind) => markers.some((marker) => marker.kind === kind),
    );

    renderLegend(legendElementFor(canvas, legendId), legendItems([
        ...described,
        ...presentKinds.map((kind) => ({
            label: markerStyles[kind].label,
            color: markerStyles[kind].color,
            pointStyle: MARKER_SHAPES[kind],
            /** Events, not a continuous series: in the legend they go without a stroke. */
            lineless: true,
        })),
    ]));

    if (series.length === 0) {
        return null;
    }

    const timeFormat = chartTimeFormat();

    const datasets = [
        ...described.map((entry, index) => ({
            label: entry.label,
            data: series[index].points,
            borderColor: entry.color,
            backgroundColor: entry.color,
            pointBackgroundColor: entry.color,
            pointBorderColor: colors.surface,
            pointBorderWidth: 1,
            /**
             * Small point: a sensor series brings hundreds of readings and with the radius of the
             * median charts the line would turn into a chain of beads. What is read here is the
             * path, not each point; the detail is in the tooltip.
             */
            pointRadius: 2.5,
            pointHoverRadius: 5,
            borderWidth: 2,
            borderDash: [...entry.borderDash],
            pointStyle: entry.pointStyle,
            tension: 0.25,
            /** `spanGaps` false (out of the box): the gaps `splitOnGaps` opened are gaps. */
        })),
        ...presentKinds.map((kind) => markerDataset(
            kind,
            markers.filter((marker) => marker.kind === kind),
            markerStyles[kind],
        )),
    ];

    return new Chart(canvas, {
        type: 'line',
        data: { datasets },
        options: {
            maintainAspectRatio: false,
            color: colors.tick,
            /** Interaction by proximity: the markers are small and are tapped with a finger. */
            interaction: { mode: 'nearest', intersect: false },
            scales: {
                x: timeAxisScale({
                    colors,
                    format: timeFormat,
                    /** The markers count too: a meal with no reading beside it still has to fit. */
                    bounds: timeAxisBounds([
                        ...series.flatMap((entry) => entry.points.map((point) => point.x)),
                        ...markers.map((marker) => marker.x),
                    ]),
                }),
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
                /**
                 * The marker lane. `display: false` and a fixed range: it is not a quantity, it is
                 * a position, and showing an axis from 0 to 1 next to the glucose would invite reading it.
                 *
                 * `axis: 'y'` is not decoration. Chart.js only guesses whether a scale is horizontal
                 * or vertical from its id (`x`, `y`, `r`) or from `position`; with an id of our own
                 * like `marks` it can guess neither and it throws
                 * `Cannot determine type of 'marks' axis`. Declaring the axis and not a `position`
                 * keeps the lane exactly where it is today: the scale stays hidden, takes up no edge
                 * of the canvas and does not shift the glucose curve.
                 */
                marks: { type: 'linear', axis: 'y', display: false, min: 0, max: 1 },
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        title: timeAxisTooltipTitle(timeFormat),
                        label: (item) => {
                            const marker = item.dataset.markers?.[item.dataIndex];

                            if (marker !== undefined) {
                                return markerTooltipLines(marker);
                            }

                            return t('dashboard.chart.context.reading', {
                                label: item.dataset.label,
                                value: formatNumber(item.parsed.y),
                                unit,
                            });
                        },
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
        plugins: [doseLabelPlugin(colors)],
    });
}
