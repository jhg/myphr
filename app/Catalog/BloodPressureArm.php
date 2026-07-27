<?php

declare(strict_types=1);

namespace App\Catalog;

use App\Support\SupportedLocale;
use ValueError;

/**
 * Arm a blood pressure reading was taken on.
 *
 * ADR 0008 (docs/adr/0008-measurement-method.md) explains that for blood pressure "the method is
 * made up of the arm and the posture": both change the value in a known way and are only known at
 * the moment of measuring, so they travel as explicit tokens and are never inferred. The value of
 * each case is that token, which is serialized inside the payload encrypted in the browser (ADR
 * 0002 and ADR 0006), so it **can never change** once published. Changing it would leave the
 * already stored encrypted envelopes unreadable, because there is no way to walk them and
 * re-encrypt them with the new token without each user's key.
 *
 * Adding a new case is safe; renaming or removing an existing one is not.
 */
enum BloodPressureArm: string implements PatientLabelled
{
    /** Brazo izquierdo. */
    case Left = 'left';

    /** Brazo derecho. */
    case Right = 'right';

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
            [self::Left, 'es'] => 'Izquierdo',
            [self::Right, 'es'] => 'Derecho',
            [self::Left, 'en'] => 'Left',
            [self::Right, 'en'] => 'Right',
            [self::Left, 'zh_CN'] => '左臂',
            [self::Right, 'zh_CN'] => '右臂',
            default => throw new ValueError(sprintf('Missing arm label for locale "%s".', $locale)),
        };
    }
}
