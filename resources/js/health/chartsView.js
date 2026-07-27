/**
 * The charts of the period: what is drawn, under which name and in which block.
 *
 * There are three families, and all three are painted at once in the three screens that consume
 * this module —the patient panel, the professional's reader and the share preview—:
 *
 * 1. **The glucose curve with the meal and insulin markers** ({@see GLUCOSE_CONTEXT_TYPE}), which
 *    is the one that shows the relation between eating, injecting and what the glucose does after.
 * 2. **The overlay of days over 24 hours** ({@see DAY_OVERLAY_TYPE}), the ambulatory glucose
 *    profile, which shows the pattern that repeats every day.
 * 3. **One per event type** ({@see CHART_SECTIONS}): median of each day with a band from the
 *    minimum to the maximum of that day.
 *
 * **Why it is a module of its own.** The computation already lived outside (`dailyBands.js`) and so
 * did the drawing (`medianBandChart.js`); what was still tied to the patient panel was the table of
 * what is drawn of each type, how each series is named and how each block is switched on or off.
 * Taking it out is what lets the professional's reader draw the same charts with no session and no
 * Livewire: there is no `$wire` here, no `x-ref`, nothing of the panel; only decrypted events, a
 * few element identifiers and Chart.js.
 *
 * **The blocks are emitted by the template and this module only fills them.** They are looked up by
 * `id`, never by `x-ref`: a `<canvas>` inside an `@island` disappears after any Livewire request
 * —the server re-emits the island and takes down whatever Alpine drew, the expensive lesson of the
 * glucose, blood pressure and insulin screens—, so the block has to be able to stay outside the
 * islands, with `wire:ignore` and a stable `wire:key`. With `id` the module finds its canvas
 * wherever it is (see `resources/views/phr/pages/dashboard.blade.php`).
 */

import { formatNumber, joinList, t } from '../i18n/index.js';
import { buildDailyBands } from './dailyBands.js';
import { buildDayOverlay } from './dayOverlay.js';
import { renderDayOverlayChart } from './dayOverlayChart.js';
import {
    catalogLabel,
    formatMethodLabel,
    INSULIN_TYPE_KEYS,
    TEMPERATURE_SITE_KEYS,
    typeLabel,
} from './eventLabels.js';
import { buildGlucoseContext, MAX_READING_GAP_MS } from './glucoseContext.js';
import { renderGlucoseContextChart } from './glucoseContextChart.js';
import { renderMedianBandChart } from './medianBandChart.js';
import { describeExcludedByUnit } from './statsView.js';
import { dominantUnit } from './statistics.js';

/**
 * Prefix of the block identifiers of each type. Every screen that draws charts uses its own, so two
 * screens mounted at once never fight over the same `<canvas>`.
 */
export const DASHBOARD_CHART_PREFIX = 'dashboard';

/**
 * What is drawn of each type: the field (or fields) with the quantity, the one that says how it was
 * measured and with which keys that group is translated. It is the same table that governs the
 * statistics cards (`MEASUREMENT_SECTIONS` of `statsView.js`), extended with glucose and blood
 * pressure, so the chart and the card of the same type cannot be grouping in different ways.
 *
 * **Meals have no chart**, for the same reason they have no card: there is no quantity to
 * average.
 *
 * Blood pressure asks for two quantities of the same event (systolic and diastolic) and comes out
 * with two series per method. The pulse does not go in: it would share the vertical axis with the
 * pressure and they are two quantities —bpm and mmHg—, so one axis would serve to misread both.
 *
 * @type {Readonly<list<object>>}
 */
export const CHART_SECTIONS = Object.freeze([
    { type: 'glucose', groupBy: 'method' },
    {
        type: 'bloodPressure',
        valueKeys: ['systolic', 'diastolic'],
        groupBy: 'method',
        magnitudeKeys: {
            systolic: 'dashboard.magnitude.systolic',
            diastolic: 'dashboard.magnitude.diastolic',
        },
    },
    { type: 'insulin', valueKeys: ['dose'], groupBy: 'insulinType', groupKeys: INSULIN_TYPE_KEYS },
    { type: 'bodyWeight' },
    { type: 'temperature', groupBy: 'site', groupKeys: TEMPERATURE_SITE_KEYS },
]);

