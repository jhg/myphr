<?php

declare(strict_types=1);

namespace App\Catalog;

use ValueError;

/**
 * Resolver from the measurement site to the body temperature LOINC code.
 *
 * ADR 0005 (docs/adr/0005-clinical-vocabulary-loinc-snomed.md) reminds us that a LOINC code does not
 * name the quantity alone. With temperature that is easy to see: LOINC publishes a different code
 * **per measurement site** —oral, axillary, tympanic…— on top of the generic "Body temperature"
 * (8310-5), which does not say where it was measured. That is why this quantity does need a
 * resolver, unlike blood pressure ({@see BloodPressureLoincCode}), where the method travels
 * separately and the code is constant.
 *
 * It resolves by site and not by unit: degrees Celsius and Fahrenheit are the same observation on a
 * different scale and share a code; the unit travels separately as a UCUM code ({@see UcumUnit}),
 * which is what ADR 0005 requires.
 *
 * The generic 8310-5 **is not used**: the screen requires picking a site (see
 * {@see TemperatureMeasurementSite}), so recording "temperature without saying where" would throw
 * away a fact we do have. A LOINC code less precise than the data allows is worse data.
 *
 * The five codes are verified against LOINC (medical terminology tool, 2026-07-27) and **must not be
 * modified**: they go into the content encrypted in the browser (ADR 0002, ADR 0004), where they can
 * no longer be fixed.
 */
enum TemperatureLoincCode: string
{
    /** Axilar. */
    case Axillary = '8328-7';

    /** Oral. */
    case Oral = '8331-1';

    /** Tympanic membrane. */
    case Tympanic = '8333-7';

    /** Arteria temporal (frente). */
    case TemporalArtery = '75539-7';

    /** Rectal. */
    case Rectal = '8332-9';

    /**
     * Resolves the temperature LOINC code for a measurement site.
     *
     * It fails loudly for a site with no code instead of falling back to the generic 8310-5: a
     * default code would turn an unreviewed new case into less precise clinical data, stored
     * encrypted and in silence.
     *
     * @throws ValueError if the site has no LOINC code assigned.
     */
    public static function resolve(TemperatureMeasurementSite $site): self
    {
        return match ($site) {
            TemperatureMeasurementSite::Axillary => self::Axillary,
            TemperatureMeasurementSite::Oral => self::Oral,
            TemperatureMeasurementSite::Tympanic => self::Tympanic,
            TemperatureMeasurementSite::TemporalArtery => self::TemporalArtery,
            TemperatureMeasurementSite::Rectal => self::Rectal,
            default => throw new ValueError(sprintf(
                'There is no temperature LOINC code for measurement site "%s".',
                $site->value,
            )),
        };
    }

    /** Official LOINC term, in English, exactly as published by the Regenstrief Institute (ADR 0005). */
    public function officialName(): string
    {
        return match ($this) {
            self::Axillary => 'Axillary temperature',
            self::Oral => 'Oral temperature',
            self::Tympanic => 'Tympanic membrane temperature',
            self::TemporalArtery => 'Body temperature - Temporal artery',
            self::Rectal => 'Rectal temperature',
        };
    }
}
