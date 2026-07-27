/**
 * The interface of an already decrypted clipping (ADR 0011, ADR 0002, ADR 0004, ADR 0006).
 *
 * **What it is.** The professional who opens a shared link sees the same thing the patient sees in
 * their panel —charts, statistics, timeline, search and sub-period selection— over the events of
 * the clipping. This module is that screen: it takes the package body in the clear and a
 * container, and paints the whole thing. It does not know where the package came from, and that is
 * why it serves both the professional's reader (where the package comes from the PIN) and the
 * preview of the share screen (where the patient sees, before sending anything, exactly what the doctor will see).
 *
 * **The three security invariants this module has to keep**, and which
 * `tests/js/clippingExplorer.test.mjs` checks:
 *
 * 1. **Narrow, never widen.** The sub-period and the search work against
 *    {@see memoryEventSource}, which can only return events from the list it already has in front
 *    of it. There is no `fetch` here, no `$wire`, no URL: there is no way to ask for one more
 *    event, and the chosen range is also clipped against the ends of the clipping
 *    ({@see narrowToClipping}) so that a wider period cannot even be *stated*.
 * 2. **The package lives only in memory.** It is not written to `localStorage`, nor to
 *    `sessionStorage`, nor to IndexedDB, nor to a cookie. Closing the tab wipes it, just like the
 *    patient's master key (ADR 0003). The language preference is not stored either, nor the
 *    sub-period, nor the searched text: on a clinic computer, any of those three is a clinical
 *    trace that outlives whoever left it.
 * 3. **The search never leaves the browser.** It runs entirely over what is decrypted
 *    ({@see searchEvents}); what is typed travels nowhere, and in the reader there is nowhere it
 *    could travel to.
 *
 * **No Livewire and no Alpine**, and not out of taste: everything that touches a public Livewire
 * property ends up in its snapshot, which travels to the server and stays there (ADR 0002, with
 * `App\Livewire\Hooks\EncryptedPayloadGuardHook` and the architecture tests watching it). Besides,
 * the reader has no session. The controls are plain DOM with `addEventListener`, which is what
 * lets this module be mounted on both screens without dragging anything of the panel along.
 *
 * **What is kept from the earlier static report**, because it was the best it had: the header with
 * "N events, from X to Y, generated on Z" —the only thing that makes a truncated clipping visible—
 * and the clinical table with the official LOINC term, which is not translated (ADR 0005) and is
 * what ends up copied into a paper health record.
 */

import { formatDateTime, joinList, t } from '../i18n/index.js';
import {
    chartBlockAriaLabel,
    chartBlockTitle,
    chartElementIds,
    CHART_BLOCKS,
    destroyCharts,
    renderCharts,
} from '../health/chartsView.js';
import { observeColorSchemeChange } from '../health/chartTheme.js';
import { customRange, DateRangeError, presetRange } from '../health/dateRange.js';
import { typeLabel } from '../health/eventLabels.js';
import { searchEvents } from '../health/eventSearch.js';
import { flattenDecryptedEvent, memoryEventSource } from '../health/eventSource.js';
import { EVENT_TYPES, filterBySelectedTypes } from '../health/eventTypes.js';
import { createCallout } from '../health/eventVisuals.js';
import { majorityUnit, unitCount } from '../health/statistics.js';
import { renderStatsSections } from '../health/statsView.js';
import { renderTimelineSection } from '../health/timelineView.js';
import { describeEvent, reportHeadline, typeSummary } from './clinicalReport.js';

/**
 * Unit glucose readings are shown in when the clipping brings none.
 *
 * **The patient's display unit does not travel in the clipping, and that is deliberate**: it is
 * their encrypted configuration (ADR 0007) and it says nothing clinical the doctor needs. So the
 * unit comes from the readings themselves ({@see clippingGlucoseUnit}), which is the real datum:
 * if they measured in mmol/L, it reads in mmol/L.
 */
const DEFAULT_GLUCOSE_UNIT = 'mg/dL';

/** Sub-period shortcuts, all relative to the **end of the clipping**, never to today's clock. */
export const CLIP_RANGE_PRESETS = Object.freeze(['all', 'day', 'week', 'month', 'custom']);

/**
 * The two ends of the clipping, as its own body declares them.
 *
 * It is the ceiling of everything this screen can show. A `null` end is an open end ("from the
 * beginning", "to the end"), and it does not need filling in: the data source is the list already
 * in memory, so an open range widens nothing, it only stops clipping.
 *
 * @param {object} body Package body in the clear.
 * @returns {{from: string|null, to: string|null}}
 */
export function clippingBounds(body) {
    return {
        from: typeof body?.range?.from === 'string' ? body.range.from : null,
        to: typeof body?.range?.to === 'string' ? body.range.to : null,
    };
}

/**
 * @param {string|null} value
 * @returns {number} `NaN` if it cannot be read, which here always means "does not clip".
 */
