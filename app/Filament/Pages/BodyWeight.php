<?php

declare(strict_types=1);

namespace App\Filament\Pages;

use App\Catalog\BodyHeightLoincCode;
use App\Catalog\BodyWeightLoincCode;
use App\Catalog\DataOrigin;
use App\Catalog\RecordedBy;
use App\Catalog\UcumUnit;
use BackedEnum;
use Filament\Support\Icons\Heroicon;
use Illuminate\Contracts\Support\Htmlable;

/**
 * Pantalla de peso y estatura (ADR 0002, ADR 0004, ADR 0005, ADR 0006, ADR 0008).
 *
 * **El nombre interno se queda como está.** La pantalla ya no registra solo el peso, y su título y
 * su etiqueta de menú lo dicen, pero la clase sigue llamándose `BodyWeight` y su componente Alpine
 * `phrBodyWeightPage`. El nombre del componente vive en `resources/js/app.js`, que otro trabajo está
 * editando ahora mismo, y perder ahí un registro deja la pantalla muda sin ningún error visible.
 * Renombrar clase, vista, componente, `x-ref` y `wire:key` es una tarea aparte, para cuando no haya
 * trabajo concurrente; el cambio de ahora es solo de etiqueta visible.
 *
 * Un evento de esta pantalla guarda el peso, su unidad y —de forma opcional— la estatura con la
 * suya. No hay método de medición que declarar (ADR 0008) —una báscula no ofrece variantes que
 * cambien el valor de forma conocida, al revés que el brazo y la postura de la tensión o el sitio de
 * medida de la temperatura— y los dos códigos LOINC son constantes, así que tampoco hace falta un
 * resolutor como el de la glucemia: ver {@see BodyWeightLoincCode} y {@see BodyHeightLoincCode}.
 *
 * **La estatura es un evento, no un dato de perfil.** Quien está creciendo, o en tratamiento para
 * ganar estatura, necesita seguirla en el tiempo, y un dato estático en la ficha no lo permite. Va
 * en el mismo registro que el peso porque es donde se mide y donde se usa: el índice de masa
 * corporal sale de los dos. Es un campo opcional: quien se pesa cada semana la rellena una vez y la
 * deja en blanco después, y el cliente arrastra la última conocida.
 *
 * La unidad sí se pregunta, porque kilogramos y libras son dos formas de escribir la misma magnitud
 * y cada registro conserva la suya (ADR 0006). No se convierte entre ellas en ninguna parte: la
 * conversión exigiría fijar precisión y redondeo, y el mismo criterio que la glucemia aplica aquí
 * —la gráfica traza una serie por unidad en vez de mezclarlas.
 *
 * Igual que {@see Glucose} y {@see BloodPressure}, esta clase no ve nunca el contenido de un
 * registro: el transporte común de ciphertext vive en {@see HealthEventPage}, que valida la
 * envoltura del sobre y la autorización, nunca el contenido.
 *
 * El catálogo no publica {@see DataOrigin}: la vista no pregunta el origen del dato (siempre manual,
 * ver JSDoc de `resources/js/health/bodyWeightPage.js`), así que no hay `<select>` que rellenar con
 * esos tokens. `origin` sigue viajando dentro del sobre cifrado, fijo a `manual` desde el cliente.
 */
final class BodyWeight extends HealthEventPage
{
    protected static string|BackedEnum|null $navigationIcon = Heroicon::Scale;

    protected string $view = 'phr.pages.body-weight';

    /**
     * El título y la etiqueta de navegación se resuelven por método y no como propiedad estática
     * porque un inicializador de propiedad en PHP solo admite expresiones constantes: `__()` no
     * puede llamarse ahí.
     */
    public function getTitle(): string|Htmlable
    {
        return __('Weight and height');
    }

    public static function getNavigationLabel(): string
    {
        return __('Weight and height');
    }

    /**
     * Catálogo público en claro que el cliente necesita para construir el payload cifrado (ADR
     * 0005). No es dato clínico: son los mismos tokens y códigos para cualquier usuario.
     *
     * La etiqueta de la unidad no es su código UCUM: el código de la libra es `[lb_av]`, con los
     * corchetes que UCUM reserva a las unidades no métricas, y enseñarlo así en un desplegable y en
     * el historial sería pedirle a la persona que lea notación de intercambio. Se guarda el código y
     * se muestra la etiqueta, que es exactamente la distinción del ADR 0005.
     *
     * @return array{
     *     units: list<array{code: string, label: string}>,
     *     loinc: string,
     *     heightUnits: list<array{code: string, label: string}>,
     *     heightLoinc: string,
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
                ['code' => UcumUnit::Kilogram->value, 'label' => 'kg'],
                ['code' => UcumUnit::Pound->value, 'label' => 'lb'],
            ],
            /** Uno solo y constante: el peso no resuelve código por unidad ni por método. */
            'loinc' => BodyWeightLoincCode::Measured->value,
            /**
             * Centímetros y pulgadas, la misma pareja métrica/habitual que en el peso. La pulgada es
             * `[in_i]` en UCUM y se enseña como `in`, por el mismo motivo que la libra: el código es
             * notación de intercambio, no algo que se le pida leer a nadie (ADR 0005).
             */
            'heightUnits' => [
                ['code' => UcumUnit::Centimeter->value, 'label' => 'cm'],
                ['code' => UcumUnit::Inch->value, 'label' => 'in'],
            ],
            /** Genérico y sin postura ni método, porque no se preguntan: ver {@see BodyHeightLoincCode}. */
            'heightLoinc' => BodyHeightLoincCode::Generic->value,
            /** Campo común a todo evento (ADR 0006), no propio del peso. */
            'recordedByRoles' => self::labelledOptions(RecordedBy::cases(), $locale),
        ];
    }
}
