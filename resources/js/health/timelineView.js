/**
 * Unified timeline of already decrypted events.
 *
 * **What it is and why it is a module of its own.** It is the only view that shows the relation
 * between eating, injecting insulin and what the glucose does afterwards: no per-type screen can
 * do it. It used to live inside `dashboardPage.js`, tied to the patient panel; now it **takes an
 * array of decrypted events and returns nodes**, touching no Livewire, no `$wire` and no `x-ref`,
 * so that the doctor opening a shared clipping sees exactly the same timeline as the patient,
 * with no account and no session.
 *
 * The two possible exclusions —the entry cap and the types this module cannot describe— are always
 * stated with their exact count. A clipped timeline presented as complete makes what does appear
 * be read wrongly.
 */

import { formatDayHeading, formatTimeOfDay, joinList, t } from '../i18n/index.js';
import {
    catalogLabel,
    formatMeasuredValue,
    formatMethodLabel,
    INSULIN_TYPE_KEYS,
    MEAL_TYPE_KEYS,
    TEMPERATURE_SITE_KEYS,
    typeLabel,
} from './eventLabels.js';
import { createCallout, renderEmptyState } from './eventVisuals.js';

/**
 * Cap on painted entries.
 *
 * **Decryption is not the reason**: the events arrive already decrypted. What costs is the DOM: a
 * month of intensive recording can go past a thousand rows, and painting them all leaves the
 * screen heavy on a phone.
 *
 * It clips by the most recent, **never in silence** ({@see renderTimelineSection}).
 */
export const TIMELINE_MAX_ENTRIES = 100;

/**
 * Foods named in the line of a meal before summarizing the rest with `+N`.
 *
 * A meal of twelve ingredients would take five lines and break the "read at a glance"; the full
 * names are still on the meals screen.
 */
const TIMELINE_MAX_FOODS = 3;

/**
 * One-line summary of each event type.
 *
 * Each entry returns `{summary, detail}`: `summary` is the datum (the figure with its unit) and
 * `detail` the context that keeps it from being misread —the measurement method, the site, the
 * insulin type—, which the view paints in secondary ink. `detail` may be `null`: all those fields
 * are optional in the envelope (ADR 0006) and none is invented here.
 *
 * The units come from the event itself and are UCUM codes (ADR 0005): they are neither translated
 * nor converted (ADR 0007).
 *
 * @type {Record<string, (data: object) => {summary: string, detail: string|null}>}
 */
const TIMELINE_SUMMARIES = Object.freeze({
    glucose: (data) => ({
        summary: t('dashboard.timeline.measurement', {
            value: formatMeasuredValue(data.value),
            unit: data.unit ?? '',
        }),
        detail: typeof data.method === 'string' && data.method !== '' ? formatMethodLabel(data.method) : null,
    }),

    bloodPressure: (data) => {
        const reading = t('dashboard.timeline.bloodPressureReading', {
            systolic: formatMeasuredValue(data.systolic),
            diastolic: formatMeasuredValue(data.diastolic),
            unit: data.unit ?? '',
        });

        /** The pulse is optional (ADR 0006): without it the line leaves no gap and writes no zero. */
        const pulse = typeof data.pulse === 'string' && data.pulse !== ''
            ? t('dashboard.timeline.pulse', {
                pulse: formatMeasuredValue(data.pulse),
                unit: t('dashboard.unit.bpm'),
            })
            : null;

        return {
            summary: pulse === null ? reading : `${reading} · ${pulse}`,
            detail: typeof data.arm === 'string' && typeof data.posture === 'string'
                ? formatMethodLabel(`${data.arm}_${data.posture}`)
                : null,
        };
    },

    insulin: (data) => ({
        summary: t('dashboard.timeline.measurement', {
            value: formatMeasuredValue(data.dose),
            unit: data.unit ?? '',
        }),
        detail: catalogLabel(INSULIN_TYPE_KEYS, data.insulinType) || null,
    }),

    /**
     * In a meal the clinical datum is not a figure but what was eaten: the meal type is the summary
     * and the foods, the detail. It is exactly the datum that lets the timeline be read for what it
     * is after: eating, injecting and what the glucose does afterwards.
     */
    meal: (data) => {
        const foods = Array.isArray(data.foods) ? data.foods : [];
        const names = foods
            .map((food) => (typeof food?.name === 'string' ? food.name.trim() : ''))
            .filter((name) => name !== '');
        const shown = names.slice(0, TIMELINE_MAX_FOODS);
        const hidden = names.length - shown.length;

        if (hidden > 0) {
            shown.push(t('dashboard.timeline.moreFoods', { count: hidden }));
        }

        return {
            summary: catalogLabel(MEAL_TYPE_KEYS, data.mealType),
            detail: names.length === 0 ? t('dashboard.timeline.noFoods') : joinList(shown),
        };
    },

    bodyWeight: (data) => ({
        summary: t('dashboard.timeline.measurement', {
            value: formatMeasuredValue(data.value),
            unit: data.unit ?? '',
        }),
        detail: null,
    }),

    temperature: (data) => ({
        summary: t('dashboard.timeline.measurement', {
            value: formatMeasuredValue(data.value),
            unit: data.unit ?? '',
        }),
        detail: catalogLabel(TEMPERATURE_SITE_KEYS, data.site) || null,
    }),
});

