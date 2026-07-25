<?php

declare(strict_types=1);

namespace App\Catalog;

/**
 * Unidades UCUM (http://unitsofmeasure.org) propias de la tensión arterial.
 *
 * Se declaran aparte de {@see UcumUnit} en vez de añadirse a ese enum compartido porque esta
 * pantalla no toca ficheros que no sean suyos (varios agentes trabajan en paralelo sobre el
 * catálogo). El ADR 0005 (docs/adr/0005-clinical-vocabulary-loinc-snomed.md) fija los milímetros
 * de mercurio como `mm[Hg]` y los latidos por minuto como `/min`, verificados contra UCUM: a
 * diferencia de la glucemia, la tensión no ofrece una unidad alternativa que el usuario deba
 * elegir, así que cada caso es fijo para su magnitud y no hay selector en la pantalla.
 */
enum BloodPressureUnit: string
{
    /** Milímetros de mercurio, unidad de la presión sistólica y diastólica. */
    case MillimetersOfMercury = 'mm[Hg]';

    /** Latidos por minuto, unidad del pulso. */
    case BeatsPerMinute = '/min';
}
