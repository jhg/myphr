<?php

declare(strict_types=1);

namespace App\Catalog;

use App\Support\SupportedLocale;
use ValueError;

/**
 * Arm a blood pressure reading was taken on.
 *
 * ADR 0008 (docs/adr/0008-measurement-method.md) explains that for blood pressure "the method is
 * made up of the arm and the posture": both change the value in a known way and are only known at
 * the moment of measuring, so they travel as explicit tokens and are never inferred. The value of
 * each case is that token, which is serialized inside the payload encrypted in the browser (ADR
 * 0002 and ADR 0006), so it **can never change** once published. Changing it would leave the
 * already stored encrypted envelopes unreadable, because there is no way to walk them and
 * re-encrypt them with the new token without each user's key.
 *
 * Adding a new case is safe; renaming or removing an existing one is not.
 */
enum BloodPressureArm: string implements PatientLabelled
{
    /** Brazo izquierdo. */
    case Left = 'left';

    /** Brazo derecho. */
    case Right = 'right';

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
            [self::Left, 'es'] => 'Izquierdo',
            [self::Right, 'es'] => 'Derecho',
            [self::Left, 'en'] => 'Left',
            [self::Right, 'en'] => 'Right',
            [self::Left, 'zh_CN'] => '左臂',
            [self::Right, 'zh_CN'] => '右臂',
            [self::Left, 'hi'] => 'बायाँ',
            [self::Right, 'hi'] => 'दायाँ',
            [self::Left, 'fr'] => 'Gauche',
            [self::Right, 'fr'] => 'Droit',
            [self::Left, 'ar'] => 'الأيسر',
            [self::Right, 'ar'] => 'الأيمن',
            [self::Left, 'bn'] => 'বাম',
            [self::Right, 'bn'] => 'ডান',
            [self::Left, 'pt'] => 'Esquerdo',
            [self::Right, 'pt'] => 'Direito',
            [self::Left, 'ru'] => 'Левая',
            [self::Right, 'ru'] => 'Правая',
            [self::Left, 'ur'] => 'بایاں',
            [self::Right, 'ur'] => 'دایاں',
            [self::Left, 'id'] => 'Kiri',
            [self::Right, 'id'] => 'Kanan',
            [self::Left, 'de'] => 'Links',
            [self::Right, 'de'] => 'Rechts',
            [self::Left, 'ja'] => '左腕',
            [self::Right, 'ja'] => '右腕',
            [self::Left, 'sw'] => 'Mkono wa kushoto',
            [self::Right, 'sw'] => 'Mkono wa kulia',
            [self::Left, 'mr'] => 'डावा',
            [self::Right, 'mr'] => 'उजवा',
            [self::Left, 'te'] => 'ఎడమ',
            [self::Right, 'te'] => 'కుడి',
            [self::Left, 'ta'] => 'இடது',
            [self::Right, 'ta'] => 'வலது',
            [self::Left, 'tr'] => 'Sol',
            [self::Right, 'tr'] => 'Sağ',
            [self::Left, 'ko'] => '왼팔',
            [self::Right, 'ko'] => '오른팔',
            [self::Left, 'vi'] => 'Tay trái',
            [self::Right, 'vi'] => 'Tay phải',
            [self::Left, 'jv'] => 'Kiwa',
            [self::Right, 'jv'] => 'Tengen',
            [self::Left, 'it'] => 'Sinistro',
            [self::Right, 'it'] => 'Destro',
            [self::Left, 'ha'] => 'Hagu',
            [self::Right, 'ha'] => 'Dama',
            [self::Left, 'th'] => 'แขนซ้าย',
            [self::Right, 'th'] => 'แขนขวา',
            [self::Left, 'fa'] => 'چپ',
            [self::Right, 'fa'] => 'راست',
            [self::Left, 'pl'] => 'Lewa',
            [self::Right, 'pl'] => 'Prawa',
            default => throw new ValueError(sprintf('Missing arm label for locale "%s".', $locale)),
        };
    }
}
