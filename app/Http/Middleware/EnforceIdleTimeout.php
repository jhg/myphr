<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use App\Auth\SessionSecrets;
use Closure;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Symfony\Component\HttpFoundation\Response;

/**
 * Caducidad por inactividad contada en el servidor (Spec 0001 §8; ADR 0009).
 *
 * Quince minutos sin ninguna petición autenticada y la sesión se cierra entera: se destruye el
 * secreto de sesión, se cierra la sesión de Laravel y se rota el token CSRF, exactamente lo mismo
 * que hace `POST /phr/auth/lock`.
 *
 * **Quien cuenta el tiempo es el servidor, no el navegador.** El temporizador de `lock.js` no se
 * ejecuta en una pestaña que el sistema operativo descartó por memoria, ni en un portátil cerrado,
 * ni con JavaScript desactivado, ni si la llamada de cierre no llega a salir. Sin esta comprobación,
 * la sesión (y con ella el secreto, que es la mitad del material con el que se abre la clave
 * maestra) sobrevive hasta el `session.lifetime` de Laravel, hoy 120 minutos, que es justo el puesto
 * compartido desatendido que motiva la medida. El temporizador del cliente sigue siendo útil: es lo
 * que avisa y lo que dispara la recarga dura, no lo que decide la caducidad.
 *
 * La marca de tiempo vive en la carga útil de la sesión, junto al secreto: no hace falta ninguna
 * columna y destruir la sesión la destruye.
 *
 * La ruta de bloqueo queda exenta a propósito. Es la que ya hace esta misma destrucción, y contestar
 * a esa petición con un 401 dejaría al cliente reintentando su cierre en bucle contra un endpoint
 * que nunca le va a responder que sí.
 */
final readonly class EnforceIdleTimeout
{
    /** Clave de la marca de última actividad dentro de la sesión. */
    public const string SESSION_KEY = 'phr.last_activity_at';

    /** Inactividad tolerada, en segundos (ADR 0009: quince minutos). */
    public const int IDLE_LIMIT_SECONDS = 15 * 60;

    /** Ruta que ya destruye la sesión por su cuenta y no debe recibir un 401 por caducidad. */
    private const string LOCK_ROUTE = 'filament.phr.auth.lock';

    public function __construct(private SessionSecrets $sessionSecrets) {}

    public function handle(Request $request, Closure $next): Response
    {
        if (! $request->hasSession() || Auth::guard('web')->guest() || $request->routeIs(self::LOCK_ROUTE)) {
            return $next($request);
        }

        $session = $request->session();
        $lastActivity = $session->get(self::SESSION_KEY);
        $now = time();

        if (is_int($lastActivity) && $now - $lastActivity >= self::IDLE_LIMIT_SECONDS) {
            $this->expire($request);
        }

        $session->put(self::SESSION_KEY, $now);

        return $next($request);
    }

    /**
     * Cierra la sesión entera y corta la petición.
     *
     * Se lanza {@see AuthenticationException} en vez de construir la respuesta a mano para que el
     * destino sea el mismo que el de cualquier otra petición sin autenticar: 401 con cuerpo JSON
     * cuando el cliente pide JSON, que es lo que `recovery.js` ya sabe llevar a la pantalla de
     * acceso, y redirección al login en una navegación normal.
     *
     * @throws AuthenticationException
     */
    private function expire(Request $request): never
    {
        $session = $request->session();

        $this->sessionSecrets->destroy($session);

        Auth::guard('web')->logout();

        $session->invalidate();
        $session->regenerateToken();

        throw new AuthenticationException('Unauthenticated.', ['web'], route('filament.phr.auth.login'));
    }
}