/**
 * Stroke of the icon of each type, in the line style of the other icons (24×24, no fill,
 * `stroke-width` 1.5).
 *
 * **Why an icon and not a colour of its own.** Six types would need six colours, and DESIGN.md
 * defines only four series colours —the last two with a state meaning (Success, Warning) and red
 * reserved for errors (Don'ts #4)—; inventing two more would be exactly the "private palette"
 * § Charts forbids. Besides, colour can never be the only carrier of meaning (Do's #3). With the
 * silhouette of the icon plus the type name written out, the distinction holds in greyscale and
 * with the dark theme too.
 *
 * @type {Record<string, string>}
 */
const TIMELINE_ICONS = Object.freeze({
    glucose: 'M12 3.75s5.25 5.25 5.25 9a5.25 5.25 0 0 1-10.5 0c0-3.75 5.25-9 5.25-9Z',
    bloodPressure: 'M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733'
        + '-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12Z',
    insulin: 'm15.75 3.75 4.5 4.5M18.75 6.75 6.75 18.75l-3.75 1.5 1.5-3.75L16.5 4.5M9.75 12l1.5 1.5M12 9.75l1.5 1.5',
    meal: 'M6 3v6a2.25 2.25 0 0 0 2.25 2.25M6 3v18M9.75 3v6M8.25 11.25V21M17.25 3c-1.125 1.5-1.5 3-1.5 5.25 '
        + '0 1.5.75 2.25 1.5 2.25V21',
    bodyWeight: 'M4.5 6.75h15v12.75h-15V6.75Zm7.5 2.25-2.25 4.5h4.5L12 9Z',
    temperature: 'M12 3.75a2.25 2.25 0 0 1 2.25 2.25v7.06a4.5 4.5 0 1 1-4.5 0V6A2.25 2.25 0 0 1 12 3.75Z',
});

/**
 * Summarizes an already decrypted event into a timeline entry.
 *
 * It returns `null` for a type this module cannot describe —a future type, or an envelope whose
 * content does not have the expected shape—. The caller counts those cases and states them on
 * screen ({@see buildTimeline}).
 *
 * @param {{type?: string, occurredAt: string, data?: object}} event Flattened with
 *        `flattenDecryptedEvent`.
 * @returns {{type: string, typeLabel: string, summary: string, detail: string|null, occurredAt: string}|null}
 */
