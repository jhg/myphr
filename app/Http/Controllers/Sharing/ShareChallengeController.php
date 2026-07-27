<?php

declare(strict_types=1);

namespace App\Http\Controllers\Sharing;

use App\Security\Opaque\Base64Url;
use App\Sharing\ShareLinkGate;
use Illuminate\Http\JsonResponse;

/**
 * `POST /s/{link}/challenge` (ADR 0011): first step of the read.
 *
 * It returns **only the salt** the client stretches the PIN with using Argon2id. Not a byte of the
 * package or the wrapper: handing them out here, before validating the PIN, is exactly the flaw that
 * invalidated the original design, because with the blob downloaded a six-digit PIN is a million
 * offline guesses.
 *
 * It **always answers 200 and always with 16 bytes**, whether the link exists or not. A 404 on a
 * non-existent, expired or revoked link would turn a list of identifiers into a map of which
 * clippings are still alive, and along the way say that this person shared something. There is no
 * PIN to judge yet here, so all four situations have to be indistinguishable.
 *
 * The route runs with no session, no CSRF and no authentication: whoever uses it is a professional
 * without an account. It is `POST` and not `GET` so the link identifier does not end up in the
 * browsing history as a resource request or in any intermediate cache.
 */
final readonly class ShareChallengeController
{
    public function __construct(private ShareLinkGate $gate) {}

    public function __invoke(string $link): JsonResponse
    {
        return response()->json([
            'pinSalt' => Base64Url::encode($this->gate->challenge($link)),
        ]);
    }
}
