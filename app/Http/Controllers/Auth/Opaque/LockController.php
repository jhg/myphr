<?php

declare(strict_types=1);

namespace App\Http\Controllers\Auth\Opaque;

use App\Auth\SessionSecrets;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;

/**
 * `POST /phr/auth/lock` (Spec 0001 §4.6 y §8).
 *
 * El bloqueo **cierra la sesión entera**, no solo el secreto: dejar viva la sesión de Laravel
 * mantendría a la persona dentro del panel, con acceso a datos en claro y a acciones destructivas
 * como reemitir un enlace, que es justo el riesgo del puesto compartido que motiva el bloqueo.
 *
 * El cliente hace la recarga dura **después** de recibir esta respuesta, nunca antes: recargar antes
 * de la confirmación deja, ante una pérdida de red, el secreto vivo en servidor y al cliente sin
 * clave maestra en memoria, es decir, un bloqueo que no bloqueó nada del lado servidor.
 *
 * `sessionStorage['phr.rk']` no se borra: al morir el secreto, ese paquete queda cifrado bajo algo
 * que ya no existe en ningún sitio y es inútil sin que nadie tenga que limpiarlo (§8).
 *
 * El logout propio de Filament no pasa por aquí, así que el cierre de sesión normal tiene que usar
 * este mismo camino de destrucción y no confiar en que aquel lo haga (§8).
 */
final readonly class LockController
{
    public function __construct(private SessionSecrets $sessionSecrets) {}

    public function __invoke(Request $request): JsonResponse
    {
        $session = $request->session();

        $this->sessionSecrets->destroy($session);

        Auth::guard('web')->logout();

        $session->invalidate();
        $session->regenerateToken();

        return response()->json(['locked' => true]);
    }
}
