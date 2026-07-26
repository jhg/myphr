<?php

declare(strict_types=1);

namespace App\Filament\Pages;

use App\Catalog\BloodPressureArm;
use App\Catalog\BloodPressureLoincCode;
use App\Catalog\BloodPressurePosture;
use App\Catalog\BloodPressureUnit;
use App\Catalog\DataOrigin;
use App\Catalog\RecordedBy;
use BackedEnum;
use Filament\Support\Icons\Heroicon;
use Illuminate\Contracts\Support\Htmlable;

/**
 * Pantalla de tensión arterial (ADR 0002, ADR 0004, ADR 0005, ADR 0006, ADR 0008).
 *
 * Un evento de tensión arterial guarda sistólica, diastólica y pulso juntos: el ADR 0006 es
 * explícito en que la tensión es «un solo evento», no tres, porque es lo que da el aparato y lo
 * que vive el paciente. El pulso es opcional: no todos los tensiómetros lo miden.
 *
 * El ADR 0008 fija que el método de medición de la tensión lo forman el brazo y la postura, porque
 * los dos cambian el valor de forma conocida y solo se saben al medir; viajan como dos tokens
 * propios (`data.arm`, `data.posture`) y no como campos sueltos junto a la magnitud. El código
 * LOINC no depende de ninguno de los dos (ver JSDoc de {@see BloodPressureLoincCode}),
 * así que, a diferencia de la glucemia, no hace falta una tabla de resolución (método, unidad) →
 * código: los tres códigos son constantes.
 *
 * Igual que {@see Glucose}, esta clase no ve nunca el contenido de una lectura: el transporte común
 * de ciphertext vive en {@see HealthEventPage}, que valida la envoltura del sobre y la
 * autorización, nunca el contenido.
 *
 * El catálogo no publica {@see DataOrigin}: la vista no pregunta el origen del dato
 * (siempre manual, ver JSDoc de `resources/js/health/bloodPressurePage.js`), así que no hay
 * `<select>` que rellenar con esos tokens. `origin` sigue viajando dentro del sobre cifrado, fijo a
 * `manual` desde el cliente.
 */
final class BloodPressure extends HealthEventPage
{
    protected static string|BackedEnum|null $navigationIcon = Heroicon::Heart;

    protected string $view = 'phr.pages.blood-pressure';

    /**
     * El título y la etiqueta de navegación se resuelven por método y no como propiedad estática
     * porque un inicializador de propiedad en PHP solo admite expresiones constantes: `__()` no
     * puede llamarse ahí. Dejarlos como cadena fija es lo que mantenía el menú y las cabeceras en
     * castellano aunque el resto de la pantalla ya estuviera traducido.
     */
    public function getTitle(): string|Htmlable
    {
        return __('Blood pressure');
    }

    public static function getNavigationLabel(): string
    {
        return __('Blood pressure');
    }

    /**
     * Catálogo público en claro que el cliente necesita para construir el payload cifrado (ADR
     * 0005, ADR 0008). No es dato clínico: son los mismos tokens y códigos para cualquier usuario.
     *
     * @return array{
     *     arms: list<array{token: string, label: string}>,
     *     postures: list<array{token: string, label: string}>,
     *     units: array{pressure: string, pulse: string},
     *     loinc: array{systolic: string, diastolic: string, pulse: string},
     *     recordedByRoles: list<array{token: string, label: string}>,
     * }
     */
    public function catalog(): array
    {
        /** El catálogo es en claro y lo pinta el servidor, así que las etiquetas salen ya en el
         * idioma en vigor para esta petición (App\Support\SupportedLocale). */
        $locale = app()->getLocale();

        return [
            'arms' => self::labelledOptions(BloodPressureArm::cases(), $locale),
            'postures' => self::labelledOptions(BloodPressurePosture::cases(), $locale),
            /** Sin selector: la tensión no ofrece unidad alternativa (ver BloodPressureUnit). */
            'units' => [
                'pressure' => BloodPressureUnit::MillimetersOfMercury->value,
                'pulse' => BloodPressureUnit::BeatsPerMinute->value,
            ],
            'loinc' => [
                'systolic' => BloodPressureLoincCode::Systolic->value,
                'diastolic' => BloodPressureLoincCode::Diastolic->value,
                'pulse' => BloodPressureLoincCode::Pulse->value,
            ],
            /** Campo común a todo evento (ADR 0006), no propio de la tensión. */
            'recordedByRoles' => self::labelledOptions(RecordedBy::cases(), $locale),
        ];
    }
}
