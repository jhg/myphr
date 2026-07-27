/**
 * Readable labels of the catalog tokens and format of the clinical figures (ADR 0005, ADR 0008).
 *
 * **Why it is here and not in each screen.** These labels are knowingly duplicated with respect to
 * `app/Catalog/*`: neither the home dashboard nor the professional's reader receives the server
 * catalog —the reader has no server to ask, and the dashboard paints cards the server does not
 * know about—, so they translate the tokens on their own. What there cannot be is one copy per
 * screen: "Capillary" and "Left, sitting" have to say exactly the same thing in the patient
 * summary and in the report the doctor reads, or the two are looking at data that seems
 * different.
 *
 * A token this module does not know **never breaks the screen and is never swallowed**: it is
 * humanized and shown as it came in the envelope, which is true information even if untranslated.
 *
 * Pure module: no Livewire, no `$wire`, no DOM.
 */

import { formatNumber as formatLocalizedNumber, t } from '../i18n/index.js';

/**
 * Catalog keys of the glucose methods (`App\Catalog\GlucoseMeasurementMethod`, ADR 0008).
 * The token list is the server's and cannot change: they are the ones travelling inside the envelope.
 */
const GLUCOSE_METHOD_KEYS = Object.freeze({
    capillary: 'dashboard.method.capillary',
    interstitial: 'dashboard.method.interstitial',
});

/** Blood pressure arm keys (`App\Catalog\BloodPressureArm`, ADR 0008). */
const BLOOD_PRESSURE_ARM_KEYS = Object.freeze({
    left: 'dashboard.arm.left',
    right: 'dashboard.arm.right',
});

/** Blood pressure posture keys (`App\Catalog\BloodPressurePosture`, ADR 0008). */
const BLOOD_PRESSURE_POSTURE_KEYS = Object.freeze({
    sitting: 'dashboard.posture.sitting',
    lying: 'dashboard.posture.lying',
    standing: 'dashboard.posture.standing',
});

/** Insulin type keys (`App\Catalog\InsulinType`). */
export const INSULIN_TYPE_KEYS = Object.freeze({
    rapid: 'dashboard.timeline.insulinType.rapid',
    long: 'dashboard.timeline.insulinType.long',
    mixed: 'dashboard.timeline.insulinType.mixed',
});

/** Meal type keys (`App\Catalog\MealType`). */
export const MEAL_TYPE_KEYS = Object.freeze({
    breakfast: 'dashboard.timeline.mealType.breakfast',
    lunch: 'dashboard.timeline.mealType.lunch',
    dinner: 'dashboard.timeline.mealType.dinner',
    snack: 'dashboard.timeline.mealType.snack',
});

/** Temperature measurement site keys (`App\Catalog\TemperatureMeasurementSite`). */
export const TEMPERATURE_SITE_KEYS = Object.freeze({
    axillary: 'dashboard.timeline.site.axillary',
    oral: 'dashboard.timeline.site.oral',
    tympanic: 'dashboard.timeline.site.tympanic',
    temporal: 'dashboard.timeline.site.temporal',
    rectal: 'dashboard.timeline.site.rectal',
});

/**
 * Last resort for a catalog token this module cannot translate: every word separated by `_` is
 * capitalized. It never returns an empty string and never invents a clinical label.
 *
 * @param {string} token
 * @returns {string}
 */
export function humanizeToken(token) {
    if (typeof token !== 'string') {
        return '';
    }

    return token
        .split('_')
        .filter((word) => word !== '')
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
}

/**
 * Label of a catalog token, with the generic humanizing as fallback.
 *
 * @param {Record<string, string>} keys
 * @param {unknown} token
 * @returns {string}
 */
export function catalogLabel(keys, token) {
    if (typeof token !== 'string' || token === '') {
        return '';
    }

    return keys[token] !== undefined ? t(keys[token]) : humanizeToken(token);
}

/**
 * Readable label of a method token (ADR 0008): glucose (`capillary`, `interstitial`) or blood
 * pressure (`${arm}_${posture}`, e.g. `left_sitting`).
 *
 * A token it does not recognize (a future quantity or combination) breaks nothing: it is
 * humanized, so the screen keeps saying what it includes even without a clinically precise translation.
 *
 * @param {string} token
 * @returns {string}
 */
export function formatMethodLabel(token) {
    if (GLUCOSE_METHOD_KEYS[token] !== undefined) {
        return t(GLUCOSE_METHOD_KEYS[token]);
    }

    const [arm, posture] = token.split('_');

    if (BLOOD_PRESSURE_ARM_KEYS[arm] !== undefined && BLOOD_PRESSURE_POSTURE_KEYS[posture] !== undefined) {
        return t('dashboard.method.combined', {
            arm: t(BLOOD_PRESSURE_ARM_KEYS[arm]),
            posture: t(BLOOD_PRESSURE_POSTURE_KEYS[posture]),
        });
    }

    return humanizeToken(token);
}

/**
 * Name of the event type, the label heading its card and its timeline.
 *
 * @param {string} type
 * @returns {string}
 */
export function typeLabel(type) {
    return t(`dashboard.timeline.type.${type}`);
}

/**
 * Formats a value already computed by `statistics.js` as a localized number. The values arriving
 * here are always JavaScript numbers (mean, median, minimum, maximum, percentage), never the ADR
 * 0004 at-rest string: see the JSDoc of `statistics.js` about display precision.
 *
 * @param {number} value
 * @returns {string}
 */
export function formatNumber(value) {
    return formatLocalizedNumber(value);
}

/**
 * Localized format of a clinical value at rest (ADR 0004: always a string, with the dot as decimal
 * separator).
 *
 * If the string does not represent a finite number it is returned **as is**, untouched: it is the
 * datum the person saved, and replacing it with a dash or with `NaN` would be hiding or inventing.
 *
 * @param {unknown} raw
 * @returns {string}
 */
export function formatMeasuredValue(raw) {
    if (typeof raw !== 'string' || raw.trim() === '') {
        return '';
    }

    const value = Number(raw);

    return Number.isFinite(value) ? formatNumber(value) : raw;
}
