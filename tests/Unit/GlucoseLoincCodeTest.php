<?php

declare(strict_types=1);

use App\Catalog\GlucoseLoincCode;
use App\Catalog\GlucoseMeasurementMethod;
use App\Catalog\UcumUnit;

/**
 * The four blood glucose LOINC codes (ADR 0005 and ADR 0008) are verified against the source and
 * must not change. Every method and unit pair resolves to exactly its own.
 */
it('resolves every method and unit pair to its verified LOINC code', function (
    GlucoseMeasurementMethod $method,
    UcumUnit $unit,
    string $expectedCode,
): void {
    expect(GlucoseLoincCode::resolve($method, $unit)->value)->toBe($expectedCode);
})->with([
    'capilar en mg/dL' => [GlucoseMeasurementMethod::Capillary, UcumUnit::MilligramsPerDeciliter, '41653-7'],
    'capilar en mmol/L' => [GlucoseMeasurementMethod::Capillary, UcumUnit::MillimolesPerLiter, '14743-9'],
    'intersticial en mg/dL' => [GlucoseMeasurementMethod::Interstitial, UcumUnit::MilligramsPerDeciliter, '99504-3'],
    'interstitial in mmol/L (six-digit code)' => [GlucoseMeasurementMethod::Interstitial, UcumUnit::MillimolesPerLiter, '105272-9'],
]);

/**
 * The resolver is total over the supported pairs and loud about the unsupported ones: a wrong LOINC
 * code is a wrong clinical fact, so it must never return a default one. `Gram` is a real catalog
 * unit (weight) that has no blood glucose code.
 */
it('throws on an unsupported method and unit pair', function (): void {
    GlucoseLoincCode::resolve(GlucoseMeasurementMethod::Capillary, UcumUnit::Gram);
})->throws(ValueError::class);

/**
 * The patient label lives alongside the official LOINC term, it does not replace it (ADR 0005).
 */
it('keeps the official LOINC term alongside our own patient label', function (): void {
    $code = GlucoseLoincCode::CapillaryMilligramsPerDeciliter;

    expect($code->officialName())->toBe('Glucose [Mass/volume] in Capillary blood by Glucometer')
        ->and($code->patientLabel('es'))->toBe('Glucosa en sangre capilar')
        ->and($code->patientLabel('en'))->toBe('Blood glucose (capillary)')
        ->and($code->patientLabel('es'))->not->toBe($code->officialName());
});

/**
 * These string values travel inside the encrypted envelope of a measurement event (ADR 0002,
 * ADR 0006, ADR 0008). An already encrypted envelope cannot be walked and re-encrypted with a new
 * token without each user's key, so this is a regression test against an accidental change of the
 * value: if it fails, the proposed change is incompatible with already stored data.
 */
it('does not change the measurement method token stored in encrypted events', function (): void {
    expect(GlucoseMeasurementMethod::Capillary->value)->toBe('capillary')
        ->and(GlucoseMeasurementMethod::Interstitial->value)->toBe('interstitial');
});

/** Same as the previous one, but for the UCUM unit codes. */
it('does not change the UCUM unit code stored in encrypted events', function (): void {
    expect(UcumUnit::MilligramsPerDeciliter->value)->toBe('mg/dL')
        ->and(UcumUnit::MillimolesPerLiter->value)->toBe('mmol/L');
});
