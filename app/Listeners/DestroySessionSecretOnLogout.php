<?php

declare(strict_types=1);

namespace App\Listeners;

use App\Auth\SessionSecrets;
use App\Http\Controllers\Auth\Opaque\LockController;
use Illuminate\Auth\Events\Logout;
use Illuminate\Contracts\Session\Session;

/**
 * El cierre de sesión destruye el secreto de sesión por el mismo camino que el bloqueo
 * (Spec 0001 §8).
 *
 * Filament monta su propio `POST /phr/logout` (`Filament\Auth\Http\Controllers\LogoutController`),
 * que no sabe nada del secreto: hace `Filament::auth()->logout()` y `session()->invalidate()`. Hoy
 * ese `invalidate()` se lleva por delante toda la carga útil, secreto incluido, pero eso es un
 * efecto lateral de un controlador de terceros, no una garantía de este proyecto: un cambio futuro
 * en ese controlador —o cualquier otro punto que llame a `Auth::logout()` sin invalidar— dejaría el
 * secreto vivo sin ningún síntoma visible.
 *
 * Engancharse al evento `Logout` en vez de sustituir el controlador cubre los tres caminos con una
 * sola pieza: el logout de Filament, {@see LockController} y
 * cualquier `Auth::logout()` futuro. Se descubre por la firma de `handle()`.
 *
 * `SessionSecrets::destroy()` es idempotente, así que ejecutarlo sobre una sesión que ya no tiene
 * secreto no es un error: es el caso normal cuando el bloqueo ya lo había borrado.
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
