<?php

declare(strict_types=1);

namespace App\Catalog;

use App\Support\SupportedLocale;
use ValueError;

/**
 * Closed list of units for the amount of a food inside a meal (ADR 0006).
 *
 * A literal decision by the user: grams, milligrams, kilos, centilitres, litres, millilitres and
 * pieces, and nothing else. The foods themselves are NOT coded against any vocabulary (a deliberate
 * exception to ADR 0005, justified in the ADR that covers the meals screen), but the unit is coded
 * in UCUM (http://unitsofmeasure.org), exactly as ADR 0005 requires, to avoid an impossible
 * conversion later on.
 *
 * Codes verified one by one against the UCUM specification (common units table
 * https://ucum.org/docs/common-units and the HL7 listing at
 * https://terminology.hl7.org/5.5.0/ValueSet-ucum-common.html, both in the case-sensitive form from
 * the spec):
 * - Gram: `g`.
 * - Milligram: `mg` (prefix `m` = milli).
 * - Kilogram: `kg` (prefix `k` = kilo).
 * - Centilitre: `cL` (prefix `c` = centi on top of `L`, not `cl`: the uppercase form is the one UCUM
 *   documents as the case-sensitive alternative to avoid confusing a lowercase `l` with the digit 1,
 *   and it is the one HL7/FHIR use in their common unit tables).
 * - Litre: `L` (not `l`, same reason).
 * - Millilitre: `mL` (not `ml`, same reason).
 * - Pieces (item count): UCUM has no symbol of its own for "one piece"; a dimensionless amount is
 *   the unit `1`, and UCUM lets you annotate it in braces so the code stays readable without
 *   changing its meaning (`{annotation}` is syntactic sugar over `1`). We pick `{each}` instead of a
 *   bare `1` because a UCUM code with no annotation ("1") says nothing on its own in a list of
 *   units, and `{each}` is the annotation HL7/FHIR examples already use for "one piece, one item"
 *   when there is no more specific counting unit (tablets, capsules, and so on). It is documented
 *   here so it can be reviewed.
 *
 * The value of each case is that UCUM code verbatim, not a readable approximation. It is a token
 * that travels inside the encrypted envelope (ADR 0004, ADR 0006), so, like
 * {@see GlucoseMeasurementMethod}, it **can never change** once published: renaming or removing a
 * case would leave the stored envelopes unreadable, because there is no way to walk them and
 * re-encrypt them with the new token without each user's key.
 *
 * Adding a new case is safe; renaming or removing an existing one is not.
 */
enum FoodQuantityUnit: string
{
    /** Gramos. */
    case Gram = 'g';

    /** Miligramos. */
    case Milligram = 'mg';

    /** Kilogramos. */
    case Kilogram = 'kg';

    /** Centilitros. */
    case Centiliter = 'cL';

    /** Litros. */
    case Liter = 'L';

    /** Mililitros. */
    case Milliliter = 'mL';

