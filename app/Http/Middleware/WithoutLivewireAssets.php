<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Stops Livewire from injecting its runtime into the reader page (ADR 0011).
 *
 * Livewire does not wait for a template to ask for its scripts: it listens to `RequestHandled` and,
 * if any component was rendered during the request, it **injects** its styles and JavaScript itself
 * into any 200 HTML response containing `</html>`
 * (`SupportAutoInjectedAssets::shouldInjectLivewireAssets()`). The reader page is exactly that:
 * HTML, 200 and with `</html>`.
 *
 * The fact that no component is rendered on that route today is not enough of a defence. It would be
 * an implementation detail —one component painted by a `View::composer`, or a change in Livewire, is
 * enough for the condition to hold— and the failure would be silent and serious: the panel runtime
 * loaded on a public page, with no session, opened on somebody else's device. It already happens in
 * the test suite, where Livewire's static marker survives from one request to the next and the
 * reader page showed up with `<!-- Livewire Scripts -->` inside.
 *
 * `livewire.inject_assets` is the only public lever that turns that injection off, and it is turned
 * off for this route only: the panel does not use it, because its layouts ask for
 * `@livewireScripts` explicitly.
 */
final class WithoutLivewireAssets
{
    public function handle(Request $request, Closure $next): Response
    {
        config(['livewire.inject_assets' => false]);

        return $next($request);
    }
}
