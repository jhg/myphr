<?php

declare(strict_types=1);

namespace App\Catalog;

use App\Support\SupportedLocale;
use ValueError;

/**
 * Context of a blood glucose reading relative to the nearest meal (ADR 0006).
 *
 * ADR 0006 calls it "the field with the most clinical value on the list": without it, a reading of
 * 180 mg/dL does not say whether it is fasting hyperglycaemia or a normal rise after eating. The
 * value of each case is the stable token that goes into the encrypted envelope (ADR 0004: "stable
 * tokens, never visible labels"), so, like {@see GlucoseMeasurementMethod}, it **can never change**
 * once published: renaming or removing a case would leave the stored envelopes unreadable.
 *
 * There was no enum for this in the catalog; it is created here following the style of
 * {@see GlucoseMeasurementMethod} and {@see UcumUnit}.
 */
enum MealContext: string implements PatientLabelled
{
    /** Fasting, without having eaten yet. */
    case Fasting = 'fasting';

    /** Before eating. */
    case BeforeMeal = 'before_meal';

    /** After eating. */
    case AfterMeal = 'after_meal';

    /** At bedtime. */
    case Bedtime = 'bedtime';

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
            [self::Fasting, 'es'] => 'En ayunas',
            [self::BeforeMeal, 'es'] => 'Antes de comer',
            [self::AfterMeal, 'es'] => 'Después de comer',
            [self::Bedtime, 'es'] => 'Al acostarse',
            [self::Fasting, 'en'] => 'Fasting',
            [self::BeforeMeal, 'en'] => 'Before meal',
            [self::AfterMeal, 'en'] => 'After meal',
            [self::Bedtime, 'en'] => 'Bedtime',
            [self::Fasting, 'zh_CN'] => '空腹',
            [self::BeforeMeal, 'zh_CN'] => '餐前',
            [self::AfterMeal, 'zh_CN'] => '餐后',
            [self::Bedtime, 'zh_CN'] => '睡前',
            default => throw new ValueError(sprintf('Missing meal context label for locale "%s".', $locale)),
        };
    }
}
