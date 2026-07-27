<?php

declare(strict_types=1);

namespace App\Catalog;

use App\Support\SupportedLocale;
use ValueError;

/**
 * Type of insulin injected: rapid, long acting or mixed (ADR 0006, MVP types section).
 *
 * The insulin event carries **no LOINC code**: it is not an observation of a quantity, it is the
 * record of a medication administration (ADR 0006, "insulin (type rapid|long|mixed, dose, and the
 * product code where applicable, because it is a medication administration and not an
 * observation)"). That is the difference with {@see GlucoseMeasurementMethod}: we do not look for a
 * lab code for (type, unit) because no such thing exists here.
 *
 * The value of each case is the stable token that goes into the encrypted envelope (ADR 0004:
 * "stable tokens, never visible labels"), so, like {@see GlucoseMeasurementMethod}, it **can never
 * change** once published. Changing it would leave the already stored encrypted envelopes
 * unreadable, because there is no way to walk them and re-encrypt them with the new token without
 * each user's key.
 *
 * Adding a new case is safe; renaming or removing an existing one is not.
 */
enum InsulinType: string implements PatientLabelled
{
    /** Rapid acting insulin. */
    case Rapid = 'rapid';

    /** Long acting (basal) insulin. */
    case Long = 'long';

    /** Mixed insulin (rapid and long acting combined in the same injection). */
    case Mixed = 'mixed';

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
            [self::Rapid, 'es'] => 'Rápida',
            [self::Long, 'es'] => 'Lenta',
            [self::Mixed, 'es'] => 'Mixta',
            [self::Rapid, 'en'] => 'Rapid-acting',
            [self::Long, 'en'] => 'Long-acting',
            [self::Mixed, 'en'] => 'Mixed',
            [self::Rapid, 'zh_CN'] => '速效',
            [self::Long, 'zh_CN'] => '长效',
            [self::Mixed, 'zh_CN'] => '预混',
            default => throw new ValueError(sprintf('Missing insulin type label for locale "%s".', $locale)),
        };
    }
}
