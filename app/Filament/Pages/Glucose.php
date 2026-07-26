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
 * Pantalla de glucemia (ADR 0002, ADR 0004, ADR 0005, ADR 0006, ADR 0008).
 *
 * Esta clase no ve nunca el contenido de una glucemia. El transporte común de ciphertext —el
 * sobre baja como valor de retorno y sube como parámetro de método, nunca en una propiedad
 * pública, así que no entra en el snapshot de Livewire (ADR 0002)— vive en {@see HealthEventPage}
 * y es compartido con el resto de pantallas de eventos clínicos. El servidor valida la envoltura
 * del sobre y la autorización, nunca el contenido: no hay forma de comprobar que dentro dice
 * «glucosa» sin la clave del usuario.
 *
 * La vista (`resources/views/phr/pages/glucose.blade.php`) es un componente Alpine propio, no un
 * formulario de Filament: el ADR 0002 reserva los campos y columnas de Filament para datos en claro,
 * y aquí todo el contenido clínico está cifrado.
 */
final class Glucose extends HealthEventPage
{
    protected static string|BackedEnum|null $navigationIcon = Heroicon::Beaker;

    protected string $view = 'phr.pages.glucose';

    /**
     * El título y la etiqueta de navegación se resuelven por método y no como propiedad estática
     * porque un inicializador de propiedad en PHP solo admite expresiones constantes: `__()` no
     * puede llamarse ahí. Dejarlos como cadena fija es lo que mantenía el menú y las cabeceras en
     * castellano aunque el resto de la pantalla ya estuviera traducido.
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
     * Catálogo público en claro que el cliente necesita para construir el payload cifrado (ADR
     * 0005, ADR 0008). No es dato clínico: son los mismos tokens y códigos para cualquier usuario.
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
        /** El catálogo es en claro y lo pinta el servidor, así que las etiquetas salen ya en el
         * idioma en vigor para esta petición (App\Support\SupportedLocale). */
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
     * Tabla que resuelve (método, unidad) al código LOINC de glucemia (ADR 0005, ADR 0008), para
     * que el cliente no tenga que reimplementar {@see GlucoseLoincCode::resolve()}.
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
