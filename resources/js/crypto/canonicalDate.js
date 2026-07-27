/**
 * Canonical date form from ADR 0004: `YYYY-MM-DDTHH:MM:SS.ffffffZ`,
 * always UTC, `Z` suffix, **always six fraction digits**.
 *
 * JavaScript `Date` only has millisecond precision, so the three missing
 * digits are padded with zeros. When the source is a string with more than
 * three fraction digits (the server stores `occurred_at` with precision 6,
 * ADR 0006), they are kept as they are: they are read from the string
 * itself instead of going through `Date`, which would lose them.
 *
 * Plain ISO 8601 is not enough: it allows variants that are different bytes,
 * and these bytes go into the AEAD associated data and into the key
 * derivation, where one byte of difference is a failed decryption.
 */

/**
 * `YYYY-MM-DD`, then `T` or a space, `HH:MM:SS`, an optional fraction, and a
 * mandatory offset (`Z` or `±HH:MM`).
 */
const ISO_LIKE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|z|[+-]\d{2}:?\d{2})$/;

/** Canonicalization error, told apart from the crypto ones. */
export class CanonicalDateError extends Error {
    /** @param {string} message */
    constructor(message) {
        super(message);
        this.name = 'CanonicalDateError';
    }
}

/**
 * @param {number} value
 * @param {number} width
 * @returns {string}
 */
function pad(value, width) {
    return String(value).padStart(width, '0');
}

/**
 * @param {Date} date Valid instant.
 * @param {string} microseconds Exactly six digits.
 * @returns {string}
 */
function format(date, microseconds) {
    return `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1, 2)}-${pad(date.getUTCDate(), 2)}`
        + `T${pad(date.getUTCHours(), 2)}:${pad(date.getUTCMinutes(), 2)}:${pad(date.getUTCSeconds(), 2)}`
        + `.${microseconds}Z`;
}

/**
 * Returns the canonical form of an instant.
 *
 * @param {Date|number|string} value `Date`, epoch in milliseconds, or ISO 8601
 *        string with an explicit offset. A string without offset is rejected:
 *        guessing the local zone would give different bytes on each device.
 * @returns {string} `YYYY-MM-DDTHH:MM:SS.ffffffZ`.
 * @throws {CanonicalDateError} If the value is not a valid instant or the
 *         string carries no offset.
 */
export function canonicalDate(value) {
    if (value instanceof Date) {
        if (Number.isNaN(value.getTime())) {
            throw new CanonicalDateError('canonicalDate received an invalid Date.');
        }

        return format(value, pad(value.getUTCMilliseconds(), 3) + '000');
    }

    if (typeof value === 'number') {
        if (!Number.isFinite(value)) {
            throw new CanonicalDateError('canonicalDate received a non-finite timestamp.');
        }

        return canonicalDate(new Date(value));
    }

    if (typeof value !== 'string') {
        throw new CanonicalDateError('canonicalDate expects a Date, an epoch in milliseconds or a string.');
    }

    const match = ISO_LIKE.exec(value);

    if (match === null) {
        throw new CanonicalDateError(
            `canonicalDate cannot parse "${value}": expected YYYY-MM-DDTHH:MM:SS[.fff...] with Z or ±HH:MM.`
        );
    }

    const [, year, month, day, hour, minute, second, fraction = '', offset] = match;

    const normalizedOffset = offset.toUpperCase() === 'Z'
        ? 'Z'
        : offset.replace(/^([+-]\d{2})(\d{2})$/, '$1:$2');

    assertCalendarComponents(value, Number(year), Number(month), Number(day), Number(hour), Number(minute), Number(second));

    const parsed = new Date(
        `${year}-${month}-${day}T${hour}:${minute}:${second}${normalizedOffset === 'Z' ? 'Z' : normalizedOffset}`
    );

    if (Number.isNaN(parsed.getTime())) {
        throw new CanonicalDateError(`canonicalDate cannot parse "${value}": not a valid instant.`);
    }

    // Truncated to six digits, never rounded: rounding would move the
    // instant, and with it the associated data.
    const microseconds = fraction.slice(0, 6).padEnd(6, '0');

    return format(parsed, microseconds);
}

/**
 * Rejects impossible calendar components. `Date` overflows them silently
 * (`2026-02-30` becomes `2026-03-02`), and accepting that overflow would
 * mean two different strings produce the same canonical form, and therefore
 * the same key.
 *
 * @param {string} value
 * @param {number} year
 * @param {number} month
 * @param {number} day
 * @param {number} hour
 * @param {number} minute
 * @param {number} second
 * @returns {void}
 */
function assertCalendarComponents(value, year, month, day, hour, minute, second) {
    const daysInMonth = [
        31,
        (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28,
        31, 30, 31, 30, 31, 31, 30, 31, 30, 31,
    ];

    const valid = month >= 1 && month <= 12
        && day >= 1 && day <= daysInMonth[month - 1]
        && hour <= 23 && minute <= 59 && second <= 59;

    if (!valid) {
        throw new CanonicalDateError(`canonicalDate cannot parse "${value}": impossible calendar components.`);
    }
}

/**
 * Same canonical form, as UTF-8 bytes, which is how it enters the AEAD
 * associated data and the `info` of the derivation.
 *
 * @param {Date|number|string} value
 * @returns {Uint8Array}
 */
export function canonicalDateBytes(value) {
    return new TextEncoder().encode(canonicalDate(value));
}
