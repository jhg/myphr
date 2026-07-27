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
 * It returns the secret the browser reopens the `sessionStorage` bundle with after a reload, a 419
 * or a deployment, without asking for the password again.
 *
 * It is `POST` and not `GET` on purpose: a `GET` is cacheable by design, and an intermediary that
 * cached this response would write the secret onto a third party's disk.
 *
 * It includes `encryptedSettings` because the settings do not travel inside the `sessionStorage`
 * bundle, only the wrapped master key: without this field, a screen that starts up through recovery
 * would have no unit of measurement and no target range until the next full login.
 *
 * Error codes (§4.5): the route lives in `authenticatedRoutes()`, so a missing or expired session is
 * cut off by the authentication middleware before it gets here; `410` covers a session that is still
 * alive but whose secret is gone. Both take the client to the login screen.
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