/**
 * The two charts that are **not** of an event type, but of a clinical question.
 *
 * `glucoseContext` crosses three types —glucose, meals and insulin— on the same time axis, which
 * is what is looked at in an appointment and what no per-type screen can show. `dayOverlay`
 * overlays every day of the period on 24 hours: the format of the ambulatory glucose profile,
 * which reveals the pattern that repeats every day and that a chronological series dissolves.
 *
 * Their block identifiers come from {@see chartElementIds} just like those of a type: for the
 * template and for the reader they are one more block.
 */
export const GLUCOSE_CONTEXT_TYPE = 'glucoseContext';
export const DAY_OVERLAY_TYPE = 'dayOverlay';

/**
 * Every chart block a screen emits, in the order they are read: first the two that answer a
 * question, then one per event type.
 *
 * @type {Readonly<list<string>>}
 */
export const CHART_BLOCKS = Object.freeze([
    GLUCOSE_CONTEXT_TYPE,
    DAY_OVERLAY_TYPE,
    ...CHART_SECTIONS.map((section) => section.type),
]);

/** Keys of the texts specific to the two charts that are not of a type. */
const BLOCK_KEYS = Object.freeze({
    [GLUCOSE_CONTEXT_TYPE]: { title: 'dashboard.chart.context.title', aria: 'dashboard.chart.context.ariaLabel' },
    [DAY_OVERLAY_TYPE]: { title: 'dashboard.chart.overlay.title', aria: 'dashboard.chart.overlay.ariaLabel' },
});

/**
 * Heading of the block of a chart.
 *
 * @param {string} type One of {@see CHART_BLOCKS}.
 * @returns {string}
 */
export function chartBlockTitle(type) {
    return BLOCK_KEYS[type] === undefined ? typeLabel(type) : t(BLOCK_KEYS[type].title);
}

/**
 * Accessible name of the canvas: a `<canvas>` is a graphical object with no text and without this
 * it has no name at all (Do's #3).
 *
 * @param {string} type
 * @returns {string}
 */
export function chartBlockAriaLabel(type) {
    return BLOCK_KEYS[type] === undefined
        ? t('dashboard.chart.ariaLabel', { type: typeLabel(type) })
        : t(BLOCK_KEYS[type].aria);
}

/**
 * Group label of a series: the measurement method, the site or the insulin type.
 *
 * A type that does not group (weight, measured one single way) arrives with an empty group and
 * takes the name of the type: the legend is never left with an unnamed entry.
 *
 * @param {object} section One entry of {@see CHART_SECTIONS}.
 * @param {string} group
 * @returns {string}
 */
export function chartGroupLabel(section, group) {
    if (group === '') {
        return typeLabel(section.type);
    }

    if (section.groupKeys !== undefined) {
        return catalogLabel(section.groupKeys, group);
    }

    /** Glucose and blood pressure: their tokens are the ADR 0008 ones, which `formatMethodLabel` already translates. */
    return formatMethodLabel(group);
}

/**
 * Full label of a series. With a single quantity it is the group one; with several it also carries
 * which one it is, because a plain "Left arm, sitting" does not say whether the line is the
 * systolic or the diastolic, and those two cannot be confused.
 *
 * @param {object} section
 * @param {{group: string, valueKey: string}} series
 * @returns {string}
 */
export function chartSeriesLabel(section, series) {
    const groupLabel = chartGroupLabel(section, series.group);
    const magnitudeKey = section.magnitudeKeys?.[series.valueKey];

    if (magnitudeKey === undefined) {
        return groupLabel;
    }

    return t('dashboard.chart.seriesMagnitude', { group: groupLabel, magnitude: t(magnitudeKey) });
}

/**
 * Chart caption: which series it includes, in which unit, and what was left out.
 *
 * It is not decoration: the canvas is a graphical object with no text and this paragraph is its
 * `aria-describedby` (Do's #3), the only way the band and its exclusions reach whoever does not see the chart.
 *
 * @param {object} params
 * @param {list<string>} params.seriesLabels
 * @param {string} params.unit
 * @param {number} params.excludedByUnit
 * @param {number} params.omittedDays
 * @returns {string}
 */
