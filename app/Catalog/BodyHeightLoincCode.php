<?php

declare(strict_types=1);

namespace App\Catalog;

/**
 * Código LOINC de la estatura corporal.
 *
 * **Por qué el genérico 8302-2 «Body height» y no una variante.** LOINC publica una familia entera
 * alrededor de la estatura, y cada variante afirma algo distinto:
 *
 * * `8308-9` «Body height --standing» y `8306-3` «Body height --lying» afirman la POSTURA. La
 *   distinción es real —tumbado se mide algo más que de pie, y en lactantes es la única forma de
 *   medir—, pero esta pantalla no pregunta la postura. Guardar «de pie» sin haberlo preguntado sería
 *   inventarse un dato clínico, que es justo lo contrario del criterio de
 *   {@see TemperatureLoincCode}: allí el genérico no se usa porque la pantalla SÍ exige el sitio, y
 *   tirar un dato que se tiene deja un código peor de lo que permite el dato.
 * * `3137-7` «Body height Measured» y `3138-5` «Body height Stated» afirman el MÉTODO. Aquí está la
 *   diferencia con el peso, que sí usa la variante «Measured» ({@see BodyWeightLoincCode}): el peso
 *   se teclea leyendo una báscula en ese momento, mientras que la estatura se teclea casi siempre de
 *   memoria. Sin preguntarlo no se puede saber si fue medida o declarada, y afirmar «Measured» sería
 *   falso la mayoría de las veces.
 *
 * El genérico 8302-2 es además el que exige el perfil de constantes vitales de FHIR
 * (http://hl7.org/fhir/StructureDefinition/vitalsigns), así que es también el que mejor viaja fuera.
 *
 * Si algún día la pantalla llega a preguntar la postura, esta clase pasa a tener un resolutor con la
 * forma de {@see TemperatureLoincCode::resolve()} y los códigos `8308-9` / `8306-3` como casos
 * nuevos. Añadir un caso es seguro; cambiar el valor de este **no lo es**: entra en el contenido que
 * se cifra en el navegador (ADR 0002, ADR 0004), donde ya no se puede corregir sin la clave de cada
 * usuario.
 *
 * Verificado contra LOINC con la herramienta de terminologías médicas (2026-07-27).
 */
enum BodyHeightLoincCode: string
{
    /** Estatura corporal, sin afirmar postura ni método. */
    case Generic = '8302-2';

    /** Término oficial LOINC, en inglés, tal y como lo publica Regenstrief Institute (ADR 0005). */
    public function officialName(): string
    {
        return match ($this) {
            self::Generic => 'Body height',
        };
    }
}
