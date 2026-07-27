/**
 * Statistics cards of a period, out of already decrypted events (ADR 0007, ADR 0008).
 *
 * **All the computing is done by `health/statistics.js`** (`summarizeGlucosePeriod`,
 * `summarizeBloodPressurePeriod`, `summarizeMeasurementPeriod`): this module reimplements no mean
 * and no median, it only shapes the result to paint it.
 *
 * **Why it is a module of its own.** It used to live inside `dashboardPage.js`, that is, inside
 * the patient panel. Now it takes an array of decrypted events and returns nodes, with no
 * Livewire, no `$wire` and without reading the document, so that the professional opening a shared
 * clipping sees the same figures computed the same way. Patient and doctor seeing two different
 * means of the same period is exactly the failure this separation prevents.
 *
 * **The measurement method is never mixed in silence** (ADR 0008): each card is of one single
 * method, with its label always visible.
 */

import { formatDateTime, t } from '../i18n/index.js';
import {
    catalogLabel,
    formatMethodLabel,
    formatNumber,
    INSULIN_TYPE_KEYS,
    TEMPERATURE_SITE_KEYS,
    typeLabel,
} from './eventLabels.js';
import { buildDailyBands } from './dailyBands.js';
import { createCallout, createSegmentedBar, createStatTile, renderEmptyState } from './eventVisuals.js';
import { selectedTypeTokens } from './eventTypes.js';
import {
    dominantUnit,
    summarizeBloodPressurePeriod,
    summarizeGlucosePeriod,
    summarizeMeasurementPeriod,
} from './statistics.js';

/**
 * Resolves the glucose target range from the encrypted user settings (ADR 0007).
 *
 * The setting **brings no default value**: if the settings do not exist, or do not bring
 * `glucoseTargetRange`, or bring it with `low`/`high` that are not finite and ordered numbers,
 * this function returns `undefined` and `summarizeGlucosePeriod` will not compute `inRangePercent`
 * at all (neither `null` nor `0`: the key is not there).
 *
 * **The range carries its own unit and it has to be compared with the display one** (ADR 0007:
 * nothing is converted between mg/dL and mmol/L). A range of 3.9-10 mmol/L with readings in mg/dL
 * is a reachable state: comparing one set of numbers against the other would publish a "time in
 * range: 0%" that looks like a clinical datum and is not.
 *
 * @param {object|null} userSettings What `settings()` returns.
 * @param {string} unit Display unit in force.
 * @returns {{low: number, high: number, unit: string}|undefined}
 */
export function resolveGlucoseTargetRange(userSettings, unit) {
    const raw = userSettings?.glucoseTargetRange;

    if (raw === undefined || raw === null) {
        return undefined;
    }

    const low = Number(raw.low);
    const high = Number(raw.high);

    if (!Number.isFinite(low) || !Number.isFinite(high) || low > high) {
        return undefined;
    }

    if (raw.unit !== unit) {
        return undefined;
    }

    return { low, high, unit: raw.unit };
}

/**
 * Is there a saved target range that cannot be applied because it is in another unit?
 *
 * It tells "there is no range" from "there is a range and it does not serve here": the first is
 * solved by configuring it, the second by changing one of the two units, and offering the wrong
 * message sends the person to the wrong place.
 *
 * @param {object|null} userSettings
 * @param {string} unit Display unit in force.
 * @returns {boolean}
 */
export function targetRangeUnitMismatch(userSettings, unit) {
    const raw = userSettings?.glucoseTargetRange;

    if (raw === undefined || raw === null) {
        return false;
    }

    return Number.isFinite(Number(raw.low)) && Number.isFinite(Number(raw.high)) && raw.unit !== unit;
}

/**
 * Does the period summary have any group with data?
 *
 * It serves glucose and blood pressure (`byMethod`, ADR 0008) as well as weight, temperature and
 * insulin (`byGroup`), because the question is the same: anything to paint, or the empty state?
 *
 * @param {{byMethod?: Record<string, object>, byGroup?: Record<string, object>}} periodSummary
 * @returns {boolean}
 */
