<?php

declare(strict_types=1);

namespace App\Sharing;

use App\Catalog\BloodPressureArm;
use App\Catalog\BloodPressureLoincCode;
use App\Catalog\BloodPressurePosture;
use App\Catalog\BodyHeightLoincCode;
use App\Catalog\BodyWeightLoincCode;
use App\Catalog\FoodQuantityUnit;
use App\Catalog\GlucoseLoincCode;
use App\Catalog\GlucoseMeasurementMethod;
use App\Catalog\InjectionSite;
use App\Catalog\InsulinType;
use App\Catalog\MealContext;
use App\Catalog\MealType;
use App\Catalog\PatientLabelled;
use App\Catalog\RecordedBy;
use App\Catalog\TemperatureLoincCode;
use App\Catalog\TemperatureMeasurementSite;
use App\Filament\Pages\Sharing;
use App\Support\SupportedLocale;
use BackedEnum;

/**
 * Vocabulario en claro que la página del lector necesita para pintar un recorte (ADR 0011).
 *
 * Todo lo que sale de aquí es **dato público de referencia** (ADR 0005): tokens de catálogo con su
 * etiqueta y términos oficiales LOINC. Nada depende de ninguna cuenta, nada distingue a un lector de
 * otro y nada dice qué contiene el recorte que se va a abrir: el mismo JSON se sirve para un enlace
 * vivo, uno caducado y uno que nunca existió. Los valores clínicos siguen dentro del paquete
 * cifrado, y esta clase no los ve ni puede verlos.
 *
 * **Por qué las etiquetas salen en los tres idiomas a la vez y no solo en el negociado.** La página
 * se pinta en el `Accept-Language` del profesional (nunca en el idioma del paciente, que es columna
 * en claro por el ADR 0007 y no tiene por qué salir de casa), pero esa cabecera dice el idioma del
 * navegador, no el de quien lo usa: en una consulta el portátil suele estar en el idioma que dejó
 * puesto quien lo instaló. Que el selector de idioma funcione sin recargar exige tener las tres
 * versiones ya en la página, porque una segunda petición para cambiar de idioma sería una petición
 * más que ata a ese lector con ese enlace, y una cookie de preferencia sería justo la cookie que
 * esta ruta se quita de encima. Son unos kilobytes de texto.
 *
 * **Los términos oficiales LOINC no se traducen** (ADR 0005): van una sola vez, fuera del bloque por
 * idioma, en el inglés que publica Regenstrief. Es lo que se copia a una historia clínica.
 */