export function chartCaptionText({ seriesLabels, unit, excludedByUnit, omittedDays }) {
    if (seriesLabels.length === 0) {
        return t('dashboard.chart.empty');
    }

    const parts = [t('dashboard.chart.caption', { unit, series: joinList(seriesLabels) })];

    if (omittedDays > 0) {
        parts.push(t('dashboard.chart.omittedDays', { count: omittedDays }));
    }

    const excludedText = describeExcludedByUnit(excludedByUnit, unit);

    if (excludedText !== null) {
        parts.push(excludedText);
    }

    return parts.join(' ');
}

/**
 * Unit a type is drawn in.
 *
 * Glucose takes the display one from the profile (ADR 0007, the same as the cards); the others,
 * the one of the most recent record ({@see dominantUnit}), because there is no setting to choose.
 * `null` means there is no reading of that type with a unit, and then there is nothing to draw.
 *
 * @param {object} section
 * @param {list<object>} events
 * @param {string} glucoseUnit Glucose display unit.
 * @returns {string|null}
 */
export function chartUnit(section, events, glucoseUnit) {
    if (section.type === 'glucose') {
        return glucoseUnit;
    }

    return dominantUnit(events, section.type, (section.valueKeys ?? ['value'])[0]);
}

/**
 * Identifiers of the chart block of a type, exactly as the template writes them.
 *
 * @param {string} type
 * @param {string} [prefix]
 * @returns {{block: string, canvas: string, caption: string, legend: string}}
 */
export function chartElementIds(type, prefix = DASHBOARD_CHART_PREFIX) {
    const base = `${prefix}-chart-${type}`;

    return { block: base, canvas: `${base}-canvas`, caption: `${base}-caption`, legend: `${base}-legend` };
}

/**
 * @param {string} id
 * @returns {HTMLElement|null} `null` also when there is no real document (the `tests/js` tests
 *          mount a minimal DOM and do not bring the chart blocks).
 */
function elementById(id) {
    if (typeof document?.getElementById !== 'function') {
        return null;
    }

    return document.getElementById(id);
}

/**
 * Destroys the chart of a type, if there was one. Repainting without destroying would leave the
 * previous instance tied to the same canvas, with both responding to the mouse.
 *
 * @param {Record<string, object>} charts Live instances, indexed by type. It is modified.
 * @param {string} type
 */
export function destroyChart(charts, type) {
    if (charts[type] !== undefined && charts[type] !== null) {
        charts[type].destroy();
    }

    delete charts[type];
}

/**
 * Hides and destroys every chart: with no data to draw none is left standing (that is what happens
 * when the session locks, because they draw values in the clear).
 *
 * @param {Record<string, object>} charts
 * @param {string} [prefix]
 */
export function destroyCharts(charts, prefix = DASHBOARD_CHART_PREFIX) {
    for (const type of CHART_BLOCKS) {
        destroyChart(charts, type);
        elementById(chartElementIds(type, prefix).block)?.classList.add('hidden');
    }
}

/**
 * Common plumbing of a chart block: find it, destroy the previous one, decide whether there is
 * anything to draw, write the caption and draw.
 *
 * The block is revealed **before** building the chart: Chart.js measures the container width when
 * it is created and inside a hidden element that width is zero, so the canvas would come out one
 * pixel wide and would not recover when shown.
 *
 * @param {object} params
 * @param {string} params.type
 * @param {string} params.prefix
 * @param {Record<string, object>} params.charts Se modifica.
 * @param {() => {caption: string, draw: (canvas: HTMLCanvasElement, ids: object) => object|null}|null} params.plan
 *        Returns `null` when there is nothing to draw and the block has to stay hidden: a canvas
 *        with empty axes looks like a bug, not an empty state.
 */
