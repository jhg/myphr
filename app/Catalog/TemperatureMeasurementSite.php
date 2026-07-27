<?php

declare(strict_types=1);

namespace App\Catalog;

use App\Support\SupportedLocale;
use ValueError;

/**
 * Body site where the temperature was taken.
 *
 * It is the measurement method ADR 0008 (docs/adr/0008-measurement-method.md) requires for this
 * quantity: the site changes the value in a known way —an axillary reading runs several tenths below
 * a rectal one for the same person at the same moment— and is only known at the moment of measuring,
 * so it is asked for and never inferred. Mixing sites in a single series without saying so would
 * produce a curve that means nothing, just like mixing arms in blood pressure.
 *
 * Unlike the arm and the posture in blood pressure, here the site **also determines the LOINC code**
 * ({@see TemperatureLoincCode}): LOINC publishes a different code per measurement site. The token of
 * this enum still travels separately in `data.site`, because the code is exchange vocabulary and the
 * token is what groups our own series.
 *
 * The value of each case is that token, which is serialized inside the payload encrypted in the
 * browser (ADR 0002, ADR 0006), so it **can never change** once published: there is no way to walk
 * the stored envelopes and re-encrypt them without each user's key. Adding a new case is safe;
 * renaming or removing an existing one is not.
 *
 * The order is the one from the template, and axillary goes first on purpose: it is the most common
 * way to take a temperature at home, and the dropdown offers no empty option (the site is
 * mandatory), so the first option is the one you confirm or change.
 */
enum TemperatureMeasurementSite: string implements PatientLabelled
{
    /** Axila. */
    case Axillary = 'axillary';

    /** Boca (sublingual). */
    case Oral = 'oral';

    /** Ear, on the tympanic membrane. */
    case Tympanic = 'tympanic';

    /** Forehead, over the temporal artery. */
    case TemporalArtery = 'temporal';