export function hasPeriodData(periodSummary) {
    return Object.keys(periodSummary?.byMethod ?? periodSummary?.byGroup ?? {}).length > 0;
}

/**
 * Is there any glucose recorded in the period, even if all of it is in another display unit?
 *
 * `hasPeriodData` looks only at what entered the computation, so it is false for somebody with
 * thirty readings in mg/dL displaying in mmol/L. To decide whether that person is already a
 * glucose user (and so whether talking about the target range makes sense, ADR 0007) the excluded ones count too.
 *
 * @param {{byMethod: object, excludedByUnit: number}} glucoseSummary
 * @returns {boolean}
 */
export function hasAnyGlucoseSignal(glucoseSummary) {
    return hasPeriodData(glucoseSummary) || glucoseSummary.excludedByUnit > 0;
}

/**
 * Entries of `byMethod` (or of `byGroup`: it is the same shape) in a stable order —alphabetical by
 * token—, so the view does not reorder the cards between one load and the next.
 *
 * @param {Record<string, object>} byMethod
 * @returns {list<[string, object]>}
 */
export function sortedMethodEntries(byMethod) {
    return Object.entries(byMethod).sort(([a], [b]) => a.localeCompare(b));
}

/**
 * Sentence about the events left out for being in another display unit (ADR 0007: nothing is
 * converted between units), or `null` if there were none.
 *
 * @param {number} excludedByUnit
 * @param {string} unit Current display unit.
 * @returns {string|null}
 */
export function describeExcludedByUnit(excludedByUnit, unit) {
    if (excludedByUnit <= 0) {
        return null;
    }

    return t('dashboard.excludedByUnit', { count: excludedByUnit, unit });
}

/**
 * Footnote with the records left out for being in another unit, or `null`.
 *
 * It lives apart because it goes with a window with data as well as with the empty state: it is
 * the notice that keeps somebody with thirty glucose readings in mg/dL who switched their unit to
 * mmol/L from reading "no records yet" and believing they have lost their data.
 *
 * @param {number} excludedByUnit
 * @param {string} unit
 * @returns {HTMLParagraphElement|null}
 */
function createExcludedNote(excludedByUnit, unit) {
    const excludedText = describeExcludedByUnit(excludedByUnit, unit);

    if (excludedText === null) {
        return null;
    }

    const note = document.createElement('p');
    note.className = 'text-caption text-ink-secondary';
    note.textContent = excludedText;

    return note;
}

/**
 * Separator of the composite group + quantity key, the same null character and for the same reason
 * as in `dailyBands.js`: catalog tokens can carry dashes and spaces, and a key that could be split
 * wrongly would mix two different clinical series.
 */
const TREND_KEY_SEPARATOR = '\u0000';

/**
 * @param {string} group Measurement method, site, insulin type... or `''` if the type does not group.
 * @param {string} valueKey Quantity inside the envelope (`value`, `systolic`, `dose`, ...).
 * @returns {string}
 */
function trendKey(group, valueKey) {
    return `${group}${TREND_KEY_SEPARATOR}${valueKey}`;
}

/**
 * Daily series for the sparklines of the tiles, one per group and quantity.
 *
 * **It leans on `buildDailyBands` instead of recomputing anything**, and that is the point: the
 * sparkline of a card and the big chart next to it have to be drawing the same day with the same
 * number. From there come the three rules that are not negotiable, already resolved: one series
 * per measurement method (ADR 0008), the day in the time zone of the **event itself** and not of
 * the browser looking, and days with no readings as `null` —a gap— and never as a zero.
 *
 * From each day the **median** is taken, the same figure the chart draws as the central line: the
 * mean of a day with one hypoglycaemia and five normal readings tells another story.
 *
 * @param {list<object>} events Events of the period, already decrypted.
 * @param {{type: string, valueKeys?: list<string>, groupBy?: string, unit?: string}} params
 * @returns {Map<string, list<number|null>>} Key of {@see trendKey}.
 */
