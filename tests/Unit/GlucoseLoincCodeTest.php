<?php

declare(strict_types=1);

use App\Catalog\GlucoseLoincCode;
use App\Catalog\GlucoseMeasurementMethod;
use App\Catalog\UcumUnit;

/**
 * Los cuatro códigos LOINC de glucemia (ADR 0005 y ADR 0008) están verificados contra la fuente
 * y no deben cambiar. Cada combinación de método y unidad resuelve exactamente al suyo.
 */
it('resuelve cada combinación de método y unidad a su código LOINC verificado', function (
    GlucoseMeasurementMethod $method,
    UcumUnit $unit,
    string $expectedCode,
): void {
    expect(GlucoseLoincCode::resolve($method, $unit)->value)->toBe($expectedCode);
})->with([
    'capilar en mg/dL' => [GlucoseMeasurementMethod::Capillary, UcumUnit::MilligramsPerDeciliter, '41653-7'],
    'capilar en mmol/L' => [GlucoseMeasurementMethod::Capillary, UcumUnit::MillimolesPerLiter, '14743-9'],
    'intersticial en mg/dL' => [GlucoseMeasurementMethod::Interstitial, UcumUnit::MilligramsPerDeciliter, '99504-3'],
    'intersticial en mmol/L (código de seis dígitos)' => [GlucoseMeasurementMethod::Interstitial, UcumUnit::MillimolesPerLiter, '105272-9'],
]);

/**
 * El resolutor es total sobre las combinaciones soportadas y ruidoso ante las que no lo son: un
 * código LOINC equivocado es un dato clínico equivocado, así que nunca debe devolver uno por
 * defecto. `Gram` es una unidad real del catálogo (peso) que no tiene código de glucemia.
 */
it('lanza excepción ante una combinación de método y unidad no soportada', function (): void {
    GlucoseLoincCode::resolve(GlucoseMeasurementMethod::Capillary, UcumUnit::Gram);
})->throws(ValueError::class);

/**
 * La etiqueta al paciente convive con el término oficial LOINC, no lo sustituye (ADR 0005).
 */
it('mantiene el término oficial LOINC junto a la etiqueta propia del paciente', function (): void {
    $code = GlucoseLoincCode::CapillaryMilligramsPerDeciliter;

    expect($code->officialName())->toBe('Glucose [Mass/volume] in Capillary blood by Glucometer')
        ->and($code->patientLabel('es'))->toBe('Glucosa en sangre capilar')
        ->and($code->patientLabel('en'))->toBe('Blood glucose (capillary)')
        ->and($code->patientLabel('es'))->not->toBe($code->officialName());
});

/**
 * Estos valores de cadena viajan dentro del sobre cifrado del evento de medición (ADR 0002,
 * ADR 0006, ADR 0008). Un sobre ya cifrado no se puede recorrer y re-cifrar con un token nuevo
 * sin la clave de cada usuario, así que este es un test de regresión contra un cambio accidental
 * del valor: si falla, el cambio propuesto es incompatible con datos ya guardados.
 */
it('no cambia el token de método de medición guardado en eventos cifrados', function (): void {
    expect(GlucoseMeasurementMethod::Capillary->value)->toBe('capillary')
        ->and(GlucoseMeasurementMethod::Interstitial->value)->toBe('interstitial');
});

/** Igual que el anterior, pero para los códigos UCUM de unidad. */
it('no cambia el código UCUM de unidad guardado en eventos cifrados', function (): void {
    expect(UcumUnit::MilligramsPerDeciliter->value)->toBe('mg/dL')
        ->and(UcumUnit::MillimolesPerLiter->value)->toBe('mmol/L');
});
