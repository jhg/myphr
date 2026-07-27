<?php

declare(strict_types=1);

namespace App\Http\Controllers\Auth\Opaque;

use App\Auth\SessionSecrets;
use App\Models\User;
use App\Support\AuditEvent;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;

/**
 * `POST /phr/auth/lock` (Spec 0001 §4.6 and §8).
 *
 * Locking **closes the whole session**, not just the secret: leaving the Laravel session alive would
 * keep the person inside the panel, with access to plaintext data and to destructive actions like
 * reissuing a link, which is exactly the shared-machine risk that motivates locking.
 *
 * The client does the hard reload **after** receiving this response, never before: reloading before
 * the confirmation leaves, on a network failure, the secret alive on the server and the client
 * without a master key in memory, that is, a lock that locked nothing on the server side.
 *
 * `sessionStorage['phr.rk']` is not cleared: once the secret dies, that bundle is encrypted under
 * something that no longer exists anywhere and is useless without anyone having to clean it (§8).
 *
 * Filament's own logout does not go through here, so an ordinary logout has to use this same
 * destruction path and not trust that it does it (§8).
 */
final readonly class LockController
{
    public function __construct(private SessionSecrets $sessionSecrets) {}

    public function __invoke(Request $request): JsonResponse
    {
        $session = $request->session();

        $user = $request->user();

        $this->sessionSecrets->destroy($session);

        /** Before the `logout`, which is what leaves nobody to attribute it to. */
        if ($user instanceof User) {
            activity(AuditEvent::LOG_NAME)
                ->causedBy($user)
                ->performedOn($user)
                ->event(AuditEvent::LoggedOut->value)
                ->log(AuditEvent::LoggedOut->value);
        }

        Auth::guard('web')->logout();

        $session->invalidate();
        $session->regenerateToken();

        return response()->json(['locked' => true]);
    }
}