export function describeTimelineEvent(event) {
    const describe = TIMELINE_SUMMARIES[event?.type];

    if (describe === undefined) {
        return null;
    }

    const { summary, detail } = describe(event.data ?? {});

    return {
        type: event.type,
        /**
         * Composite key with the type token. It is only reached for the types in
         * `TIMELINE_SUMMARIES` (the others have already left through `null`), so the list of
         * `dashboard.timeline.type.*` keys that have to exist in every catalog is exactly the
         * one of that object.
         */
        typeLabel: typeLabel(event.type),
        summary,
        detail,
        occurredAt: event.occurredAt,
    };
}

/**
 * Day grouping key **in the device zone**, not in UTC.
 *
 * Grouping by the UTC date would split across two days a 23:30 dinner in Madrid in summer, which
 * is exactly the entry that has to be seen next to the glucose reading afterwards.
 *
 * @param {string} occurredAt
 * @returns {string} Local `YYYY-MM-DD`.
 */
export function localDayKey(occurredAt) {
    const date = new Date(occurredAt);
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');

    return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * Timeline entries: the events that arrive, mixed and from the most recent to the
 * oldest.
 *
 * It filters neither by window nor by type: the period is applied by the data source and the type
 * by the caller (`filterBySelectedTypes`), so exactly what has to be painted arrives here.
 *
 * `hidden` are the entries left out by the {@see TIMELINE_MAX_ENTRIES} cap and `unsupported`
 * those of a type this module cannot describe. Both counts reach the screen: neither exclusion
 * is silent.
 *
 * @param {list<object>} events Decrypted, flattened events, already filtered by period and type.
 * @returns {{entries: list<object>, hidden: number, unsupported: number}}
 */
export function buildTimeline(events) {
    const entries = [];
    let unsupported = 0;

    for (const event of events) {
        const entry = describeTimelineEvent(event);

        if (entry === null) {
            unsupported += 1;

            continue;
        }

        entries.push(entry);
    }

    entries.sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt));

    return {
        entries: entries.slice(0, TIMELINE_MAX_ENTRIES),
        hidden: Math.max(entries.length - TIMELINE_MAX_ENTRIES, 0),
        unsupported,
    };
}

/**
 * Groups already sorted entries into days, keeping the incoming order.
 *
 * @param {list<{occurredAt: string}>} entries Sorted from most recent to oldest.
 * @returns {list<{dayKey: string, occurredAt: string, entries: list<object>}>}
 */
export function groupEntriesByDay(entries) {
    /** @type {list<{dayKey: string, occurredAt: string, entries: list<object>}>} */
    const days = [];

    for (const entry of entries) {
        const dayKey = localDayKey(entry.occurredAt);
        const current = days[days.length - 1];

        if (current !== undefined && current.dayKey === dayKey) {
            current.entries.push(entry);

            continue;
        }

        days.push({ dayKey, occurredAt: entry.occurredAt, entries: [entry] });
    }

    return days;
}

/**
 * Icon of the type of an entry. It is decorative (`aria-hidden`): the type is written next to it,
 * and the screen reader already reads it there.
 *
 * @param {string} type
 * @returns {SVGSVGElement}
 */
function createTimelineIcon(type) {
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('viewBox', '0 0 24 24');
    icon.setAttribute('fill', 'none');
    icon.setAttribute('stroke', 'currentColor');
    icon.setAttribute('stroke-width', '1.5');
    icon.setAttribute('aria-hidden', 'true');
    icon.setAttribute('class', 'mt-0.5 size-5 shrink-0 text-ink-secondary');

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    path.setAttribute('d', TIMELINE_ICONS[type] ?? '');
    icon.appendChild(path);

    return icon;
}

/**
 * One entry: time, type icon, and the datum on one line.
 *
 * The time goes in IBM Plex Mono and with a fixed width so the column stays aligned between
 * entries: a day with six records is scanned down that column.
 *
 * @param {{type: string, typeLabel: string, summary: string, detail: string|null, occurredAt: string}} entry
 * @returns {HTMLLIElement}
 */