function instantOf(value) {
    return typeof value === 'string' ? Date.parse(value) : NaN;
}

/**
 * Intersection of what was asked with what the clipping contains: **the result is never wider than
 * the ends of the clipping**.
 *
 * This function is the declarative half of the "narrow, never widen" invariant. The other half is
 * structural and stronger: even if this returned a ten-year range, {@see memoryEventSource} would
 * still have nowhere to take an event that is not in the package from. Both exist because the
 * first one is what keeps the screen from *claiming* to cover a period it does not cover.
 *
 * @param {{from: string|null, to: string|null}} range What was asked for.
 * @param {{from: string|null, to: string|null}} bounds Output of {@see clippingBounds}.
 * @returns {{from: string|null, to: string|null}}
 */
export function narrowToClipping(range, bounds) {
    const requestedFrom = instantOf(range?.from ?? null);
    const boundFrom = instantOf(bounds?.from ?? null);
    const requestedTo = instantOf(range?.to ?? null);
    const boundTo = instantOf(bounds?.to ?? null);

    return {
        from: Number.isNaN(boundFrom) || (!Number.isNaN(requestedFrom) && requestedFrom > boundFrom)
            ? (range?.from ?? null)
            : bounds.from,
        to: Number.isNaN(boundTo) || (!Number.isNaN(requestedTo) && requestedTo < boundTo)
            ? (range?.to ?? null)
            : bounds.to,
    };
}

/**
 * Instant the relative shortcuts count from: the end of the clipping.
 *
 * **It is not "now", and that is the whole point.** A clipping generated a week ago with "last
 * day" counted from today would come out empty, and an empty screen reads as "this patient has no
 * records". Counting from the end of the clipping, "last day" is the last day *of the clipping*,
 * which is what whoever presses it means.
 *
 * @param {{from: string|null, to: string|null}} bounds
 * @param {list<{occurredAt?: string}>} events
 * @returns {Date}
 */
export function clippingEnd(bounds, events) {
    const declaredEnd = instantOf(bounds?.to ?? null);

    if (!Number.isNaN(declaredEnd)) {
        return new Date(declaredEnd);
    }

    /** With no declared end, the most recent record; the `+1` keeps that event itself inside. */
    let newest = -Infinity;

    for (const event of events) {
        const occurredMs = instantOf(event?.occurredAt ?? null);

        if (!Number.isNaN(occurredMs) && occurredMs > newest) {
            newest = occurredMs;
        }
    }

    return newest === -Infinity ? new Date() : new Date(newest + 1);
}

/**
 * The sub-period to apply, already clipped to the clipping.
 *
 * A badly typed range **does not leave the screen blank**: it returns the whole clipping and the
 * reason in `error`, which the caller paints as a warning. In an appointment, an empty screen with
 * no explanation is worse than a period wider than the one asked for.
 *
 * @param {object} params
 * @param {string} params.preset One of {@see CLIP_RANGE_PRESETS}.
 * @param {string} [params.fromDay] `YYYY-MM-DD`, only with `custom`.
 * @param {string} [params.toDay] `YYYY-MM-DD`, only with `custom`.
 * @param {{from: string|null, to: string|null}} params.bounds
 * @param {list<object>} params.events
 * @returns {{range: {from: string|null, to: string|null}, error: string}}
 */
export function clippingSubrange({ preset, fromDay, toDay, bounds, events }) {
    try {
        const requested = preset === 'custom'
            ? customRange(fromDay, toDay)
            : presetRange(preset, clippingEnd(bounds, events));

        const range = narrowToClipping(requested, bounds);

        /**
         * A period that does not overlap the clipping —"1 to 5 July" over a clipping of June—
         * comes out of the intersection as an empty or inverted interval. Without this check the
         * screen is left with six empty cards and not one warning: the count would say "0 records"
         * and the cause, fixable in two clicks, would be written nowhere.
         */
        if (instantOf(range.from) >= instantOf(range.to)) {
            return {
                range: { ...bounds },
                error: t('clip.range.outside', {
                    from: formatDateTime(bounds.from),
                    to: formatDateTime(bounds.to),
                }),
            };
        }

        return { range, error: '' };
    } catch (failure) {
        return {
            range: { ...bounds },
            error: failure instanceof DateRangeError ? failure.message : t('range.error.badDate'),
        };
    }
}

/**
 * Flattens the package events into the shape the views expect (`{...content, occurredAt}`), and
 * counts the ones that do not have that shape.
 *
 * **An unreadable event does not disappear**: it comes out of the count here and the caller says
 * it out loud and still shows it in the clinical table, with its date (ADR 0004). In a clipping
 * somebody else is going to read, a missing record is indistinguishable from a record that never
 * existed, and that difference is clinical.
 *
 * **Nor does an event of a type this clipping does not declare disappear.** A clipping generated by
 * a newer version of the panel may bring a seventh type: its content is readable, so it is not
 * unreadable, but it is not among the offered types and therefore passes no filter. Without this
 * third bucket it fell out of the charts, the statistics, the timeline **and the clinical table**,
 * appearing in no count, which is a regression from the static report, which did paint it as a
 * "not understood" row.
 *
 * @param {object} body Package body in the clear.
 * @param {list<string>} types Types the screen offers ({@see clippingTypes}).
 * @returns {{events: list<object>, raws: list<object>, unreadable: list<object>,
 *           undeclared: list<object>}}
 */
