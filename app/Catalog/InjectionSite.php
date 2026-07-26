<?php

declare(strict_types=1);

namespace App\Catalog;

use App\Support\SupportedLocale;
use ValueError;

/**
 * Zona de inyección de la insulina (ADR 0006, «en la insulina, el producto concreto en texto libre
 * ..., más la zona de inyección»).
 *
 * Propio de la insulina, no común a todo evento: vive dentro de `data`, junto a `insulinType`,
 * `dose`, `unit` y `product`. Es opcional, con el mismo criterio que
 * {@see MealContext}: si la persona no la indica, el campo se omite del contenido
 * cifrado en vez de guardarse con un valor por defecto silencioso, porque una zona inventada es
 * peor que ninguna.
 *
 * El valor de cada caso es el token estable que entra en el sobre cifrado (ADR 0004: «tokens
 * estables, nunca etiquetas visibles»), así que, igual que {@see GlucoseMeasurementMethod}, **no
 * puede cambiar nunca** una vez publicado. Cambiarlo dejaría ilegibles los sobres cifrados ya
 * guardados, porque no hay forma de recorrerlos y re-cifrarlos con el token nuevo sin la clave de
 * cada usuario.
 *
 * Añadir un caso nuevo es seguro; renombrar o eliminar uno existente no lo es.
 */
enum InjectionSite: string implements PatientLabelled
{
    /** Abdomen. */
    case Abdomen = 'abdomen';

    /** Muslo. */
    case Thigh = 'thigh';

    /** Glúteo. */
    case Glute = 'glute';

    /** Brazo. */
    case Arm = 'arm';

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
            [self::Abdomen, 'es'] => 'Abdomen',
            [self::Thigh, 'es'] => 'Muslo',
            [self::Glute, 'es'] => 'Glúteo',
            [self::Arm, 'es'] => 'Brazo',
            [self::Abdomen, 'en'] => 'Abdomen',
            [self::Thigh, 'en'] => 'Thigh',
            [self::Glute, 'en'] => 'Glute',
            [self::Arm, 'en'] => 'Arm',
            [self::Abdomen, 'zh_CN'] => '腹部',
            [self::Thigh, 'zh_CN'] => '大腿',
            [self::Glute, 'zh_CN'] => '臀部',
            [self::Arm, 'zh_CN'] => '手臂',
            default => throw new ValueError(sprintf('Falta la etiqueta de zona de inyección para el idioma "%s".', $locale)),
        };
    }
}