export function dailyTrends(events, { type, valueKeys = ['value'], groupBy, unit } = {}) {
    const { series } = buildDailyBands(events, { type, valueKeys, groupBy, unit });
    /** @type {Map<string, list<number|null>>} */
    const trends = new Map();

    for (const entry of series) {
        trends.set(
            trendKey(entry.group, entry.valueKey),
            entry.points.map((point) => (point === null ? null : point.median)),
        );
    }

    return trends;
}

/**
 * Segmented bar of time in range: below, inside and above the target range.
 *
 * **The only datum on this screen that can be read as good or improvable without interpreting**:
 * the range was chosen by the person themselves in their profile (ADR 0007), so the application
 * does not set the threshold. A number alone —"68%"— does not say which way the remaining 32% goes,
 * and below and above are opposite clinical situations.
 *
 * **The two outside bands share a tone on purpose.** The system reserves red for errors and
 * destructive actions (DESIGN.md, Don'ts #4), and this is a personal summary, not a diagnosis:
 * painting somebody's glucose red is a message this application is in no position to give.
 * Inventing a fifth colour to tell them apart would be inventing a role the system does not have,
 * so what tells them apart is their place in the bar —bottom left, top right— and their written
 * label in the legend, which is what is really read.
 *
 * **The inside band always goes in the success tone**, with no threshold changing it. This used to
 * be a lone figure and the clinical reference of 70% decided whether it came out green or amber;
 * with the bar that threshold is unnecessary and would get in the way: somebody at 68% would get
 * all three bands in the same amber and the bar would stop being segmented exactly when it is most
 * needed. Those readings were inside the range, which is a fact and not a grade.
 *
 * @param {{inRangePercent: number, belowRangePercent: number, aboveRangePercent: number}} methodSummary
 * @returns {HTMLElement}
 */
function renderTimeInRangeBar(methodSummary) {
    const section = document.createElement('div');
    section.className = 'mt-3 rounded-card border border-border bg-background px-4 py-3';

    const caption = document.createElement('p');
    caption.className = 'text-caption text-ink-secondary';
    caption.textContent = t('dashboard.stat.timeInRange');
    section.appendChild(caption);

    const asPercent = (percent) => `${formatNumber(percent)} %`;

    const bar = createSegmentedBar([
        {
            label: t('dashboard.stat.belowRange'),
            percent: methodSummary.belowRangePercent,
            value: asPercent(methodSummary.belowRangePercent),
            tone: 'warning',
        },
        {
            label: t('dashboard.stat.inRange'),
            percent: methodSummary.inRangePercent,
            value: asPercent(methodSummary.inRangePercent),
            tone: 'good',
        },
        {
            label: t('dashboard.stat.aboveRange'),
            percent: methodSummary.aboveRangePercent,
            value: asPercent(methodSummary.aboveRangePercent),
            tone: 'warning',
        },
    ]);
    bar.classList.add('mt-2');
    section.appendChild(bar);

    return section;
}

/**
 * Empty state of a section.
 *
 * The sentence does not name the type because the card heading already says it. What it does say
 * is "in this period", which is the information that keeps a gap from being read as "it was lost".
 *
 * `urlForType` arrives as an argument and gives no route by default: the patient panel passes the
 * Filament one for the "record the first one" button, and the professional's reader has none.
 *
 * `emptyText` also arrives from outside, and for the same reason: the default sentence ("no
 * records in this period yet") is written in the patient's voice and asserts a clinical absence.
 * In the reader neither of the two holds —whoever looks has no account, and what they see is a
 * closed clipping, not their history—, so the calling screen says the sentence that fits.
 *
 * @param {string} type
 * @param {(type: string) => string|null} urlForType
 * @param {string} [emptyText]
 * @returns {HTMLElement}
 */
