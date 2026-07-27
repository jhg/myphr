<?php

declare(strict_types=1);

namespace App\Catalog;

use App\Support\SupportedLocale;
use ValueError;

/**
 * Body site where the temperature was taken.
 *
 * It is the measurement method ADR 0008 (docs/adr/0008-measurement-method.md) requires for this
 * quantity: the site changes the value in a known way —an axillary reading runs several tenths below
 * a rectal one for the same person at the same moment— and is only known at the moment of measuring,
 * so it is asked for and never inferred. Mixing sites in a single series without saying so would
 * produce a curve that means nothing, just like mixing arms in blood pressure.
 *
 * Unlike the arm and the posture in blood pressure, here the site **also determines the LOINC code**
 * ({@see TemperatureLoincCode}): LOINC publishes a different code per measurement site. The token of
 * this enum still travels separately in `data.site`, because the code is exchange vocabulary and the
 * token is what groups our own series.
 *
 * The value of each case is that token, which is serialized inside the payload encrypted in the
 * browser (ADR 0002, ADR 0006), so it **can never change** once published: there is no way to walk
 * the stored envelopes and re-encrypt them without each user's key. Adding a new case is safe;
 * renaming or removing an existing one is not.
 *
 * The order is the one from the template, and axillary goes first on purpose: it is the most common
 * way to take a temperature at home, and the dropdown offers no empty option (the site is
 * mandatory), so the first option is the one you confirm or change.
 */
enum TemperatureMeasurementSite: string implements PatientLabelled
{
    /** Axila. */
    case Axillary = 'axillary';

    /** Boca (sublingual). */
    case Oral = 'oral';

    /** Ear, on the tympanic membrane. */
    case Tympanic = 'tympanic';

    /** Forehead, over the temporal artery. */
    case TemporalArtery = 'temporal';

    /** Recto. */
    case Rectal = 'rectal';

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
            [self::Axillary, 'es'] => 'Axilar',
            [self::Oral, 'es'] => 'Oral',
            [self::Tympanic, 'es'] => 'Timpánica (oído)',
            [self::TemporalArtery, 'es'] => 'Frente (arteria temporal)',
            [self::Rectal, 'es'] => 'Rectal',
            [self::Axillary, 'en'] => 'Armpit',
            [self::Oral, 'en'] => 'Mouth',
            [self::Tympanic, 'en'] => 'Ear (eardrum)',
            [self::TemporalArtery, 'en'] => 'Forehead (temporal artery)',
            [self::Rectal, 'en'] => 'Rectal',
            [self::Axillary, 'zh_CN'] => '腋下',
            [self::Oral, 'zh_CN'] => '口腔',
            [self::Tympanic, 'zh_CN'] => '耳道（鼓膜）',
            [self::TemporalArtery, 'zh_CN'] => '额头（颞动脉）',
            [self::Rectal, 'zh_CN'] => '直肠',
            default => throw new ValueError(sprintf('Missing measurement site label for locale "%s".', $locale)),
        };
    }
}
