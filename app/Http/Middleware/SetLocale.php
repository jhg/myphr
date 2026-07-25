<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use App\Support\SupportedLocale;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\App;
use Symfony\Component\HttpFoundation\Response;

/**
 * Fija el idioma de la petición antes de que Filament pinte nada (ADR 0007).
 *
 * Va montado en el grupo del panel, detrás de `StartSession` y por delante de la autorización: así
 * cubre por igual las pantallas autenticadas y las que no lo están, que son justo donde no hay
 * usuario del que leer la preferencia y solo queda `Accept-Language`.
 *
 * No toca la sesión ni escribe ninguna cookie: la preferencia vive en `users.locale` y lo demás se
 * negocia en cada petición.
 */
final class SetLocale
{
    public function handle(Request $request, Closure $next): Response
    {
        App::setLocale(SupportedLocale::forRequest($request));

        return $next($request);
    }
}
