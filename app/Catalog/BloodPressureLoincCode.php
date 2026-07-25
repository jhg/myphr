<?php

declare(strict_types=1);

namespace App\Catalog;

/**
 * Códigos LOINC de los tres componentes de una lectura de tensión arterial.
 *
 * A diferencia de la glucemia ({@see GlucoseLoincCode}), aquí el código no depende del método: el
 * ADR 0008 (docs/adr/0008-measurement-method.md) es explícito en que «los códigos LOINC que usamos
 * para esta magnitud... nombran la magnitud y nada más», así que el brazo y la postura viajan en
 * campos propios ({@see BloodPressureArm}, {@see BloodPressurePosture}) y el código LOINC es
 * siempre el mismo para cada componente. Por eso este catálogo no necesita un resolutor como
 * {@see GlucoseLoincCode::resolve()}: cada caso ya es el código final.
 *
 * Los tres valores están verificados contra LOINC (herramienta de terminologías médicas,
 * 2026-07-25) y no deben modificarse: es el mismo aviso de inmutabilidad que
 * {@see GlucoseMeasurementMethod}, porque el código entra también en el contenido que se cifra en
 * el navegador (ADR 0002, ADR 0004).
 *
 * Una lectura no trae siempre los tres: el pulso es opcional porque no todos los aparatos de
 * tensión lo dan, así que `Pulse` puede no aparecer en `data.loinc` de un evento concreto.
 */
enum BloodPressureLoincCode: string
{
    /** Presión arterial sistólica. */
    case Systolic = '8480-6';

    /** Presión arterial diastólica. */
    case Diastolic = '8462-4';

    /** Frecuencia cardiaca (pulso). */
    case Pulse = '8867-4';

    /** Término oficial LOINC, en inglés, tal y como lo publica Regenstrief Institute. */
    public function officialName(): string
    {
        return match ($this) {
            self::Systolic => 'Systolic blood pressure',
            self::Diastolic => 'Diastolic blood pressure',
            self::Pulse => 'Heart rate',
        };
    }
}
