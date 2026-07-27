<?php

declare(strict_types=1);

namespace App\Catalog;

/**
 * LOINC codes for the three components of a blood pressure reading.
 *
 * Unlike blood glucose ({@see GlucoseLoincCode}), here the code does not depend on the method: ADR
 * 0008 (docs/adr/0008-measurement-method.md) is explicit that "the LOINC codes we use for this
 * quantity... name the quantity and nothing else", so the arm and the posture travel in their own
 * fields ({@see BloodPressureArm}, {@see BloodPressurePosture}) and the LOINC code is always the
 * same for each component. That is why this catalog needs no resolver like
 * {@see GlucoseLoincCode::resolve()}: every case is already the final code.
 *
 * The three values are verified against LOINC (medical terminology tool, 2026-07-25) and must not be
 * modified: it is the same immutability warning as {@see GlucoseMeasurementMethod}, because the code
 * also goes into the content encrypted in the browser (ADR 0002, ADR 0004).
 *
 * A reading does not always carry all three: the pulse is optional because not every blood pressure
 * monitor reports it, so `Pulse` may be absent from `data.loinc` on a given event.
 */
enum BloodPressureLoincCode: string
{
    /** Systolic blood pressure. */
    case Systolic = '8480-6';

    /** Diastolic blood pressure. */
    case Diastolic = '8462-4';

    /** Frecuencia cardiaca (pulso). */
    case Pulse = '8867-4';

    /** Official LOINC term, in English, exactly as published by the Regenstrief Institute. */
    public function officialName(): string
    {
        return match ($this) {
            self::Systolic => 'Systolic blood pressure',
            self::Diastolic => 'Diastolic blood pressure',
            self::Pulse => 'Heart rate',
        };
    }
}