final readonly class ReaderCatalog
{
    /**
     * Cómo se enseña cada código UCUM, que es notación de intercambio y no algo que se le pida leer
     * a nadie (ADR 0005). No se traduce: `mg/dL` es `mg/dL` en los tres idiomas.
     *
     * Un código que no esté en esta tabla se enseña tal cual en el cliente, sin inventar nada: ver
     * `unitLabel()` en `resources/js/reader/clinicalReport.js`.
     *
     * @var array<string, string>
     */
    private const array UNIT_DISPLAY = [
        'mg/dL' => 'mg/dL',
        'mmol/L' => 'mmol/L',
        'Cel' => '°C',
        '[degF]' => '°F',
        'kg' => 'kg',
        'g' => 'g',
        '[lb_av]' => 'lb',
        'cm' => 'cm',
        '[in_i]' => 'in',
        'mm[Hg]' => 'mmHg',
        /** Pulso: el código UCUM es `/min`, pero lo que lee un clínico es «lpm/bpm». */
        '/min' => 'bpm',
        /** Unidad internacional de insulina (`App\Filament\Pages\Insulin::UNIT_INTERNATIONAL_UNIT`). */
        '[iU]' => 'IU',
    ];

    /**
     * @return array{
     *     locales: list<array{code: string, label: string}>,
     *     labels: array<string, array<string, array<string, string>>>,
     *     loinc: array<string, string>,
     *     units: array<string, string>,
     * }
     */
    public function toArray(): array
    {
        $labels = [];

        foreach (SupportedLocale::all() as $locale) {
            $labels[$locale] = $this->labelsFor($locale);
        }

        return [
            'locales' => $this->locales(),
            'labels' => $labels,
            'loinc' => $this->loinc(),
            'units' => self::UNIT_DISPLAY,
        ];
    }

    /**
     * Nombre de cada idioma **en ese mismo idioma**, nunca traducido al de la página: quien busca
     * su idioma en un selector busca la palabra que reconoce, no su traducción.
     *
     * @return list<array{code: string, label: string}>
     */
    private function locales(): array
    {
        $names = ['en' => 'English', 'es' => 'Español', 'zh_CN' => '简体中文'];

        return array_map(
            static fn (string $locale): array => ['code' => $locale, 'label' => $names[$locale] ?? $locale],
            SupportedLocale::all(),
        );
    }

    /**
     * Etiquetas de catálogo en un idioma.
     *
     * Los seis tipos clínicos se nombran con las mismas palabras que el menú del panel
     * ({@see Sharing::SHAREABLE_TYPES}), para que quien comparte y quien lee
     * estén hablando de lo mismo.
     *
     * @return array<string, array<string, string>>
     */
    private function labelsFor(string $locale): array
    {
        return [
            'types' => [
                'glucose' => __('Blood glucose', [], $locale),
                'bloodPressure' => __('Blood pressure', [], $locale),
                'insulin' => __('Insulin', [], $locale),
                'meal' => __('Meals', [], $locale),
                'bodyWeight' => __('Body weight', [], $locale),
                'temperature' => __('Temperature', [], $locale),
            ],
            'glucoseMethods' => $this->tokens(GlucoseMeasurementMethod::cases(), $locale),
            'mealContexts' => $this->tokens(MealContext::cases(), $locale),
            'arms' => $this->tokens(BloodPressureArm::cases(), $locale),
            'postures' => $this->tokens(BloodPressurePosture::cases(), $locale),
            'insulinTypes' => $this->tokens(InsulinType::cases(), $locale),
            'injectionSites' => $this->tokens(InjectionSite::cases(), $locale),
            'mealTypes' => $this->tokens(MealType::cases(), $locale),
            'temperatureSites' => $this->tokens(TemperatureMeasurementSite::cases(), $locale),
            'recordedBy' => $this->tokens(RecordedBy::cases(), $locale),
            /**
             * `FoodQuantityUnit` publica `code` en vez de `token` y no implementa
             * {@see PatientLabelled}, pero su `label()` sí traduce: «pieza» no es notación UCUM.
             */
            'foodUnits' => array_reduce(
                FoodQuantityUnit::cases(),
                static function (array $carry, FoodQuantityUnit $unit) use ($locale): array {
                    $carry[$unit->value] = $unit->label($locale);

                    return $carry;
                },
                [],
            ),
        ];
    }

    /**
     * @param  list<PatientLabelled&BackedEnum>  $cases
     * @return array<string, string>
     */
    private function tokens(array $cases, string $locale): array
    {
        $labels = [];

        foreach ($cases as $case) {
            $labels[(string) $case->value] = $case->label($locale);
        }

        return $labels;
    }

    /**
     * Término oficial de cada código LOINC que este proyecto emite, en inglés y sin traducir
     * (ADR 0005): es el nombre que identifica la magnitud fuera de esta aplicación.
     *
     * @return array<string, string>
     */
    private function loinc(): array
    {
        $names = [];

        foreach ([
            ...GlucoseLoincCode::cases(),
            ...BloodPressureLoincCode::cases(),
            ...TemperatureLoincCode::cases(),
            ...BodyWeightLoincCode::cases(),
            ...BodyHeightLoincCode::cases(),
        ] as $code) {
            $names[$code->value] = $code->officialName();
        }

        return $names;
    }
}
