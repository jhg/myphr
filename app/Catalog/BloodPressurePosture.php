<?php

declare(strict_types=1);

namespace App\Catalog;

use App\Support\SupportedLocale;
use ValueError;

/**
 * Postura en la que se tomó una lectura de tensión arterial.
 *
 * Junto con {@see BloodPressureArm} forma el método de medición que exige el ADR 0008
 * (docs/adr/0008-measurement-method.md): la postura cambia el valor tanto como el brazo —la
 * tensión de alguien tumbado no es la misma que de pie, diferencia clave para detectar
 * hipotensión ortostática— y solo se sabe en el momento de medir. El valor de cada caso es el
 * token estable que entra en el sobre cifrado, así que, igual que {@see BloodPressureArm},
 * **no puede cambiar nunca** una vez publicado.
 *
 * Añadir un caso nuevo es seguro; renombrar o eliminar uno existente no lo es.
 */
enum BloodPressurePosture: string implements PatientLabelled
{
    /** Sentado. */
    case Sitting = 'sitting';

    /** Tumbado. */
    case Lying = 'lying';

    /** De pie. */
    case Standing = 'standing';

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
            [self::Sitting, 'es'] => 'Sentado',
            [self::Lying, 'es'] => 'Tumbado',
            [self::Standing, 'es'] => 'De pie',
            [self::Sitting, 'en'] => 'Sitting',
            [self::Lying, 'en'] => 'Lying down',
            [self::Standing, 'en'] => 'Standing',
            [self::Sitting, 'zh_CN'] => '坐位',
            [self::Lying, 'zh_CN'] => '卧位',
            [self::Standing, 'zh_CN'] => '立位',
            default => throw new ValueError(sprintf('Falta la etiqueta de postura para el idioma "%s".', $locale)),
        };
    }
}
