<?php

declare(strict_types=1);

namespace App\Catalog;

/**
 * LOINC code for body weight.
 *
 * Unlike blood glucose ({@see GlucoseLoincCode}), there is no resolution table here: LOINC names
 * measured body weight with a single code, without distinguishing the unit. The kilogram and the
 * pound are two ways of expressing the same quantity —the unit travels separately, as a UCUM code
 * ({@see UcumUnit}), exactly as ADR 0005 requires— and they do not change the observed concept, so
 * neither needs a code of its own.
 *
 * There is also no measurement method to record (ADR 0008): a scale gives the same weight without
 * the person weighing having to declare anything that changes the value in a known way, unlike the
 * arm and posture in blood pressure or the measurement site in temperature
 * ({@see TemperatureLoincCode}).
 *
 * The value is verified against LOINC and **must not be modified**: it goes into the content
 * encrypted in the browser (ADR 0002, ADR 0004), so changing it would leave the stored envelopes
 * saying one thing and the catalog another, with no way to reconcile them without each user's key.
 */
enum BodyWeightLoincCode: string
{
    /** Measured body weight (not stated, not estimated). */
    case Measured = '3141-9';

    /** Official LOINC term, in English, exactly as published by the Regenstrief Institute (ADR 0005). */
    public function officialName(): string
    {
        return match ($this) {
            self::Measured => 'Body weight Measured',
        };
    }
}
