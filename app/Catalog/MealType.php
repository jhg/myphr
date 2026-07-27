<?php

declare(strict_types=1);

namespace App\Catalog;

use App\Support\SupportedLocale;
use ValueError;

/**
 * Type of meal for a `meal` event (ADR 0006).
 *
 * Specific to the meals event: it lives inside `data.mealType`, next to the ordered list of foods
 * (`data.foods`). The value of each case is the stable token that goes into the encrypted envelope
 * (ADR 0004: "stable tokens, never visible labels"), so, like {@see GlucoseMeasurementMethod}, it
 * **can never change** once published: renaming or removing a case would leave the stored envelopes
 * unreadable, because there is no way to walk them and re-encrypt them with the new token without
 * each user's key.
 *
 * Adding a new case is safe; renaming or removing an existing one is not.
 */
enum MealType: string implements PatientLabelled
{
    /** Desayuno. */
    case Breakfast = 'breakfast';

    /** Comida (almuerzo). */
    case Lunch = 'lunch';

    /** Cena. */
    case Dinner = 'dinner';

    /** Snack between meals. */
    case Snack = 'snack';

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
            [self::Breakfast, 'es'] => 'Desayuno',
            [self::Lunch, 'es'] => 'Comida',
            [self::Dinner, 'es'] => 'Cena',
            [self::Snack, 'es'] => 'Tentempié',
            [self::Breakfast, 'en'] => 'Breakfast',
            [self::Lunch, 'en'] => 'Lunch',
            [self::Dinner, 'en'] => 'Dinner',
            [self::Snack, 'en'] => 'Snack',
            [self::Breakfast, 'zh_CN'] => '早餐',
            [self::Lunch, 'zh_CN'] => '午餐',
            [self::Dinner, 'zh_CN'] => '晚餐',
            [self::Snack, 'zh_CN'] => '加餐',
            [self::Breakfast, 'hi'] => 'नाश्ता',
            [self::Lunch, 'hi'] => 'दोपहर का भोजन',
            [self::Dinner, 'hi'] => 'रात का भोजन',
            [self::Snack, 'hi'] => 'हल्का नाश्ता',
            [self::Breakfast, 'fr'] => 'Petit-déjeuner',
            [self::Lunch, 'fr'] => 'Déjeuner',
            [self::Dinner, 'fr'] => 'Dîner',
            [self::Snack, 'fr'] => 'Collation',
            [self::Breakfast, 'ar'] => 'الإفطار',
            [self::Lunch, 'ar'] => 'الغداء',
            [self::Dinner, 'ar'] => 'العشاء',
            [self::Snack, 'ar'] => 'وجبة خفيفة',
            [self::Breakfast, 'bn'] => 'নাশতা',
            [self::Lunch, 'bn'] => 'দুপুরের খাবার',
            [self::Dinner, 'bn'] => 'রাতের খাবার',
            [self::Snack, 'bn'] => 'জলখাবার',
            [self::Breakfast, 'pt'] => 'Pequeno-almoço',
            [self::Lunch, 'pt'] => 'Almoço',
            [self::Dinner, 'pt'] => 'Jantar',
            [self::Snack, 'pt'] => 'Lanche',
            [self::Breakfast, 'ru'] => 'Завтрак',
            [self::Lunch, 'ru'] => 'Обед',
            [self::Dinner, 'ru'] => 'Ужин',
            [self::Snack, 'ru'] => 'Перекус',
            [self::Breakfast, 'ur'] => 'ناشتہ',
            [self::Lunch, 'ur'] => 'دوپہر کا کھانا',
            [self::Dinner, 'ur'] => 'رات کا کھانا',
            [self::Snack, 'ur'] => 'ہلکا ناشتہ',
            [self::Breakfast, 'id'] => 'Sarapan',
            [self::Lunch, 'id'] => 'Makan siang',
            [self::Dinner, 'id'] => 'Makan malam',
            [self::Snack, 'id'] => 'Camilan',
            [self::Breakfast, 'de'] => 'Frühstück',
            [self::Lunch, 'de'] => 'Mittagessen',
            [self::Dinner, 'de'] => 'Abendessen',
            [self::Snack, 'de'] => 'Zwischenmahlzeit',
            [self::Breakfast, 'ja'] => '朝食',
            [self::Lunch, 'ja'] => '昼食',
            [self::Dinner, 'ja'] => '夕食',
            [self::Snack, 'ja'] => '間食',
            [self::Breakfast, 'sw'] => 'Kiamsha kinywa',
            [self::Lunch, 'sw'] => 'Chakula cha mchana',
            [self::Dinner, 'sw'] => 'Chakula cha jioni',
            [self::Snack, 'sw'] => 'Kitafunwa',
            [self::Breakfast, 'mr'] => 'नाश्ता',
            [self::Lunch, 'mr'] => 'दुपारचे जेवण',
            [self::Dinner, 'mr'] => 'रात्रीचे जेवण',
            [self::Snack, 'mr'] => 'अल्पोपाहार',
            [self::Breakfast, 'te'] => 'అల్పాహారం',
            [self::Lunch, 'te'] => 'మధ్యాహ్న భోజనం',
            [self::Dinner, 'te'] => 'రాత్రి భోజనం',
            [self::Snack, 'te'] => 'చిరుతిండి',
            [self::Breakfast, 'ta'] => 'காலை உணவு',
            [self::Lunch, 'ta'] => 'மதிய உணவு',
            [self::Dinner, 'ta'] => 'இரவு உணவு',
            [self::Snack, 'ta'] => 'சிற்றுண்டி',
            [self::Breakfast, 'tr'] => 'Kahvaltı',
            [self::Lunch, 'tr'] => 'Öğle yemeği',
            [self::Dinner, 'tr'] => 'Akşam yemeği',
            [self::Snack, 'tr'] => 'Ara öğün',
            [self::Breakfast, 'ko'] => '아침 식사',
            [self::Lunch, 'ko'] => '점심 식사',
            [self::Dinner, 'ko'] => '저녁 식사',
            [self::Snack, 'ko'] => '간식',
            [self::Breakfast, 'vi'] => 'Bữa sáng',
            [self::Lunch, 'vi'] => 'Bữa trưa',
            [self::Dinner, 'vi'] => 'Bữa tối',
            [self::Snack, 'vi'] => 'Bữa phụ',
            [self::Breakfast, 'jv'] => 'Sarapan',
            [self::Lunch, 'jv'] => 'Nedha awan',
            [self::Dinner, 'jv'] => 'Nedha bengi',
            [self::Snack, 'jv'] => 'Cemilan',
            [self::Breakfast, 'it'] => 'Colazione',
            [self::Lunch, 'it'] => 'Pranzo',
            [self::Dinner, 'it'] => 'Cena',
            [self::Snack, 'it'] => 'Spuntino',
            [self::Breakfast, 'ha'] => 'Karin kumallo',
            [self::Lunch, 'ha'] => 'Abincin rana',
            [self::Dinner, 'ha'] => 'Abincin dare',
            [self::Snack, 'ha'] => 'Abun ciye-ciye',
            [self::Breakfast, 'th'] => 'อาหารเช้า',
            [self::Lunch, 'th'] => 'อาหารกลางวัน',
            [self::Dinner, 'th'] => 'อาหารเย็น',
            [self::Snack, 'th'] => 'อาหารว่าง',
            [self::Breakfast, 'fa'] => 'صبحانه',
            [self::Lunch, 'fa'] => 'ناهار',
            [self::Dinner, 'fa'] => 'شام',
            [self::Snack, 'fa'] => 'میان‌وعده',
            [self::Breakfast, 'pl'] => 'Śniadanie',
            [self::Lunch, 'pl'] => 'Obiad',
            [self::Dinner, 'pl'] => 'Kolacja',
            [self::Snack, 'pl'] => 'Przekąska',
            default => throw new ValueError(sprintf('Missing meal type label for locale "%s".', $locale)),
        };
    }
}