    /** Recto. */
    case Rectal = 'rectal';

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
            [self::Axillary, 'es'] => 'Axilar',
            [self::Oral, 'es'] => 'Oral',
            [self::Tympanic, 'es'] => 'Timpánica (oído)',
            [self::TemporalArtery, 'es'] => 'Frente (arteria temporal)',
            [self::Rectal, 'es'] => 'Rectal',
            [self::Axillary, 'en'] => 'Armpit',
            [self::Oral, 'en'] => 'Mouth',
            [self::Tympanic, 'en'] => 'Ear (eardrum)',
            [self::TemporalArtery, 'en'] => 'Forehead (temporal artery)',
            [self::Rectal, 'en'] => 'Rectal',
            [self::Axillary, 'zh_CN'] => '腋下',
            [self::Oral, 'zh_CN'] => '口腔',
            [self::Tympanic, 'zh_CN'] => '耳道（鼓膜）',
            [self::TemporalArtery, 'zh_CN'] => '额头（颞动脉）',
            [self::Rectal, 'zh_CN'] => '直肠',
            [self::Axillary, 'hi'] => 'बगल',
            [self::Oral, 'hi'] => 'मुँह',
            [self::Tympanic, 'hi'] => 'कान (कान का पर्दा)',
            [self::TemporalArtery, 'hi'] => 'माथा (टेम्पोरल धमनी)',
            [self::Rectal, 'hi'] => 'मलाशय',
            [self::Axillary, 'fr'] => 'Aisselle',
            [self::Oral, 'fr'] => 'Bouche',
            [self::Tympanic, 'fr'] => 'Oreille (tympan)',
            [self::TemporalArtery, 'fr'] => 'Front (artère temporale)',
            [self::Rectal, 'fr'] => 'Rectum',
            [self::Axillary, 'ar'] => 'الإبط',
            [self::Oral, 'ar'] => 'الفم',
            [self::Tympanic, 'ar'] => 'الأذن (طبلة الأذن)',
            [self::TemporalArtery, 'ar'] => 'الجبهة (الشريان الصدغي)',
            [self::Rectal, 'ar'] => 'المستقيم',
            [self::Axillary, 'bn'] => 'বগল',
            [self::Oral, 'bn'] => 'মুখ',
            [self::Tympanic, 'bn'] => 'কান (কানের পর্দা)',
            [self::TemporalArtery, 'bn'] => 'কপাল (টেম্পোরাল ধমনী)',
            [self::Rectal, 'bn'] => 'মলদ্বার',
            [self::Axillary, 'pt'] => 'Axila',
            [self::Oral, 'pt'] => 'Boca',
            [self::Tympanic, 'pt'] => 'Ouvido (tímpano)',
            [self::TemporalArtery, 'pt'] => 'Testa (artéria temporal)',
            [self::Rectal, 'pt'] => 'Retal',
            [self::Axillary, 'ru'] => 'Подмышка',
            [self::Oral, 'ru'] => 'Рот',
            [self::Tympanic, 'ru'] => 'Ухо (барабанная перепонка)',
            [self::TemporalArtery, 'ru'] => 'Лоб (височная артерия)',
            [self::Rectal, 'ru'] => 'Ректально',
            [self::Axillary, 'ur'] => 'بغل',
            [self::Oral, 'ur'] => 'منہ',
            [self::Tympanic, 'ur'] => 'کان (پردۂ سماعت)',
            [self::TemporalArtery, 'ur'] => 'پیشانی (شقیقی شریان)',
            [self::Rectal, 'ur'] => 'مقعدی',
            [self::Axillary, 'id'] => 'Ketiak',
            [self::Oral, 'id'] => 'Mulut',
            [self::Tympanic, 'id'] => 'Telinga (gendang telinga)',
            [self::TemporalArtery, 'id'] => 'Dahi (arteri temporal)',
            [self::Rectal, 'id'] => 'Rektal',
            [self::Axillary, 'de'] => 'Achselhöhle',
            [self::Oral, 'de'] => 'Mund',
            [self::Tympanic, 'de'] => 'Ohr (Trommelfell)',
            [self::TemporalArtery, 'de'] => 'Stirn (Schläfenarterie)',
            [self::Rectal, 'de'] => 'Rektal',
            [self::Axillary, 'ja'] => 'わきの下',
            [self::Oral, 'ja'] => '口',
            [self::Tympanic, 'ja'] => '耳（鼓膜）',
            [self::TemporalArtery, 'ja'] => '額（側頭動脈）',
            [self::Rectal, 'ja'] => '直腸',
            [self::Axillary, 'sw'] => 'Kwapa',
            [self::Oral, 'sw'] => 'Mdomo',
            [self::Tympanic, 'sw'] => 'Sikio (ngoma ya sikio)',
            [self::TemporalArtery, 'sw'] => 'Paji la uso (ateri ya muda)',
            [self::Rectal, 'sw'] => 'Rektamu',
            [self::Axillary, 'mr'] => 'काख',
            [self::Oral, 'mr'] => 'तोंड',
            [self::Tympanic, 'mr'] => 'कान (कर्णपटल)',
            [self::TemporalArtery, 'mr'] => 'कपाळ (टेम्पोरल धमनी)',
            [self::Rectal, 'mr'] => 'गुदाशय',
            [self::Axillary, 'te'] => 'చంక',
            [self::Oral, 'te'] => 'నోరు',
            [self::Tympanic, 'te'] => 'చెవి (కర్ణభేరి)',
            [self::TemporalArtery, 'te'] => 'నుదురు (టెంపోరల్ ధమని)',
            [self::Rectal, 'te'] => 'మలాశయం',
            [self::Axillary, 'ta'] => 'அக்குள்',
            [self::Oral, 'ta'] => 'வாய்',
            [self::Tympanic, 'ta'] => 'காது (செவிப்பறை)',
            [self::TemporalArtery, 'ta'] => 'நெற்றி (டெம்போரல் தமனி)',
            [self::Rectal, 'ta'] => 'மலக்குடல்',
            [self::Axillary, 'tr'] => 'Koltuk altı',
            [self::Oral, 'tr'] => 'Ağız',
            [self::Tympanic, 'tr'] => 'Kulak (kulak zarı)',
            [self::TemporalArtery, 'tr'] => 'Alın (temporal arter)',
            [self::Rectal, 'tr'] => 'Rektal',
            [self::Axillary, 'ko'] => '겨드랑이',
            [self::Oral, 'ko'] => '입',
            [self::Tympanic, 'ko'] => '귀 (고막)',
            [self::TemporalArtery, 'ko'] => '이마 (측두동맥)',
            [self::Rectal, 'ko'] => '직장',
            [self::Axillary, 'vi'] => 'Nách',
            [self::Oral, 'vi'] => 'Miệng',
            [self::Tympanic, 'vi'] => 'Tai (màng nhĩ)',
            [self::TemporalArtery, 'vi'] => 'Trán (động mạch thái dương)',
            [self::Rectal, 'vi'] => 'Trực tràng',
            [self::Axillary, 'jv'] => 'Kelet',
            [self::Oral, 'jv'] => 'Cangkem',
            [self::Tympanic, 'jv'] => 'Kuping (gendhang kuping)',
            [self::TemporalArtery, 'jv'] => 'Bathuk (arteri temporal)',
            [self::Rectal, 'jv'] => 'Rektal',
            [self::Axillary, 'it'] => 'Ascella',
            [self::Oral, 'it'] => 'Bocca',
            [self::Tympanic, 'it'] => 'Orecchio (timpano)',
            [self::TemporalArtery, 'it'] => 'Fronte (arteria temporale)',
            [self::Rectal, 'it'] => 'Rettale',
            [self::Axillary, 'ha'] => 'Hamata',
            [self::Oral, 'ha'] => 'Baki',
            [self::Tympanic, 'ha'] => 'Kunne (membran kunne)',
            [self::TemporalArtery, 'ha'] => 'Goshi (jijiyar haikali)',
            [self::Rectal, 'ha'] => 'Dubura',
            [self::Axillary, 'th'] => 'รักแร้',
            [self::Oral, 'th'] => 'ปาก',
            [self::Tympanic, 'th'] => 'หู (แก้วหู)',
            [self::TemporalArtery, 'th'] => 'หน้าผาก (หลอดเลือดแดงขมับ)',
            [self::Rectal, 'th'] => 'ทางทวารหนัก',
            [self::Axillary, 'fa'] => 'زیر بغل',
            [self::Oral, 'fa'] => 'دهان',
            [self::Tympanic, 'fa'] => 'گوش (پرده گوش)',
            [self::TemporalArtery, 'fa'] => 'پیشانی (شریان گیجگاهی)',
            [self::Rectal, 'fa'] => 'مقعدی',
            [self::Axillary, 'pl'] => 'Pacha',
            [self::Oral, 'pl'] => 'Usta',
            [self::Tympanic, 'pl'] => 'Ucho (błona bębenkowa)',
            [self::TemporalArtery, 'pl'] => 'Czoło (tętnica skroniowa)',
            [self::Rectal, 'pl'] => 'Odbytniczo',
            default => throw new ValueError(sprintf('Missing measurement site label for locale "%s".', $locale)),
        };
    }
}
