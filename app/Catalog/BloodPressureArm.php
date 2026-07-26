<?php

declare(strict_types=1);

namespace App\Catalog;

use App\Support\SupportedLocale;
use ValueError;

/**
 * Brazo en el que se tomó una lectura de tensión arterial.
 *
 * El ADR 0008 (docs/adr/0008-measurement-method.md) explica que en la tensión arterial «el método
 * lo forman el brazo y la postura»: los dos cambian el valor de forma conocida y solo se saben en
 * el momento de medir, así que viajan como tokens explícitos y nunca se deducen. El valor de cada
 * caso es ese token, que se serializa dentro del payload que se cifra en el navegador (ADR 0002 y
 * ADR 0006), así que **no puede cambiar nunca** una vez publicado. Cambiarlo dejaría ilegibles los
 * sobres cifrados ya guardados, porque no hay forma de recorrerlos y re-cifrarlos con el token
 * nuevo sin la clave de cada usuario.
 *
 * Añadir un caso nuevo es seguro; renombrar o eliminar uno existente no lo es.
 */
enum BloodPressureArm: string implements PatientLabelled
{
    /** Brazo izquierdo. */
    case Left = 'left';

    /** Brazo derecho. */
    case Right = 'right';

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
            [self::Left, 'es'] => 'Izquierdo',
            [self::Right, 'es'] => 'Derecho',
            [self::Left, 'en'] => 'Left',
            [self::Right, 'en'] => 'Right',
            [self::Left, 'zh_CN'] => '左臂',
            [self::Right, 'zh_CN'] => '右臂',
            default => throw new ValueError(sprintf('Falta la etiqueta de brazo para el idioma "%s".', $locale)),
        };
    }
}
