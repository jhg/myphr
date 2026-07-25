<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * `Cache-Control: no-store` en todas las respuestas de autenticación (Spec 0001 §4).
 *
 * Vive en un middleware y no en cada controlador para que ninguna respuesta futura de este grupo de
 * rutas se quede sin la cabecera por olvido, incluidas las de error que genera el manejador de
 * excepciones y las que produce el limitador de tasa.
 *
 * `Vary: Cookie` se añade a lo que depende de la sesión (§4.5): sin él, una caché compartida podría
 * servir la respuesta de una persona a otra.
 *
 * `Referrer-Policy: no-referrer` cubre la página de establecimiento de contraseña: su URL lleva el
 * token del enlace en el fragmento, y aunque el fragmento no viaja en la cabecera `Referer`, el
 * resto de la URL sí delataría a cualquier recurso externo que la persona abriera desde ahí que
 * alguien está dando de alta una cuenta en este servidor. Se aplica a todo el grupo por el mismo
 * motivo por el que se aplica `no-store`: para que ninguna respuesta futura se quede sin ella.
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