function paintChartBlock({ type, prefix, charts, plan }) {
    const ids = chartElementIds(type, prefix);
    const block = elementById(ids.block);

    destroyChart(charts, type);

    if (block === null) {
        return;
    }

    const canvas = elementById(ids.canvas);
    const drawing = canvas === null ? null : plan();

    if (drawing === null) {
        block.classList.add('hidden');

        return;
    }

    block.classList.remove('hidden');

    const caption = elementById(ids.caption);

    if (caption !== null) {
        caption.textContent = drawing.caption;
    }

    charts[type] = drawing.draw(canvas, ids);
}

/**
 * Caption of the glucose curve with markers: which series it carries, what was grouped and what was left out.
 *
 * Everything that is not seen is stated with a number. A marker grouped in silence is a meal the
 * eye takes as not having happened, and a reading clipped without warning reads as "there was nothing before".
 *
 * @param {object} params
 * @returns {string}
 */
export function contextCaptionText({
    seriesLabels,
    unit,
    excludedByUnit,
    groupedMarkers,
    omittedReadings,
    omittedMarkers,
}) {
    const parts = [t('dashboard.chart.context.caption', {
        unit,
        series: joinList(seriesLabels),
        hours: formatNumber(MAX_READING_GAP_MS / 3_600_000),
    })];

    if (groupedMarkers > 0) {
        parts.push(t('dashboard.chart.context.grouped', { count: groupedMarkers }));
    }

    if (omittedReadings > 0) {
        parts.push(t('dashboard.chart.context.omittedReadings', { count: omittedReadings }));
    }

    if (omittedMarkers > 0) {
        parts.push(t('dashboard.chart.context.omittedMarkers', { count: omittedMarkers }));
    }

    const excludedText = describeExcludedByUnit(excludedByUnit, unit);

    if (excludedText !== null) {
        parts.push(excludedText);
    }

    return parts.join(' ');
}

/**
 * Caption of the 24-hour overlay: which series it carries, how many days are overlaid, what
 * background band there is and what was left out.
 *
 * @param {object} params
 * @returns {string}
 */
export function overlayCaptionText({ seriesLabels, unit, dayCount, omittedDays, excludedByUnit, targetRange }) {
    const parts = [
        t('dashboard.chart.overlay.caption', { unit, series: joinList(seriesLabels) }),
        t('dashboard.chart.overlay.days', { count: dayCount }),
    ];

    if (targetRange !== undefined && targetRange !== null) {
        parts.push(t('dashboard.chart.overlay.targetRange', {
            low: formatNumber(targetRange.low),
            high: formatNumber(targetRange.high),
            unit: targetRange.unit,
        }));
    }

    if (omittedDays > 0) {
        parts.push(t('dashboard.chart.omittedDays', { count: omittedDays }));
    }

    const excludedText = describeExcludedByUnit(excludedByUnit, unit);

    if (excludedText !== null) {
        parts.push(excludedText);
    }

    return parts.join(' ');
}

/**
 * Draws one chart for each included type that has anything to draw.
 *
 * An excluded type, or one with no readings in the period, stays hidden: a canvas with empty axes
 * looks like a bug, and what does have to be said —that there are no records of that type in the
 * period— is already said by its statistics card, in text.
 *
 * @param {list<object>} events Events of the period, already decrypted and filtered by type.
 * @param {object} params
 * @param {string} params.glucoseUnit Glucose display unit (ADR 0007).
 * @param {Record<string, object>} params.charts Live instances indexed by type. It is modified.
 * @param {(type: string) => boolean} [params.includesType] Which types are ticked.
 * @param {string} [params.prefix]
 * @param {{low: number, high: number, unit: string}} [params.targetRange] Glucose target range,
 *        already resolved and already checked to be in the same unit (ADR 0007: nothing is
 *        converted). Without it, the 24-hour overlay is drawn with no background band, which is
 *        right: a band with numbers of another unit would be a false reference.
 */