function createTimelineEntry(entry) {
    const row = document.createElement('li');
    /** The same row separator as the history of the per-type screens (`insulinPage.js`). */
    row.className = 'flex min-h-11 items-start gap-3 border-b border-border py-2 last:border-b-0';

    const time = document.createElement('span');
    time.className = 'w-14 shrink-0 pt-0.5 font-mono text-body-sm text-ink-secondary';
    time.textContent = formatTimeOfDay(entry.occurredAt);
    row.appendChild(time);

    row.appendChild(createTimelineIcon(entry.type));

    const line = document.createElement('p');
    line.className = 'text-body-sm text-ink';

    const label = document.createElement('span');
    label.className = 'font-semibold';
    label.textContent = entry.typeLabel;
    line.appendChild(label);

    /** The datum on the same line as the type: "Glucose 112 mg/dL" reads in one pass. */
    if (entry.summary !== '') {
        const summary = document.createElement('span');
        summary.className = 'ml-2 font-mono';
        summary.textContent = entry.summary;
        line.appendChild(summary);
    }

    /**
     * The context (method, site, insulin type, foods) in secondary ink: it accompanies the datum
     * without competing, but it is always there: a number without its method is misread (ADR 0008).
     */
    if (entry.detail !== null && entry.detail !== '') {
        const detail = document.createElement('span');
        detail.className = 'ml-2 text-ink-secondary';
        detail.textContent = `· ${entry.detail}`;
        line.appendChild(detail);
    }

    row.appendChild(line);

    return row;
}

/**
 * One day: the date as a heading and its entries below.
 *
 * @param {{occurredAt: string, entries: list<object>}} day
 * @returns {HTMLDivElement}
 */
function createTimelineDay(day) {
    const section = document.createElement('div');
    section.className = 'border-t border-border pt-3 first:border-t-0 first:pt-0';

    const heading = document.createElement('h3');
    heading.className = 'font-display text-body-sm font-semibold text-ink';
    heading.textContent = formatDayHeading(day.occurredAt);
    section.appendChild(heading);

    const list = document.createElement('ul');
    list.className = 'mt-1';

    for (const entry of day.entries) {
        list.appendChild(createTimelineEntry(entry));
    }

    section.appendChild(list);

    return section;
}

/**
 * Timeline section, grouped by day.
 *
 * `emptyStateUrl` is **optional and arrives as an argument**: in the patient panel it leads to
 * creating the first record (Filament decides the route and it travels in a `data-*`), and in the
 * professional's reader there is no screen to send anybody to, so without it only the sentence is painted.
 *
 * `emptyText` is just as optional and exists for a more serious reason: the default sentence —"no
 * records in this period yet"— asserts a clinical absence, and what empties the list may be the
 * search box. Saying "there are no records" when what there is is a filter in place is exactly the
 * reading this project cannot afford, so the calling screen says which of the two things is
 * happening.
 *
 * @param {list<object>} events Decrypted and flattened events, already filtered by period and type.
 * @param {{emptyStateUrl?: string|null, emptyText?: string}} [options]
 * @returns {DocumentFragment}
 */
export function renderTimelineSection(events, { emptyStateUrl = null, emptyText } = {}) {
    const fragment = document.createDocumentFragment();
    const { entries, hidden, unsupported } = buildTimeline(events);

    if (unsupported > 0) {
        const notice = createCallout('info', t('dashboard.timeline.unsupported', { count: unsupported }));
        notice.classList.add('mb-4');
        fragment.appendChild(notice);
    }

    if (entries.length === 0) {
        fragment.appendChild(renderEmptyState(emptyText ?? t('dashboard.empty'), emptyStateUrl, t('dashboard.addFirst')));

        return fragment;
    }

    if (hidden > 0) {
        const notice = createCallout('info', t('dashboard.timeline.capped', {
            count: hidden,
            shown: entries.length,
        }));
        notice.classList.add('mb-4');
        fragment.appendChild(notice);
    }

    const days = document.createElement('div');
    days.className = 'space-y-4';

    for (const day of groupEntriesByDay(entries)) {
        days.appendChild(createTimelineDay(day));
    }

    fragment.appendChild(days);

    return fragment;
}
