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
            default => throw new ValueError(sprintf('Missing meal type label for locale "%s".', $locale)),
        };
    }
}
