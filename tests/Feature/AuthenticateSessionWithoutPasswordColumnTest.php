<?php

declare(strict_types=1);

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;

uses(RefreshDatabase::class);

/**
 * `Filament\Http\Middleware\AuthenticateSession` (montado en el panel `phr`) extiende
 * `Illuminate\Session\Middleware\AuthenticateSession` sin sobrescribir `handle()`. Esa clase guarda
 * `password_hash_web` en la sesión en la primera petición autenticada y la compara en las
 * siguientes; si no cuadra, cierra la sesión.
 *
 * Sin columna `password`, {@see User::getAuthPassword()} devuelve `''`, que es "falsy" en PHP. La
 * primera línea de `handle()` es
 * `if (! $request->hasSession() || ! $request->user() || ! $request->user()->getAuthPassword())`,
 * así que el middleware se sale por ahí y nunca llega a comparar nada contra la sesión. Este test
 * demuestra que varias peticiones autenticadas seguidas no cierran la sesión sola, que es como se
 * manifestaría en producción si esto se rompiera.
 */
it('no cierra la sesion en peticiones autenticadas sucesivas', function (): void {
    $user = User::factory()->registered()->create();
    $this->actingAs($user);

    $first = $this->get('/phr');
    $first->assertOk();

    expect(auth()->check())->toBeTrue()
        ->and(auth()->id())->toBe($user->id);

    $second = $this->get('/phr');
    $second->assertOk();

    expect(auth()->check())->toBeTrue()
        ->and(auth()->id())->toBe($user->id);
});
