<?php

declare(strict_types=1);

namespace App\Catalog;

/**
 * Clinical catalog units, identified by their UCUM code (http://unitsofmeasure.org).
 *
 * ADR 0005 (docs/adr/0005-clinical-vocabulary-loinc-snomed.md) requires storing the unit as a UCUM
 * code and not as free text: that is what FHIR requires and it avoids an impossible conversion later
 * on, since fixing it would mean re-encrypting every envelope of every user in the browser. The
 * value of each case is that UCUM code exactly as the standard defines it (case and symbol
 * sensitive), not a readable approximation.
 *
 * `Gram` is included as an example from the ADR (a weight unit) and takes no part today in resolving
 * any blood glucose code; it exists to record that the unit catalog is shared across quantities and
 * not exclusive to blood glucose.
 *
 * The body weight, height and temperature codes are the ones UCUM defines, brackets included
 * (`[lb_av]`, `[in_i]`, `[degF]`): in UCUM those brackets mark "customary" —non metric— units and
 * are part of the code, not decoration of our own notation. Writing `lb` or `degF` would be a
 * different code and, since the code travels inside the encrypted envelope, there would be no way to
 * fix it afterwards without each user's key.
 */
enum UcumUnit: string
{
    /** Milligrams per decilitre. */
    case MilligramsPerDeciliter = 'mg/dL';

    /** Millimoles per litre. */
    case MillimolesPerLiter = 'mmol/L';

    /** Grams. Reserved for future quantities (weight, for instance); not used for blood glucose. */
    case Gram = 'g';

    /** Kilograms: the metric unit of body weight. */
    case Kilogram = 'kg';

    /** Avoirdupois pounds, the pound in everyday use (1 lb = 0.45359237 kg exactly). */
    case Pound = '[lb_av]';

    /** Centimetres: the metric unit of body height. */
    case Centimeter = 'cm';

    /**
     * International inch (1 `[in_i]` = 0.0254 m exactly).
     *
     * The `_i` suffix is not decoration of ours: UCUM distinguishes the international inch from
     * `[in_us]` (the US survey inch), which is a different unit. Writing a bare `in` would be a code
     * UCUM does not define, and since it travels inside the encrypted envelope there would be no way
     * to fix it.
     */
    case Inch = '[in_i]';

    /** Grados Celsius. */
    case DegreeCelsius = 'Cel';

    /** Grados Fahrenheit. */
    case DegreeFahrenheit = '[degF]';
}
