<?php

declare(strict_types=1);

namespace App\Catalog;

use App\Support\SupportedLocale;
use ValueError;

/**
 * Resolver from the (method, unit) pair to the matching blood glucose LOINC code.
 *
 * ADR 0005 (docs/adr/0005-clinical-vocabulary-loinc-snomed.md) explains that a LOINC code does not
 * identify the quantity alone: it also includes the unit and, in measurements like blood glucose,
 * the method. That is why the same clinical concept for the patient may need more than one code
 * depending on how and with what it was measured. ADR 0008 (docs/adr/0008-measurement-method.md)
 * adds that this decision is taken with an explicit method and unit, never inferred ones.
 *
 * The four codes below are verified against LOINC and must not be modified. The interstitial fluid
 * code in mmol/L has six digits before the dash (`105272-9`); that is a valid LOINC format and any
 * future format validation must accept it.
 *
 * The patient label (`patientLabel()`) does not replace the official LOINC term (`officialName()`):
 * both live side by side, exactly as ADR 0005 requires. The label is ours, in the patient's
 * language; the official term is the one used in a consultation or when exporting.
 */
enum GlucoseLoincCode: string
{
    case CapillaryMilligramsPerDeciliter = '41653-7';

    case CapillaryMillimolesPerLiter = '14743-9';

    case InterstitialMilligramsPerDeciliter = '99504-3';

    case InterstitialMillimolesPerLiter = '105272-9';

    /**
     * Resolves the blood glucose LOINC code for a method and unit pair.
     *
     * The resolver is total over the supported combinations: for each one it always returns the same
     * code, and given an unsupported combination it fails loudly instead of returning a default
     * code, because a wrong LOINC code is a wrong clinical fact.
     *
     * @throws ValueError if the method and unit pair has no LOINC code assigned.
     */
    public static function resolve(GlucoseMeasurementMethod $method, UcumUnit $unit): self
    {
        return match ([$method, $unit]) {
            [GlucoseMeasurementMethod::Capillary, UcumUnit::MilligramsPerDeciliter] => self::CapillaryMilligramsPerDeciliter,
            [GlucoseMeasurementMethod::Capillary, UcumUnit::MillimolesPerLiter] => self::CapillaryMillimolesPerLiter,
            [GlucoseMeasurementMethod::Interstitial, UcumUnit::MilligramsPerDeciliter] => self::InterstitialMilligramsPerDeciliter,
            [GlucoseMeasurementMethod::Interstitial, UcumUnit::MillimolesPerLiter] => self::InterstitialMillimolesPerLiter,
            default => throw new ValueError(sprintf(
                'There is no blood glucose LOINC code for method "%s" in unit "%s".',
                $method->value,
                $unit->value,
            )),
        };
    }

    /** Official LOINC term, in English, exactly as published by the Regenstrief Institute. */
    public function officialName(): string
    {
        return match ($this) {
            self::CapillaryMilligramsPerDeciliter => 'Glucose [Mass/volume] in Capillary blood by Glucometer',
            self::CapillaryMillimolesPerLiter => 'Glucose [Moles/volume] in Capillary blood by Glucometer',
            self::InterstitialMilligramsPerDeciliter => 'Glucose [Mass/volume] in Interstitial fluid',
            self::InterstitialMillimolesPerLiter => 'Glucose [Moles/volume] in Interstitial fluid',
        };
    }

    /**
     * Our own label for the patient, in the given language. It does not replace `officialName()`.
     *
     * This is the only layer we can offer complete in all three languages: LOINC publishes no
     * official Simplified Chinese translation of these four terms, so `officialName()` stays in
     * English always and our own wording, which we do translate, goes here.
     *
     * @param  string  $locale  Any code; unsupported ones fall back to the default language.
     */
    public function patientLabel(string $locale): string
    {
        $locale = SupportedLocale::resolve($locale);

        return match ([$this, $locale]) {
            [self::CapillaryMilligramsPerDeciliter, 'es'],
            [self::CapillaryMillimolesPerLiter, 'es'] => 'Glucosa en sangre capilar',
            [self::InterstitialMilligramsPerDeciliter, 'es'],
            [self::InterstitialMillimolesPerLiter, 'es'] => 'Glucosa en líquido intersticial',
            [self::CapillaryMilligramsPerDeciliter, 'en'],
            [self::CapillaryMillimolesPerLiter, 'en'] => 'Blood glucose (capillary)',
            [self::InterstitialMilligramsPerDeciliter, 'en'],
            [self::InterstitialMillimolesPerLiter, 'en'] => 'Interstitial fluid glucose',
            [self::CapillaryMilligramsPerDeciliter, 'zh_CN'],
            [self::CapillaryMillimolesPerLiter, 'zh_CN'] => '毛细血管血糖',
            [self::InterstitialMilligramsPerDeciliter, 'zh_CN'],
            [self::InterstitialMillimolesPerLiter, 'zh_CN'] => '组织液葡萄糖',
            default => throw new ValueError(sprintf('Missing patient label for locale "%s".', $locale)),
        };
    }
}
