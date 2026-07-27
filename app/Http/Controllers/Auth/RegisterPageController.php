<?php

declare(strict_types=1);

namespace App\Http\Controllers\Auth;

use Illuminate\Http\Request;
use Illuminate\Http\Response;

/**
 * `GET /phr/register`: public signup page (ADR 0009).
 *
 * It is served without a single database query, like {@see SetPasswordPageController}: there is
 * nothing to validate yet. The name, the login and the OPAQUE `registrationRequest` travel together
 * in the body of `registration/public/start`, which is the only place where we check whether the
 * email already has an account.
 *
 * Unlike invited signup, this screen does reveal that an account exists when the email is taken. It
 * is a deliberate decision from ADR 0009: without that notice, somebody who mistypes their email
 * cannot know what happened or how to continue. It is mitigated by the endpoint's per-IP attempt
 * limiting, not here.
 */
final readonly class RegisterPageController
{
    public function __invoke(Request $request): Response
    {
        return response()->view('phr.auth.register');
    }
}