export function flattenClippingEvents(body, types = EVENT_TYPES) {
    const packaged = Array.isArray(body?.events) ? body.events : [];
    const events = [];
    const raws = [];
    const unreadable = [];
    const undeclared = [];

    for (const raw of packaged) {
        const content = raw?.content;

        if (content === null || typeof content !== 'object' || typeof content.type !== 'string') {
            unreadable.push(raw);

            continue;
        }

        if (!types.includes(content.type)) {
            undeclared.push(raw);

            continue;
        }

        events.push(flattenDecryptedEvent({ occurredAt: raw.occurredAt }, content));
        raws.push(raw);
    }

    return { events, raws, unreadable, undeclared };
}

/**
 * Types this clipping declares it includes, in the order of {@see EVENT_TYPES}.
 *
 * The checkboxes are painted **only** for those types: offering "Meals" in a clipping where the
 * patient chose not to share them would invite ticking it and concluding, from the silence, that
 * they do not eat. What was left out is said separately, in the header, in those words.
 *
 * **If the clipping declares no type but brings events**, the types actually inside are offered and
 * it is stated that the clipping does not declare them ({@see renderClippingExplorer}). The
 * alternative was leaving the screen saying "tick at least one type" over a panel with no checkbox
 * to tick: a dead end over data that is right there.
 *
 * @param {object} body
 * @returns {list<string>}
 */
export function clippingTypes(body) {
    const included = Array.isArray(body?.includedTypes) ? body.includedTypes : [];
    const declared = EVENT_TYPES.filter((type) => included.includes(type));

    if (declared.length > 0) {
        return declared;
    }

    const present = new Set(
        (Array.isArray(body?.events) ? body.events : [])
            .map((raw) => raw?.content?.type)
            .filter((type) => typeof type === 'string'),
    );

    return EVENT_TYPES.filter((type) => present.has(type));
}

/**
 * Unit the glucose readings of the clipping are shown in: that of the **majority** of the readings.
 *
 * It was chosen by majority and not by recency ({@see majorityUnit} rather than `dominantUnit`)
 * because here the reader does not know whether the patient has just changed meters. With the unit
 * of the last reading, two new readings in mmol/L send two hundred in mg/dL to a footnote and the
 * card summary describes two records, not the clipping.
 *
 * @param {list<object>} events
 * @returns {string}
 */
export function clippingGlucoseUnit(events) {
    return majorityUnit(events, 'glucose', 'value') ?? DEFAULT_GLUCOSE_UNIT;
}

/**
 * Are there glucose readings in more than one unit?
 *
 * When there are, the card number describes a part of the clipping and that has to be said up top,
 * with the weight of a warning: the excluded-readings note `statsView.js` already paints goes in
 * `text-caption`, that is with less visual weight than the number it contradicts.
 *
 * @param {list<object>} events
 * @returns {boolean}
 */
export function clippingHasMixedGlucoseUnits(events) {
    return unitCount(events, 'glucose', 'value') > 1;
}

// --- Painting ------------------------------------------------------------------------------------

/** @param {string} tagName @param {string} className @param {string} [text] */
function element(tagName, className, text) {
    const node = document.createElement(tagName);

    node.className = className;

    if (text !== undefined) {
        node.textContent = text;
    }

    return node;
}

/**
 * Card with a title, of the same set as the panel ones (DESIGN.md § Cards).
 *
 * @param {string} title
 * @returns {{card: HTMLElement, body: HTMLElement}}
 */
function card(title) {
    const node = element('section', 'rounded-card border border-border bg-surface p-card shadow-sm');

    node.appendChild(element('h2', 'font-display text-subhead text-ink', title));

    const body = element('div', 'mt-4');
    node.appendChild(body);

    return { card: node, body };
}

/**
 * Mandatory header of the clipping: how many events, from when to when and when it was generated,
 * plus the two type lists.
 *
 * **It is always shown and never folded away.** It is the reference everything below is read
 * against: without it, a clipping missing the worst week reads as a complete history. And the
 * excluded types are said out loud because an absence reads as a clinical zero.
 *
 * @param {object} resolved Vocabulary already resolved ({@see resolveCatalog}).
 * @param {object} body
 * @returns {HTMLElement}
 */