function renderTypeEmptyState(type, urlForType, emptyText) {
    return renderEmptyState(emptyText ?? t('dashboard.empty'), urlForType(type), t('dashboard.addFirst'));
}

/**
 * @param {string} method
 * @param {object} methodSummary One entry of `byMethod` of `summarizeGlucosePeriod`.
 * @param {string} unit
 * @param {list<number|null>} [trend] Daily series of this method for the sparkline of the median
 *        ({@see dailyTrends}).
 * @returns {HTMLDivElement}
 */
function renderGlucoseMethodCard(method, methodSummary, unit, trend) {
    const card = document.createElement('div');
    card.className = 'rounded-card border border-border bg-surface p-pad-md';

    const heading = document.createElement('p');
    heading.className = 'text-body-sm font-semibold text-ink';
    heading.textContent = formatMethodLabel(method);
    card.appendChild(heading);

    const grid = document.createElement('div');
    grid.className = 'mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3';

    grid.appendChild(createStatTile({ label: t('dashboard.stat.count'), value: String(methodSummary.count) }));
    grid.appendChild(createStatTile({ label: t('dashboard.stat.mean'), value: formatNumber(methodSummary.mean), unit }));
    /**
     * The sparkline goes with the **median** and not with the mean: it is the figure the big chart
     * draws as a line, so the card and the chart tell the same story. Hanging it off the six tiles
     * would repeat the same stroke six times.
     */
    grid.appendChild(createStatTile({
        label: t('dashboard.stat.median'),
        value: formatNumber(methodSummary.median),
        unit,
        trend,
    }));
    grid.appendChild(createStatTile({ label: t('dashboard.stat.min'), value: formatNumber(methodSummary.min), unit }));
    grid.appendChild(createStatTile({ label: t('dashboard.stat.max'), value: formatNumber(methodSummary.max), unit }));
    grid.appendChild(createStatTile({
        label: t('dashboard.stat.lastReading'),
        value: formatNumber(methodSummary.last.value),
        unit: `${unit} · ${formatDateTime(methodSummary.last.occurredAt)}`,
    }));

    card.appendChild(grid);

    /**
     * Time in range is not one more tile: it is a split, and as a segmented bar it reads without
     * any arithmetic ({@see renderTimeInRangeBar}). With no target range configured there is no bar
     * —the `inRangePercent` key does not exist, ADR 0007— and what takes its place is the
     * invitation to configure it that the section paints.
     */
    if (methodSummary.inRangePercent !== undefined) {
        card.appendChild(renderTimeInRangeBar(methodSummary));
    }

    return card;
}

/**
 * Full glucose section of the period: the target range notice (missing, or in another unit) and one
 * subcard per measurement method (ADR 0008).
 *
 * @param {{byMethod: object, excludedByUnit: number}} glucoseSummary Summary of the period.
 * @param {string} unit
 * @param {{low: number, high: number, unit: string}|undefined} targetRange
 * @param {boolean} unitMismatch There is a saved range, but in another unit (see
 *        {@see targetRangeUnitMismatch}).
 * @param {{
 *   urlForType?: (type: string) => string|null,
 *   inviteTargetRange?: boolean,
 *   trends?: Map<string, list<number|null>>,
 * }} [options] `trends` arrives from outside because this function receives the already computed
 *        summary and not the events, and daily series can only be built with the events ({@see dailyTrends}).
 * @returns {DocumentFragment}
 */
