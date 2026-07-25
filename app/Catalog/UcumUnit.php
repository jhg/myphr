<?php

declare(strict_types=1);

namespace App\Catalog;

/**
 * Unidades del catálogo clínico, identificadas por su código UCUM (http://unitsofmeasure.org).
 *
 * El ADR 0005 (docs/adr/0005-clinical-vocabulary-loinc-snomed.md) exige guardar la unidad como
 * código UCUM y no como texto libre: es lo que exige FHIR y evita una conversión imposible más
 * adelante, ya que corregirla obligaría a re-cifrar en el navegador todos los sobres de todos los
 * usuarios. El valor de cada caso es ese código UCUM tal cual lo define el estándar (sensible a
 * mayúsculas y símbolos), no una aproximación legible.
 *
 * `Gram` se incluye como ejemplo del ADR (unidad de peso) y no participa hoy en la resolución de
 * ningún código de glucemia; existe para dejar constancia de que el catálogo de unidades es
 * compartido entre magnitudes y no exclusivo de la glucemia.
 */
enum UcumUnit: string
{
    /** Miligramos por decilitro. */
    case MilligramsPerDeciliter = 'mg/dL';

    /** Milimoles por litro. */
    case MillimolesPerLiter = 'mmol/L';

    /** Gramos. Reservada para magnitudes futuras (p. ej. peso); no aplica a glucemia. */
    case Gram = 'g';
}
