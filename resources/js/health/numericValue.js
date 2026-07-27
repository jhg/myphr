/**
 * Pure, shared logic to validate and normalize clinical numeric fields (glucose, systolic,
 * diastolic, pulse, ...). Every screen with a measurement value uses this module instead of
 * repeating the validation five times.
 *
 * **Why it exists** (patient safety criterion): with an `<input type="text">` one can type both
 * `7,8` and `7.8`, and that decimal separator ambiguity is a reading and parsing error that, in a
 * clinical datum already encrypted, cannot be corrected afterwards.
 *
 * **The field pattern in Blade** is `type="number" min="0" step="any" inputmode="decimal"`: with
 * `step="1"` the browser would mark `7.5` as invalid (and half a unit is a real value), while
 * `step="any"` lets the arrows step by one and still accept decimals. That `step` does not impose
 * a decimal limit on its own, so the 2-decimal limit is imposed by this module, on the client,
 * with a clear message in the person's language, BEFORE sealing the envelope (ADR 0004).
 *
 * The value still travels as a **string** in the payload (ADR 0004, "decimals as a string"): these
 * functions never convert to `Number`, they only validate the shape and normalize the separator.
 */

import { t } from '../i18n/index.js';

/** At most 2 decimals, unsigned (negatives are validated apart, to give a message of their own). */
const NUMERIC_PATTERN = /^\d+(\.\d{1,2})?$/;

/**
 * Replaces a decimal comma with a dot. It touches nothing else: if `rawValue` brings several
 * commas or any other character, `parseNumericValue` is what rejects it afterwards.
 *
 * @param {string} rawValue
 * @returns {string}
 */
export function normalizeDecimalSeparator(rawValue) {
    return rawValue.replace(',', '.');
}

/**
 * Validates and normalizes a clinical numeric value typed by the person.
 *
 * An empty string is returned as is: whether each field is required is decided by the caller
 * (`buildGlucoseContent`, `buildBloodPressureContent`, ...), just as they do today with their own
 * "value is missing" messages. For any non-empty string it demands, in this order: (1) that it is
 * not negative, (2) that it has at most 2 decimals, (3) that, with the comma already normalized to
 * a dot, it is a recognizable number.
 *
 * @param {string} rawValue Exactly as the person typed it in the `<input type="number">`.
 * @param {string} fieldLabel Field name **already translated**, for the error message: the caller
 *        takes it from the catalog (`t('field.value')`, `t('field.systolic')`, ...). It goes as a
 *        `{field}` placeholder inside the sentence, not concatenated, because in Chinese the noun
 *        carries no article and the sentence is not assembled in the same order.
 * @returns {string} The normalized value (comma → dot), ready to enter the payload as a string
 *          (ADR 0004). Empty string if `rawValue` was empty or only spaces.
 * @throws {Error} With a message in the active language if it is not numeric, is negative, or has
 *         more than 2 decimals.
 */
export function parseNumericValue(rawValue, fieldLabel) {
    if (typeof rawValue !== 'string') {
        throw new Error(t('numeric.notANumber', { field: fieldLabel }));
    }

    const trimmed = rawValue.trim();

    if (trimmed === '') {
        return '';
    }

    if (trimmed.startsWith('-')) {
        throw new Error(t('numeric.negative', { field: fieldLabel }));
    }

    const normalized = normalizeDecimalSeparator(trimmed);

    if (/^\d+\.\d{3,}$/.test(normalized)) {
        throw new Error(t('numeric.tooManyDecimals', { field: fieldLabel }));
    }

    if (!NUMERIC_PATTERN.test(normalized)) {
        throw new Error(t('numeric.notANumberHint', { field: fieldLabel }));
    }

    return normalized;
}