export function renderClippingHeader(resolved, body) {
    const headline = reportHeadline(body);
    const types = typeSummary(resolved, body);

    const section = element('section', 'rounded-card border border-border bg-surface p-card shadow-sm');
    section.appendChild(element('h2', 'font-display text-headline text-ink', headline.count));

    for (const line of [headline.range, headline.generatedAt, types.included, types.excluded]) {
        if (line === null) {
            continue;
        }

        section.appendChild(element('p', 'mt-1 text-body text-ink-secondary', line));
    }

    section.appendChild(element('p', 'mt-3 text-body-sm text-ink-secondary', t('reader.header.snapshot')));

    return section;
}

/**
 * The second line of the header: **what is being looked at right now**, after narrowing.
 *
 * The clipping header is painted once and describes the whole package, which is its job: it is the
 * reference that shows a clipping arrived truncated. But while it was the only one, narrowing to
 * seven days and unticking blood pressure left on screen —and above all **on paper**, because the
 * controls carry `data-phr-reader-screen-only` and are not printed— a heading declaring six months
 * and every type on top of a filtered seven-day table. The defence against a truncated history
 * became the cause of the error.
 *
 * That is why this line is repainted on every `repaint()` and **is printed**: it states the range
 * actually applied, the ticked types and the searched text. The one above says what is in the
 * clipping; this one says what is below.
 *
 * @param {{from: string|null, to: string|null}} range Range already clipped ({@see clippingSubrange}).
 * @param {list<string>} types Every type the clipping offers.
 * @param {Record<string, boolean>} selected
 * @param {string} query Searched text.
 * @returns {string}
 */
export function viewingText(range, types, selected, query) {
    /**
     * The range is composed here and not with `rangeText`: that sentence is written for the header
     * ("Covering from X to Y") and this one speaks in the present ("from X to Y"). What is copied
     * from it is the criterion for open ends ({@see describeRange}).
     */
    const parts = [describeRange(range)];

    const marked = types.filter((type) => selected[type] === true);

    if (marked.length === 0) {
        parts.push(t('clip.viewing.noTypes'));
    } else if (marked.length === types.length) {
        parts.push(t('clip.viewing.allTypes'));
    } else {
        parts.push(t('clip.viewing.types', { types: joinList(marked.map(typeLabel)) }));
    }

    if (query.trim() !== '') {
        parts.push(t('clip.viewing.search', { query: query.trim() }));
    }

    return `${t('clip.viewing.label')} ${parts.join(' · ')}`;
}

/**
 * An open range is said with words, never with a gap: it is the criterion of `rangeText`, the same
 * criterion as in `clinicalReport.js`.
 *
 * @param {{from: string|null, to: string|null}} range
 * @returns {string}
 */
function describeRange(range) {
    if (range.from === null && range.to === null) {
        return t('clip.viewing.rangeAll');
    }

    if (range.to === null) {
        return t('clip.viewing.rangeFrom', { from: formatDateTime(range.from) });
    }

    if (range.from === null) {
        return t('clip.viewing.rangeTo', { to: formatDateTime(range.to) });
    }

    return t('clip.viewing.rangeBetween', {
        from: formatDateTime(range.from),
        to: formatDateTime(range.to),
    });
}

/**
 * Clinical table: one row per record, with the value, the method, the note and the LOINC code.
 *
 * **Neither the timeline nor the charts replace it.** It is a real `<table>` because it is read in
 * columns, compared at a glance and comes out on paper the way a table does, which is where this
 * ends up when somebody files it into a health record; and it is the only place the official LOINC
 * term appears, which is not translated (ADR 0005) and is what allows copying a quantity into
 * another system without reinterpreting it.
 *
 * @param {object} resolved
 * @param {list<{occurredAt: string, content: object}>} events Events **of the package**, unflattened.
 * @returns {HTMLElement}
 */
export function renderClinicalTable(resolved, events) {
    const wrapper = element('div', 'overflow-x-auto rounded-card border border-border bg-surface');
    const table = element('table', 'w-full border-collapse text-body-sm');

    const head = document.createElement('thead');
    const headRow = document.createElement('tr');

    for (const key of [
        'reader.table.when',
        'reader.table.what',
        'reader.table.value',
        'reader.table.details',
        'reader.table.loinc',
    ]) {
        const cell = element(
            'th',
            'border-b border-border px-4 py-3 text-left text-overline text-ink-secondary uppercase',
            t(key),
        );
        cell.scope = 'col';
        headRow.appendChild(cell);
    }

    head.appendChild(headRow);
    table.appendChild(head);

    const tbody = document.createElement('tbody');

    for (const event of events) {
        tbody.appendChild(renderClinicalRow(describeEvent(resolved, event)));
    }

    if (events.length === 0) {
        const row = document.createElement('tr');
        const cell = element('td', 'px-4 py-3 text-body text-ink-secondary', t('reader.table.empty'));
        cell.colSpan = 5;
        row.appendChild(cell);
        tbody.appendChild(row);
    }

    table.appendChild(tbody);
    wrapper.appendChild(table);

    return wrapper;
}

/**
 * @param {object} row Output of {@see describeEvent}.
 * @returns {HTMLTableRowElement}
 */
