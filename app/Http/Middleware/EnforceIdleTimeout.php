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
 * Idle timeout counted on the server (Spec 0001 §8; ADR 0009).
 *
 * Fifteen minutes without any authenticated request and the whole session is closed: the session
 * secret is destroyed, the Laravel session is closed and the CSRF token is rotated, exactly what
 * `POST /phr/auth/lock` does.
 *
 * **The server counts the time, not the browser.** The `lock.js` timer does not run in a tab the
 * operating system discarded for memory, nor on a closed laptop, nor with JavaScript off, nor if the
 * lock call never manages to leave. Without this check, the session (and with it the secret, which
 * is half the material the master key is opened with) survives until Laravel's `session.lifetime`,
 * today 120 minutes, which is exactly the unattended shared machine that motivates the measure. The
 * client timer is still useful: it is what warns and what triggers the hard reload, not what decides
 * the expiry.
 *
 * The timestamp lives in the session payload, next to the secret: no column is needed and destroying
 * the session destroys it.
 *
 * The lock route is exempt on purpose. It is the one that already performs this same destruction,
 * and answering that request with a 401 would leave the client retrying its lock in a loop against
 * an endpoint that is never going to say yes.
 */
final readonly class EnforceIdleTimeout
{
    /** Key of the last-activity mark inside the session. */
    public const string SESSION_KEY = 'phr.last_activity_at';

    /** Inactividad tolerada, en segundos (ADR 0009: quince minutos). */
    public const int IDLE_LIMIT_SECONDS = 15 * 60;

    /** Route that already destroys the session on its own and must not get a 401 for expiry. */
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
     * Closes the whole session and cuts the request short.
     *
     * {@see AuthenticationException} is thrown instead of building the response by hand so the
     * destination is the same as for any other unauthenticated request: 401 with a JSON body when
     * the client asks for JSON, which is what `recovery.js` already knows how to take to the login
     * screen, and a redirect to login on a normal navigation.
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