export function renderCharts(events, {
    glucoseUnit,
    charts,
    includesType = () => true,
    prefix = DASHBOARD_CHART_PREFIX,
    targetRange,
}) {
    renderGlucoseContextBlock(events, { glucoseUnit, charts, includesType, prefix });
    renderDayOverlayBlock(events, { glucoseUnit, charts, includesType, prefix, targetRange });

    for (const section of CHART_SECTIONS) {
        const ids = chartElementIds(section.type, prefix);
        const block = elementById(ids.block);

        destroyChart(charts, section.type);

        if (block === null) {
            continue;
        }

        const unit = includesType(section.type) ? chartUnit(section, events, glucoseUnit) : null;

        const bands = unit === null
            ? { days: [], series: [], excludedByUnit: 0, omittedDays: 0 }
            : buildDailyBands(events, {
                type: section.type,
                valueKeys: section.valueKeys,
                groupBy: section.groupBy,
                unit,
            });

        const canvas = elementById(ids.canvas);

        if (bands.series.length === 0 || canvas === null) {
            block.classList.add('hidden');

            continue;
        }

        /**
         * The block is revealed **before** building the chart: Chart.js measures the container
         * width when it is created, and inside a hidden element that width is zero, so the canvas
         * would come out one pixel wide and would not recover when shown.
         */
        block.classList.remove('hidden');

        const seriesLabels = bands.series.map((series) => chartSeriesLabel(section, series));
        const caption = elementById(ids.caption);

        if (caption !== null) {
            caption.textContent = chartCaptionText({
                seriesLabels,
                unit,
                excludedByUnit: bands.excludedByUnit,
                omittedDays: bands.omittedDays,
            });
        }

        charts[section.type] = renderMedianBandChart(canvas, {
            days: bands.days,
            series: bands.series.map((series, index) => ({
                label: seriesLabels[index],
                points: series.points,
            })),
            unit,
            legendId: ids.legend,
        });
    }
}

/**
 * The glucose curve with the meal and insulin markers on top.
 *
 * **It depends only on glucose being ticked**, not on meals or insulin: the chart is the glucose,
 * and the markers are the context that explains it. If the filter leaves meals out, the meal events
 * no longer arrive here —the caller filters first— and the curve is drawn without them, which is
 * exactly what was asked for.
 *
 * @param {list<object>} events
 * @param {object} params
 */
function renderGlucoseContextBlock(events, { glucoseUnit, charts, includesType, prefix }) {
    paintChartBlock({
        type: GLUCOSE_CONTEXT_TYPE,
        prefix,
        charts,
        plan: () => {
            if (!includesType('glucose')) {
                return null;
            }

            const context = buildGlucoseContext(events, { unit: glucoseUnit });

            if (context.series.length === 0) {
                return null;
            }

            const seriesLabels = context.series.map(
                (series) => (series.group === '' ? typeLabel('glucose') : formatMethodLabel(series.group)),
            );

            return {
                caption: contextCaptionText({ seriesLabels, unit: glucoseUnit, ...context }),
                draw: (canvas, ids) => renderGlucoseContextChart(canvas, {
                    series: context.series.map((series, index) => ({
                        label: seriesLabels[index],
                        points: series.points,
                    })),
                    markers: context.markers,
                    unit: glucoseUnit,
                    legendId: ids.legend,
                }),
            };
        },
    });
}

/**
 * The overlay of every day of the period on a 24-hour axis.
 *
 * @param {list<object>} events
 * @param {object} params
 */
function renderDayOverlayBlock(events, { glucoseUnit, charts, includesType, prefix, targetRange }) {
    paintChartBlock({
        type: DAY_OVERLAY_TYPE,
        prefix,
        charts,
        plan: () => {
            if (!includesType('glucose')) {
                return null;
            }

            const overlay = buildDayOverlay(events, { unit: glucoseUnit });

            if (overlay.groups.length === 0) {
                return null;
            }

            const groups = overlay.groups.map((group) => ({
                ...group,
                label: group.group === '' ? typeLabel('glucose') : formatMethodLabel(group.group),
            }));

            return {
                caption: overlayCaptionText({
                    seriesLabels: groups.map((group) => group.label),
                    unit: glucoseUnit,
                    dayCount: overlay.dayCount,
                    omittedDays: overlay.omittedDays,
                    excludedByUnit: overlay.excludedByUnit,
                    targetRange,
                }),
                draw: (canvas, ids) => renderDayOverlayChart(canvas, {
                    groups,
                    unit: glucoseUnit,
                    legendId: ids.legend,
                    targetRange,
                }),
            };
        },
    });
}
