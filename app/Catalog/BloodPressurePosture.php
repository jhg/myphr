<?php

declare(strict_types=1);

namespace App\Catalog;

use App\Support\SupportedLocale;
use ValueError;

/**
 * Posture a blood pressure reading was taken in.
 *
 * Together with {@see BloodPressureArm} it forms the measurement method ADR 0008
 * (docs/adr/0008-measurement-method.md) requires: posture changes the value as much as the arm does
 * —someone's blood pressure lying down is not the same as standing up, a key difference for
 * spotting orthostatic hypotension— and it is only known at the moment of measuring. The value of
 * each case is the stable token that goes into the encrypted envelope, so, like
 * {@see BloodPressureArm}, it **can never change** once published.
 *
 * Adding a new case is safe; renaming or removing an existing one is not.
 */
enum BloodPressurePosture: string implements PatientLabelled
{
    /** Sentado. */
    case Sitting = 'sitting';

    /** Tumbado. */
    case Lying = 'lying';

    /** Standing up. */
    case Standing = 'standing';

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
            [self::Sitting, 'es'] => 'Sentado',
            [self::Lying, 'es'] => 'Tumbado',
            [self::Standing, 'es'] => 'De pie',
            [self::Sitting, 'en'] => 'Sitting',
            [self::Lying, 'en'] => 'Lying down',
            [self::Standing, 'en'] => 'Standing',
            [self::Sitting, 'zh_CN'] => '坐位',
            [self::Lying, 'zh_CN'] => '卧位',
            [self::Standing, 'zh_CN'] => '立位',
            [self::Sitting, 'hi'] => 'बैठकर',
            [self::Lying, 'hi'] => 'लेटकर',
            [self::Standing, 'hi'] => 'खड़े होकर',
            [self::Sitting, 'fr'] => 'Assis',
            [self::Lying, 'fr'] => 'Allongé',
            [self::Standing, 'fr'] => 'Debout',
            [self::Sitting, 'ar'] => 'جالس',
            [self::Lying, 'ar'] => 'مستلقٍ',
            [self::Standing, 'ar'] => 'واقف',
            [self::Sitting, 'bn'] => 'বসে',
            [self::Lying, 'bn'] => 'শুয়ে',
            [self::Standing, 'bn'] => 'দাঁড়িয়ে',
            [self::Sitting, 'pt'] => 'Sentado',
            [self::Lying, 'pt'] => 'Deitado',
            [self::Standing, 'pt'] => 'Em pé',
            [self::Sitting, 'ru'] => 'Сидя',
            [self::Lying, 'ru'] => 'Лёжа',
            [self::Standing, 'ru'] => 'Стоя',
            [self::Sitting, 'ur'] => 'بیٹھے ہوئے',
            [self::Lying, 'ur'] => 'لیٹے ہوئے',
            [self::Standing, 'ur'] => 'کھڑے ہوئے',
            [self::Sitting, 'id'] => 'Duduk',
            [self::Lying, 'id'] => 'Berbaring',
            [self::Standing, 'id'] => 'Berdiri',
            [self::Sitting, 'de'] => 'Sitzend',
            [self::Lying, 'de'] => 'Liegend',
            [self::Standing, 'de'] => 'Stehend',
            [self::Sitting, 'ja'] => '座位',
            [self::Lying, 'ja'] => '横になって',
            [self::Standing, 'ja'] => '立位',
            [self::Sitting, 'sw'] => 'Ameketi',
            [self::Lying, 'sw'] => 'Amelala',
            [self::Standing, 'sw'] => 'Amesimama',
            [self::Sitting, 'mr'] => 'बसून',
            [self::Lying, 'mr'] => 'झोपून',
            [self::Standing, 'mr'] => 'उभे राहून',
            [self::Sitting, 'te'] => 'కూర్చొని',
            [self::Lying, 'te'] => 'పడుకుని',
            [self::Standing, 'te'] => 'నిలబడి',
            [self::Sitting, 'ta'] => 'அமர்ந்து',
            [self::Lying, 'ta'] => 'படுத்துக்கொண்டு',
            [self::Standing, 'ta'] => 'நின்று',
            [self::Sitting, 'tr'] => 'Oturarak',
            [self::Lying, 'tr'] => 'Yatarak',
            [self::Standing, 'tr'] => 'Ayakta',
            [self::Sitting, 'ko'] => '앉은 자세',
            [self::Lying, 'ko'] => '누운 자세',
            [self::Standing, 'ko'] => '선 자세',
            [self::Sitting, 'vi'] => 'Ngồi',
            [self::Lying, 'vi'] => 'Nằm',
            [self::Standing, 'vi'] => 'Đứng',
            [self::Sitting, 'jv'] => 'Lungguh',
            [self::Lying, 'jv'] => 'Turu',
            [self::Standing, 'jv'] => 'Ngadeg',
            [self::Sitting, 'it'] => 'Seduto',
            [self::Lying, 'it'] => 'Sdraiato',
            [self::Standing, 'it'] => 'In piedi',
            [self::Sitting, 'ha'] => 'Zaune',
            [self::Lying, 'ha'] => 'Kwance',
            [self::Standing, 'ha'] => 'Tsaye',
            [self::Sitting, 'th'] => 'นั่ง',
            [self::Lying, 'th'] => 'นอน',
            [self::Standing, 'th'] => 'ยืน',
            [self::Sitting, 'fa'] => 'نشسته',
            [self::Lying, 'fa'] => 'درازکش',
            [self::Standing, 'fa'] => 'ایستاده',
            [self::Sitting, 'pl'] => 'Na siedząco',
            [self::Lying, 'pl'] => 'Na leżąco',
            [self::Standing, 'pl'] => 'Na stojąco',
            default => throw new ValueError(sprintf('Missing posture label for locale "%s".', $locale)),
        };
    }
}
