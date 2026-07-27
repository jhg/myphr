<?php

declare(strict_types=1);

namespace App\Filament\Pages;

use App\Catalog\DataOrigin;
use App\Catalog\RecordedBy;
use App\Catalog\TemperatureLoincCode;
use App\Catalog\TemperatureMeasurementSite;
use App\Catalog\UcumUnit;
use BackedEnum;
use Filament\Support\Icons\Heroicon;
use Illuminate\Contracts\Support\Htmlable;

/**
 * Pantalla de temperatura corporal (ADR 0002, ADR 0004, ADR 0005, ADR 0006, ADR 0008).
 *
 * Un evento de temperatura guarda el valor, su unidad y el sitio donde se midió. El sitio es el
 * método de medición del ADR 0008: cambia el valor de forma conocida (la axilar va por debajo de la
 * rectal para la misma persona en el mismo momento) y solo se sabe al medir, así que se pregunta y
 * viaja como token propio (`data.site`), nunca deducido.
 *
 * A diferencia de la tensión, aquí el sitio **además determina el código LOINC**: LOINC publica un
 * código por sitio de medida, así que esta pantalla sí necesita una tabla de resolución sitio →
 * código, al estilo de la glucemia. El porqué, y por qué no se usa el genérico 8310-5, está en
 * {@see TemperatureLoincCode}.
 *
 * La unidad se pregunta y no se convierte: Celsius y Fahrenheit son la misma observación en otra
 * escala, cada registro conserva la suya (ADR 0006) y la gráfica traza una serie por pareja (sitio,
 * unidad) en vez de mezclar escalas, que daría una curva que salta de 36 a 98 sin decir nada.
 *
 * Igual que el resto de pantallas de eventos, esta clase no ve nunca el contenido de un registro: el
 * transporte común de ciphertext vive en {@see HealthEventPage}, que valida la envoltura del sobre y
 * la autorización, nunca el contenido.
 *
 * El catálogo no publica {@see DataOrigin}: la vista no pregunta el origen del dato (siempre manual,
 * ver JSDoc de `resources/js/health/temperaturePage.js`), así que no hay `<select>` que rellenar con
 * esos tokens. `origin` sigue viajando dentro del sobre cifrado, fijo a `manual` desde el cliente.
 */
final class Temperature extends HealthEventPage
{
    protected static string|BackedEnum|null $navigationIcon = Heroicon::Fire;

    protected string $view = 'phr.pages.temperature';

    /**
     * El título y la etiqueta de navegación se resuelven por método y no como propiedad estática
     * porque un inicializador de propiedad en PHP solo admite expresiones constantes: `__()` no
     * puede llamarse ahí.
     */
    public function getTitle(): string|Htmlable
    {
        return __('Body temperature');
    }

    public static function getNavigationLabel(): string
    {
        return __('Body temperature');
    }

    /**
     * Catálogo público en claro que el cliente necesita para construir el payload cifrado (ADR
     * 0005, ADR 0008). No es dato clínico: son los mismos tokens y códigos para cualquier usuario.
     *
     * La etiqueta de la unidad no es su código UCUM: el código de Fahrenheit es `[degF]`, con los
     * corchetes que UCUM reserva a las unidades no métricas, y enseñarlo así sería pedirle a la
     * persona que lea notación de intercambio. Se guarda el código y se muestra `°C` o `°F`, que es
     * exactamente la distinción del ADR 0005.
     *
     * @return array{
     *     units: list<array{code: string, label: string}>,
     *     sites: list<array{token: string, label: string}>,
     *     loinc: list<array{site: string, code: string}>,
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
                ['code' => UcumUnit::DegreeCelsius->value, 'label' => '°C'],
                ['code' => UcumUnit::DegreeFahrenheit->value, 'label' => '°F'],
            ],
            'sites' => self::labelledOptions(TemperatureMeasurementSite::cases(), $locale),
            'loinc' => self::loincTable(),
            /** Campo común a todo evento (ADR 0006), no propio de la temperatura. */
            'recordedByRoles' => self::labelledOptions(RecordedBy::cases(), $locale),
        ];
    }

    /**
     * Tabla que resuelve el sitio de medición al código LOINC (ADR 0005, ADR 0008), para que el
     * cliente no tenga que reimplementar {@see TemperatureLoincCode::resolve()}.
     *
     * No lleva `try`/`catch` como la de la glucemia: allí hay combinaciones (método, unidad) sin
     * código y la tabla las salta, mientras que aquí todo sitio publicado tiene el suyo. Si algún
     * día se añade un sitio sin código, este método reventará al construir el catálogo —en el acto y
     * a la vista— en vez de servir una pantalla que guardaría registros sin código.
     *
     * @return list<array{site: string, code: string}>
     */
    private static function loincTable(): array
    {
        return array_map(
            static fn (TemperatureMeasurementSite $site): array => [
                'site' => $site->value,
                'code' => TemperatureLoincCode::resolve($site)->value,
            ],
            TemperatureMeasurementSite::cases(),
        );
    }
}
