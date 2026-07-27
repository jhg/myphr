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
 * Los enums del catálogo con etiqueta al paciente, con el nombre del método que la devuelve.
 *
 * `GlucoseLoincCode` usa `patientLabel()` en vez de `label()` porque ahí la etiqueta convive con el
 * término oficial LOINC y el ADR 0005 exige que no se confundan.
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

/** Cada caso de cada enum del catálogo, con el método que da su etiqueta al paciente. */
dataset('catalog cases', function (): Generator {
    foreach (catalogLabelSources() as [$enum, $method]) {
        foreach ($enum::cases() as $case) {
            yield sprintf('%s::%s', class_basename($enum), $case->name) => [$case, $method];
        }
    }
});

/**
 * El chino simplificado es el tercer idioma, y la etiqueta al paciente es la única capa que podemos
 * ofrecer completa en los tres: LOINC no publica traducción oficial al chino de estos términos
 * (ADR 0005), así que el término oficial sigue en inglés y esta capa es nuestra.
 */
it('devuelve etiqueta en los tres idiomas para cada caso del catálogo', function (
    BackedEnum $case,
    string $method,
): void {
    foreach (SupportedLocale::all() as $locale) {
        expect(trim($case->{$method}($locale)))->not->toBe('');
    }
})->with('catalog cases');

/**
 * Un idioma sin traducir se detecta aquí y no en producción: si alguien añade un caso y solo
 * rellena el castellano, la etiqueta china sería la castellana y nadie se daría cuenta.
 */
it('no deja caer al castellano la etiqueta china de ningún caso', function (
    BackedEnum $case,
    string $method,
): void {
    $chinese = $case->{$method}('zh_CN');

    expect($chinese)->not->toBe($case->{$method}('es'))
        ->and($chinese)->toMatch('/\p{Han}/u');
})->with('catalog cases');

/**
 * Un idioma desconocido no revienta la pantalla: cae al idioma por defecto, que es el inglés. Una
 * cuenta con una preferencia obsoleta o una cabecera rara del navegador es alguien que no entiende
 * la interfaz, no un error del que haya que enterarse con un 500.
 */
it('cae al idioma por defecto ante un idioma desconocido', function (
    BackedEnum $case,
    string $method,
): void {
    $english = $case->{$method}('en');

    expect($case->{$method}('kl'))->toBe($english)
        ->and($case->{$method}(''))->toBe($english)
        ->and($case->{$method}('xx_YY'))->toBe($english);
})->with('catalog cases');

/**
 * Las variantes regionales que manda un navegador de verdad sí se reconocen: `zh-CN` con guion es
 * la forma de BCP 47, y `es-AR` casa por la parte de idioma.
 */
it('reconoce las variantes regionales del idioma', function (
    BackedEnum $case,
    string $method,
): void {
    expect($case->{$method}('zh-CN'))->toBe($case->{$method}('zh_CN'))
        ->and($case->{$method}('ZH_cn'))->toBe($case->{$method}('zh_CN'))
        ->and($case->{$method}('es-AR'))->toBe($case->{$method}('es'));
})->with('catalog cases');

/**
 * ADR 0005: el término publicado por Regenstrief va en `coding.display` y no se traduce nunca, ni
 * siquiera al chino. Nuestra etiqueta va aparte y es la que se traduce.
 */
it('no traduce el término oficial LOINC en ningún idioma', function (): void {
    $code = GlucoseLoincCode::CapillaryMilligramsPerDeciliter;

    expect($code->officialName())->toBe('Glucose [Mass/volume] in Capillary blood by Glucometer')
        ->and($code->patientLabel('zh_CN'))->toBe('毛细血管血糖')
        ->and($code->patientLabel('zh_CN'))->not->toBe($code->officialName())
        ->and(BloodPressureLoincCode::Systolic->officialName())->toBe('Systolic blood pressure');
});
