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
 *
 * Los códigos de peso corporal, estatura y temperatura son los que UCUM define, con sus corchetes
 * incluidos (`[lb_av]`, `[in_i]`, `[degF]`): esos corchetes marcan en UCUM las unidades «habituales» —no métricas— y
 * forman parte del código, no son un adorno de nuestra notación. Escribir `lb` o `degF` sería un
 * código distinto y, como el código viaja dentro del sobre cifrado, no habría forma de corregirlo
 * después sin la clave de cada usuario.
 */
enum UcumUnit: string
{
    /** Miligramos por decilitro. */
    case MilligramsPerDeciliter = 'mg/dL';

    /** Milimoles por litro. */
    case MillimolesPerLiter = 'mmol/L';

    /** Gramos. Reservada para magnitudes futuras (p. ej. peso); no aplica a glucemia. */
    case Gram = 'g';

    /** Kilogramos: unidad métrica de peso corporal. */
    case Kilogram = 'kg';

    /** Libras avoirdupois, la libra de uso corriente (1 lb = 0,45359237 kg exactos). */
    case Pound = '[lb_av]';

    /** Centímetros: unidad métrica de estatura corporal. */
    case Centimeter = 'cm';

    /**
     * Pulgada internacional (1 `[in_i]` = 0,0254 m exactos).
     *
     * El sufijo `_i` no es decoración nuestra: UCUM distingue la pulgada internacional de la
     * `[in_us]` (US survey inch), que es una unidad distinta. Escribir `in` a secas sería un código
     * que UCUM no define, y como viaja dentro del sobre cifrado no habría forma de corregirlo.
     */
    case Inch = '[in_i]';

    /** Grados Celsius. */
    case DegreeCelsius = 'Cel';

    /** Grados Fahrenheit. */
    case DegreeFahrenheit = '[degF]';
}