function renderClinicalRow(row) {
    const tableRow = element('tr', 'border-b border-border last:border-b-0 break-inside-avoid');

    const when = element(
        'td',
        'px-4 py-3 align-top font-mono text-body-sm text-ink whitespace-nowrap',
        row.tz === null ? row.occurredAtLabel : `${row.occurredAtLabel} (${row.tz})`,
    );

    const what = element('td', 'px-4 py-3 align-top text-body-sm text-ink', row.typeLabel);

    const value = element(
        'td',
        row.unreadable
            ? 'px-4 py-3 align-top text-body-sm text-error-ink'
            : 'px-4 py-3 align-top font-mono text-body text-ink whitespace-nowrap',
        row.value,
    );

    const details = element('td', 'px-4 py-3 align-top text-body-sm text-ink-secondary');

    if (row.details.length > 0 || row.note !== null) {
        const list = element('ul', 'flex flex-col gap-0.5');

        for (const detail of row.details) {
            list.appendChild(element('li', '', detail));
        }

        if (row.note !== null) {
            list.appendChild(element('li', 'text-ink', t('reader.detail.note', { note: row.note })));
        }

        details.appendChild(list);
    }

    const loinc = element('td', 'px-4 py-3 align-top text-caption text-ink-secondary');

    for (const entry of row.loinc) {
        const item = element('p', '');

        /**
         * The code goes in monospace (Do's #7) and the official term is **not translated** (ADR
         * 0005): it is the name this quantity is identified by outside here.
         */
        item.appendChild(element('span', 'font-mono text-ink', entry.code));

        if (entry.name !== null) {
            item.appendChild(document.createTextNode(` ${entry.name}`));
        }

        loinc.appendChild(item);
    }

    for (const cell of [when, what, value, details, loinc]) {
        tableRow.appendChild(cell);
    }

    return tableRow;
}

/**
 * The chart blocks: the two that cross types —the glucose curve with meal and insulin markers, and
 * the day overlay over 24 hours— and then one per type with a quantity worth averaging. The list
 * and the titles come from `chartsView.js`, so the professional sees exactly the same charts the
 * patient sees in their panel.
 *
 * This module paints them and not a template, unlike in the patient panel: there the markup is
 * emitted by Blade because the Livewire morph would wipe any canvas written by JavaScript (ADR
 * 0002), and here there is no Livewire morphing anything. `chartsView.js` finds them by `id`,
 * with the prefix it receives, so that two screens mounted at once never fight over the same
 * `<canvas>`.
 *
 * @param {string} prefix
 * @returns {HTMLElement}
 */
function renderChartBlocks(prefix) {
    const container = element('div', 'space-y-8');

    for (const type of CHART_BLOCKS) {
        const ids = chartElementIds(type, prefix);

        /** Hidden by default: `renderCharts()` reveals it if there is anything to draw. */
        const block = element('div', 'hidden');
        block.id = ids.block;

        block.appendChild(element('h3', 'font-display text-body-sm font-semibold text-ink', chartBlockTitle(type)));

        const frame = element('div', 'mt-2 h-80');
        const canvas = document.createElement('canvas');
        canvas.id = ids.canvas;
        canvas.setAttribute('role', 'img');
        canvas.setAttribute('aria-label', chartBlockAriaLabel(type));
        canvas.setAttribute('aria-describedby', `${ids.caption} ${ids.legend}`);
        frame.appendChild(canvas);
        block.appendChild(frame);

        const legend = element('ul', 'mt-3 flex flex-wrap gap-x-4 gap-y-1');
        legend.id = ids.legend;
        block.appendChild(legend);

        const caption = element('p', 'mt-2 text-caption text-ink-secondary');
        caption.id = ids.caption;
        block.appendChild(caption);

        container.appendChild(block);
    }

    return container;
}

/**
 * The controls: sub-period, types and search.
 *
 * They are marked with `data-phr-reader-screen-only`, which the reader stylesheet hides when
 * printing: a dropdown and a search field on paper are ink nobody can press.
 *
 * @param {object} params
 * @param {list<string>} params.types Types the clipping includes.
 * @param {Record<string, boolean>} params.selected
 * @param {string} params.idPrefix
 * @param {() => void} params.onChange
 * `cancelPendingSearch` is exposed because the debounce has to die with the screen: a pending
 * `repaint()` running after `destroy()` recomputes statistics and **keeps the events in the clear
 * alive in memory** a while after the screen was considered closed, which is exactly the opposite
 * of the "memory only, and gone when it is gone" invariant.
 *
 * @returns {{section: HTMLElement, presetSelect: HTMLElement, fromInput: HTMLElement,
 *           toInput: HTMLElement, customRow: HTMLElement, searchInput: HTMLElement,
 *           rangeError: HTMLElement, cancelPendingSearch: () => void}}
 */
