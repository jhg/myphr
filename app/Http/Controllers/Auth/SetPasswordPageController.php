<?php

declare(strict_types=1);

namespace App\Http\Controllers\Auth;

use Illuminate\Http\Request;
use Illuminate\Http\Response;

/**
 * `GET /phr/set-password`: set-password page (Spec 0001 §4.1 and §10).
 *
 * It is served **generic**, with no token in the path and without a single database query: the token
 * travels in the URL fragment (`#<token>`), which the browser never sends to the server. It only
 * reaches the server inside the body of `registration/start`, which is also the only place where it
 * is validated.
 *
 * A deliberate consequence: this page answers the same for a valid token, an expired one, an already
 * consumed one and a made-up one. The invalid-link error is shown by the client when
 * `registration/start` returns its generic error (§7).
 */
final readonly class SetPasswordPageController
{
    public function __invoke(Request $request): Response
    {
        return response()->view('phr.auth.set-password');
    }
}
