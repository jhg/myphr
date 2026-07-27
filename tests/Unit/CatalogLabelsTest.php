<?php

declare(strict_types=1);

use App\Catalog\BloodPressureArm;
use App\Catalog\BloodPressureLoincCode;
use App\Catalog\BloodPressurePosture;
use App\Catalog\DataOrigin;
use App\Catalog\FoodQuantityUnit;
use App\Catalog\GlucoseLoincCode;
use App\Catalog\GlucoseMeasurementMethod;
use App\Catalog\InjectionSite;
use App\Catalog\InsulinType;
use App\Catalog\MealContext;
use App\Catalog\MealType;
use App\Catalog\RecordedBy;
use App\Catalog\TemperatureMeasurementSite;
use App\Support\SupportedLocale;

/**
 * The catalog enums with a patient label, together with the name of the method that returns it.
 *
 * `GlucoseLoincCode` uses `patientLabel()` instead of `label()` because there the label lives
 * alongside the official LOINC term and ADR 0005 requires that they not be confused.
 *
 * @return list<array{class-string, string}>
 */
function catalogLabelSources(): array
{
    return [
        [BloodPressureArm::class, 'label'],
        [BloodPressurePosture::class, 'label'],
        [DataOrigin::class, 'label'],
        [FoodQuantityUnit::class, 'label'],
        [GlucoseMeasurementMethod::class, 'label'],
        [InjectionSite::class, 'label'],
        [InsulinType::class, 'label'],
        [MealContext::class, 'label'],
        [MealType::class, 'label'],
        [RecordedBy::class, 'label'],
        [TemperatureMeasurementSite::class, 'label'],
        [GlucoseLoincCode::class, 'patientLabel'],
    ];
}

/** Every case of every catalog enum, with the method that gives its patient label. */
dataset('catalog cases', function (): Generator {
    foreach (catalogLabelSources() as [$enum, $method]) {
        foreach ($enum::cases() as $case) {
            yield sprintf('%s::%s', class_basename($enum), $case->name) => [$case, $method];
        }
    }
});

/**
 * Simplified Chinese is the third language, and the patient label is the only layer we can offer
 * complete in all three: LOINC publishes no official Chinese translation of these terms
 * (ADR 0005), so the official term stays in English and this layer is ours.
 */
it('returns a label in all three languages for every catalog case', function (
    BackedEnum $case,
    string $method,
): void {
    foreach (SupportedLocale::all() as $locale) {
        expect(trim($case->{$method}($locale)))->not->toBe('');
    }
})->with('catalog cases');

/**
 * An untranslated language is caught here and not in production: if somebody adds a case and only
 * fills in Spanish, the Chinese label would be the Spanish one and nobody would notice.
 */
it('never falls back to Spanish for the Chinese label of any case', function (
    BackedEnum $case,
    string $method,
): void {
    $chinese = $case->{$method}('zh_CN');

    expect($chinese)->not->toBe($case->{$method}('es'))
        ->and($chinese)->toMatch('/\p{Han}/u');
})->with('catalog cases');

/**
 * An unknown language does not blow the screen up: it falls back to the default language, which is
 * English. An account with a stale preference or an odd browser header is somebody who does not
 * understand the interface, not an error we need to hear about through a 500.
 */
it('falls back to the default language for an unknown language', function (
    BackedEnum $case,
    string $method,
): void {
    $english = $case->{$method}('en');

    expect($case->{$method}('kl'))->toBe($english)
        ->and($case->{$method}(''))->toBe($english)
        ->and($case->{$method}('xx_YY'))->toBe($english);
})->with('catalog cases');

/**
 * The regional variants a real browser sends are recognized: `zh-CN` with a dash is the BCP 47 form,
 * and `es-AR` matches on the language part.
 */
it('recognizes the regional variants of a language', function (
    BackedEnum $case,
    string $method,
): void {
    expect($case->{$method}('zh-CN'))->toBe($case->{$method}('zh_CN'))
        ->and($case->{$method}('ZH_cn'))->toBe($case->{$method}('zh_CN'))
        ->and($case->{$method}('es-AR'))->toBe($case->{$method}('es'));
})->with('catalog cases');

/**
 * ADR 0005: the term published by Regenstrief goes in `coding.display` and is never translated, not
 * even into Chinese. Our label lives apart and is the one that gets translated.
 */
it('never translates the official LOINC term into any language', function (): void {
    $code = GlucoseLoincCode::CapillaryMilligramsPerDeciliter;

    expect($code->officialName())->toBe('Glucose [Mass/volume] in Capillary blood by Glucometer')
        ->and($code->patientLabel('zh_CN'))->toBe('毛细血管血糖')
        ->and($code->patientLabel('zh_CN'))->not->toBe($code->officialName())
        ->and(BloodPressureLoincCode::Systolic->officialName())->toBe('Systolic blood pressure');
});
