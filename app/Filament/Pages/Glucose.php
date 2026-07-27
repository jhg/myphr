<?php

declare(strict_types=1);

namespace App\Filament\Pages;

use App\Catalog\GlucoseLoincCode;
use App\Catalog\GlucoseMeasurementMethod;
use App\Catalog\MealContext;
use App\Catalog\RecordedBy;
use App\Catalog\UcumUnit;
use BackedEnum;
use Filament\Support\Icons\Heroicon;
use Illuminate\Contracts\Support\Htmlable;
use ValueError;

/**
 * Blood glucose screen (ADR 0002, ADR 0004, ADR 0005, ADR 0006, ADR 0008).
 *
 * This class never sees the content of a blood glucose reading. The shared ciphertext transport —the
 * envelope comes down as a return value and goes up as a method parameter, never in a public
 * property, so it does not enter the Livewire snapshot (ADR 0002)— lives in {@see HealthEventPage}
 * and is shared with the rest of the clinical event screens. The server validates the envelope
 * wrapper and authorization, never the content: there is no way to check that it says "glucose"
 * inside without the user's key.
 *
 * The view (`resources/views/phr/pages/glucose.blade.php`) is an Alpine component of its own, not a
 * Filament form: ADR 0002 reserves Filament fields and columns for plaintext data, and here all the
 * clinical content is encrypted.
 */
final class Glucose extends HealthEventPage
{
    protected static string|BackedEnum|null $navigationIcon = Heroicon::Beaker;

    protected string $view = 'phr.pages.glucose';

    /**
     * The title and the navigation label are resolved by method and not as a static property because
     * a property initializer in PHP only accepts constant expressions: `__()` cannot be called
     * there. Leaving them as fixed strings is what kept the menu and the headers in Spanish even
     * when the rest of the screen was already translated.
     */
    public function getTitle(): string|Htmlable
    {
        return __('Blood glucose');
    }

    public static function getNavigationLabel(): string
    {
        return __('Blood glucose');
    }

    /**
     * Public plaintext catalog the client needs to build the encrypted payload (ADR 0005,
     * ADR 0008). It is not clinical data: the same tokens and codes for every user.
     *
     * @return array{
     *     units: list<array{code: string, label: string}>,
     *     methods: list<array{token: string, label: string}>,
     *     mealContexts: list<array{token: string, label: string}>,
     *     recordedByRoles: list<array{token: string, label: string}>,
     *     loinc: list<array{method: string, unit: string, code: string}>,
     * }
     */
    public function catalog(): array
    {
        /** The catalog is plaintext and the server paints it, so the labels already come out in the
         * language in force for this request (App\Support\SupportedLocale). */
        $locale = app()->getLocale();

        return [
            'units' => [
                ['code' => UcumUnit::MilligramsPerDeciliter->value, 'label' => 'mg/dL'],
                ['code' => UcumUnit::MillimolesPerLiter->value, 'label' => 'mmol/L'],
            ],
            'methods' => self::labelledOptions(GlucoseMeasurementMethod::cases(), $locale),
            'mealContexts' => self::labelledOptions(MealContext::cases(), $locale),
            'recordedByRoles' => self::labelledOptions(RecordedBy::cases(), $locale),
            'loinc' => self::loincTable(),
        ];
    }

    /**
     * Table resolving (method, unit) to the blood glucose LOINC code (ADR 0005, ADR 0008), so the
     * client does not have to reimplement {@see GlucoseLoincCode::resolve()}.
     *
     * @return list<array{method: string, unit: string, code: string}>
     */
    private static function loincTable(): array
    {
        $table = [];

        foreach (GlucoseMeasurementMethod::cases() as $method) {
            foreach (UcumUnit::cases() as $unit) {
                try {
                    $code = GlucoseLoincCode::resolve($method, $unit);
                } catch (ValueError) {
                    continue;
                }

                $table[] = [
                    'method' => $method->value,
                    'unit' => $unit->value,
                    'code' => $code->value,
                ];
            }
        }

        return $table;
    }
}
