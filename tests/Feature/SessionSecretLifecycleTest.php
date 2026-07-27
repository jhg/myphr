<?php

declare(strict_types=1);

use App\Auth\SessionSecrets;
use App\Listeners\DestroySessionSecretOnLogout;
use App\Models\User;
use Illuminate\Auth\Events\Logout;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Auth;

uses(RefreshDatabase::class);

/**
 * Logging out and locking destroy the secret through the same path (Spec 0001 §8).
 */
it('destroys the session secret on any logout, not just the panel lock', function (): void {
    $session = app('session.store');
    $session->put(SessionSecrets::SESSION_KEY, 'not-a-real-secret');

    event(new Logout('web', User::factory()->registered()->make()));

    expect($session->get(SessionSecrets::SESSION_KEY))->toBeNull();
});

it('wires the listener to the logout event', function (): void {
    $raw = app('events')->getRawListeners()[Logout::class] ?? [];

    $listeners = array_map(
        static fn (mixed $listener): string => is_string($listener) ? $listener : $listener::class,
        is_array($raw) ? $raw : [$raw],
    );

    expect(implode('|', $listeners))->toContain(DestroySessionSecretOnLogout::class);
});

it('leaves no session secret behind after the panel logout route', function (): void {
    $user = User::factory()->registered()->create();

    $this->actingAs($user);
    session()->put(SessionSecrets::SESSION_KEY, 'not-a-real-secret');

    $this->post(route('filament.phr.auth.logout'))->assertRedirect();

    expect(session()->get(SessionSecrets::SESSION_KEY))->toBeNull()
        ->and(Auth::guard('web')->check())->toBeFalse();
});
