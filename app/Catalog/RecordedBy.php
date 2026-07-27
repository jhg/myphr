<?php

declare(strict_types=1);

namespace App\Catalog;

use App\Support\SupportedLocale;
use ValueError;

/**
 * Who recorded a clinical event: the person themselves or someone who cares for them (ADR 0006,
 * "Fields we capture even though we do not use them today").
 *
 * Common to every event type, not specific to blood glucose: it lives at the top level of the
 * decrypted content (`recordedBy`), next to `v`, `type` and `tz`, not inside `data`. The value of
 * each case is the stable token that goes into the encrypted envelope (ADR 0004: "stable tokens,
 * never visible labels"), so, like {@see GlucoseMeasurementMethod}, it **can never change** once
 * published.
 *
 * Unlike {@see MealContext}, this field does admit a sensible default: it is not a clinical claim,
 * it is a fact about how the data got in, and by far the most common case is that the person records
 * it themselves.
 */
enum RecordedBy: string implements PatientLabelled
{
    /** Recorded by the person the event is about. */
    case SelfReported = 'self';

    /** Recorded by someone who cares for them (a relative, a professional carer, and so on). */
    case Caregiver = 'caregiver';

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
            [self::SelfReported, 'es'] => 'La propia persona',
            [self::Caregiver, 'es'] => 'Un cuidador',
            [self::SelfReported, 'en'] => 'The person themselves',
            [self::Caregiver, 'en'] => 'A caregiver',
            [self::SelfReported, 'zh_CN'] => '本人',
            [self::Caregiver, 'zh_CN'] => '照护者',
            [self::SelfReported, 'hi'] => 'स्वयं व्यक्ति',
            [self::Caregiver, 'hi'] => 'देखभालकर्ता',
            [self::SelfReported, 'fr'] => 'La personne elle-même',
            [self::Caregiver, 'fr'] => 'Un aidant',
            [self::SelfReported, 'ar'] => 'الشخص نفسه',
            [self::Caregiver, 'ar'] => 'مقدّم الرعاية',
            [self::SelfReported, 'bn'] => 'ব্যক্তি নিজে',
            [self::Caregiver, 'bn'] => 'পরিচর্যাকারী',
            [self::SelfReported, 'pt'] => 'A própria pessoa',
            [self::Caregiver, 'pt'] => 'Um cuidador',
            [self::SelfReported, 'ru'] => 'Сам человек',
            [self::Caregiver, 'ru'] => 'Лицо, осуществляющее уход',
            [self::SelfReported, 'ur'] => 'خود فرد',
            [self::Caregiver, 'ur'] => 'نگہداشت کرنے والا',
            [self::SelfReported, 'id'] => 'Orang itu sendiri',
            [self::Caregiver, 'id'] => 'Pengasuh',
            [self::SelfReported, 'de'] => 'Die Person selbst',
            [self::Caregiver, 'de'] => 'Eine Betreuungsperson',
            [self::SelfReported, 'ja'] => '本人',
            [self::Caregiver, 'ja'] => '介護者',
            [self::SelfReported, 'sw'] => 'Mtu mwenyewe',
            [self::Caregiver, 'sw'] => 'Mlezi',
            [self::SelfReported, 'mr'] => 'स्वतः व्यक्ती',
            [self::Caregiver, 'mr'] => 'काळजीवाहक',
            [self::SelfReported, 'te'] => 'వ్యక్తి స్వయంగా',
            [self::Caregiver, 'te'] => 'సంరక్షకుడు',
            [self::SelfReported, 'ta'] => 'நபர் தாமே',
            [self::Caregiver, 'ta'] => 'பராமரிப்பாளர்',
            [self::SelfReported, 'tr'] => 'Kişinin kendisi',
            [self::Caregiver, 'tr'] => 'Bakım veren',
            [self::SelfReported, 'ko'] => '본인',
            [self::Caregiver, 'ko'] => '보호자',
            [self::SelfReported, 'vi'] => 'Chính người đó',
            [self::Caregiver, 'vi'] => 'Người chăm sóc',
            [self::SelfReported, 'jv'] => 'Wongé dhéwé',
            [self::Caregiver, 'jv'] => 'Pengasuh',
            [self::SelfReported, 'it'] => 'La persona stessa',
            [self::Caregiver, 'it'] => 'Un caregiver',
            [self::SelfReported, 'ha'] => 'Mutumin da kansa',
            [self::Caregiver, 'ha'] => 'Mai kulawa',
            [self::SelfReported, 'th'] => 'บุคคลนั้นเอง',
            [self::Caregiver, 'th'] => 'ผู้ดูแล',
            [self::SelfReported, 'fa'] => 'خودِ فرد',
            [self::Caregiver, 'fa'] => 'مراقب',
            [self::SelfReported, 'pl'] => 'Sama osoba',
            [self::Caregiver, 'pl'] => 'Opiekun',
            default => throw new ValueError(sprintf('Missing recorded-by label for locale "%s".', $locale)),
        };
    }
}
