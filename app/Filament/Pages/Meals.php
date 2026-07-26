<?php

declare(strict_types=1);

namespace App\Filament\Pages;

use App\Catalog\FoodQuantityUnit;
use App\Catalog\MealType;
use App\Catalog\RecordedBy;
use BackedEnum;
use Filament\Support\Icons\Heroicon;
use Illuminate\Contracts\Support\Htmlable;

/**
 * Pantalla de comidas (ADR 0002, ADR 0004, ADR 0005, ADR 0006).
 *
 * Esta clase no ve nunca el contenido de una comida. El transporte común de ciphertext vive en
 * {@see HealthEventPage} y es compartido con el resto de pantallas de eventos clínicos: el sobre
 * baja como valor de retorno y sube como parámetro de método, nunca en una propiedad pública, así
 * que no entra en el snapshot de Livewire (ADR 0002). El servidor valida la envoltura del sobre y
 * la autorización, nunca el contenido: no hay forma de comprobar que dentro dice «tortilla» sin la
 * clave del usuario.
 *
 * A diferencia de la glucemia, los alimentos de una comida NO se codifican contra ningún
 * vocabulario clínico: es una decisión consciente que se aparta del criterio general del ADR 0005,
 * justificada en el ADR propio de esta pantalla. Lo que sí va codificado en UCUM es la unidad de
 * cada alimento ({@see FoodQuantityUnit}), que es lo que el ADR 0005 exige para no acabar con una
 * conversión imposible más adelante.
 *
 * El campo `origin` del ADR 0006 (cómo entró el dato: tecleado a mano o importado de un aparato) no
 * se pregunta aquí: hoy toda entrada es manual, no existe ninguna integración con un aparato de
 * comidas, así que el cliente lo fija siempre a `manual` sin mostrar un selector cuya única
 * respuesta posible sería esa. El día que exista una importación automática, será ella quien
 * escriba `device`, no un selector en este formulario. El catálogo de `dataOrigins` de la glucemia
 * no se publica aquí por el mismo motivo: no hay nada que el cliente necesite elegir.
 *
 * La vista (`resources/views/phr/pages/meals.blade.php`) es un componente Alpine propio, no un
 * formulario de Filament: el ADR 0002 reserva los campos y columnas de Filament para datos en claro,
 * y aquí todo el contenido clínico está cifrado.
 */
final class Meals extends HealthEventPage
{
    protected static string|BackedEnum|null $navigationIcon = Heroicon::Cake;

    protected string $view = 'phr.pages.meals';

    /**
     * El título y la etiqueta de navegación se resuelven por método y no como propiedad estática
     * porque un inicializador de propiedad en PHP solo admite expresiones constantes: `__()` no
     * puede llamarse ahí. Dejarlos como cadena fija es lo que mantenía el menú y las cabeceras en
     * castellano aunque el resto de la pantalla ya estuviera traducido.
     */
    public function getTitle(): string|Htmlable
    {
        return __('Meals');
    }

    public static function getNavigationLabel(): string
    {
        return __('Meals');
    }

    /**
     * Catálogo público en claro que el cliente necesita para construir el payload cifrado (ADR
     * 0005, ADR 0006). No es dato clínico: son los mismos tokens y códigos para cualquier usuario.
     *
     * @return array{
     *     mealTypes: list<array{token: string, label: string}>,
     *     units: list<array{code: string, label: string}>,
     *     recordedByRoles: list<array{token: string, label: string}>,
     * }
     */
    public function catalog(): array
    {
        /** El catálogo es en claro y lo pinta el servidor, así que las etiquetas salen ya en el
         * idioma en vigor para esta petición (App\Support\SupportedLocale). */
        $locale = app()->getLocale();

        return [
            'mealTypes' => self::labelledOptions(MealType::cases(), $locale),
            'units' => array_map(
                static fn (FoodQuantityUnit $unit): array => [
                    'code' => $unit->value,
                    'label' => $unit->label($locale),
                ],
                FoodQuantityUnit::cases(),
            ),
            /** Campo común a todo evento (ADR 0006), no propio de las comidas. */
            'recordedByRoles' => self::labelledOptions(RecordedBy::cases(), $locale),
        ];
    }
}
