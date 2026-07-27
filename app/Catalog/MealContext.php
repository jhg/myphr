<?php

declare(strict_types=1);

namespace App\Catalog;

use App\Support\SupportedLocale;
use ValueError;

/**
 * Context of a blood glucose reading relative to the nearest meal (ADR 0006).
 *
 * ADR 0006 calls it "the field with the most clinical value on the list": without it, a reading of
 * 180 mg/dL does not say whether it is fasting hyperglycaemia or a normal rise after eating. The
 * value of each case is the stable token that goes into the encrypted envelope (ADR 0004: "stable
 * tokens, never visible labels"), so, like {@see GlucoseMeasurementMethod}, it **can never change**
 * once published: renaming or removing a case would leave the stored envelopes unreadable.
 *
 * There was no enum for this in the catalog; it is created here following the style of
 * {@see GlucoseMeasurementMethod} and {@see UcumUnit}.
 */
enum MealContext: string implements PatientLabelled
{
    /** Fasting, without having eaten yet. */
    case Fasting = 'fasting';

    /** Before eating. */
    case BeforeMeal = 'before_meal';

    /** After eating. */
    case AfterMeal = 'after_meal';

    /** At bedtime. */
    case Bedtime = 'bedtime';

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
            [self::Fasting, 'es'] => 'En ayunas',
            [self::BeforeMeal, 'es'] => 'Antes de comer',
            [self::AfterMeal, 'es'] => 'Después de comer',
            [self::Bedtime, 'es'] => 'Al acostarse',
            [self::Fasting, 'en'] => 'Fasting',
            [self::BeforeMeal, 'en'] => 'Before meal',
            [self::AfterMeal, 'en'] => 'After meal',
            [self::Bedtime, 'en'] => 'Bedtime',
            [self::Fasting, 'zh_CN'] => '空腹',
            [self::BeforeMeal, 'zh_CN'] => '餐前',
            [self::AfterMeal, 'zh_CN'] => '餐后',
            [self::Bedtime, 'zh_CN'] => '睡前',
            [self::Fasting, 'hi'] => 'उपवास में',
            [self::BeforeMeal, 'hi'] => 'भोजन से पहले',
            [self::AfterMeal, 'hi'] => 'भोजन के बाद',
            [self::Bedtime, 'hi'] => 'सोने से पहले',
            [self::Fasting, 'fr'] => 'À jeun',
            [self::BeforeMeal, 'fr'] => 'Avant le repas',
            [self::AfterMeal, 'fr'] => 'Après le repas',
            [self::Bedtime, 'fr'] => 'Au coucher',
            [self::Fasting, 'ar'] => 'صائم',
            [self::BeforeMeal, 'ar'] => 'قبل الوجبة',
            [self::AfterMeal, 'ar'] => 'بعد الوجبة',
            [self::Bedtime, 'ar'] => 'قبل النوم',
            [self::Fasting, 'bn'] => 'উপবাসে',
            [self::BeforeMeal, 'bn'] => 'খাবারের আগে',
            [self::AfterMeal, 'bn'] => 'খাবারের পরে',
            [self::Bedtime, 'bn'] => 'শোবার আগে',
            [self::Fasting, 'pt'] => 'Em jejum',
            [self::BeforeMeal, 'pt'] => 'Antes da refeição',
            [self::AfterMeal, 'pt'] => 'Após a refeição',
            [self::Bedtime, 'pt'] => 'Ao deitar',
            [self::Fasting, 'ru'] => 'Натощак',
            [self::BeforeMeal, 'ru'] => 'До еды',
            [self::AfterMeal, 'ru'] => 'После еды',
            [self::Bedtime, 'ru'] => 'Перед сном',
            [self::Fasting, 'ur'] => 'خالی پیٹ',
            [self::BeforeMeal, 'ur'] => 'کھانے سے پہلے',
            [self::AfterMeal, 'ur'] => 'کھانے کے بعد',
            [self::Bedtime, 'ur'] => 'سونے سے پہلے',
            [self::Fasting, 'id'] => 'Puasa',
            [self::BeforeMeal, 'id'] => 'Sebelum makan',
            [self::AfterMeal, 'id'] => 'Setelah makan',
            [self::Bedtime, 'id'] => 'Sebelum tidur',
            [self::Fasting, 'de'] => 'Nüchtern',
            [self::BeforeMeal, 'de'] => 'Vor der Mahlzeit',
            [self::AfterMeal, 'de'] => 'Nach der Mahlzeit',
            [self::Bedtime, 'de'] => 'Vor dem Schlafengehen',
            [self::Fasting, 'ja'] => '空腹時',
            [self::BeforeMeal, 'ja'] => '食前',
            [self::AfterMeal, 'ja'] => '食後',
            [self::Bedtime, 'ja'] => '就寝前',
            [self::Fasting, 'sw'] => 'Kufunga',
            [self::BeforeMeal, 'sw'] => 'Kabla ya mlo',
            [self::AfterMeal, 'sw'] => 'Baada ya mlo',
            [self::Bedtime, 'sw'] => 'Wakati wa kulala',
            [self::Fasting, 'mr'] => 'उपाशीपोटी',
            [self::BeforeMeal, 'mr'] => 'जेवणापूर्वी',
            [self::AfterMeal, 'mr'] => 'जेवणानंतर',
            [self::Bedtime, 'mr'] => 'झोपण्यापूर्वी',
            [self::Fasting, 'te'] => 'పరగడుపున',
            [self::BeforeMeal, 'te'] => 'భోజనానికి ముందు',
            [self::AfterMeal, 'te'] => 'భోజనం తర్వాత',
            [self::Bedtime, 'te'] => 'నిద్రకు ముందు',
            [self::Fasting, 'ta'] => 'உண்ணாநிலையில்',
            [self::BeforeMeal, 'ta'] => 'உணவுக்கு முன்',
            [self::AfterMeal, 'ta'] => 'உணவுக்குப் பின்',
            [self::Bedtime, 'ta'] => 'படுக்கைக்குச் செல்லும் முன்',
            [self::Fasting, 'tr'] => 'Açlıkta',
            [self::BeforeMeal, 'tr'] => 'Öğünden önce',
            [self::AfterMeal, 'tr'] => 'Öğünden sonra',
            [self::Bedtime, 'tr'] => 'Yatmadan önce',
            [self::Fasting, 'ko'] => '공복',
            [self::BeforeMeal, 'ko'] => '식전',
            [self::AfterMeal, 'ko'] => '식후',
            [self::Bedtime, 'ko'] => '취침 전',
            [self::Fasting, 'vi'] => 'Lúc đói',
            [self::BeforeMeal, 'vi'] => 'Trước bữa ăn',
            [self::AfterMeal, 'vi'] => 'Sau bữa ăn',
            [self::Bedtime, 'vi'] => 'Trước khi đi ngủ',
            [self::Fasting, 'jv'] => 'Nalika pasa',
            [self::BeforeMeal, 'jv'] => 'Sadurunge mangan',
            [self::AfterMeal, 'jv'] => 'Sawisé mangan',
            [self::Bedtime, 'jv'] => 'Sadurunge turu',
            [self::Fasting, 'it'] => 'A digiuno',
            [self::BeforeMeal, 'it'] => 'Prima del pasto',
            [self::AfterMeal, 'it'] => 'Dopo il pasto',
            [self::Bedtime, 'it'] => 'Prima di coricarsi',
            [self::Fasting, 'ha'] => 'Azumi',
            [self::BeforeMeal, 'ha'] => 'Kafin abinci',
            [self::AfterMeal, 'ha'] => 'Bayan abinci',
            [self::Bedtime, 'ha'] => 'Kafin kwanciya',
            [self::Fasting, 'th'] => 'ขณะอดอาหาร',
            [self::BeforeMeal, 'th'] => 'ก่อนอาหาร',
            [self::AfterMeal, 'th'] => 'หลังอาหาร',
            [self::Bedtime, 'th'] => 'ก่อนนอน',
            [self::Fasting, 'fa'] => 'ناشتا',
            [self::BeforeMeal, 'fa'] => 'پیش از غذا',
            [self::AfterMeal, 'fa'] => 'پس از غذا',
            [self::Bedtime, 'fa'] => 'پیش از خواب',
            [self::Fasting, 'pl'] => 'Na czczo',
            [self::BeforeMeal, 'pl'] => 'Przed posiłkiem',
            [self::AfterMeal, 'pl'] => 'Po posiłku',
            [self::Bedtime, 'pl'] => 'Przed snem',
            default => throw new ValueError(sprintf('Missing meal context label for locale "%s".', $locale)),
        };
    }
}
