<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * `Cache-Control: no-store` on every authentication response (Spec 0001 §4).
 *
 * It lives in a middleware and not in each controller so no future response in this route group is
 * left without the header by oversight, including the error responses the exception handler
 * generates and the ones the rate limiter produces.
 *
 * `Vary: Cookie` is added to whatever depends on the session (§4.5): without it, a shared cache
 * could serve one person's response to another.
 *
 * `Referrer-Policy: no-referrer` covers the set-password page: its URL carries the link token in the
 * fragment, and although the fragment does not travel in the `Referer` header, the rest of the URL
 * would tell any external resource the person opened from there that somebody is signing up on this
 * server. It is applied to the whole group for the same reason `no-store` is: so no future response
 * is left without it.
 */
final class NoStore
{
    /**
     * @param  Closure(Request): Response  $next
     */
    public function handle(Request $request, Closure $next): Response
    {
        $response = $next($request);

        $response->headers->set('Cache-Control', 'no-store, private');
        $response->headers->set('Pragma', 'no-cache');
        $response->headers->set('Referrer-Policy', 'no-referrer');

        if (! $response->headers->has('Vary')) {
            $response->headers->set('Vary', 'Cookie');
        }

        return $response;
    }
}
