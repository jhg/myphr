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
            [self::Abdomen, 'hi'] => 'पेट',
            [self::Thigh, 'hi'] => 'जांघ',
            [self::Glute, 'hi'] => 'नितंब',
            [self::Arm, 'hi'] => 'बांह',
            [self::Abdomen, 'fr'] => 'Abdomen',
            [self::Thigh, 'fr'] => 'Cuisse',
            [self::Glute, 'fr'] => 'Fesse',
            [self::Arm, 'fr'] => 'Bras',
            [self::Abdomen, 'ar'] => 'البطن',
            [self::Thigh, 'ar'] => 'الفخذ',
            [self::Glute, 'ar'] => 'الأرداف',
            [self::Arm, 'ar'] => 'الذراع',
            [self::Abdomen, 'bn'] => 'পেট',
            [self::Thigh, 'bn'] => 'উরু',
            [self::Glute, 'bn'] => 'নিতম্ব',
            [self::Arm, 'bn'] => 'বাহু',
            [self::Abdomen, 'pt'] => 'Abdómen',
            [self::Thigh, 'pt'] => 'Coxa',
            [self::Glute, 'pt'] => 'Nádega',
            [self::Arm, 'pt'] => 'Braço',
            [self::Abdomen, 'ru'] => 'Живот',
            [self::Thigh, 'ru'] => 'Бедро',
            [self::Glute, 'ru'] => 'Ягодица',
            [self::Arm, 'ru'] => 'Рука',
            [self::Abdomen, 'ur'] => 'پیٹ',
            [self::Thigh, 'ur'] => 'ران',
            [self::Glute, 'ur'] => 'سرین',
            [self::Arm, 'ur'] => 'بازو',
            [self::Abdomen, 'id'] => 'Perut',
            [self::Thigh, 'id'] => 'Paha',
            [self::Glute, 'id'] => 'Bokong',
            [self::Arm, 'id'] => 'Lengan',
            [self::Abdomen, 'de'] => 'Bauch',
            [self::Thigh, 'de'] => 'Oberschenkel',
            [self::Glute, 'de'] => 'Gesäß',
            [self::Arm, 'de'] => 'Oberarm',
            [self::Abdomen, 'ja'] => '腹部',
            [self::Thigh, 'ja'] => '太もも',
            [self::Glute, 'ja'] => '臀部',
            [self::Arm, 'ja'] => '腕',
            [self::Abdomen, 'sw'] => 'Tumbo',
            [self::Thigh, 'sw'] => 'Paja',
            [self::Glute, 'sw'] => 'Matako',
            [self::Arm, 'sw'] => 'Mkono',
            [self::Abdomen, 'mr'] => 'पोट',
            [self::Thigh, 'mr'] => 'मांडी',
            [self::Glute, 'mr'] => 'नितंब',
            [self::Arm, 'mr'] => 'बाहू',
            [self::Abdomen, 'te'] => 'పొత్తికడుపు',
            [self::Thigh, 'te'] => 'తొడ',
            [self::Glute, 'te'] => 'పిరుదు',
            [self::Arm, 'te'] => 'చేయి',
            [self::Abdomen, 'ta'] => 'வயிறு',
            [self::Thigh, 'ta'] => 'தொடை',
            [self::Glute, 'ta'] => 'பிட்டம்',
            [self::Arm, 'ta'] => 'கை',
            [self::Abdomen, 'tr'] => 'Karın',
            [self::Thigh, 'tr'] => 'Uyluk',
            [self::Glute, 'tr'] => 'Kalça',
            [self::Arm, 'tr'] => 'Kol',
            [self::Abdomen, 'ko'] => '복부',
            [self::Thigh, 'ko'] => '허벅지',
            [self::Glute, 'ko'] => '엉덩이',
            [self::Arm, 'ko'] => '팔',
            [self::Abdomen, 'vi'] => 'Bụng',
            [self::Thigh, 'vi'] => 'Đùi',
            [self::Glute, 'vi'] => 'Mông',
            [self::Arm, 'vi'] => 'Cánh tay',
            [self::Abdomen, 'jv'] => 'Weteng',
            [self::Thigh, 'jv'] => 'Pupu',
            [self::Glute, 'jv'] => 'Bokong',
            [self::Arm, 'jv'] => 'Lengen',
            [self::Abdomen, 'it'] => 'Addome',
            [self::Thigh, 'it'] => 'Coscia',
            [self::Glute, 'it'] => 'Gluteo',
            [self::Arm, 'it'] => 'Braccio',
            [self::Abdomen, 'ha'] => 'Ciki',
            [self::Thigh, 'ha'] => 'Cinya',
            [self::Glute, 'ha'] => 'Gindi',
            [self::Arm, 'ha'] => 'Hannu',
            [self::Abdomen, 'th'] => 'หน้าท้อง',
            [self::Thigh, 'th'] => 'ต้นขา',
            [self::Glute, 'th'] => 'ก้น',
            [self::Arm, 'th'] => 'ต้นแขน',
            [self::Abdomen, 'fa'] => 'شکم',
            [self::Thigh, 'fa'] => 'ران',
            [self::Glute, 'fa'] => 'باسن',
            [self::Arm, 'fa'] => 'بازو',
            [self::Abdomen, 'pl'] => 'Brzuch',
            [self::Thigh, 'pl'] => 'Udo',
            [self::Glute, 'pl'] => 'Pośladek',
            [self::Arm, 'pl'] => 'Ramię',
            default => throw new ValueError(sprintf('Missing injection site label for locale "%s".', $locale)),
        };
    }
}
