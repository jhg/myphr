<?php

declare(strict_types=1);

namespace App\Catalog;

use App\Support\SupportedLocale;
use ValueError;

/**
 * Whether the value of a clinical event was typed by hand or came from a device (ADR 0006, "Fields
 * we capture even though we do not use them today").
 *
 * Common to every event type, not specific to blood glucose: it lives at the top level of the
 * decrypted content (`origin`), next to `v`, `type` and `tz`, not inside `data`. The value of each
 * case is the stable token that goes into the encrypted envelope (ADR 0004: "stable tokens, never
 * visible labels"), so, like {@see GlucoseMeasurementMethod}, it **can never change** once
 * published.
 *
 * Unlike {@see MealContext}, this field does admit a sensible default: it is not a clinical claim,
 * it is a fact about how the data got in, and by far the most common case is that it was typed by
 * hand.
 *
 * No capture form asks for this value: manual entry is always `Manual`, so asking has no real answer
 * and only invites wrong ones (a confusion this project already suffered once with "measurement
 * method", which is a different thing: what it was measured with, not how it got into the
 * application). The enum is not deleted even though nobody asks for it today: the value still
 * travels inside the encrypted envelope because a future automatic import (syncing with a connected
 * glucose meter or sensor) will build the event with `Device` and no human involved, and what you
 * do not capture at the source cannot be reconstructed later.
 */
enum DataOrigin: string
{
    /** Typed by hand by whoever records it. */
    case Manual = 'manual';

    /** Read automatically from a device (sensor, connected glucose meter, etc.). */
    case Device = 'device';

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
            [self::Manual, 'es'] => 'Manual',
            [self::Device, 'es'] => 'Aparato',
            [self::Manual, 'en'] => 'Manual',
            [self::Device, 'en'] => 'Device',
            [self::Manual, 'zh_CN'] => '手动输入',
            [self::Device, 'zh_CN'] => '设备读取',
            [self::Manual, 'hi'] => 'हाथ से दर्ज',
            [self::Device, 'hi'] => 'उपकरण से',
            [self::Manual, 'fr'] => 'Saisie manuelle',
            [self::Device, 'fr'] => 'Depuis un appareil',
            [self::Manual, 'ar'] => 'إدخال يدوي',
            [self::Device, 'ar'] => 'من جهاز',
            [self::Manual, 'bn'] => 'হাতে লিখে দেওয়া',
            [self::Device, 'bn'] => 'ডিভাইস থেকে',
            [self::Manual, 'pt'] => 'Registo manual',
            [self::Device, 'pt'] => 'A partir de dispositivo',
            [self::Manual, 'ru'] => 'Введено вручную',
            [self::Device, 'ru'] => 'Получено с устройства',
            [self::Manual, 'ur'] => 'دستی اندراج',
            [self::Device, 'ur'] => 'آلے سے',
            [self::Manual, 'id'] => 'Dimasukkan manual',
            [self::Device, 'id'] => 'Dari perangkat',
            [self::Manual, 'de'] => 'Manuell eingegeben',
            [self::Device, 'de'] => 'Von Gerät',
            [self::Manual, 'ja'] => '手入力',
            [self::Device, 'ja'] => '機器から取得',
            [self::Manual, 'sw'] => 'Iliyoingizwa mwenyewe',
            [self::Device, 'sw'] => 'Kutoka kwenye kifaa',
            [self::Manual, 'mr'] => 'हाताने नोंदवलेले',
            [self::Device, 'mr'] => 'उपकरणातून',
            [self::Manual, 'te'] => 'చేతితో నమోదు చేసినది',
            [self::Device, 'te'] => 'పరికరం నుండి',
            [self::Manual, 'ta'] => 'கையால் உள்ளிடப்பட்டது',
            [self::Device, 'ta'] => 'சாதனத்திலிருந்து',
            [self::Manual, 'tr'] => 'Manuel girildi',
            [self::Device, 'tr'] => 'Cihazdan alındı',
            [self::Manual, 'ko'] => '수동 입력',
            [self::Device, 'ko'] => '기기에서 가져옴',
            [self::Manual, 'vi'] => 'Nhập thủ công',
            [self::Device, 'vi'] => 'Từ thiết bị',
            [self::Manual, 'jv'] => 'Diiseni kanthi manual',
            [self::Device, 'jv'] => 'Saka piranti',
            [self::Manual, 'it'] => 'Inserito manualmente',
            [self::Device, 'it'] => 'Da dispositivo',
            [self::Manual, 'ha'] => 'An shigar da hannu',
            [self::Device, 'ha'] => 'Daga na\'ura',
            [self::Manual, 'th'] => 'ป้อนด้วยตนเอง',
            [self::Device, 'th'] => 'จากอุปกรณ์',
            [self::Manual, 'fa'] => 'ورود دستی',
            [self::Device, 'fa'] => 'از دستگاه',
            [self::Manual, 'pl'] => 'Wprowadzone ręcznie',
            [self::Device, 'pl'] => 'Z urządzenia',
            default => throw new ValueError(sprintf('Missing data origin label for locale "%s".', $locale)),
        };
    }
}