function renderControls({ types, selected, idPrefix, onChange }) {
    const { card: section, body } = card(t('clip.controls.title'));
    section.setAttribute('data-phr-reader-screen-only', '');

    // --- Sub-period ------------------------------------------------------------------------------

    const rangeLabel = element('label', 'mb-1.5 block text-body-sm font-semibold text-ink', t('clip.range.label'));
    rangeLabel.htmlFor = `${idPrefix}-clip-range`;
    body.appendChild(rangeLabel);

    const presetSelect = element(
        'select',
        'block min-h-11 w-full rounded-control border-[1.5px] border-border-strong bg-surface px-3.5 py-2.5 '
            + 'text-body text-ink focus:border-accent focus:shadow-focus-blue focus:outline-none sm:w-72',
    );
    presetSelect.id = `${idPrefix}-clip-range`;

    for (const preset of CLIP_RANGE_PRESETS) {
        const option = document.createElement('option');
        option.value = preset;
        option.textContent = t(`clip.range.${preset}`);
        presetSelect.appendChild(option);
    }

    presetSelect.value = 'all';
    body.appendChild(presetSelect);

    const customRow = element('div', 'mt-3 hidden flex-wrap items-end gap-3');
    const fromInput = renderDayInput(`${idPrefix}-clip-from`, t('clip.range.from'), customRow);
    const toInput = renderDayInput(`${idPrefix}-clip-to`, t('clip.range.to'), customRow);
    body.appendChild(customRow);

    /** The range error does not auto-dismiss (Don'ts #6) and carries text as well as colour (Do's #3). */
    const rangeError = element('p', 'mt-2 text-body-sm text-error-ink');
    rangeError.hidden = true;
    rangeError.setAttribute('role', 'alert');
    body.appendChild(rangeError);

    body.appendChild(element('p', 'mt-1.5 text-helper text-ink-secondary', t('clip.range.help')));

    const syncCustomRow = () => {
        customRow.className = presetSelect.value === 'custom'
            ? 'mt-3 flex flex-wrap items-end gap-3'
            : 'mt-3 hidden flex-wrap items-end gap-3';
    };

    presetSelect.addEventListener('change', () => {
        syncCustomRow();
        onChange();
    });

    for (const input of [fromInput, toInput]) {
        input.addEventListener('change', onChange);
    }

    // --- Types -----------------------------------------------------------------------------------

    const fieldset = element('fieldset', 'mt-4');
    fieldset.appendChild(element('legend', 'mb-1.5 block text-body-sm font-semibold text-ink', t('clip.types.label')));

    const chips = element('div', 'flex flex-wrap gap-2');

    for (const type of types) {
        const label = element('label', 'inline-flex min-h-11 cursor-pointer items-center');

        const input = document.createElement('input');
        input.type = 'checkbox';
        input.className = 'peer sr-only';
        input.checked = selected[type] === true;
        input.addEventListener('change', () => {
            selected[type] = input.checked;
            onChange();
        });

        label.appendChild(input);
        label.appendChild(element(
            'span',
            'inline-flex min-h-11 items-center rounded-chip border border-chip-outline bg-chip-surface px-3.5 '
                + 'py-1.5 text-body-sm font-semibold text-chip-ink peer-checked:border-accent '
                + 'peer-checked:bg-accent peer-checked:text-accent-ink peer-focus-visible:shadow-focus-blue',
            typeLabel(type),
        ));

        chips.appendChild(label);
    }

    fieldset.appendChild(chips);
    body.appendChild(fieldset);

    // --- Search ----------------------------------------------------------------------------------

    const searchWrapper = element('div', 'mt-4');
    const searchLabel = element('label', 'mb-1.5 block text-body-sm font-semibold text-ink', t('clip.search.label'));
    searchLabel.htmlFor = `${idPrefix}-clip-search`;
    searchWrapper.appendChild(searchLabel);

    /**
     * `type="search"` and not `type="text"`: the browser adds the clear button and announces it as a
     * search field. `autocomplete="off"` because this is typed on a clinic computer several people
     * use, and what somebody searches in somebody else's history —"hypoglycaemia", a drug name—
     * has no business staying in the next person's autocomplete.
     */
    const searchInput = document.createElement('input');
    searchInput.id = `${idPrefix}-clip-search`;
    searchInput.type = 'search';
    searchInput.autocomplete = 'off';
    searchInput.placeholder = t('clip.search.placeholder');
    searchInput.setAttribute('aria-describedby', `${idPrefix}-clip-search-help`);
    searchInput.className = 'block min-h-11 w-full rounded-control border-[1.5px] border-border-strong bg-surface '
        + 'px-3.5 py-2.5 text-body text-ink focus:border-accent focus:shadow-focus-blue focus:outline-none';

    /**
     * A hand-written 200 ms debounce, which is what `@input.debounce.200ms` does in the panel:
     * repainting five charts and six cards on every keystroke is noticeable, and 200 ms is how long
     * a pause takes to be felt while typing. There is no Alpine here to set it up.
     */
    let debounce = null;
    const cancelPendingSearch = () => {
        if (debounce !== null) {
            clearTimeout(debounce);
            debounce = null;
        }
    };

    searchInput.addEventListener('input', () => {
        cancelPendingSearch();

        debounce = setTimeout(onChange, 200);
    });

    searchWrapper.appendChild(searchInput);

    const help = element('p', 'mt-1.5 text-helper text-ink-secondary', t('clip.search.help'));
    help.id = `${idPrefix}-clip-search-help`;
    searchWrapper.appendChild(help);

    body.appendChild(searchWrapper);

    return { section, presetSelect, fromInput, toInput, customRow, searchInput, rangeError, cancelPendingSearch };
}

