<?php

declare(strict_types=1);

namespace App\Filament\Pages;

use App\Catalog\InjectionSite;
use App\Catalog\InsulinType;
use App\Catalog\RecordedBy;
use App\Catalog\UcumUnit;
use BackedEnum;
use Filament\Support\Icons\Heroicon;
use Illuminate\Contracts\Support\Htmlable;

/**
 * Pantalla de insulina inyectada (ADR 0002, ADR 0004, ADR 0005, ADR 0006).
 *
 * Esta clase no ve nunca el contenido de una administración de insulina. El transporte común de
 * ciphertext —el sobre baja como valor de retorno y sube como parámetro de método, nunca en una
 * propiedad pública, así que no entra en el snapshot de Livewire (ADR 0002)— vive en
 * {@see HealthEventPage} y es compartido con el resto de pantallas de eventos clínicos. El servidor
 * valida la envoltura del sobre y la autorización, nunca el contenido: no hay forma de comprobar que
 * dentro dice «insulina» sin la clave del usuario.
 *
 * **No lleva código LOINC.** A diferencia de la glucemia, un evento de insulina no es una
 * observación de una magnitud: es el registro de una administración de medicación (ADR 0006, «tipo
 * rapid|long|mixed, dosis, y código del producto si procede, porque es una administración de
 * medicación y no una observación»). No hay tabla (tipo, unidad) → código que resolver aquí, y no
 * hay que añadir una: es la diferencia deliberada con {@see Glucose::catalog()}.
 *
 * La vista (`resources/views/phr/pages/insulin.blade.php`) es un componente Alpine propio, no un
 * formulario de Filament: el ADR 0002 reserva los campos y columnas de Filament para datos en claro,
 * y aquí todo el contenido clínico está cifrado.
 *
 * **El formulario no pregunta el origen del dato** (manual o aparato): hoy no existe ninguna
 * integración con un aparato en esta pantalla, así que la entrada es siempre manual y preguntarlo
 * no tiene una respuesta real. `origin` sigue viajando en el contenido cifrado porque el ADR 0006
 * lo exige y no se puede añadir después sobre datos ya cifrados, pero `insulinPage.js` lo fija a
 * `manual` sin mostrar ningún control; el día que exista una importación automática desde un
 * aparato, será ella quien lo ponga a `device`. Por eso `catalog()` ya no publica `dataOrigins`:
 * nada en la vista lo necesita.
 */
final class Insulin extends HealthEventPage
{
    /**
     * Código UCUM de la unidad internacional de insulina (ADR 0005: «la unidad internacional de
     * insulina es `[iU]`, nadie la escribe espontáneamente»). Verificado contra
     * https://unitsofmeasure.org: `[iU]` es el código UCUM de «international unit».
     *
     * No sale de {@see UcumUnit} porque ese enum hoy solo cubre las unidades de la
     * glucemia; añadirle un caso queda fuera del alcance de esta pantalla.
     */
    private const string UNIT_INTERNATIONAL_UNIT = '[iU]';

    /**
     * Heroicons no trae una jeringuilla: `EyeDropper` (gotero) es el icono disponible más cercano
     * a «dosis administrada», y distinto del `Beaker` (matraz) de {@see Glucose}.
     */
    protected static string|BackedEnum|null $navigationIcon = Heroicon::OutlinedEyeDropper;

    protected string $view = 'phr.pages.insulin';

    /**
     * El título y la etiqueta de navegación se resuelven por método y no como propiedad estática
     * porque un inicializador de propiedad en PHP solo admite expresiones constantes: `__()` no
     * puede llamarse ahí. Dejarlos como cadena fija es lo que mantenía el menú y las cabeceras en
     * castellano aunque el resto de la pantalla ya estuviera traducido.
     */
    public function getTitle(): string|Htmlable
    {
        return __('Injected insulin');
    }

    public static function getNavigationLabel(): string
    {
        return __('Insulin');
    }

    /**
     * Catálogo público en claro que el cliente necesita para construir el payload cifrado (ADR
     * 0005, ADR 0006). No es dato clínico: son los mismos tokens para cualquier usuario.
     *
     * @return array{
     *     units: list<array{code: string, label: string}>,
     *     insulinTypes: list<array{token: string, label: string}>,
     *     injectionSites: list<array{token: string, label: string}>,
     *     recordedByRoles: list<array{token: string, label: string}>,
     * }
     */
    public function catalog(): array
    {
        /** El catálogo es en claro y lo pinta el servidor, así que las etiquetas salen ya en el
         * idioma en vigor para esta petición (App\Support\SupportedLocale). */
        $locale = app()->getLocale();

        return [
            'units' => [
                ['code' => self::UNIT_INTERNATIONAL_UNIT, 'label' => 'UI (unidades internacionales)'],
            ],
            'insulinTypes' => array_map(
                static fn (InsulinType $type): array => [
                    'token' => $type->value,
                    'label' => $type->label($locale),
                ],
                InsulinType::cases(),
            ),
            'injectionSites' => array_map(
                static fn (InjectionSite $site): array => [
                    'token' => $site->value,
                    'label' => $site->label($locale),
                ],
                InjectionSite::cases(),
            ),
            /**
             * Campo común a todo evento (ADR 0006), no propio de la insulina. `dataOrigins` no se
             * publica: el formulario no pregunta el origen del dato (ver JSDoc de la clase), así
             * que la vista no lo necesita.
             */
            'recordedByRoles' => array_map(
                static fn (RecordedBy $role): array => [
                    'token' => $role->value,
                    'label' => $role->label($locale),
                ],
                RecordedBy::cases(),
            ),
        ];
    }
}
