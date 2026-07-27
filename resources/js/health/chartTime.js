/**
 * Format of the times on the axes of the charts that place each reading in time.
 *
 * **Why a formatter in the browser zone is no good.** The charts that place readings on a time axis
 * —every one of them: the curve with meal and insulin markers, the 24-hour overlay and the five
 * screens by type— do not work with absolute instants: they work with the **wall clock time of
 * whoever recorded** the event, which `eventWallClockMs()` encodes as if it were UTC (see
 * `dailyBands.js`). Formatting that number with the browser zone would shift it a second time, and
 * the post-meal peak would show at a different time depending on where the application is opened.
 * Hence it is always formatted in UTC. That is also why `formatChartDate()` no longer exists in the
 * language module: it formatted in the browser zone.
 *
 * The language is the active one: the time is written the way it is written in that language (the
 * 12-hour clock in English, the 24-hour one in Spanish), which is a writing convention and not a clinical datum.
 */

import { intlLocale } from '../i18n/index.js';

/**
 * Wall clock time formatter, in the active language and **always in UTC**.
 *
 * One is built per draw and not one per label: `Intl.DateTimeFormat` is expensive and an axis may
 * ask for a hundred labels. It is not memoized at module level because the language changes
 * without reloading (the professional's reader has a selector, ADR 0011).
 *
 * @param {Intl.DateTimeFormatOptions} options
 * @returns {Intl.DateTimeFormat}
 */
export function wallClockFormat(options) {
    return new Intl.DateTimeFormat(intlLocale(), { ...options, timeZone: 'UTC' });
}
