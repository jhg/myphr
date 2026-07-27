<?php

declare(strict_types=1);

namespace App\Catalog;

use ValueError;

/**
 * Resolutor del sitio de medición al código LOINC de temperatura corporal.
 *
 * El ADR 0005 (docs/adr/0005-clinical-vocabulary-loinc-snomed.md) recuerda que un código LOINC no
 * nombra solo la magnitud. En la temperatura eso se ve con claridad: LOINC publica un código
 * distinto **por sitio de medida** —oral, axilar, timpánica…— además del genérico «Body temperature»
 * (8310-5), que no dice dónde se midió. Por eso esta magnitud sí necesita un resolutor, al contrario
 * que la tensión ({@see BloodPressureLoincCode}), donde el método viaja aparte y el código es
 * constante.
 *
 * Se resuelve por sitio y no por unidad: los grados Celsius y los Fahrenheit son la misma
 * observación en otra escala y comparten código; la unidad viaja aparte como código UCUM
 * ({@see UcumUnit}), que es lo que exige el ADR 0005.
 *
 * El genérico 8310-5 **no se usa**: la pantalla exige elegir sitio (ver
 * {@see TemperatureMeasurementSite}), así que guardar «temperatura sin decir dónde» sería tirar un
 * dato que sí se tiene. Un código LOINC menos preciso de lo que permite el dato es un dato peor.
 *
 * Los cinco códigos están verificados contra LOINC (herramienta de terminologías médicas,
 * 2026-07-27) y **no deben modificarse**: entran en el contenido que se cifra en el navegador (ADR
 * 0002, ADR 0004), donde ya no se pueden corregir.
 */
enum TemperatureLoincCode: string
{
    /** Axilar. */
    case Axillary = '8328-7';

    /** Oral. */
    case Oral = '8331-1';

    /** Membrana timpánica. */
    case Tympanic = '8333-7';

    /** Arteria temporal (frente). */
    case TemporalArtery = '75539-7';

    /** Rectal. */
    case Rectal = '8332-9';

    /**
     * Resuelve el código LOINC de temperatura para un sitio de medición.
     *
     * Falla de forma ruidosa ante un sitio sin código en vez de caer al genérico 8310-5: un código
     * por defecto convertiría un caso nuevo sin revisar en un dato clínico menos preciso que se
     * guardaría cifrado y en silencio.
     *
     * @throws ValueError si el sitio no tiene código LOINC asignado.
     */
    public static function resolve(TemperatureMeasurementSite $site): self
    {
        return match ($site) {
            TemperatureMeasurementSite::Axillary => self::Axillary,
            TemperatureMeasurementSite::Oral => self::Oral,
            TemperatureMeasurementSite::Tympanic => self::Tympanic,
            TemperatureMeasurementSite::TemporalArtery => self::TemporalArtery,
            TemperatureMeasurementSite::Rectal => self::Rectal,
            default => throw new ValueError(sprintf(
                'No existe código LOINC de temperatura para el sitio de medición "%s".',
                $site->value,
            )),
        };
    }

    /** Término oficial LOINC, en inglés, tal y como lo publica Regenstrief Institute (ADR 0005). */
    public function officialName(): string
    {
        return match ($this) {
            self::Axillary => 'Axillary temperature',
            self::Oral => 'Oral temperature',
            self::Tympanic => 'Tympanic membrane temperature',
            self::TemporalArtery => 'Body temperature - Temporal artery',
            self::Rectal => 'Rectal temperature',
        };
    }
}
