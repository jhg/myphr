<?php

declare(strict_types=1);

namespace App\Catalog;

use App\Support\SupportedLocale;
use ValueError;

/**
 * Quién registró un evento clínico: la propia persona o alguien que la cuida (ADR 0006, «Campos que
 * se capturan aunque hoy no se usen»).
 *
 * Común a todo tipo de evento, no propio de la glucemia: vive en el nivel superior del contenido
 * descifrado (`recordedBy`), junto a `v`, `type` y `tz`, no dentro de `data`. El valor de cada caso
 * es el token estable que entra en el sobre cifrado (ADR 0004: «tokens estables, nunca etiquetas
 * visibles»), así que, igual que {@see GlucoseMeasurementMethod}, **no puede cambiar nunca** una vez
 * publicado.
 *
 * A diferencia de {@see MealContext}, este campo sí admite un valor por defecto razonable: no es una
 * afirmación clínica, es un hecho sobre cómo entró el dato, y lo más frecuente con diferencia es que
 * lo registre la propia persona.
 */
enum RecordedBy: string implements PatientLabelled
{
    /** Lo registra la propia persona sobre la que trata el evento. */
    case SelfReported = 'self';

    /** Lo registra alguien que la cuida (familiar, cuidador profesional, etc.). */
    case Caregiver = 'caregiver';

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
            [self::SelfReported, 'es'] => 'La propia persona',
            [self::Caregiver, 'es'] => 'Un cuidador',
            [self::SelfReported, 'en'] => 'The person themselves',
            [self::Caregiver, 'en'] => 'A caregiver',
            [self::SelfReported, 'zh_CN'] => '本人',
            [self::Caregiver, 'zh_CN'] => '照护者',
            default => throw new ValueError(sprintf('Falta la etiqueta de quién registra para el idioma "%s".', $locale)),
        };
    }
}