/**
 * @param {string} id
 * @param {string} labelText
 * @param {HTMLElement} row
 * @returns {HTMLInputElement}
 */
function renderDayInput(id, labelText, row) {
    const wrapper = element('div', '');
    const label = element('label', 'mb-1.5 block text-body-sm font-semibold text-ink', labelText);
    label.htmlFor = id;
    wrapper.appendChild(label);

    const input = document.createElement('input');
    input.id = id;
    input.type = 'date';
    input.className = 'block min-h-11 rounded-control border-[1.5px] border-border-strong bg-surface px-3.5 py-2.5 '
        + 'text-body text-ink focus:border-accent focus:shadow-focus-blue focus:outline-none';
    wrapper.appendChild(input);
    row.appendChild(wrapper);

    return input;
}

/**
 * Mounts the whole clipping screen inside `container`.
 *
 * @param {HTMLElement} container It is emptied and filled.
 * @param {object} params
 * @param {object} params.body Package body in the clear.
 * @param {object} params.resolved Resolved vocabulary ({@see resolveCatalog}).
 * @param {string} params.chartPrefix Prefix of the `id`s of the chart blocks.
 * @returns {{repaint: () => Promise<void>, destroy: () => void}}
 */
export function renderClippingExplorer(container, { body, resolved, chartPrefix }) {
    const bounds = clippingBounds(body);
    const types = clippingTypes(body);
    const { events: allEvents, raws, unreadable, undeclared } = flattenClippingEvents(body, types);
    const glucoseUnit = clippingGlucoseUnit(allEvents);
    const mixedGlucoseUnits = clippingHasMixedGlucoseUnits(allEvents);

    /** The clipping brings events but does not say of which types: the ones present are offered and declared. */
    const declaredTypes = Array.isArray(body?.includedTypes) ? body.includedTypes : [];
    const undeclaredTypes = types.length > 0 && !EVENT_TYPES.some((type) => declaredTypes.includes(type));

    /**
     * Pairing between the flattened event the views see and the package event the clinical table
     * reads. It is a `WeakMap` and not a field inside the event because the filters
     * (`filterBySelectedTypes`, `searchEvents`, the memory source) return **the same objects**, so
     * identity is enough and the decrypted content does not have to be dirtied.
     */
    const rawOf = new WeakMap();

    for (const [index, event] of allEvents.entries()) {
        rawOf.set(event, raws[index]);
    }

    /** All ticked by default: opening the screen with a type left out would hide records. */
    const selected = Object.fromEntries(types.map((type) => [type, true]));
    const source = memoryEventSource(allEvents);

    /** @type {Record<string, object>} Live Chart.js instances, so they can be destroyed. */
    const charts = {};

    const controls = renderControls({
        types,
        selected,
        idPrefix: chartPrefix,
        onChange: () => void repaint(),
    });

    const notice = element('div', '');

    /**
     * The effective-state line. It goes outside the controls card on purpose: that one carries
     * `data-phr-reader-screen-only` and disappears when printing, and this one has to come out on paper.
     */
    const viewing = element('p', 'text-body text-ink-secondary');
    const chartsCard = card(t('clip.charts.title'));
    const statsCard = card(t('clip.stats.title'));
    const timelineCard = card(t('clip.timeline.title'));
    const tableCard = card(t('clip.table.title'));

    chartsCard.body.appendChild(renderChartBlocks(chartPrefix));

    /**
     * The charts are not printed. A `<canvas>` comes out on paper exactly as it was drawn, and drawn
     * in dark theme it is light lines on a transparent background: on white, invisible. What really
     * ends up inside a health record is text (ADR 0011), and that text —the statistics cards and
     * the table— is printed whole.
     */
    chartsCard.card.setAttribute('data-phr-reader-screen-only', '');

    container.replaceChildren(
        renderClippingHeader(resolved, body),
        controls.section,
        viewing,
        notice,
        chartsCard.card,
        statsCard.card,
        timelineCard.card,
        tableCard.card,
    );

    /**
     * DESIGN.md § Charts — Dark: the chart has to re-read the colours and redraw when the theme
     * changes. In the panel the theme is a class on `<html>` set by Filament; here there is no
     * panel and no toggle —storing a preference would be writing on the professional's device,
     * which is exactly what this route avoids—, so the operating system decides.
     */
    const stopObserving = observeColorSchemeChange(() => void repaint());

    async function repaint() {
        const { range, error } = clippingSubrange({
            preset: controls.presetSelect.value,
            fromDay: controls.fromInput.value,
            toDay: controls.toInput.value,
            bounds,
            events: allEvents,
        });

        controls.rangeError.textContent = error;
        controls.rangeError.hidden = error === '';

        const query = controls.searchInput.value;

        viewing.textContent = viewingText(range, types, selected, query);

        const { events: inRange } = await source(range);

        /**
         * **The period and the types are the population; the search is not.** The charts and the
         * statistics are computed over `selectedEvents`, and the search only narrows the timeline
         * and the table, which is where searching means "find this".
         *
         * While the search was the last filter of everything, typing "night" —or "140"— rewrote the
         * mean, the median and the time in range over the subset of records whose **text**
         * contained that string, with the "Mean" label untouched. A mean over a string match is not
         * a clinical population: it is a made-up number that looks like data, and here it is read
         * by somebody with no way of knowing how it came out.
         */
        const selectedEvents = filterBySelectedTypes(inRange, selected);
        const shown = searchEvents(selectedEvents, query);

        renderNotice(selectedEvents.length, selectedEvents.length - shown.length);

        renderCharts(selectedEvents, {
            glucoseUnit,
            charts,
            includesType: (type) => selected[type] === true,
            prefix: chartPrefix,
        });

        statsCard.body.replaceChildren(renderStatsSections(selectedEvents, {
            selectedTypes: selected,
            unit: glucoseUnit,
            targetRange: undefined,
            unitMismatch: false,
            /**
             * No buttons to panel screens and no invitation to configure a target range: whoever
             * looks at this has no account here and can configure nothing. A button that leads
             * nowhere is worse than no button.
             */
            urlForType: () => null,
            inviteTargetRange: false,
            /**
             * "No records in this period yet" speaks in the patient's voice and asserts a clinical
             * absence about a history that is not the reader's. What there is here is a closed
             * clipping, and that is what is said.
             */
            emptyText: t('clip.empty.type'),
        }));

        timelineCard.body.replaceChildren(renderTimelineSection(shown, {
            /**
             * If what empties the timeline is the search box, it is said that it is the search box.
             * Saying "there are no records" about records that are in the clipping and merely
             * filtered is exactly the reading this project cannot afford.
             */
            emptyText: query.trim() === '' ? t('clip.empty.type') : t('dashboard.empty.search'),
        }));

        /**
         * The table shows the same as the views **plus the unreadable ones and those of an
         * undeclared type**, which pass no filter: of the first ones neither the type nor the date
         * can be read with any guarantee, and the second ones have no checkbox to tick. Hiding
         * either would be omitting a record that exists (ADR 0004), and `describeEvent` can paint them.
         */
        tableCard.body.replaceChildren(renderClinicalTable(resolved, [
            ...shown.map((event) => rawOf.get(event)),
            ...undeclared,
            ...unreadable,
        ]));
    }

    /**
     * @param {number} shownCount Records of the period that pass the type filter.
     * @param {number} hiddenBySearch How many of those the searched text leaves out.
     */
    function renderNotice(shownCount, hiddenBySearch) {
        const callouts = [];

        if (unreadable.length > 0) {
            callouts.push(createCallout('warning', t('clip.notice.unreadable', { count: unreadable.length })));
        }

        if (undeclared.length > 0) {
            callouts.push(createCallout('warning', t('clip.notice.undeclared', { count: undeclared.length })));
        }

        if (undeclaredTypes) {
            callouts.push(createCallout('info', t('clip.notice.noDeclaredTypes')));
        }

        /**
         * Glucose readings in two units deserve a warning, not a footnote: the note `statsView.js`
         * already paints goes in `text-caption`, with less visual weight than the number it contradicts.
         */
        if (mixedGlucoseUnits) {
            callouts.push(createCallout('warning', t('clip.notice.mixedUnits', { unit: glucoseUnit })));
        }

        callouts.push(createCallout('info', t('clip.notice.shown', {
            count: shownCount,
            total: allEvents.length + undeclared.length + unreadable.length,
        })));

        if (hiddenBySearch > 0) {
            callouts.push(createCallout('info', t('dashboard.search.hidden', { count: hiddenBySearch })));
        }

        for (const callout of callouts.slice(0, -1)) {
            callout.classList.add('mb-4');
        }

        notice.replaceChildren(...callouts);
    }

    void repaint();

    return {
        repaint,
        /**
         * Unmounts: destroys the charts and stops observing the theme. Without this, mounting the
         * preview again would leave the previous Chart.js instance tied to a canvas that is gone.
         */
        destroy() {
            controls.cancelPendingSearch();
            stopObserving();
            destroyCharts(charts, chartPrefix);
            container.replaceChildren();
        },
    };
}
