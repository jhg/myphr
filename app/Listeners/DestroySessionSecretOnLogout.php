<?php

declare(strict_types=1);

namespace App\Listeners;

use App\Auth\SessionSecrets;
use App\Http\Controllers\Auth\Opaque\LockController;
use Illuminate\Auth\Events\Logout;
use Illuminate\Contracts\Session\Session;

/**
 * Logging out destroys the session secret through the same path as locking
 * (Spec 0001 §8).
 *
 * Filament mounts its own `POST /phr/logout` (`Filament\Auth\Http\Controllers\LogoutController`),
 * which knows nothing about the secret: it calls `Filament::auth()->logout()` and
 * `session()->invalidate()`. Today that `invalidate()` takes the whole payload with it, secret
 * included, but that is a side effect of a third-party controller, not a guarantee of this project:
 * a future change in that controller —or any other place that calls `Auth::logout()` without
 * invalidating— would leave the secret alive with no visible symptom.
 *
 * Hooking the `Logout` event instead of replacing the controller covers all three paths with one
 * piece: Filament's logout, {@see LockController} and any future `Auth::logout()`. It is discovered
 * from the signature of `handle()`.
 *
 * `SessionSecrets::destroy()` is idempotent, so running it on a session that no longer has a secret
 * is not an error: it is the normal case when locking already cleared it.
 */
final readonly class DestroySessionSecretOnLogout
{
    public function __construct(
        private SessionSecrets $sessionSecrets,
        private Session $session,
    ) {}

    public function handle(Logout $event): void
    {
        $this->sessionSecrets->destroy($this->session);
    }
}
