<?php

declare(strict_types=1);

namespace App\Catalog;

use App\Support\SupportedLocale;
use ValueError;

/**
 * Sitio del cuerpo donde se tomó la temperatura.
 *
 * Es el método de medición que exige el ADR 0008 (docs/adr/0008-measurement-method.md) para esta
 * magnitud: el sitio cambia el valor de forma conocida —la axilar va varias décimas por debajo de
 * la rectal para la misma persona en el mismo momento— y solo se sabe al medir, así que se pregunta
 * y nunca se deduce. Mezclar sitios en una misma serie sin decirlo produciría una curva que no
 * significa nada, igual que mezclar brazos en la tensión.
 *
 * A diferencia del brazo y la postura de la tensión, aquí el sitio **además determina el código
 * LOINC** ({@see TemperatureLoincCode}): LOINC publica un código distinto por sitio de medida. El
 * token de este enum sigue viajando aparte en `data.site`, porque el código es vocabulario de
 * intercambio y el token es lo que agrupa nuestras series.
 *
 * El valor de cada caso es ese token, que se serializa dentro del payload que se cifra en el
 * navegador (ADR 0002, ADR 0006), así que **no puede cambiar nunca** una vez publicado: no hay forma
 * de recorrer los sobres ya guardados y re-cifrarlos sin la clave de cada usuario. Añadir un caso
 * nuevo es seguro; renombrar o eliminar uno existente no lo es.
 *
 * El orden es el de la plantilla, y la axilar va primera a propósito: es la forma más habitual de
 * tomar la temperatura en casa, y el desplegable no ofrece opción vacía (el sitio es obligatorio),
 * así que la primera opción es la que se confirma o se cambia.
 */
enum TemperatureMeasurementSite: string implements PatientLabelled
{
    /** Axila. */
    case Axillary = 'axillary';

    /** Boca (sublingual). */
    case Oral = 'oral';

    /** Oído, sobre la membrana timpánica. */
    case Tympanic = 'tympanic';

    /** Frente, sobre la arteria temporal. */
    case TemporalArtery = 'temporal';

    /** Recto. */
    case Rectal = 'rectal';

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
            [self::Axillary, 'es'] => 'Axilar',
            [self::Oral, 'es'] => 'Oral',
            [self::Tympanic, 'es'] => 'Timpánica (oído)',
            [self::TemporalArtery, 'es'] => 'Frente (arteria temporal)',
            [self::Rectal, 'es'] => 'Rectal',
            [self::Axillary, 'en'] => 'Armpit',
            [self::Oral, 'en'] => 'Mouth',
            [self::Tympanic, 'en'] => 'Ear (eardrum)',
            [self::TemporalArtery, 'en'] => 'Forehead (temporal artery)',
            [self::Rectal, 'en'] => 'Rectal',
            [self::Axillary, 'zh_CN'] => '腋下',
            [self::Oral, 'zh_CN'] => '口腔',
            [self::Tympanic, 'zh_CN'] => '耳道（鼓膜）',
            [self::TemporalArtery, 'zh_CN'] => '额头（颞动脉）',
            [self::Rectal, 'zh_CN'] => '直肠',
            default => throw new ValueError(sprintf('Falta la etiqueta de sitio de medición para el idioma "%s".', $locale)),
        };
    }
}