export function renderGlucoseSection(glucoseSummary, unit, targetRange, unitMismatch = false, options = {}) {
    const urlForType = options.urlForType ?? (() => null);
    const emptyText = options.emptyText;
    const fragment = document.createDocumentFragment();

    /**
     * There is a range, but in the other unit: nothing is converted (ADR 0007), so there is no
     * percentage. It is said, instead of leaving the gap mute or asking to configure what is already configured.
     */
    if (unitMismatch) {
        const warning = createCallout('warning', t('dashboard.targetRangeUnitMismatch', { unit }));
        warning.classList.add('mb-4');
        fragment.appendChild(warning);
    }

    /**
     * The invitation is only shown to somebody who already has a glucose reading recorded: a new
     * user would be asked to configure a range with nothing yet to apply it to. The records
     * excluded by unit count as data: they are their glucose readings, only in another unit.
     *
     * And only to somebody who can configure it. In the reader of a shared clipping (ADR 0011)
     * whoever looks has no account here and there is no setting they could touch: the invitation
     * would be an impossible task, and it would also suggest the patient's configuration is missing
     * when what happens is that their target range is theirs and does not travel in the clipping.
     */
    if (options.inviteTargetRange !== false
        && targetRange === undefined && !unitMismatch && hasAnyGlucoseSignal(glucoseSummary)) {
        const invite = createCallout('info', t('dashboard.targetRangeInvite'));
        invite.classList.add('mb-4');
        fragment.appendChild(invite);
    }

    /**
     * With no method with data, one single empty state across the card. The notice of the ones
     * excluded by unit is not lost: it is painted below, which is exactly when it is most needed.
     */
    if (!hasPeriodData(glucoseSummary)) {
        fragment.appendChild(renderTypeEmptyState('glucose', urlForType, emptyText));

        const note = createExcludedNote(glucoseSummary.excludedByUnit, unit);

        if (note !== null) {
            note.classList.add('mt-3', 'text-center');
            fragment.appendChild(note);
        }

        return fragment;
    }

    const methods = document.createElement('div');
    methods.className = 'space-y-3';

    for (const [method, methodSummary] of sortedMethodEntries(glucoseSummary.byMethod)) {
        methods.appendChild(
            renderGlucoseMethodCard(method, methodSummary, unit, options.trends?.get(trendKey(method, 'value'))),
        );
    }

    const note = createExcludedNote(glucoseSummary.excludedByUnit, unit);

    if (note !== null) {
        methods.appendChild(note);
    }

    fragment.appendChild(methods);

    return fragment;
}

/**
 * @param {string} method
 * @param {object} methodSummary One entry of `byMethod` of `summarizeBloodPressurePeriod`.
 * @param {Map<string, list<number|null>>} [trends] Daily series of the period ({@see dailyTrends}).
 * @returns {HTMLDivElement}
 */
function renderBloodPressureMethodCard(method, methodSummary, trends) {
    const card = document.createElement('div');
    card.className = 'rounded-card border border-border bg-surface p-pad-md';

    const heading = document.createElement('p');
    heading.className = 'text-body-sm font-semibold text-ink';
    heading.textContent = formatMethodLabel(method);
    card.appendChild(heading);

    /** `mmHg` is the UCUM code and is not translated; `lpm`/`bpm`/`次/分` is, because it is an abbreviation. */
    const pulseUnit = t('dashboard.unit.bpm');

    const lastReadingLine = document.createElement('p');
    lastReadingLine.className = 'mt-2 font-mono text-body-lg font-semibold text-ink';
    lastReadingLine.textContent = `${methodSummary.lastReading.systolic}/${methodSummary.lastReading.diastolic}`;

    const lastReadingUnit = document.createElement('span');
    lastReadingUnit.className = 'ml-1 text-body-sm font-normal text-ink-secondary';
    lastReadingUnit.textContent = `mmHg · ${methodSummary.lastReading.pulse} ${pulseUnit} · `
        + `${formatDateTime(methodSummary.lastReading.occurredAt)}`;
    lastReadingLine.appendChild(lastReadingUnit);
    card.appendChild(lastReadingLine);

    const lastCaption = document.createElement('p');
    lastCaption.className = 'text-caption text-ink-secondary';
    lastCaption.textContent = t('dashboard.bp.lastReadingCaption');
    card.insertBefore(lastCaption, lastReadingLine);

    const grid = document.createElement('div');
    grid.className = 'mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3';

    grid.appendChild(createStatTile({ label: t('dashboard.stat.count'), value: String(methodSummary.count) }));

    for (const [key, magnitudeKey, unit] of [
        ['systolic', 'dashboard.magnitude.systolic', 'mmHg'],
        ['diastolic', 'dashboard.magnitude.diastolic', 'mmHg'],
        ['pulse', 'dashboard.magnitude.pulse', pulseUnit],
    ]) {
        const magnitude = methodSummary[key];
        const label = t(magnitudeKey);

        grid.appendChild(createStatTile({
            label: t('dashboard.stat.withMean', { magnitude: label }),
            value: formatNumber(magnitude.mean),
            unit,
        }));
        /** One sparkline per quantity: systolic, diastolic and pulse have different trends. */
        grid.appendChild(createStatTile({
            label: t('dashboard.stat.withMedian', { magnitude: label }),
            value: formatNumber(magnitude.median),
            unit,
            trend: trends?.get(trendKey(method, key)),
        }));
        grid.appendChild(createStatTile({
            label: t('dashboard.stat.withRange', { magnitude: label }),
            value: `${formatNumber(magnitude.min)}–${formatNumber(magnitude.max)}`,
            unit,
        }));
    }

    card.appendChild(grid);

    return card;
}

