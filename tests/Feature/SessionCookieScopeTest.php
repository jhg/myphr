<?php

declare(strict_types=1);

use Filament\Facades\Filament;
use Illuminate\Session\Middleware\StartSession;
use Illuminate\Support\Facades\Route;
use Livewire\Livewire;

/**
 * ¿Esta ruta arranca sesión?
 *
 * `gatherMiddleware()` devuelve el grupo `web` sin desplegar y **no descuenta** lo que se le haya
 * retirado con `withoutMiddleware()`, así que las rutas del lector aparecerían con sesión. Lo que
 * decide es la resta.
 *
 * @param  Illuminate\Routing\Route  $route
 */
function startsSession($route): bool
{
    $excluded = $route->excludedMiddleware();

    if (in_array(StartSession::class, $excluded, true)) {
        return false;
    }

    return in_array(StartSession::class, $route->gatherMiddleware(), true)
        || in_array('web', $route->gatherMiddleware(), true);
}

/**
 * El alcance de la cookie de sesión (ADR 0011).
 *
 * La lectura de un recorte compartido promete que nada identifica a quien lee: `routes/web.php` le
 * retira `StartSession`, `EncryptCookies` y `AddQueuedCookiesToResponse` a las rutas `/s`. Eso
 * gobierna lo que Laravel **lee y escribe**, y no lo que el navegador **manda**: con la cookie en
 * `path=/`, una navegación de nivel superior a `/s/{link}` la lleva igual si esa persona tiene sesión
 * abierta en el panel, y con ella el identificador del recorte y la cuenta quedan en la misma línea
 * de cualquier registro de acceso, proxy, WAF o CDN por delante de la aplicación. Es justo la
 * correlación que el ADR dice evitar.
 *
 * Por eso la cookie se acota al prefijo del panel, y por eso el endpoint de Livewire —que de serie
 * vive fuera de `/phr`— se registra dentro. Estas comprobaciones son las que impiden que un cambio
 * futuro del prefijo, o una ruta nueva con sesión colgada de la raíz, reabran el agujero en silencio.
 */
test('la cookie de sesión está acotada al prefijo del panel', function (): void {
    expect(config('session.path'))->toBe('/'.Filament::getPanel('phr')->getPath());
});

test('el endpoint de Livewire cuelga del prefijo del panel, o la cookie no le llegaría', function (): void {
    expect(Livewire::getUpdateUri())->toStartWith('/'.Filament::getPanel('phr')->getPath().'/');
});

/**
 * Toda ruta propia que arranca sesión tiene que caber dentro del alcance de la cookie. Una que
 * quedara fuera no recibiría la cookie del navegador y fallaría en silencio con un 419, y arreglarlo
 * volviendo a poner `path=/` desharía lo de arriba sin que nadie lo relacione.
 *
 * Se miran solo las rutas propias: las de Livewire que no se usan (`upload-file`, `preview-file`) y
 * las de descarga de Filament siguen declarando `web`, y ninguna se llama desde esta aplicación.
 */
test('ninguna ruta propia con sesión queda fuera del alcance de la cookie', function (): void {
    $scope = trim((string) config('session.path'), '/');

    $outside = collect(Route::getRoutes()->getRoutes())
        ->filter(fn ($route): bool => str_starts_with(
            (string) $route->getActionName(),
            'App\\',
        ) || str_contains((string) $route->getName(), 'filament.phr.'))
        ->filter(fn ($route): bool => startsSession($route))
        ->reject(fn ($route): bool => str_starts_with($route->uri(), $scope))
        ->map(fn ($route): string => $route->uri())
        ->values()
        ->all();

    expect($outside)->toBe([]);
});

/**
 * Y la otra mitad del perímetro, que ya estaba: las rutas del lector no arrancan sesión.
 */
test('las rutas del lector siguen sin sesión', function (): void {
    $readerRoutes = collect(Route::getRoutes()->getRoutes())
        ->filter(fn ($route): bool => str_starts_with($route->uri(), 's/'));

    expect($readerRoutes)->not->toBeEmpty();

    $readerRoutes->each(function ($route): void {
        expect(startsSession($route))->toBeFalse();
    });
});
