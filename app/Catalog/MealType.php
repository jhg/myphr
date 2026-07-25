<?php

declare(strict_types=1);

namespace App\Catalog;

use App\Support\SupportedLocale;
use ValueError;

/**
 * Tipo de comida de un evento `meal` (ADR 0006).
 *
 * Propio del evento de comidas: vive dentro de `data.mealType`, junto a la lista ordenada de
 * alimentos (`data.foods`). El valor de cada caso es el token estable que entra en el sobre cifrado
 * (ADR 0004: «tokens estables, nunca etiquetas visibles»), así que, igual que
 * {@see GlucoseMeasurementMethod}, **no puede cambiar nunca** una vez publicado: renombrar o
 * eliminar un caso dejaría ilegibles los sobres ya guardados, porque no hay forma de recorrerlos y
 * re-cifrarlos con el token nuevo sin la clave de cada usuario.
 *
 * Añadir un caso nuevo es seguro; renombrar o eliminar uno existente no lo es.
 */
enum MealType: string
{
    /** Desayuno. */
    case Breakfast = 'breakfast';

    /** Comida (almuerzo). */
    case Lunch = 'lunch';

    /** Cena. */
    case Dinner = 'dinner';

    /** Tentempié entre horas. */
    case Snack = 'snack';

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
            default => throw new ValueError(sprintf('Falta la etiqueta de tipo de comida para el idioma "%s".', $locale)),
        };
    }
}
