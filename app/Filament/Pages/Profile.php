<?php

declare(strict_types=1);

namespace App\Filament\Pages;

use App\Catalog\UcumUnit;
use App\Providers\Filament\PhrPanelProvider;
use App\Support\SupportedLocale;
use BackedEnum;
use Filament\Support\Icons\Heroicon;
use Illuminate\Contracts\Support\Htmlable;

/**
 * Página de perfil: ajustes de la cuenta y cambio de contraseña (ADR 0002, ADR 0007, ADR 0009).
 *
 * Esta clase no ve **nada** de lo que la página guarda. Los ajustes viajan cifrados a `PUT
 * /phr/settings` y el cambio de contraseña es un re-registro OPAQUE completo contra las rutas de
 * `/phr/auth/password/*`: en los dos casos el navegador cifra o deriva y el servidor solo valida
 * envoltura. Por eso aquí no hay formulario de Filament ni propiedad pública con contenido: el ADR
 * 0002 reserva los campos de Filament para datos en claro y la vista es un componente Alpine propio
 * (`resources/js/auth/profilePage.js`, registrado como `phrProfilePage`).
 *
 * La única excepción consciente es el idioma de la interfaz, que va en claro en `users.locale`
 * porque Filament resuelve en servidor el menú, las migas y la propia pantalla de acceso, que se
 * pinta antes de que exista ninguna clave (ADR 0007, con el mismo razonamiento que el ADR 0009 hace
 * para el correo y el nombre). No dice nada sobre la salud de nadie.
 *
 * Hereda de {@see PhrPage} y no de `Filament\Pages\Page` por las seis propiedades `#[Url]` que
 * `InteractsWithActions` publica en la barra de direcciones.
 */
final class Profile extends PhrPage
{
    protected static string|BackedEnum|null $navigationIcon = Heroicon::UserCircle;

    /**
     * Fuera de la navegación lateral: al perfil se llega por el menú de usuario, que es donde
     * cualquiera lo busca, y que ya lo registra {@see PhrPanelProvider}.
     *
     * La barra lateral es para el registro y la consulta de datos clínicos. Repetir ahí una entrada
     * a la que ya se llega desde el avatar duplica el camino y le roba sitio a lo que la persona
     * abre a diario.
     */
    protected static bool $shouldRegisterNavigation = false;

    protected string $view = 'phr.pages.profile';

    /**
     * El título y la etiqueta de navegación se resuelven por método y no como propiedad estática
     * porque un inicializador de propiedad en PHP solo admite expresiones constantes: `__()` no
     * puede llamarse ahí. Dejarlos como cadena fija es lo que mantenía el menú y las cabeceras en
     * castellano aunque el resto de la pantalla ya estuviera traducido.
     */
    public function getTitle(): string|Htmlable
    {
        return __('Profile');
    }

    public static function getNavigationLabel(): string
    {
        return __('Profile');
    }

    /**
     * Idiomas que la interfaz sabe hablar, con el inglés primero por ser el de serie.
     *
     * Lista cerrada a propósito: el valor acaba en `App::setLocale()`, así que aceptar cualquier
     * cadena sería dejar que el cliente elija un fichero de traducción.
     *
     * @return list<array{code: string, label: string}>
     */
    public function locales(): array
    {
        return [
            ['code' => 'en', 'label' => 'English'],
            ['code' => 'es', 'label' => 'Español'],
            ['code' => 'zh_CN', 'label' => '简体中文'],
        ];
    }

    /**
     * Unidades de glucemia entre las que se puede elegir la preferida (ADR 0006: es preferencia de
     * presentación, no un requisito del evento; cada registro guarda la suya).
     *
     * @return list<array{code: string, label: string}>
     */
    public function glucoseUnits(): array
    {
        return [
            ['code' => UcumUnit::MilligramsPerDeciliter->value, 'label' => 'mg/dL'],
            ['code' => UcumUnit::MillimolesPerLiter->value, 'label' => 'mmol/L'],
        ];
    }

    /**
     * Idioma en vigor para esta cuenta: el que la persona guardó y, mientras `users.locale` siga
     * vacía, el que se negoció con `Accept-Language` para esta petición.
     *
     * El ADR 0007 solo autoriza valor por defecto para lo que no es contenido clínico, y el idioma
     * no lo es: se puede elegir uno por ella sin afirmar nada sobre su salud.
     */
    public function currentLocale(): string
    {
        $locale = auth()->user()?->getAttribute('locale');

        return is_string($locale) && SupportedLocale::isSupported($locale)
            ? $locale
            : app()->getLocale();
    }
}
