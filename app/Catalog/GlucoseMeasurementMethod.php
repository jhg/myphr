<?php

declare(strict_types=1);

namespace App\Catalog;

use App\Support\SupportedLocale;
use ValueError;

/**
 * Method a blood glucose measurement was obtained with.
 *
 * ADR 0008 (docs/adr/0008-measurement-method.md) requires the method to travel as an explicit token
 * inside the measurement event itself, and not to be inferred from the LOINC code or from whether
 * the value came from a person or a device. The value of each case is that token: it is serialized
 * inside the payload encrypted in the browser (ADR 0002 and ADR 0006), so it **can never change**
 * once published. Changing it would leave the already stored encrypted envelopes unreadable, because
 * there is no way to walk them and re-encrypt them with the new token without each user's key.
 *
 * Adding a new case is safe; renaming or removing an existing one is not.
 */
enum GlucoseMeasurementMethod: string implements PatientLabelled
{
    /** Capillary blood measured with a glucose meter, after a finger prick. */
    case Capillary = 'capillary';

    /** Interstitial fluid measured with a continuous sensor (CGM/FGM). */
    case Interstitial = 'interstitial';

    /**
     * Label in the given language, to show to the patient (ADR 0005: the label does not replace the
     * token, which is the only thing that goes into the encrypted envelope).
     *
     * Each label also names the device in brackets because "capillary" and "interstitial" mean
     * nothing to someone who only knows whether they pricked a finger or wear a sensor.
     *
     * @param  string  $locale  Any code; unsupported ones fall back to the default language.
     */
    public function label(string $locale): string
    {
        $locale = SupportedLocale::resolve($locale);

        return match ([$this, $locale]) {
            [self::Capillary, 'es'] => 'Capilar (punción digital)',
            [self::Interstitial, 'es'] => 'Intersticial (sensor continuo)',
            [self::Capillary, 'en'] => 'Capillary (finger prick)',
            [self::Interstitial, 'en'] => 'Interstitial (continuous sensor)',
            [self::Capillary, 'zh_CN'] => '毛细血管血（指尖采血）',
            [self::Interstitial, 'zh_CN'] => '组织液（连续监测传感器）',
            default => throw new ValueError(sprintf('Missing measurement method label for locale "%s".', $locale)),
        };
    }
}
