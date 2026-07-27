/**
 * Conversion of the `<input type="datetime-local">` of the event screens into the ADR 0004
 * canonical date and into the offset of the ADR 0006 `tz` field.
 *
 * **These two functions live together and in a single place because their result is not screen
 * text: it is AEAD associated data.** `occurredAt` goes into the authenticated data of the
 * envelope each event is encrypted with (ADR 0004 and ADR 0006), so one microsecond of difference,
 * a different rounding or a `tz` with another sign convention do not produce a visible error when
 * saving: they produce an envelope that can never be opened again. And only on the screen that
 * drifted, so the failure shows up months later and in one part of the history, not in all of it.
 *
 * This logic used to be copied character for character in the six event screens (glucose, blood
 * pressure, insulin, temperature, weight and meals). Copying it worked while the six copies stayed
 * identical; the problem is that nothing forced them to, and fixing a daylight saving edge case in
 * one of them alone is enough to leave the events of that screen encrypted with a date the others
 * do not reproduce. **If somebody pastes these functions back inside a screen, what breaks is not
 * the style: it is the ability to decrypt the history.** Every new event screen imports from
 * here.
 *
 * `formatTzOffset` stays next to `datetimeLocalToCanonical` instead of moving to a formatting
 * module because it shares the ADR 0006 sign convention with it, which is exactly what is easy to
 * invert when rewriting: splitting them would invite defining it twice.
 */

import { canonicalDate } from '../crypto/canonicalDate.js';
import { t } from '../i18n/index.js';

/**
 * Pattern of an `<input type="datetime-local" step="1">`: no offset, because it is device local
 * time (`YYYY-MM-DDTHH:MM` or `YYYY-MM-DDTHH:MM:SS`).
 */
const DATETIME_LOCAL_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

/**
 * Breaks the value of a `datetime-local` into its calendar fields, without interpreting it in any
 * time zone yet.
 *
 * It is not exported: outside this module nobody has any business handling the half-converted
 * date, and exposing it would be offering half the road to whoever then finishes the other half
 * their own way.
 * @param {string} value
 * @returns {{year: number, month: number, day: number, hour: number, minute: number, second: number}}
 * @throws {Error} If the value does not have the expected shape.
 */
function parseDatetimeLocalFields(value) {
    const match = DATETIME_LOCAL_PATTERN.exec(value);

    if (match === null) {
        throw new Error(t('common.badDatetime', { value }));
    }

    const [, year, month, day, hour, minute, second = '00'] = match;

    return {
        year: Number(year),
        month: Number(month),
        day: Number(day),
        hour: Number(hour),
        minute: Number(minute),
        second: Number(second),
    };
}

/**
 * Shapes an offset as `±HH:MM`, with the same sign convention as the ADR 0006 `tz` field
 * (positive when local time is ahead of UTC).
 *
 * @param {number} offsetMinutes Local minus UTC, in minutes.
 * @returns {string}
 */
export function formatTzOffset(offsetMinutes) {
    const sign = offsetMinutes < 0 ? '-' : '+';
    const absolute = Math.abs(offsetMinutes);
    const hours = String(Math.floor(absolute / 60)).padStart(2, '0');
    const minutes = String(absolute % 60).padStart(2, '0');

    return `${sign}${hours}:${minutes}`;
}

/**
 * Converts a `datetime-local` (local time with no offset) into the correct instant and into its
 * canonical form (ADR 0004), together with the offset for the ADR 0006 `tz` field.
 *
 * `Date.prototype.getTimezoneOffset()` gives the device offset in force **for that particular
 * calendar date**, so the daylight saving of the recorded date is honoured and not today's.
 *
 * @param {string} value Raw value of the `<input type="datetime-local">`.
 * @param {object} [options]
 * @param {number} [options.timezoneOffsetMinutes] Offset to use instead of the `Date` one
 *        (`getTimezoneOffset` convention: UTC minus local), only so this function can be tested
 *        without depending on the time zone of whoever runs the tests.
 * @returns {{occurredAt: string, tz: string}}
 */
export function datetimeLocalToCanonical(value, { timezoneOffsetMinutes } = {}) {
    const fields = parseDatetimeLocalFields(value);

    const offsetMinutes = timezoneOffsetMinutes
        ?? new Date(fields.year, fields.month - 1, fields.day, fields.hour, fields.minute, fields.second)
            .getTimezoneOffset();

    const utcMilliseconds = Date.UTC(
        fields.year,
        fields.month - 1,
        fields.day,
        fields.hour,
        fields.minute,
        fields.second
    ) + offsetMinutes * 60_000;

    return {
        occurredAt: canonicalDate(new Date(utcMilliseconds)),
        tz: formatTzOffset(-offsetMinutes),
    };
}
