<?php

declare(strict_types=1);

namespace App\Http\Controllers\Auth\Opaque;

use App\Auth\SessionSecrets;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * `POST /phr/auth/session-secret` (Spec 0001 §4.5).
 *
 * Devuelve el secreto con el que el navegador vuelve a abrir el paquete de `sessionStorage` tras una
 * recarga, un 419 o un despliegue, sin volver a pedir la contraseña.
 *
 * Es `POST` y no `GET` a propósito: un `GET` es cacheable por diseño, y un intermediario que cacheara
 * esta respuesta escribiría el secreto en el disco de un tercero.
 *
 * Incluye `encryptedSettings` porque la configuración no viaja dentro del paquete de
 * `sessionStorage`, solo la clave maestra envuelta: sin este campo, una pantalla que arranque por
 * recuperación no tendría unidad de medida ni rango objetivo hasta el próximo login completo.
 *
 * Códigos de error (§4.5): la ruta vive en `authenticatedRoutes()`, así que una sesión inexistente o
 * caducada la corta el middleware de autenticación antes de llegar aquí; `410` cubre la sesión que
 * sigue viva pero cuyo secreto ya no está. Ambos llevan al cliente a la pantalla de login.
 */
final readonly class SessionSecretController
{
    public function __construct(private SessionSecrets $sessionSecrets) {}

    public function __invoke(Request $request): JsonResponse
    {
        $secret = $this->sessionSecrets->current($request->session());
        $user = $request->user();

        if ($secret === null || ! $user instanceof User) {
            return response()->json(['error' => 'session_secret_unavailable'], 410);
        }

        return response()->json([
            'sessionSecret' => $secret,
            'encryptedSettings' => $user->encrypted_settings,
        ])->header('Vary', 'Cookie');
    }
}