/**
 * Blood pressure section of the period: one subcard per method (arm and posture, ADR 0008), or the
 * empty state.
 *
 * @param {{byMethod: object}} bloodPressureSummary Summary of the period.
 * @param {{
 *   urlForType?: (type: string) => string|null,
 *   trends?: Map<string, list<number|null>>,
 * }} [options] `trends` arrives from outside for the same reason as in glucose: here there is only
 *        a summary, and daily series are built with the events ({@see dailyTrends}).
 * @returns {DocumentFragment}
 */
export function renderBloodPressureSection(bloodPressureSummary, options = {}) {
    const urlForType = options.urlForType ?? (() => null);
    const emptyText = options.emptyText;
    const fragment = document.createDocumentFragment();

    if (!hasPeriodData(bloodPressureSummary)) {
        fragment.appendChild(renderTypeEmptyState('bloodPressure', urlForType, emptyText));

        return fragment;
    }

    const methods = document.createElement('div');
    methods.className = 'space-y-3';

    for (const [method, methodSummary] of sortedMethodEntries(bloodPressureSummary.byMethod)) {
        methods.appendChild(renderBloodPressureMethodCard(method, methodSummary, options.trends));
    }

    fragment.appendChild(methods);

    return fragment;
}

/**
 * Types with a single numeric quantity summarized with the same generic computation
 * (`summarizeMeasurementPeriod`): which field carries the value, which field groups and with which
 * catalog keys that group is translated.
 *
 * **Meals are not here, and it is no oversight**: a meal has no quantity to average (its datum is
 * what was eaten), so a "meal average" card would be an invented number. They still appear in the
 * timeline and in the type filter, which is where they mean something.
 *
 * @type {Readonly<list<{type: string, valueKey?: string, groupBy?: string, groupKeys?: object}>>}
 */
export const MEASUREMENT_SECTIONS = Object.freeze([
    { type: 'insulin', valueKey: 'dose', groupBy: 'insulinType', groupKeys: INSULIN_TYPE_KEYS },
    /** Weight is measured one single way: no grouping field, one single card with no heading. */
    { type: 'bodyWeight' },
    { type: 'temperature', groupBy: 'site', groupKeys: TEMPERATURE_SITE_KEYS },
]);

/**
 * Card of a group of a simple quantity: the same statistics as glucose minus time in range, which
 * only exists where a target range is configured (ADR 0007).
 *
 * @param {string|null} groupLabel Label of the group, or `null` if the type does not group.
 * @param {object} groupSummary One entry of `byGroup` of `summarizeMeasurementPeriod`.
 * @param {string} unit
 * @param {list<number|null>} [trend] Daily series of the group for the sparkline of the median.
 * @returns {HTMLDivElement}
 */
