<?php

declare(strict_types=1);

namespace App\Catalog;

/**
 * Código LOINC del peso corporal.
 *
 * A diferencia de la glucemia ({@see GlucoseLoincCode}), aquí no hay tabla de resolución: LOINC
 * nombra el peso corporal medido con un único código, sin distinguir la unidad. El kilogramo y la
 * libra son dos formas de expresar la misma magnitud —la unidad viaja aparte, como código UCUM
 * ({@see UcumUnit}), tal y como exige el ADR 0005— y no cambian el concepto observado, así que
 * ninguna de las dos necesita un código propio.
 *
 * Tampoco hay método de medición que registrar (ADR 0008): una báscula da el mismo peso sin que
 * quien pesa tenga que declarar nada que altere el valor de forma conocida, al contrario de lo que
 * pasa con el brazo y la postura en la tensión o con el sitio de medida en la temperatura
 * ({@see TemperatureLoincCode}).
 *
 * El valor está verificado contra LOINC y **no debe modificarse**: entra en el contenido que se
 * cifra en el navegador (ADR 0002, ADR 0004), así que cambiarlo dejaría los sobres ya guardados
 * diciendo una cosa y el catálogo otra, sin forma de reconciliarlos sin la clave de cada usuario.
 */
enum BodyWeightLoincCode: string
{
    /** Peso corporal medido (no declarado ni estimado). */
    case Measured = '3141-9';

    /** Término oficial LOINC, en inglés, tal y como lo publica Regenstrief Institute (ADR 0005). */
    public function officialName(): string
    {
        return match ($this) {
            self::Measured => 'Body weight Measured',
        };
    }
}
