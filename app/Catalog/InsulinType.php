<?php

declare(strict_types=1);

namespace App\Catalog;

use App\Support\SupportedLocale;
use ValueError;

/**
 * Tipo de insulina inyectada: rápida, lenta o mixta (ADR 0006, sección de tipos del MVP).
 *
 * El evento de insulina **no lleva código LOINC**: no es una observación de una magnitud, es el
 * registro de una administración de medicación (ADR 0006, «insulin (tipo rapid|long|mixed, dosis, y
 * código del producto si procede, porque es una administración de medicación y no una
 * observación)»). Es la diferencia con {@see GlucoseMeasurementMethod}: no se busca un
 * código de laboratorio para (tipo, unidad) porque no existe tal cosa aquí.
 *
 * El valor de cada caso es el token estable que entra en el sobre cifrado (ADR 0004: «tokens
 * estables, nunca etiquetas visibles»), así que, igual que {@see GlucoseMeasurementMethod}, **no
 * puede cambiar nunca** una vez publicado. Cambiarlo dejaría ilegibles los sobres cifrados ya
 * guardados, porque no hay forma de recorrerlos y re-cifrarlos con el token nuevo sin la clave de
 * cada usuario.
 *
 * Añadir un caso nuevo es seguro; renombrar o eliminar uno existente no lo es.
 */
enum InsulinType: string implements PatientLabelled
{
    /** Insulina de acción rápida. */
    case Rapid = 'rapid';

    /** Insulina de acción lenta (basal). */
    case Long = 'long';

    /** Insulina mixta (combinación de rápida y lenta en la misma inyección). */
    case Mixed = 'mixed';

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
            [self::Rapid, 'es'] => 'Rápida',
            [self::Long, 'es'] => 'Lenta',
            [self::Mixed, 'es'] => 'Mixta',
            [self::Rapid, 'en'] => 'Rapid-acting',
            [self::Long, 'en'] => 'Long-acting',
            [self::Mixed, 'en'] => 'Mixed',
            [self::Rapid, 'zh_CN'] => '速效',
            [self::Long, 'zh_CN'] => '长效',
            [self::Mixed, 'zh_CN'] => '预混',
            default => throw new ValueError(sprintf('Falta la etiqueta de tipo de insulina para el idioma "%s".', $locale)),
        };
    }
}
