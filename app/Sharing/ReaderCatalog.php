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
 * Plaintext vocabulary the reader page needs to paint a clipping (ADR 0011).
 *
 * Everything that comes out of here is **public reference data** (ADR 0005): catalog tokens with
 * their labels and official LOINC terms. Nothing depends on any account, nothing tells one reader
 * from another and nothing says what the clipping about to be opened contains: the same JSON is
 * served for a live link, an expired one and one that never existed. The clinical values stay inside
 * the encrypted package, and this class neither sees them nor can see them.
 *
 * **Why the labels come out in all three languages at once and not only the negotiated one.** The
 * page is painted in the professional's `Accept-Language` (never in the patient's language, which is
 * a plaintext column under ADR 0007 and has no reason to leave home), but that header says the
 * browser's language, not the language of whoever uses it: in a practice the laptop is usually in
 * whatever language the person who set it up left it in. Making the language selector work without a
 * reload requires having all three versions already on the page, because a second request to change
 * language would be one more request tying that reader to that link, and a preference cookie would
 * be exactly the cookie this route shakes off. It is a few kilobytes of text.
 *
 * **Official LOINC terms are not translated** (ADR 0005): they go once, outside the per-language
 * block, in the English Regenstrief publishes. That is what gets copied into a medical record.
 */
final readonly class ReaderCatalog
{
    /**
     * How each UCUM code is displayed, since it is exchange notation and not something anyone should
     * be asked to read (ADR 0005). It is not translated: `mg/dL` is `mg/dL` in all three languages.
     *
     * A code that is not in this table is shown as is on the client, without inventing anything: see
     * `unitLabel()` in `resources/js/reader/clinicalReport.js`.
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
        /** Pulse: the UCUM code is `/min`, but what a clinician reads is "bpm". */
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
     * Name of each language **in that same language**, never translated into the page's: someone
     * looking for their language in a selector looks for the word they recognize, not its
     * translation.
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
     * Catalog labels in one language.
     *
     * The six clinical types are named with the same words as the panel menu
     * ({@see Sharing::SHAREABLE_TYPES}), so whoever shares and whoever reads are talking about the
     * same thing.
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
             * `FoodQuantityUnit` exposes `code` instead of `token` and does not implement
             * {@see PatientLabelled}, but its `label()` does translate: "piece" is not UCUM notation.
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
     * Official term of every LOINC code this project emits, in English and untranslated
     * (ADR 0005): it is the name that identifies the quantity outside this application.
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
