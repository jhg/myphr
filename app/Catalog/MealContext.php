<?php

declare(strict_types=1);

namespace App\Catalog;

use App\Support\SupportedLocale;
use ValueError;

/**
 * Contexto de una glucemia respecto a la comida más cercana (ADR 0006).
 *
 * El ADR 0006 lo señala como «el campo con más valor clínico de la lista»: sin él, una lectura de
 * 180 mg/dL no dice si es una hiperglucemia en ayunas o una subida normal tras comer. El valor de
 * cada caso es el token estable que entra en el sobre cifrado (ADR 0004: «tokens estables, nunca
 * etiquetas visibles»), así que, igual que {@see GlucoseMeasurementMethod}, **no puede cambiar
 * nunca** una vez publicado: renombrar o eliminar un caso dejaría ilegibles los sobres ya guardados.
 *
 * No existía un enum para esto en el catálogo; se crea aquí siguiendo el estilo de
 * {@see GlucoseMeasurementMethod} y {@see UcumUnit}.
 */
enum MealContext: string implements PatientLabelled
{
    /** En ayunas, sin haber comido todavía. */
    case Fasting = 'fasting';

    /** Antes de comer. */
    case BeforeMeal = 'before_meal';

    /** Después de comer. */
    case AfterMeal = 'after_meal';

    /** Al acostarse. */
    case Bedtime = 'bedtime';

    /**
     * Etiqueta en el idioma indicado, para mostrar al paciente (ADR 0005: la etiqueta no sustituye
     * al token, que es lo único que entra en el sobre cifrado).
     *
     * @param  string  $locale  Cualquier código; los no soportados caen al idioma por defecto.
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
            default => throw new ValueError(sprintf('Falta la etiqueta de contexto de comida para el idioma "%s".', $locale)),
        };
    }
}
