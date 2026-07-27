<?php

declare(strict_types=1);

namespace App\Catalog;

use App\Support\SupportedLocale;
use ValueError;

/**
 * Insulin injection site (ADR 0006, "for insulin, the specific product as free text ..., plus the
 * injection site").
 *
 * Specific to insulin, not common to every event: it lives inside `data`, next to `insulinType`,
 * `dose`, `unit` and `product`. It is optional, with the same criterion as {@see MealContext}: if
 * the person does not state it, the field is left out of the encrypted content instead of being
 * stored with a silent default, because a made-up site is worse than none.
 *
 * The value of each case is the stable token that goes into the encrypted envelope (ADR 0004:
 * "stable tokens, never visible labels"), so, like {@see GlucoseMeasurementMethod}, it **can never
 * change** once published. Changing it would leave the already stored encrypted envelopes
 * unreadable, because there is no way to walk them and re-encrypt them with the new token without
 * each user's key.
 *
 * Adding a new case is safe; renaming or removing an existing one is not.
 */
enum InjectionSite: string implements PatientLabelled
{
    /** Abdomen. */
    case Abdomen = 'abdomen';

    /** Muslo. */
    case Thigh = 'thigh';

    /** Buttock. */
    case Glute = 'glute';

    /** Brazo. */
    case Arm = 'arm';

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
            [self::Abdomen, 'es'] => 'Abdomen',
            [self::Thigh, 'es'] => 'Muslo',
            [self::Glute, 'es'] => 'Glúteo',
            [self::Arm, 'es'] => 'Brazo',
            [self::Abdomen, 'en'] => 'Abdomen',
            [self::Thigh, 'en'] => 'Thigh',
            [self::Glute, 'en'] => 'Glute',
            [self::Arm, 'en'] => 'Arm',
            [self::Abdomen, 'zh_CN'] => '腹部',
            [self::Thigh, 'zh_CN'] => '大腿',
            [self::Glute, 'zh_CN'] => '臀部',
            [self::Arm, 'zh_CN'] => '手臂',
            default => throw new ValueError(sprintf('Missing injection site label for locale "%s".', $locale)),
        };
    }
}
