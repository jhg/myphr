/**
 * Body mass index and known height (ADR 0004, ADR 0005, ADR 0006).
 *
 * Pure logic, shared by the weight and height screen (`health/bodyWeightPage.js`) and by the
 * read-only block of the profile (`auth/profilePage.js`). It is **always computed in the browser**:
 * the server sees neither the weight nor the height, so it cannot derive any figure from them
 * either (ADR 0004, ADR 0006).
 *
 * **CLINICAL CARE — BMI is a ratio, not a diagnosis.** This module returns a number and nothing
 * else: no category ("underweight", "overweight"...), no colour, no comparison. That is deliberate
 * and not a simplification waiting to be finished:
 *
 * * In children and adolescents BMI is not read as an absolute figure, but against percentiles by
 *   age and sex. This application stores neither age nor sex, so it cannot make that reading, and
 *   painting "overweight" over a child using the adult criterion is simply wrong.
 * * Even in adults, the same figure means different things depending on muscle mass, pregnancy,
 *   oedema or age. A threshold painted red reads as a medical judgement, and there is no doctor
 *   looking here.
 *
 * Whoever reads the figure knows what to do with it, or takes it to their appointment. The
 * interface only has to say which weight and which height it comes from.
 *
 * **About converting units.** The rest of the project does not convert between kilograms and
 * pounds: the chart draws one series per unit and the history stores the unit each record was
 * written in (ADR 0006). Here it does convert, and that does not contradict the above: BMI is a
 * **derived and ephemeral** figure, computed to be shown and never stored, never encrypted and
 * never compared with anything; and the factors are exact by definition (1 lb = 0.45359237 kg;
 * 1 in = 0.0254 m), so there is no precision to invent. What ADR 0006 avoids is rewriting a stored
 * datum, and that does not happen here.
 */

/**
 * Readable label of each weight and height unit.
 *
 * The weight screen takes these labels from the catalog the server publishes (ADR 0005), which is
 * the right thing there because Blade renders the `<select>`. The profile has no such catalog —it
 * records nothing, it only shows— and showing `[lb_av]` or `[in_i]` would be asking the person to
 * read interchange notation. The four pairs are public and fixed, so repeating them here creates
 * no new truth that could fall out of sync with the one in the envelope: what is stored is still
 * always the code.
 */
const UNIT_LABELS = Object.freeze({
    kg: 'kg',
    '[lb_av]': 'lb',
    cm: 'cm',
    '[in_i]': 'in',
});

/**
 * @param {string} code UCUM code.
 * @returns {string} The label, or the code itself if unknown: ugly but true.
 */
export function measurementUnitLabel(code) {
    return UNIT_LABELS[code] ?? code;
}

/** Exact by international definition (the same avoirdupois pound as `UcumUnit::Pound`). */
const KILOGRAMS_PER_POUND = 0.45359237;

/** Exact by definition (international inch, `[in_i]`). */
const METERS_PER_INCH = 0.0254;

/**
 * Turns a weight into kilograms, which is the numerator of the formula.
 *
 * It returns `null` —and not zero and not `NaN`— for anything that is not a usable weight: unknown
 * unit, non-numeric value or zero. A zero would be a false weight, and the caller has to be able
 * to tell "cannot be computed" from "is worth zero".
 *
 * @param {string|number} value Exactly as it travels in the envelope (string, ADR 0004).
 * @param {string} unit UCUM code.
 * @returns {number|null}
 */
export function weightInKilograms(value, unit) {
    const number = Number(value);

    if (!Number.isFinite(number) || number <= 0) {
        return null;
    }

    if (unit === 'kg') {
        return number;
    }

    if (unit === '[lb_av]') {
        return number * KILOGRAMS_PER_POUND;
    }

    return null;
}

/**
 * Turns a height into metres. Same criterion as {@see weightInKilograms} for what cannot be used:
 * `null`, never zero (which would also blow up the division).
 *
 * @param {string|number} value
 * @param {string} unit UCUM code.
 * @returns {number|null}
 */
export function heightInMeters(value, unit) {
    const number = Number(value);

    if (!Number.isFinite(number) || number <= 0) {
        return null;
    }

    if (unit === 'cm') {
        return number / 100;
    }

    if (unit === '[in_i]') {
        return number * METERS_PER_INCH;
    }

    return null;
}

/**
 * Body mass index: kilograms divided by metres squared.
 *
 * **With no height there is no BMI and `null` is returned.** No zero, no dash, no invented average
 * height: a false figure in a clinical history cannot be told apart from a good one afterwards.
 *
 * It is rounded to one decimal because that is the precision it is published with anywhere
 * serious; two decimals would fake an accuracy neither the scale nor the tape measure has.
 *
 * @param {object} params
 * @param {{value: string|number, unit: string}} params.weight
 * @param {{value: string|number, unit: string}|null|undefined} params.height
 * @returns {number|null} `null` when either is missing or one of them is unusable.
 */
export function bodyMassIndex({ weight, height }) {
    if (weight === null || weight === undefined || height === null || height === undefined) {
        return null;
    }

    const kilograms = weightInKilograms(weight.value, weight.unit);
    const meters = heightInMeters(height.value, height.unit);

    if (kilograms === null || meters === null) {
        return null;
    }

    return Math.round((kilograms / (meters * meters)) * 10) / 10;
}

/**
 * The known height at a given instant: the one of the most recent record that is **not later**
 * than that instant.
 *
 * The "not later" is the part that matters. With a person who is growing, taking a height measured
 * afterwards would divide a weight from a year ago by today's height, and the resulting BMI would
 * be lower than it was. It is the same reason height is stored as a dated event and not as a
 * profile field. A record that brings its own height uses it and does not call here; an exact date
 * tie is included (`<=`), which is the normal case of weight and height in the same envelope.
 *
 * @param {list<{occurredAt: string, content: object}>} events Weight events already decrypted, in
 *        any order.
 * @param {string|null} occurredAt Canonical date of the record height is sought for; `null` means
 *        "no upper bound", which is what the profile asks for: there the question is "how tall are
 *        you", not "how tall were you when you weighed yourself".
 * @returns {{value: string, unit: string, occurredAt: string}|null}
 */
export function heightKnownAt(events, occurredAt) {
    const limit = occurredAt === null ? Infinity : Date.parse(occurredAt);

    if (Number.isNaN(limit)) {
        return null;
    }

    let best = null;
    let bestTime = -Infinity;

    for (const event of events) {
        const height = event.content?.data?.height;

        if (height === undefined || height === null) {
            continue;
        }

        const time = Date.parse(event.occurredAt);

        if (Number.isNaN(time) || time > limit || time < bestTime) {
            continue;
        }

        best = { ...height, occurredAt: event.occurredAt };
        bestTime = time;
    }

    return best;
}