function renderMeasurementCard(groupLabel, groupSummary, unit, trend) {
    const card = document.createElement('div');
    card.className = 'rounded-card border border-border bg-surface p-pad-md';

    if (groupLabel !== null && groupLabel !== '') {
        const heading = document.createElement('p');
        heading.className = 'text-body-sm font-semibold text-ink';
        heading.textContent = groupLabel;
        card.appendChild(heading);
    }

    const grid = document.createElement('div');
    grid.className = 'mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3';

    grid.appendChild(createStatTile({ label: t('dashboard.stat.count'), value: String(groupSummary.count) }));
    grid.appendChild(createStatTile({ label: t('dashboard.stat.mean'), value: formatNumber(groupSummary.mean), unit }));
    grid.appendChild(createStatTile({
        label: t('dashboard.stat.median'),
        value: formatNumber(groupSummary.median),
        unit,
        trend,
    }));
    grid.appendChild(createStatTile({ label: t('dashboard.stat.min'), value: formatNumber(groupSummary.min), unit }));
    grid.appendChild(createStatTile({ label: t('dashboard.stat.max'), value: formatNumber(groupSummary.max), unit }));
    grid.appendChild(createStatTile({
        label: t('dashboard.stat.lastReading'),
        value: formatNumber(groupSummary.last.value),
        unit: `${unit} · ${formatDateTime(groupSummary.last.occurredAt)}`,
    }));

    card.appendChild(grid);

    return card;
}

/**
 * Section of a simple quantity type (insulin, weight, temperature) for the period.
 *
 * The person chooses the unit in no setting for these three (unlike glucose, ADR 0007), so it is
 * summarized with the one of the most recent record and the others are counted apart
 * ({@see dominantUnit}); the notice of the ones excluded by unit is the same glucose uses.
 *
 * @param {{type: string, valueKey?: string, groupBy?: string, groupKeys?: object}} section
 * @param {list<object>} events Events of the period, already decrypted.
 * @param {{urlForType?: (type: string) => string|null}} [options]
 * @returns {DocumentFragment}
 */
export function renderMeasurementSection(section, events, options = {}) {
    const urlForType = options.urlForType ?? (() => null);
    const emptyText = options.emptyText;
    const fragment = document.createDocumentFragment();
    const valueKey = section.valueKey ?? 'value';
    const unit = dominantUnit(events, section.type, valueKey);

    if (unit === null) {
        fragment.appendChild(renderTypeEmptyState(section.type, urlForType, emptyText));

        return fragment;
    }

    const summary = summarizeMeasurementPeriod(events, {
        type: section.type,
        valueKey,
        groupBy: section.groupBy,
        unit,
    });

    if (!hasPeriodData(summary)) {
        fragment.appendChild(renderTypeEmptyState(section.type, urlForType, emptyText));

        return fragment;
    }

    const groups = document.createElement('div');
    groups.className = 'space-y-3';

    /**
     * Here the series are built at home and do not arrive through `options`: this function receives
     * the events, which was all that was needed. Glucose and blood pressure receive ready-made
     * summaries, and that is why theirs have to be handed to them.
     */
    const trends = dailyTrends(events, {
        type: section.type,
        valueKeys: [valueKey],
        groupBy: section.groupBy,
        unit,
    });

    for (const [group, groupSummary] of sortedMethodEntries(summary.byGroup)) {
        const label = section.groupKeys === undefined ? null : catalogLabel(section.groupKeys, group);

        groups.appendChild(renderMeasurementCard(label, groupSummary, unit, trends.get(trendKey(group, valueKey))));
    }

    const note = createExcludedNote(summary.excludedByUnit, unit);

    if (note !== null) {
        groups.appendChild(note);
    }

    fragment.appendChild(groups);

    return fragment;
}

