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
     * This is the layer we can translate independently of the official terminology: LOINC publishes
     * the terms in English, so `officialName()` stays in English and our own wording goes here.
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
            [self::CapillaryMilligramsPerDeciliter, 'hi'],
            [self::CapillaryMillimolesPerLiter, 'hi'] => 'केशिका रक्त ग्लूकोज़',
            [self::InterstitialMilligramsPerDeciliter, 'hi'],
            [self::InterstitialMillimolesPerLiter, 'hi'] => 'अंतरालीय द्रव ग्लूकोज़',
            [self::CapillaryMilligramsPerDeciliter, 'fr'],
            [self::CapillaryMillimolesPerLiter, 'fr'] => 'Glycémie capillaire',
            [self::InterstitialMilligramsPerDeciliter, 'fr'],
            [self::InterstitialMillimolesPerLiter, 'fr'] => 'Glucose du liquide interstitiel',
            [self::CapillaryMilligramsPerDeciliter, 'ar'],
            [self::CapillaryMillimolesPerLiter, 'ar'] => 'غلوكوز الدم الشعيري',
            [self::InterstitialMilligramsPerDeciliter, 'ar'],
            [self::InterstitialMillimolesPerLiter, 'ar'] => 'غلوكوز السائل الخلالي',
            [self::CapillaryMilligramsPerDeciliter, 'bn'],
            [self::CapillaryMillimolesPerLiter, 'bn'] => 'কৈশিক রক্তের গ্লুকোজ',
            [self::InterstitialMilligramsPerDeciliter, 'bn'],
            [self::InterstitialMillimolesPerLiter, 'bn'] => 'আন্তঃকোষীয় তরলের গ্লুকোজ',
            [self::CapillaryMilligramsPerDeciliter, 'pt'],
            [self::CapillaryMillimolesPerLiter, 'pt'] => 'Glicose no sangue capilar',
            [self::InterstitialMilligramsPerDeciliter, 'pt'],
            [self::InterstitialMillimolesPerLiter, 'pt'] => 'Glicose no líquido intersticial',
            [self::CapillaryMilligramsPerDeciliter, 'ru'],
            [self::CapillaryMillimolesPerLiter, 'ru'] => 'Глюкоза капиллярной крови',
            [self::InterstitialMilligramsPerDeciliter, 'ru'],
            [self::InterstitialMillimolesPerLiter, 'ru'] => 'Глюкоза интерстициальной жидкости',
            [self::CapillaryMilligramsPerDeciliter, 'ur'],
            [self::CapillaryMillimolesPerLiter, 'ur'] => 'شعری خون کا گلوکوز',
            [self::InterstitialMilligramsPerDeciliter, 'ur'],
            [self::InterstitialMillimolesPerLiter, 'ur'] => 'بین الخلوی سیال کا گلوکوز',
            [self::CapillaryMilligramsPerDeciliter, 'id'],
            [self::CapillaryMillimolesPerLiter, 'id'] => 'Glukosa darah kapiler',
            [self::InterstitialMilligramsPerDeciliter, 'id'],
            [self::InterstitialMillimolesPerLiter, 'id'] => 'Glukosa cairan interstisial',
            [self::CapillaryMilligramsPerDeciliter, 'de'],
            [self::CapillaryMillimolesPerLiter, 'de'] => 'Kapillarblutzucker',
            [self::InterstitialMilligramsPerDeciliter, 'de'],
            [self::InterstitialMillimolesPerLiter, 'de'] => 'Glukose in der interstitiellen Flüssigkeit',
            [self::CapillaryMilligramsPerDeciliter, 'ja'],
            [self::CapillaryMillimolesPerLiter, 'ja'] => '毛細血管血糖',
            [self::InterstitialMilligramsPerDeciliter, 'ja'],
            [self::InterstitialMillimolesPerLiter, 'ja'] => '間質液グルコース',
            [self::CapillaryMilligramsPerDeciliter, 'sw'],
            [self::CapillaryMillimolesPerLiter, 'sw'] => 'Glukosi ya damu ya kapilari',
            [self::InterstitialMilligramsPerDeciliter, 'sw'],
            [self::InterstitialMillimolesPerLiter, 'sw'] => 'Glukosi ya majimaji ya interstitial',
            [self::CapillaryMilligramsPerDeciliter, 'mr'],
            [self::CapillaryMillimolesPerLiter, 'mr'] => 'केशिका रक्तातील ग्लुकोज',
            [self::InterstitialMilligramsPerDeciliter, 'mr'],
            [self::InterstitialMillimolesPerLiter, 'mr'] => 'अंतरालीय द्रवातील ग्लुकोज',
            [self::CapillaryMilligramsPerDeciliter, 'te'],
            [self::CapillaryMillimolesPerLiter, 'te'] => 'కేశనాళిక రక్త గ్లూకోజ్',
            [self::InterstitialMilligramsPerDeciliter, 'te'],
            [self::InterstitialMillimolesPerLiter, 'te'] => 'కణాంతర ద్రవ గ్లూకోజ్',
            [self::CapillaryMilligramsPerDeciliter, 'ta'],
            [self::CapillaryMillimolesPerLiter, 'ta'] => 'தந்துகி இரத்த குளுக்கோஸ்',
            [self::InterstitialMilligramsPerDeciliter, 'ta'],
            [self::InterstitialMillimolesPerLiter, 'ta'] => 'இடைநிலைத் திரவ குளுக்கோஸ்',
            [self::CapillaryMilligramsPerDeciliter, 'tr'],
            [self::CapillaryMillimolesPerLiter, 'tr'] => 'Kapiller kan glukozu',
            [self::InterstitialMilligramsPerDeciliter, 'tr'],
            [self::InterstitialMillimolesPerLiter, 'tr'] => 'İnterstisyel sıvı glukozu',
            [self::CapillaryMilligramsPerDeciliter, 'ko'],
            [self::CapillaryMillimolesPerLiter, 'ko'] => '모세혈관 혈당',
            [self::InterstitialMilligramsPerDeciliter, 'ko'],
            [self::InterstitialMillimolesPerLiter, 'ko'] => '간질액 포도당',
            [self::CapillaryMilligramsPerDeciliter, 'vi'],
            [self::CapillaryMillimolesPerLiter, 'vi'] => 'Glucose máu mao mạch',
            [self::InterstitialMilligramsPerDeciliter, 'vi'],
            [self::InterstitialMillimolesPerLiter, 'vi'] => 'Glucose dịch kẽ',
            [self::CapillaryMilligramsPerDeciliter, 'jv'],
            [self::CapillaryMillimolesPerLiter, 'jv'] => 'Glukosa getih kapiler',
            [self::InterstitialMilligramsPerDeciliter, 'jv'],
            [self::InterstitialMillimolesPerLiter, 'jv'] => 'Glukosa cairan interstisial',
            [self::CapillaryMilligramsPerDeciliter, 'it'],
            [self::CapillaryMillimolesPerLiter, 'it'] => 'Glucosio nel sangue capillare',
            [self::InterstitialMilligramsPerDeciliter, 'it'],
            [self::InterstitialMillimolesPerLiter, 'it'] => 'Glucosio nel liquido interstiziale',
            [self::CapillaryMilligramsPerDeciliter, 'ha'],
            [self::CapillaryMillimolesPerLiter, 'ha'] => 'Glukos na jinin ƙaramin jijiya',
            [self::InterstitialMilligramsPerDeciliter, 'ha'],
            [self::InterstitialMillimolesPerLiter, 'ha'] => 'Glukos na ruwan tsakanin ƙwayoyin halitta',
            [self::CapillaryMilligramsPerDeciliter, 'th'],
            [self::CapillaryMillimolesPerLiter, 'th'] => 'กลูโคสในเลือดฝอย',
            [self::InterstitialMilligramsPerDeciliter, 'th'],
            [self::InterstitialMillimolesPerLiter, 'th'] => 'กลูโคสในของเหลวระหว่างเซลล์',
            [self::CapillaryMilligramsPerDeciliter, 'fa'],
            [self::CapillaryMillimolesPerLiter, 'fa'] => 'گلوکز خون مویرگی',
            [self::InterstitialMilligramsPerDeciliter, 'fa'],
            [self::InterstitialMillimolesPerLiter, 'fa'] => 'گلوکز مایع میان‌بافتی',
            [self::CapillaryMilligramsPerDeciliter, 'pl'],
            [self::CapillaryMillimolesPerLiter, 'pl'] => 'Glukoza we krwi włośniczkowej',
            [self::InterstitialMilligramsPerDeciliter, 'pl'],
            [self::InterstitialMillimolesPerLiter, 'pl'] => 'Glukoza w płynie śródmiąższowym',
            default => throw new ValueError(sprintf('Missing patient label for locale "%s".', $locale)),
        };
    }
}
