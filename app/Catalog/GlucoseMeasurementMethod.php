<?php

declare(strict_types=1);

namespace App\Catalog;

use App\Support\SupportedLocale;
use ValueError;

/**
 * Método con el que se obtuvo una medición de glucemia.
 *
 * El ADR 0008 (docs/adr/0008-measurement-method.md) exige que el método viaje como un token
 * explícito dentro del propio evento de medición, y no se deduzca del código LOINC ni del
 * origen manual/aparato del dato. El valor de cada caso es ese token: se serializa dentro del
 * payload que se cifra en el navegador (ADR 0002 y ADR 0006), así que **no puede cambiar nunca**
 * una vez publicado. Cambiarlo dejaría ilegibles los sobres cifrados ya guardados, porque no hay
 * forma de recorrerlos y re-cifrarlos con el token nuevo sin la clave de cada usuario.
 *
 * Añadir un caso nuevo es seguro; renombrar o eliminar uno existente no lo es.
 */
enum GlucoseMeasurementMethod: string
{
    /** Medición en sangre capilar con glucómetro, tras punción digital. */
    case Capillary = 'capillary';

    /** Medición en líquido intersticial mediante sensor continuo (CGM/FGM). */
    case Interstitial = 'interstitial';

    /**
     * Etiqueta en el idioma indicado, para mostrar al paciente (ADR 0005: la etiqueta no sustituye
     * al token, que es lo único que entra en el sobre cifrado).
     *
     * Cada etiqueta nombra además el aparato entre paréntesis porque «capilar» e «intersticial» no
     * le dicen nada a quien solo sabe si se pinchó el dedo o lleva un sensor puesto.
     *
     * @param  string  $locale  Cualquier código; los no soportados caen al idioma por defecto.
     */
    public function label(string $locale): string
    {
        $locale = SupportedLocale::resolve($locale);

        return match ([$this, $locale]) {
            [self::Capillary, 'es'] => 'Capilar (punción digital)',
            [self::Interstitial, 'es'] => 'Intersticial (sensor continuo)',
            [self::Capillary, 'en'] => 'Capillary (finger prick)',
            [self::Interstitial, 'en'] => 'Interstitial (continuous sensor)',
            [self::Capillary, 'zh_CN'] => '毛细血管血（指尖采血）',
            [self::Interstitial, 'zh_CN'] => '组织液（连续监测传感器）',
            default => throw new ValueError(sprintf('Falta la etiqueta de método de medición para el idioma "%s".', $locale)),
        };
    }
}
