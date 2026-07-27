<?php

declare(strict_types=1);

namespace App\Catalog;

use App\Support\SupportedLocale;
use ValueError;

/**
 * Posture a blood pressure reading was taken in.
 *
 * Together with {@see BloodPressureArm} it forms the measurement method ADR 0008
 * (docs/adr/0008-measurement-method.md) requires: posture changes the value as much as the arm does
 * —someone's blood pressure lying down is not the same as standing up, a key difference for
 * spotting orthostatic hypotension— and it is only known at the moment of measuring. The value of
 * each case is the stable token that goes into the encrypted envelope, so, like
 * {@see BloodPressureArm}, it **can never change** once published.
 *
 * Adding a new case is safe; renaming or removing an existing one is not.
 */
enum BloodPressurePosture: string implements PatientLabelled
{
    /** Sentado. */
    case Sitting = 'sitting';

    /** Tumbado. */
    case Lying = 'lying';

    /** Standing up. */
    case Standing = 'standing';

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
            [self::Sitting, 'es'] => 'Sentado',
            [self::Lying, 'es'] => 'Tumbado',
            [self::Standing, 'es'] => 'De pie',
            [self::Sitting, 'en'] => 'Sitting',
            [self::Lying, 'en'] => 'Lying down',
            [self::Standing, 'en'] => 'Standing',
            [self::Sitting, 'zh_CN'] => '坐位',
            [self::Lying, 'zh_CN'] => '卧位',
            [self::Standing, 'zh_CN'] => '立位',
            default => throw new ValueError(sprintf('Missing posture label for locale "%s".', $locale)),
        };
    }
}
