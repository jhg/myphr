<?php

declare(strict_types=1);

namespace App\Catalog;

use App\Support\SupportedLocale;
use ValueError;

/**
 * Lista cerrada de unidades para la cantidad de un alimento dentro de una comida (ADR 0006).
 *
 * Decisión literal del usuario: gramos, miligramos, kilos, centilitros, litros, mililitros y
 * unidades, y nada más. Los alimentos en sí NO se codifican contra ningún vocabulario (es una
 * excepción consciente al ADR 0005, justificada en el ADR que cubre la pantalla de comidas), pero
 * la unidad sí va codificada en UCUM (http://unitsofmeasure.org), tal y como exige el ADR 0005 para
 * evitar una conversión imposible más adelante.
 *
 * Códigos verificados uno a uno contra la especificación UCUM (tabla de unidades comunes
 * https://ucum.org/docs/common-units y el listado de HL7 en
 * https://terminology.hl7.org/5.5.0/ValueSet-ucum-common.html, ambos con la forma sensible a
 * mayúsculas de la especificación):
 * - Gramo: `g`.
 * - Miligramo: `mg` (prefijo `m` = mili).
 * - Kilogramo: `kg` (prefijo `k` = kilo).
 * - Centilitro: `cL` (prefijo `c` = centi sobre `L`, no `cl`: la forma en mayúscula es la que UCUM
 *   documenta como alternativa sensible a mayúsculas para evitar confundir la `l` minúscula con el
 *   dígito 1, y es la que usan HL7/FHIR en sus tablas de unidades comunes).
 * - Litro: `L` (no `l`, mismo motivo).
 * - Mililitro: `mL` (no `ml`, mismo motivo).
 * - Unidades (recuento de piezas): UCUM no tiene un símbolo propio para "una pieza"; la cantidad
 *   adimensional es la unidad `1`, y UCUM permite anotarla entre llaves para que el código siga
 *   siendo legible sin cambiar su semántica (`{annotation}` es azúcar sintáctico sobre `1`). Se
 *   elige `{each}` en vez de `1` a secas porque un código UCUM vacío de anotación ("1") no dice
 *   nada por sí solo en una lista de unidades, y `{each}` es la anotación que ya usan ejemplos de
 *   HL7/FHIR para "una pieza, un ítem" cuando no hay una unidad de conteo más específica (p. ej.
 *   comprimidos, cápsulas). Queda documentado aquí para que se pueda revisar.
 *
 * El valor de cada caso es ese código UCUM tal cual, no una aproximación legible. Es un token que
 * viaja dentro del sobre cifrado (ADR 0004, ADR 0006), así que, igual que
 * {@see GlucoseMeasurementMethod}, **no puede cambiar nunca** una vez publicado: renombrar o
 * eliminar un caso dejaría ilegibles los sobres ya guardados, porque no hay forma de recorrerlos y
 * re-cifrarlos con el token nuevo sin la clave de cada usuario.
 *
 * Añadir un caso nuevo es seguro; renombrar o eliminar uno existente no lo es.
 */
enum FoodQuantityUnit: string
{
    /** Gramos. */
    case Gram = 'g';

    /** Miligramos. */
    case Milligram = 'mg';

    /** Kilogramos. */
    case Kilogram = 'kg';

    /** Centilitros. */
    case Centiliter = 'cL';

    /** Litros. */
    case Liter = 'L';

    /** Mililitros. */
    case Milliliter = 'mL';

    /** Unidades sueltas (piezas), sin una unidad de conteo más específica. */
    case Piece = '{each}';

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
            [self::Gram, 'es'] => 'Gramos',
            [self::Milligram, 'es'] => 'Miligramos',
            [self::Kilogram, 'es'] => 'Kilogramos',
            [self::Centiliter, 'es'] => 'Centilitros',
            [self::Liter, 'es'] => 'Litros',
            [self::Milliliter, 'es'] => 'Mililitros',
            [self::Piece, 'es'] => 'Unidades',
            [self::Gram, 'en'] => 'Grams',
            [self::Milligram, 'en'] => 'Milligrams',
            [self::Kilogram, 'en'] => 'Kilograms',
            [self::Centiliter, 'en'] => 'Centiliters',
            [self::Liter, 'en'] => 'Liters',
            [self::Milliliter, 'en'] => 'Milliliters',
            [self::Piece, 'en'] => 'Units',
            [self::Gram, 'zh_CN'] => '克',
            [self::Milligram, 'zh_CN'] => '毫克',
            [self::Kilogram, 'zh_CN'] => '千克',
            [self::Centiliter, 'zh_CN'] => '厘升',
            [self::Liter, 'zh_CN'] => '升',
            [self::Milliliter, 'zh_CN'] => '毫升',
            [self::Piece, 'zh_CN'] => '个',
            default => throw new ValueError(sprintf('Falta la etiqueta de unidad de cantidad de alimento para el idioma "%s".', $locale)),
        };
    }
}
