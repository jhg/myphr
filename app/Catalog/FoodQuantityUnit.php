<?php

declare(strict_types=1);

namespace App\Catalog;

use App\Support\SupportedLocale;
use ValueError;

/**
 * Closed list of units for the amount of a food inside a meal (ADR 0006).
 *
 * A literal decision by the user: grams, milligrams, kilos, centilitres, litres, millilitres and
 * pieces, and nothing else. The foods themselves are NOT coded against any vocabulary (a deliberate
 * exception to ADR 0005, justified in the ADR that covers the meals screen), but the unit is coded
 * in UCUM (http://unitsofmeasure.org), exactly as ADR 0005 requires, to avoid an impossible
 * conversion later on.
 *
 * Codes verified one by one against the UCUM specification (common units table
 * https://ucum.org/docs/common-units and the HL7 listing at
 * https://terminology.hl7.org/5.5.0/ValueSet-ucum-common.html, both in the case-sensitive form from
 * the spec):
 * - Gram: `g`.
 * - Milligram: `mg` (prefix `m` = milli).
 * - Kilogram: `kg` (prefix `k` = kilo).
 * - Centilitre: `cL` (prefix `c` = centi on top of `L`, not `cl`: the uppercase form is the one UCUM
 *   documents as the case-sensitive alternative to avoid confusing a lowercase `l` with the digit 1,
 *   and it is the one HL7/FHIR use in their common unit tables).
 * - Litre: `L` (not `l`, same reason).
 * - Millilitre: `mL` (not `ml`, same reason).
 * - Pieces (item count): UCUM has no symbol of its own for "one piece"; a dimensionless amount is
 *   the unit `1`, and UCUM lets you annotate it in braces so the code stays readable without
 *   changing its meaning (`{annotation}` is syntactic sugar over `1`). We pick `{each}` instead of a
 *   bare `1` because a UCUM code with no annotation ("1") says nothing on its own in a list of
 *   units, and `{each}` is the annotation HL7/FHIR examples already use for "one piece, one item"
 *   when there is no more specific counting unit (tablets, capsules, and so on). It is documented
 *   here so it can be reviewed.
 *
 * The value of each case is that UCUM code verbatim, not a readable approximation. It is a token
 * that travels inside the encrypted envelope (ADR 0004, ADR 0006), so, like
 * {@see GlucoseMeasurementMethod}, it **can never change** once published: renaming or removing a
 * case would leave the stored envelopes unreadable, because there is no way to walk them and
 * re-encrypt them with the new token without each user's key.
 *
 * Adding a new case is safe; renaming or removing an existing one is not.
 */
enum FoodQuantityUnit: string
{
    /** Gramos. */
    case Gram = 'g';

    /** Miligramos. */
    case Milligram = 'mg';

    /** Kilogramos. */
    case Kilogram = 'kg';

    /** Centilitros. */
    case Centiliter = 'cL';

    /** Litros. */
    case Liter = 'L';

    /** Mililitros. */
    case Milliliter = 'mL';

    /** Loose pieces, with no more specific counting unit. */
    case Piece = '{each}';

    /**
     * Label in the given language, to show to the patient (ADR 0005: the label does not replace the
     * token, which is the only thing that goes into the encrypted envelope).
     *
     * @param  string  $locale  Any code; unsupported ones fall back to the default language.
     */
    public function label(string $locale): string
    {
        $locale = SupportedLocale::resolve($locale);

        return match ([$this, $locale]) {
            [self::Gram, 'es'] => 'Gramos',
            [self::Milligram, 'es'] => 'Miligramos',
            [self::Kilogram, 'es'] => 'Kilogramos',
            [self::Centiliter, 'es'] => 'Centilitros',
            [self::Liter, 'es'] => 'Litros',
            [self::Milliliter, 'es'] => 'Mililitros',
            [self::Piece, 'es'] => 'Unidades',
            [self::Gram, 'en'] => 'Grams',
            [self::Milligram, 'en'] => 'Milligrams',
            [self::Kilogram, 'en'] => 'Kilograms',
            [self::Centiliter, 'en'] => 'Centiliters',
            [self::Liter, 'en'] => 'Liters',
            [self::Milliliter, 'en'] => 'Milliliters',
            [self::Piece, 'en'] => 'Units',
            [self::Gram, 'zh_CN'] => '克',
            [self::Milligram, 'zh_CN'] => '毫克',
            [self::Kilogram, 'zh_CN'] => '千克',
            [self::Centiliter, 'zh_CN'] => '厘升',
            [self::Liter, 'zh_CN'] => '升',
            [self::Milliliter, 'zh_CN'] => '毫升',
            [self::Piece, 'zh_CN'] => '个',
            default => throw new ValueError(sprintf('Missing food quantity unit label for locale "%s".', $locale)),
        };
    }
}
