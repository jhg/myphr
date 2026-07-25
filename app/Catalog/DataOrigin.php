<?php

declare(strict_types=1);

namespace App\Catalog;

use App\Support\SupportedLocale;
use ValueError;

/**
 * Si el dato de un evento clínico se tecleó a mano o llegó de un aparato (ADR 0006, «Campos que se
 * capturan aunque hoy no se usen»).
 *
 * Común a todo tipo de evento, no propio de la glucemia: vive en el nivel superior del contenido
 * descifrado (`origin`), junto a `v`, `type` y `tz`, no dentro de `data`. El valor de cada caso es
 * el token estable que entra en el sobre cifrado (ADR 0004: «tokens estables, nunca etiquetas
 * visibles»), así que, igual que {@see GlucoseMeasurementMethod}, **no puede cambiar nunca** una vez
 * publicado.
 *
 * A diferencia de {@see MealContext}, este campo sí admite un valor por defecto razonable: no es
 * una afirmación clínica, es un hecho sobre cómo entró el dato, y lo más frecuente con diferencia es
 * que se teclee a mano.
 *
 * Ningún formulario de captura pregunta este valor: la inserción manual siempre es `Manual`, así
 * que preguntarlo no tiene respuesta real y solo invita a contestar mal (confusión ya sufrida una
 * vez en este proyecto con "método de medición", que es otra cosa: con qué se midió, no cómo entró
 * el dato en la aplicación). El enum no se borra aunque hoy nadie lo pregunte: el valor sigue
 * viajando en el sobre cifrado porque una futura importación automática (sincronización con un
 * glucómetro o sensor conectado) construirá el evento con `Device` sin intervención humana, y lo
 * que no se captura en origen no se puede reconstruir después.
 */
enum DataOrigin: string
{
    /** Introducido a mano por quien registra. */
    case Manual = 'manual';

    /** Leído automáticamente de un aparato (sensor, glucómetro conectado, etc.). */
    case Device = 'device';

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
            [self::Manual, 'es'] => 'Manual',
            [self::Device, 'es'] => 'Aparato',
            [self::Manual, 'en'] => 'Manual',
            [self::Device, 'en'] => 'Device',
            [self::Manual, 'zh_CN'] => '手动输入',
            [self::Device, 'zh_CN'] => '设备读取',
            default => throw new ValueError(sprintf('Falta la etiqueta de origen del dato para el idioma "%s".', $locale)),
        };
    }
}
