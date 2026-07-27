<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Impide que Livewire inyecte su runtime en la página del lector (ADR 0011).
 *
 * Livewire no espera a que una plantilla pida sus scripts: escucha `RequestHandled` y, si durante la
 * petición se renderizó algún componente, **inyecta él mismo** sus estilos y su JavaScript en
 * cualquier respuesta HTML de 200 que contenga `</html>`
 * (`SupportAutoInjectedAssets::shouldInjectLivewireAssets()`). La página del lector es exactamente
 * eso: HTML, 200 y con `</html>`.
 *
 * Que hoy no se renderice ningún componente en esa ruta no basta como defensa. Sería un detalle de
 * implementación —basta un componente pintado por un `View::composer`, o un cambio en Livewire, para
 * que la condición se cumpla— y el fallo sería silencioso y grave: el runtime del panel cargado en
 * una página pública, sin sesión y abierta en el dispositivo de otra persona. De hecho ya ocurre en
 * el banco de pruebas, donde el marcador estático de Livewire sobrevive de una petición a la
 * siguiente y la página del lector aparecía con `<!-- Livewire Scripts -->` dentro.
 *
 * `livewire.inject_assets` es la única palanca pública que apaga esa inyección, y se apaga solo para
 * esta ruta: el panel no la usa, porque sus layouts piden `@livewireScripts` explícitamente.
 */
final class WithoutLivewireAssets
{
    public function handle(Request $request, Closure $next): Response
    {
        config(['livewire.inject_assets' => false]);

        return $next($request);
    }
}