    /** Loose pieces, with no more specific counting unit. */
    case Piece = '{each}';

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
            [self::Gram, 'es'] => 'Gramos',
            [self::Milligram, 'es'] => 'Miligramos',
            [self::Kilogram, 'es'] => 'Kilogramos',
            [self::Centiliter, 'es'] => 'Centilitros',
            [self::Liter, 'es'] => 'Litros',
            [self::Milliliter, 'es'] => 'Mililitros',
            [self::Piece, 'es'] => 'Unidades',
            [self::Gram, 'en'] => 'Grams',
            [self::Milligram, 'en'] => 'Milligrams',
            [self::Kilogram, 'en'] => 'Kilograms',
            [self::Centiliter, 'en'] => 'Centiliters',
            [self::Liter, 'en'] => 'Liters',
            [self::Milliliter, 'en'] => 'Milliliters',
            [self::Piece, 'en'] => 'Units',
            [self::Gram, 'zh_CN'] => '克',
            [self::Milligram, 'zh_CN'] => '毫克',
            [self::Kilogram, 'zh_CN'] => '千克',
            [self::Centiliter, 'zh_CN'] => '厘升',
            [self::Liter, 'zh_CN'] => '升',
            [self::Milliliter, 'zh_CN'] => '毫升',
            [self::Piece, 'zh_CN'] => '个',
            [self::Gram, 'hi'] => 'ग्राम',
            [self::Milligram, 'hi'] => 'मिलीग्राम',
            [self::Kilogram, 'hi'] => 'किलोग्राम',
            [self::Centiliter, 'hi'] => 'सेंटीलीटर',
            [self::Liter, 'hi'] => 'लीटर',
            [self::Milliliter, 'hi'] => 'मिलीलीटर',
            [self::Piece, 'hi'] => 'इकाइयाँ',
            [self::Gram, 'fr'] => 'Grammes',
            [self::Milligram, 'fr'] => 'Milligrammes',
            [self::Kilogram, 'fr'] => 'Kilogrammes',
            [self::Centiliter, 'fr'] => 'Centilitres',
            [self::Liter, 'fr'] => 'Litres',
            [self::Milliliter, 'fr'] => 'Millilitres',
            [self::Piece, 'fr'] => 'Unités',
            [self::Gram, 'ar'] => 'غرام',
            [self::Milligram, 'ar'] => 'مليغرام',
            [self::Kilogram, 'ar'] => 'كيلوغرام',
            [self::Centiliter, 'ar'] => 'سنتيلتر',
            [self::Liter, 'ar'] => 'لتر',
            [self::Milliliter, 'ar'] => 'مليلتر',
            [self::Piece, 'ar'] => 'وحدات',
            [self::Gram, 'bn'] => 'গ্রাম',
            [self::Milligram, 'bn'] => 'মিলিগ্রাম',
            [self::Kilogram, 'bn'] => 'কিলোগ্রাম',
            [self::Centiliter, 'bn'] => 'সেন্টিলিটার',
            [self::Liter, 'bn'] => 'লিটার',
            [self::Milliliter, 'bn'] => 'মিলিলিটার',
            [self::Piece, 'bn'] => 'একক',
            [self::Gram, 'pt'] => 'Gramas',
            [self::Milligram, 'pt'] => 'Miligramas',
            [self::Kilogram, 'pt'] => 'Quilogramas',
            [self::Centiliter, 'pt'] => 'Centilitros',
            [self::Liter, 'pt'] => 'Litros',
            [self::Milliliter, 'pt'] => 'Mililitros',
            [self::Piece, 'pt'] => 'Unidades',
            [self::Gram, 'ru'] => 'Граммы',
            [self::Milligram, 'ru'] => 'Миллиграммы',
            [self::Kilogram, 'ru'] => 'Килограммы',
            [self::Centiliter, 'ru'] => 'Сантилитры',
            [self::Liter, 'ru'] => 'Литры',
            [self::Milliliter, 'ru'] => 'Миллилитры',
            [self::Piece, 'ru'] => 'Штуки',
            [self::Gram, 'ur'] => 'گرام',
            [self::Milligram, 'ur'] => 'ملی گرام',
            [self::Kilogram, 'ur'] => 'کلوگرام',
            [self::Centiliter, 'ur'] => 'سینٹی لیٹر',
            [self::Liter, 'ur'] => 'لیٹر',
            [self::Milliliter, 'ur'] => 'ملی لیٹر',
            [self::Piece, 'ur'] => 'عدد',
            [self::Gram, 'id'] => 'Gram',
            [self::Milligram, 'id'] => 'Miligram',
            [self::Kilogram, 'id'] => 'Kilogram',
            [self::Centiliter, 'id'] => 'Sentiliter',
            [self::Liter, 'id'] => 'Liter',
            [self::Milliliter, 'id'] => 'Mililiter',
            [self::Piece, 'id'] => 'Buah',
            [self::Gram, 'de'] => 'Gramm',
            [self::Milligram, 'de'] => 'Milligramm',
            [self::Kilogram, 'de'] => 'Kilogramm',
            [self::Centiliter, 'de'] => 'Zentiliter',
            [self::Liter, 'de'] => 'Liter',
            [self::Milliliter, 'de'] => 'Milliliter',
            [self::Piece, 'de'] => 'Stück',
            [self::Gram, 'ja'] => 'グラム',
            [self::Milligram, 'ja'] => 'ミリグラム',
            [self::Kilogram, 'ja'] => 'キログラム',
            [self::Centiliter, 'ja'] => 'センチリットル',
            [self::Liter, 'ja'] => 'リットル',
            [self::Milliliter, 'ja'] => 'ミリリットル',
            [self::Piece, 'ja'] => '個',
            [self::Gram, 'sw'] => 'Gramu',
            [self::Milligram, 'sw'] => 'Miligramu',
            [self::Kilogram, 'sw'] => 'Kilogramu',
            [self::Centiliter, 'sw'] => 'Sentilita',
            [self::Liter, 'sw'] => 'Lita',
            [self::Milliliter, 'sw'] => 'Mililita',
            [self::Piece, 'sw'] => 'Vipande',
            [self::Gram, 'mr'] => 'ग्रॅम',
            [self::Milligram, 'mr'] => 'मिलिग्रॅम',
            [self::Kilogram, 'mr'] => 'किलोग्रॅम',
            [self::Centiliter, 'mr'] => 'सेंटीलीटर',
            [self::Liter, 'mr'] => 'लिटर',
            [self::Milliliter, 'mr'] => 'मिलिलिटर',
            [self::Piece, 'mr'] => 'नग',
            [self::Gram, 'te'] => 'గ్రాములు',
            [self::Milligram, 'te'] => 'మిల్లీగ్రాములు',
            [self::Kilogram, 'te'] => 'కిలోగ్రాములు',
            [self::Centiliter, 'te'] => 'సెంటీలీటర్లు',
            [self::Liter, 'te'] => 'లీటర్లు',
            [self::Milliliter, 'te'] => 'మిల్లీలీటర్లు',
            [self::Piece, 'te'] => 'ముక్కలు',
            [self::Gram, 'ta'] => 'கிராம்',
            [self::Milligram, 'ta'] => 'மில்லிகிராம்',
            [self::Kilogram, 'ta'] => 'கிலோகிராம்',
            [self::Centiliter, 'ta'] => 'சென்டிலிட்டர்',
            [self::Liter, 'ta'] => 'லிட்டர்',
            [self::Milliliter, 'ta'] => 'மில்லிலிட்டர்',
            [self::Piece, 'ta'] => 'துண்டுகள்',
            [self::Gram, 'tr'] => 'Gram',
            [self::Milligram, 'tr'] => 'Miligram',
            [self::Kilogram, 'tr'] => 'Kilogram',
            [self::Centiliter, 'tr'] => 'Santilitre',
            [self::Liter, 'tr'] => 'Litre',
            [self::Milliliter, 'tr'] => 'Mililitre',
            [self::Piece, 'tr'] => 'Adet',
            [self::Gram, 'ko'] => '그램',
            [self::Milligram, 'ko'] => '밀리그램',
            [self::Kilogram, 'ko'] => '킬로그램',
            [self::Centiliter, 'ko'] => '센티리터',
            [self::Liter, 'ko'] => '리터',
            [self::Milliliter, 'ko'] => '밀리리터',
            [self::Piece, 'ko'] => '개',
            [self::Gram, 'vi'] => 'Gam',
            [self::Milligram, 'vi'] => 'Miligam',
            [self::Kilogram, 'vi'] => 'Kilôgam',
            [self::Centiliter, 'vi'] => 'Centilit',
            [self::Liter, 'vi'] => 'Lít',
            [self::Milliliter, 'vi'] => 'Mililít',
            [self::Piece, 'vi'] => 'Cái',
            [self::Gram, 'jv'] => 'Gram',
            [self::Milligram, 'jv'] => 'Miligram',
            [self::Kilogram, 'jv'] => 'Kilogram',
            [self::Centiliter, 'jv'] => 'Sentiliter',
            [self::Liter, 'jv'] => 'Liter',
            [self::Milliliter, 'jv'] => 'Mililiter',
            [self::Piece, 'jv'] => 'Biji',
            [self::Gram, 'it'] => 'Grammi',
            [self::Milligram, 'it'] => 'Milligrammi',
            [self::Kilogram, 'it'] => 'Chilogrammi',
            [self::Centiliter, 'it'] => 'Centilitri',
            [self::Liter, 'it'] => 'Litri',
            [self::Milliliter, 'it'] => 'Millilitri',
            [self::Piece, 'it'] => 'Pezzi',
            [self::Gram, 'ha'] => 'Gram',
            [self::Milligram, 'ha'] => 'Milligram',
            [self::Kilogram, 'ha'] => 'Kilogram',
            [self::Centiliter, 'ha'] => 'Centilita',
            [self::Liter, 'ha'] => 'Lita',
            [self::Milliliter, 'ha'] => 'Millilita',
            [self::Piece, 'ha'] => 'Guda',
            [self::Gram, 'th'] => 'กรัม',
            [self::Milligram, 'th'] => 'มิลลิกรัม',
            [self::Kilogram, 'th'] => 'กิโลกรัม',
            [self::Centiliter, 'th'] => 'เซนติลิตร',
            [self::Liter, 'th'] => 'ลิตร',
            [self::Milliliter, 'th'] => 'มิลลิลิตร',
            [self::Piece, 'th'] => 'ชิ้น',
            [self::Gram, 'fa'] => 'گرم',
            [self::Milligram, 'fa'] => 'میلی‌گرم',
            [self::Kilogram, 'fa'] => 'کیلوگرم',
            [self::Centiliter, 'fa'] => 'سانتی‌لیتر',
            [self::Liter, 'fa'] => 'لیتر',
            [self::Milliliter, 'fa'] => 'میلی‌لیتر',
            [self::Piece, 'fa'] => 'عدد',
            [self::Gram, 'pl'] => 'Gramy',
            [self::Milligram, 'pl'] => 'Miligramy',
            [self::Kilogram, 'pl'] => 'Kilogramy',
            [self::Centiliter, 'pl'] => 'Centylitry',
            [self::Liter, 'pl'] => 'Litry',
            [self::Milliliter, 'pl'] => 'Mililitry',
            [self::Piece, 'pl'] => 'Sztuki',
            default => throw new ValueError(sprintf('Missing food quantity unit label for locale "%s".', $locale)),
        };
    }
}
