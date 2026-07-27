<?php

declare(strict_types=1);

use App\Http\Controllers\Sharing\ShareChallengeController;
use App\Http\Controllers\Sharing\ShareOpenController;
use App\Http\Controllers\Sharing\ShareReaderPageController;
use App\Http\Middleware\NoStore;
use App\Http\Middleware\WithoutLivewireAssets;
use Illuminate\Cookie\Middleware\AddQueuedCookiesToResponse;
use Illuminate\Cookie\Middleware\EncryptCookies;
use Illuminate\Foundation\Http\Middleware\PreventRequestForgery;
use Illuminate\Session\Middleware\StartSession;
use Illuminate\Support\Facades\Route;
use Illuminate\View\Middleware\ShareErrorsFromSession;
use Livewire\Livewire;
use Livewire\Mechanisms\HandleRequests\RequireLivewireHeaders;

/**
 * La raíz del sitio manda al panel, que es toda la aplicación.
 *
 * Antes servía `resources/views/welcome.blade.php`, la página de bienvenida de fábrica de Laravel:
 * texto en inglés sin `__()` —la única URL del proyecto sin traducir en ninguno de los tres
 * idiomas— y decenas de peldaños de rampa (`text-gray-900`, `bg-gray-200`, `text-white`) que
 * DESIGN.md prohíbe y que ensuciaban cualquier auditoría de tokens. No la enlazaba nada.
 *
 * Va al panel y no directamente a la pantalla de acceso: si hay sesión, Filament lleva al inicio, y
 * si no la hay, redirige él mismo a `/phr/login`. Así la decisión de a dónde va una visita sin
 * sesión vive en un solo sitio.
 */
Route::redirect('/', '/phr')->name('home');

/**
 * El endpoint de Livewire, bajado al prefijo del panel.
 *
 * De serie vive en `/livewire-<hash>/update`, es decir **fuera** de `/phr`, y eso obligaba a que la
 * cookie de sesión tuviera `path=/`. Con `path=/`, el navegador la manda también en la navegación de
 * nivel superior a `/s/{link}` y en sus subrecursos: retirarle `StartSession` a esas rutas evita que
 * Laravel la lea y la escriba, pero no evita que viaje. Cualquier proxy, WAF, CDN o registro de
 * acceso por delante ve entonces, en la misma línea, el identificador del recorte y la cookie de una
 * cuenta concreta, que es exactamente la correlación que este diseño dice evitar (ADR 0011).
 *
 * Con la ruta aquí, **todo lo que necesita sesión cuelga de `/phr`** y la cookie puede acotarse
 * (`SESSION_PATH`, `config/session.php`). Lo vigila `tests/Feature/SessionCookieScopeTest.php`, que
 * recorre las rutas y falla si alguna con `StartSession` queda fuera del prefijo.
 *
 * El nombre acaba en `livewire.update` porque es así como `HandleRequests::findUpdateRoute()`
 * encuentra una ruta propia y la prefiere a la suya.
 */
Livewire::setUpdateRoute(fn ($handle) => Route::post('/phr/livewire/update', $handle)
    ->middleware(['web', RequireLivewireHeaders::class])
    ->name('phr.livewire.update'));

/**
 * Lectura de un recorte compartido con un profesional (ADR 0011).
 *
 * Las tres rutas viven aquí y no bajo `phr` porque el prefijo del panel es el de Filament
 * (`PhrPanelProvider::path('phr')`) y todo lo que se monta ahí pasa por `routes()`, que Filament
 * envuelve con el grupo `web` y por tanto con sesión y CSRF, incluidas sus rutas sin autenticar.
 * Esta pila es la contraria: sin cookie de sesión, sin CSRF y sin nada que identifique a quien lee.
 *
 * El prefijo es `/s`, corto porque acaba en un QR —cada carácter son módulos de más en el código— y
 * mudo porque la URL se enseña en una consulta y se guarda en el historial de un dispositivo ajeno:
 * `/compartir-historial-medico/…` diría de qué va antes de que nadie la abra. El dominio ya delata
 * bastante por Certificate Transparency.
 *
 * Se retiran cinco middlewares del grupo `web`, uno a uno y de forma explícita:
 *
 * * `StartSession`, `EncryptCookies` y `AddQueuedCookiesToResponse`, para que la respuesta no lleve
 *   ninguna cookie. Una cookie de sesión aquí sería un identificador estable de un profesional en su
 *   consulta, correlacionable entre los recortes de dos pacientes distintos.
 * * `PreventRequestForgery`, porque no hay sesión que falsificar y exigir un token obligaría a
 *   pintarlo en la página, que es tanto como no exigirlo.
 * * `ShareErrorsFromSession`, que sin sesión revienta.
 *
 * `WithoutLivewireAssets` apaga la inyección automática del runtime de Livewire, que se cuela en
 * cualquier respuesta HTML de 200 sin que la plantilla lo pida: el porqué está en el propio
 * middleware.
 *
 * `NoStore` sí se aplica: ya pone `Cache-Control: no-store`, `Pragma: no-cache` y
 * `Referrer-Policy: no-referrer`, esta última especialmente pertinente aquí, porque la URL lleva `S`
 * en el fragmento y el resto de la URL no debe viajar como `Referer` a ningún recurso externo.
 *
 * Los limitadores por IP son hermanos de los de `OpaqueServiceProvider` y se declaran en
 * `AppServiceProvider`. No sustituyen al contador de intentos, que vive en columna: son dos frenos
 * distintos, uno contra el ruido y otro contra la fuerza bruta sobre el PIN.
 */
Route::prefix('s')
    ->name('share.')
    ->middleware([NoStore::class, WithoutLivewireAssets::class])
    ->withoutMiddleware([
        EncryptCookies::class,
        AddQueuedCookiesToResponse::class,
        StartSession::class,
        ShareErrorsFromSession::class,
        PreventRequestForgery::class,
    ])
    ->group(function (): void {
        Route::get('{link}', ShareReaderPageController::class)->name('reader');

        Route::post('{link}/challenge', ShareChallengeController::class)
            ->middleware('throttle:share-challenge')
            ->name('challenge');

        Route::post('{link}/open', ShareOpenController::class)
            ->middleware('throttle:share-open')
            ->name('open');
    });
