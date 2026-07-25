<?php

declare(strict_types=1);

namespace App\Filament\Pages;

use BackedEnum;
use Filament\Panel;
use Filament\Support\Icons\Heroicon;
use Illuminate\Contracts\Support\Htmlable;

/**
 * Panel de inicio (Spec 0001 §9, «Propiedades en URL»; ADR 0002, ADR 0006, ADR 0007, ADR 0008).
 *
 * Sustituye a `Filament\Pages\Dashboard`: sus widgets resuelven en servidor, y el servidor no
 * puede leer datos cifrados (ADR 0002). Esta página muestra, en su lugar, un resumen de glucemia y
 * tensión de la última semana y del último mes, calculado en el navegador
 * (`resources/js/health/dashboardPage.js`) a partir de `fetchEvents()`, heredado de
 * {@see HealthEventPage} igual que hace {@see Glucose}. El servidor no ve nunca el contenido de un
 * evento; solo entrega el ciphertext, como en cualquier otra pantalla de eventos clínicos.
 *
 * Hereda de `HealthEventPage` (y no de `Filament\Pages\Dashboard`) para reutilizar `fetchEvents` y
 * heredar, a través de {@see PhrPage}, el mismo cierre de las seis propiedades `#[Url]` de
 * `InteractsWithActions` que exige Spec 0001 §9.
 *
 * **Sigue siendo la página de inicio del panel, en `/phr`.** `HasRoutes::getRoutePath()` calcula la
 * ruta a partir de `getSlug()` si no se sobrescribe, lo que daría `/phr/dashboard`. Se sobrescribe
 * aquí `getRoutePath()` a `/`, igual que hace `Filament\Pages\Dashboard::$routePath`, para que la
 * ruta del panel siga siendo `/phr` y no cambie el registro en
 * `App\Providers\Filament\PhrPanelProvider::pages()`.
 *
 * De ahí también la duplicación literal de las seis propiedades `#[Url]` sin el atributo: es
 * deliberada y el test de arquitectura la cubre (`tests/Feature/PanelUrlPropertiesTest.php`); si
 * alguien borra una, el test falla.
 */
final class Dashboard extends HealthEventPage
{
    protected static string $routePath = '/';

    protected static string|BackedEnum|null $navigationIcon = Heroicon::Home;

    protected static ?int $navigationSort = -2;

    protected string $view = 'phr.pages.dashboard';

    /**
     * El título y la etiqueta de navegación se resuelven por método y no como propiedad estática
     * porque un inicializador de propiedad en PHP solo admite expresiones constantes: `__()` no
     * puede llamarse ahí. Dejarlos como cadena fija es lo que mantenía el menú y las cabeceras en
     * castellano aunque el resto de la pantalla ya estuviera traducido.
     */
    public function getTitle(): string|Htmlable
    {
        return __('Home');
    }

    public static function getNavigationLabel(): string
    {
        return __('Home');
    }

    /** @var mixed */
    public $defaultAction = null;

    /** @var mixed */
    public $defaultActionArguments = null;

    /** @var mixed */
    public $defaultActionContext = null;

    /** @var mixed */
    public $defaultTableAction = null;

    /** @var mixed */
    public $defaultTableActionRecord = null;

    /** @var mixed */
    public $defaultTableActionArguments = null;

    public static function getRoutePath(Panel $panel): string
    {
        return self::$routePath;
    }
}
