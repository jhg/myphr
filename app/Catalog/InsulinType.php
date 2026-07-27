<?php

declare(strict_types=1);

namespace App\Catalog;

use App\Support\SupportedLocale;
use ValueError;

/**
 * Type of insulin injected: rapid, long acting or mixed (ADR 0006, MVP types section).
 *
 * The insulin event carries **no LOINC code**: it is not an observation of a quantity, it is the
 * record of a medication administration (ADR 0006, "insulin (type rapid|long|mixed, dose, and the
 * product code where applicable, because it is a medication administration and not an
 * observation)"). That is the difference with {@see GlucoseMeasurementMethod}: we do not look for a
 * lab code for (type, unit) because no such thing exists here.
 *
 * The value of each case is the stable token that goes into the encrypted envelope (ADR 0004:
 * "stable tokens, never visible labels"), so, like {@see GlucoseMeasurementMethod}, it **can never
 * change** once published. Changing it would leave the already stored encrypted envelopes
 * unreadable, because there is no way to walk them and re-encrypt them with the new token without
 * each user's key.
 *
 * Adding a new case is safe; renaming or removing an existing one is not.
 */
enum InsulinType: string implements PatientLabelled
{
    /** Rapid acting insulin. */
    case Rapid = 'rapid';

    /** Long acting (basal) insulin. */
    case Long = 'long';

    /** Mixed insulin (rapid and long acting combined in the same injection). */
    case Mixed = 'mixed';

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
            [self::Rapid, 'es'] => 'Rápida',
            [self::Long, 'es'] => 'Lenta',
            [self::Mixed, 'es'] => 'Mixta',
            [self::Rapid, 'en'] => 'Rapid-acting',
            [self::Long, 'en'] => 'Long-acting',
            [self::Mixed, 'en'] => 'Mixed',
            [self::Rapid, 'zh_CN'] => '速效',
            [self::Long, 'zh_CN'] => '长效',
            [self::Mixed, 'zh_CN'] => '预混',
            [self::Rapid, 'hi'] => 'त्वरित-अभिनयी',
            [self::Long, 'hi'] => 'दीर्घ-अभिनयी',
            [self::Mixed, 'hi'] => 'मिश्रित',
            [self::Rapid, 'fr'] => 'À action rapide',
            [self::Long, 'fr'] => 'À action prolongée',
            [self::Mixed, 'fr'] => 'Prémélangée',
            [self::Rapid, 'ar'] => 'سريع المفعول',
            [self::Long, 'ar'] => 'طويل المفعول',
            [self::Mixed, 'ar'] => 'مخلوط',
            [self::Rapid, 'bn'] => 'দ্রুত কার্যকর',
            [self::Long, 'bn'] => 'দীর্ঘস্থায়ী',
            [self::Mixed, 'bn'] => 'মিশ্র',
            [self::Rapid, 'pt'] => 'De ação rápida',
            [self::Long, 'pt'] => 'De ação prolongada',
            [self::Mixed, 'pt'] => 'Pré-misturada',
            [self::Rapid, 'ru'] => 'Быстрого действия',
            [self::Long, 'ru'] => 'Длительного действия',
            [self::Mixed, 'ru'] => 'Смешанный',
            [self::Rapid, 'ur'] => 'تیز اثر کرنے والی',
            [self::Long, 'ur'] => 'طویل اثر کرنے والی',
            [self::Mixed, 'ur'] => 'مخلوط',
            [self::Rapid, 'id'] => 'Kerja cepat',
            [self::Long, 'id'] => 'Kerja panjang',
            [self::Mixed, 'id'] => 'Campuran',
            [self::Rapid, 'de'] => 'Schnell wirksam',
            [self::Long, 'de'] => 'Lang wirksam',
            [self::Mixed, 'de'] => 'Mischinsulin',
            [self::Rapid, 'ja'] => '速効型',
            [self::Long, 'ja'] => '持効型',
            [self::Mixed, 'ja'] => '混合型',
            [self::Rapid, 'sw'] => 'Athari ya haraka',
            [self::Long, 'sw'] => 'Athari ya muda mrefu',
            [self::Mixed, 'sw'] => 'Mchanganyiko',
            [self::Rapid, 'mr'] => 'जलद-प्रभावी',
            [self::Long, 'mr'] => 'दीर्घ-प्रभावी',
            [self::Mixed, 'mr'] => 'मिश्रित',
            [self::Rapid, 'te'] => 'వేగంగా పనిచేసే',
            [self::Long, 'te'] => 'దీర్ఘకాలం పనిచేసే',
            [self::Mixed, 'te'] => 'మిశ్రమ',
            [self::Rapid, 'ta'] => 'விரைவுச் செயல்பாடு',
            [self::Long, 'ta'] => 'நீண்டகாலச் செயல்பாடு',
            [self::Mixed, 'ta'] => 'கலவை',
            [self::Rapid, 'tr'] => 'Hızlı etkili',
            [self::Long, 'tr'] => 'Uzun etkili',
            [self::Mixed, 'tr'] => 'Karışım',
            [self::Rapid, 'ko'] => '속효성',
            [self::Long, 'ko'] => '지속형',
            [self::Mixed, 'ko'] => '혼합형',
            [self::Rapid, 'vi'] => 'Tác dụng nhanh',
            [self::Long, 'vi'] => 'Tác dụng kéo dài',
            [self::Mixed, 'vi'] => 'Hỗn hợp',
            [self::Rapid, 'jv'] => 'Tumindak cepet',
            [self::Long, 'jv'] => 'Tumindak suwe',
            [self::Mixed, 'jv'] => 'Campuran',
            [self::Rapid, 'it'] => 'Ad azione rapida',
            [self::Long, 'it'] => 'Ad azione prolungata',
            [self::Mixed, 'it'] => 'Premiscelata',
            [self::Rapid, 'ha'] => 'Mai saurin aiki',
            [self::Long, 'ha'] => 'Mai tsawon aiki',
            [self::Mixed, 'ha'] => 'Haɗaɗɗe',
            [self::Rapid, 'th'] => 'ออกฤทธิ์เร็ว',
            [self::Long, 'th'] => 'ออกฤทธิ์นาน',
            [self::Mixed, 'th'] => 'ชนิดผสม',
            [self::Rapid, 'fa'] => 'سریع‌الاثر',
            [self::Long, 'fa'] => 'طولانی‌اثر',
            [self::Mixed, 'fa'] => 'مخلوط',
            [self::Rapid, 'pl'] => 'Szybkodziałająca',
            [self::Long, 'pl'] => 'Długodziałająca',
            [self::Mixed, 'pl'] => 'Mieszana',
            default => throw new ValueError(sprintf('Missing insulin type label for locale "%s".', $locale)),
        };
    }
}
