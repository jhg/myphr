<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use App\Support\SupportedLocale;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\App;
use Symfony\Component\HttpFoundation\Response;

/**
 * Sets the request language before Filament paints anything (ADR 0007).
 *
 * It is mounted in the panel group, behind `StartSession` and ahead of authorization: that way it
 * covers authenticated and unauthenticated screens alike, and the unauthenticated ones are exactly
 * where there is no user to read the preference from and only `Accept-Language` is left.
 *
 * It touches neither the session nor any cookie: the preference lives in `users.locale` and the rest
 * is negotiated on every request.
 */
final class SetLocale
{
    public function handle(Request $request, Closure $next): Response
    {
        App::setLocale(SupportedLocale::forRequest($request));

        return $next($request);
    }
}