/**
 * Card of a type: the same surface as the template sections (DESIGN.md § Cards, with theme roles
 * and not ramp shades) and the type name as heading.
 *
 * This module writes the heading and not the template because which cards exist depends on the
 * filter, and a server heading would stay on screen over a card that is no longer there.
 *
 * @param {string} type
 * @param {DocumentFragment} body
 * @returns {HTMLElement}
 */
function createStatsCard(type, body) {
    const card = document.createElement('section');
    card.className = 'rounded-card border border-border bg-surface p-card shadow-sm';

    const heading = document.createElement('h3');
    heading.className = 'font-display text-subhead text-ink';
    heading.textContent = typeLabel(type);
    card.appendChild(heading);

    const content = document.createElement('div');
    content.className = 'mt-4';
    content.appendChild(body);
    card.appendChild(content);

    return card;
}

/**
 * Every statistics section of the period, one card per ticked type.
 *
 * Only what has been ticked is painted: if blood pressure is unticked, its card is not there,
 * instead of staying around saying there is no data. With **no** type ticked it is said, because
 * an empty screen with no explanation reads as "I have no records" and that is not what happened.
 *
 * @param {list<object>} events Events of the period, decrypted and **not** filtered by type: each
 *        section keeps its own.
 * @param {object} params
 * @param {Record<string, boolean>} params.selectedTypes
 * @param {string} params.unit Glucose display unit (ADR 0007).
 * @param {{low: number, high: number, unit: string}|undefined} params.targetRange
 * @param {boolean} params.unitMismatch
 * @param {(type: string) => string|null} [params.urlForType]
 * @param {boolean} [params.inviteTargetRange] `false` in the professional's reader, which has no
 *        setting to configure (see {@see renderGlucoseSection}).
 * @param {string} [params.emptyText] Sentence of the empty state. See {@see renderTypeEmptyState}:
 *        the default one speaks in the patient's voice and asserts a clinical absence, which is not
 *        what happens when what empties the card is somebody else's clipping.
 * @returns {DocumentFragment}
 */
export function renderStatsSections(events, {
    selectedTypes,
    unit,
    targetRange,
    unitMismatch,
    urlForType,
    inviteTargetRange = true,
    emptyText,
}) {
    const options = { urlForType: urlForType ?? (() => null), inviteTargetRange, emptyText };
    const fragment = document.createDocumentFragment();

    if (selectedTypeTokens(selectedTypes).length === 0) {
        fragment.appendChild(createCallout('info', t('dashboard.typeFilter.none')));

        return fragment;
    }

    /** @type {list<[string, DocumentFragment]>} */
    const sections = [];

    if (selectedTypes.glucose === true) {
        const summary = summarizeGlucosePeriod(events, { unit, targetRange });
        /** One series per method (ADR 0008) and only of the display unit (ADR 0007). */
        const trends = dailyTrends(events, { type: 'glucose', groupBy: 'method', unit });

        sections.push([
            'glucose',
            renderGlucoseSection(summary, unit, targetRange, unitMismatch, { ...options, trends }),
        ]);
    }

    if (selectedTypes.bloodPressure === true) {
        /** The three quantities of the envelope go together and come out as three series per method. */
        const trends = dailyTrends(events, {
            type: 'bloodPressure',
            valueKeys: ['systolic', 'diastolic', 'pulse'],
            groupBy: 'method',
        });

        sections.push([
            'bloodPressure',
            renderBloodPressureSection(summarizeBloodPressurePeriod(events), { ...options, trends }),
        ]);
    }

    for (const section of MEASUREMENT_SECTIONS) {
        if (selectedTypes[section.type] === true) {
            sections.push([section.type, renderMeasurementSection(section, events, options)]);
        }
    }

    for (const [type, body] of sections) {
        fragment.appendChild(createStatsCard(type, body));
    }

    return fragment;
}
