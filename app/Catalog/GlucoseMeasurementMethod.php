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
            [self::Capillary, 'hi'] => 'केशिका रक्त (उंगली में चुभन)',
            [self::Interstitial, 'hi'] => 'अंतरालीय द्रव (निरंतर सेंसर)',
            [self::Capillary, 'fr'] => 'Sang capillaire (piqûre au doigt)',
            [self::Interstitial, 'fr'] => 'Liquide interstitiel (capteur en continu)',
            [self::Capillary, 'ar'] => 'دم شعيري (وخز الإصبع)',
            [self::Interstitial, 'ar'] => 'سائل خلالي (مستشعر مستمر)',
            [self::Capillary, 'bn'] => 'কৈশিক রক্ত (আঙুলে সূচ ফোটানো)',
            [self::Interstitial, 'bn'] => 'আন্তঃকোষীয় তরল (নিরবচ্ছিন্ন সেন্সর)',
            [self::Capillary, 'pt'] => 'Capilar (picada no dedo)',
            [self::Interstitial, 'pt'] => 'Intersticial (sensor contínuo)',
            [self::Capillary, 'ru'] => 'Капиллярная кровь (прокол пальца)',
            [self::Interstitial, 'ru'] => 'Интерстициальная жидкость (непрерывный датчик)',
            [self::Capillary, 'ur'] => 'شعری خون (انگلی میں چبھن)',
            [self::Interstitial, 'ur'] => 'بین الخلوی سیال (مسلسل سینسر)',
            [self::Capillary, 'id'] => 'Kapiler (tusuk jari)',
            [self::Interstitial, 'id'] => 'Cairan interstisial (sensor kontinu)',
            [self::Capillary, 'de'] => 'Kapillarblut (Fingerstich)',
            [self::Interstitial, 'de'] => 'Interstitielle Flüssigkeit (kontinuierlicher Sensor)',
            [self::Capillary, 'ja'] => '毛細血管血（指先穿刺）',
            [self::Interstitial, 'ja'] => '間質液（持続測定センサー）',
            [self::Capillary, 'sw'] => 'Damu ya kapilari (kuchoma kidole)',
            [self::Interstitial, 'sw'] => 'Majimaji ya interstitial (kihisi endelevu)',
            [self::Capillary, 'mr'] => 'केशिका रक्त (बोट टोचून)',
            [self::Interstitial, 'mr'] => 'अंतरालीय द्रव (सतत सेन्सर)',
            [self::Capillary, 'te'] => 'కేశనాళిక రక్తం (వేలు గుచ్చడం)',
            [self::Interstitial, 'te'] => 'కణాంతర ద్రవం (నిరంతర సెన్సర్)',
            [self::Capillary, 'ta'] => 'தந்துகி இரத்தம் (விரல் குத்தல்)',
            [self::Interstitial, 'ta'] => 'இடைநிலைத் திரவம் (தொடர்ச்சியான சென்சார்)',
            [self::Capillary, 'tr'] => 'Kapiller kan (parmak delme)',
            [self::Interstitial, 'tr'] => 'İnterstisyel sıvı (sürekli sensör)',
            [self::Capillary, 'ko'] => '모세혈관 혈액 (손가락 채혈)',
            [self::Interstitial, 'ko'] => '간질액 (연속 측정 센서)',
            [self::Capillary, 'vi'] => 'Máu mao mạch (chích đầu ngón tay)',
            [self::Interstitial, 'vi'] => 'Dịch kẽ (cảm biến liên tục)',
            [self::Capillary, 'jv'] => 'Getih kapiler (cucuk driji)',
            [self::Interstitial, 'jv'] => 'Cairan interstisial (sensor terus-menerus)',
            [self::Capillary, 'it'] => 'Sangue capillare (puntura del dito)',
            [self::Interstitial, 'it'] => 'Liquido interstiziale (sensore continuo)',
            [self::Capillary, 'ha'] => 'Jinin ƙaramin jijiya (caccakar yatsa)',
            [self::Interstitial, 'ha'] => 'Ruwan tsakanin ƙwayoyin halitta (na\'urar auna mai ci gaba)',
            [self::Capillary, 'th'] => 'เลือดฝอย (เจาะปลายนิ้ว)',
            [self::Interstitial, 'th'] => 'ของเหลวระหว่างเซลล์ (เซนเซอร์ต่อเนื่อง)',
            [self::Capillary, 'fa'] => 'خون مویرگی (سوراخ کردن انگشت)',
            [self::Interstitial, 'fa'] => 'مایع میان‌بافتی (حسگر پیوسته)',
            [self::Capillary, 'pl'] => 'Krew włośniczkowa (nakłucie palca)',
            [self::Interstitial, 'pl'] => 'Płyn śródmiąższowy (czujnik ciągły)',
            default => throw new ValueError(sprintf('Missing measurement method label for locale "%s".', $locale)),
        };
    }
}
