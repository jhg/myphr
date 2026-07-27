<?php

declare(strict_types=1);

use App\Auth\SessionSecrets;
use App\Http\Middleware\EnforceIdleTimeout;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Auth;

uses(RefreshDatabase::class);

/**
 * Idle timeout counted on the server (Spec 0001 §8; ADR 0009).
 *
 * The `lock.js` timer does not count: it does not run in a tab discarded for memory, nor on a closed
 * laptop, nor without JavaScript, nor if the lock call never manages to leave. These tests simulate
 * exactly that, a browser that never called `POST /phr/auth/lock`, and check that the session dies
 * anyway.
 */

/** Pushes the last activity as many seconds into the past as asked. */
function ageSession(int $secondsAgo): void
{
    session()->put(EnforceIdleTimeout::SESSION_KEY, time() - $secondsAgo);
}

it('closes the whole session after fifteen minutes with no request', function (): void {
    $user = User::factory()->registered()->create();

    $this->actingAs($user);
    session()->put(SessionSecrets::SESSION_KEY, 'not-a-real-secret');
    ageSession(EnforceIdleTimeout::IDLE_LIMIT_SECONDS + 1);

    $this->get('/phr')->assertRedirect(route('filament.phr.auth.login'));

    expect(Auth::guard('web')->check())->toBeFalse()
        ->and(session()->get(SessionSecrets::SESSION_KEY))->toBeNull();
});

/** `recovery.js` already knows how to take a 401 to the login screen (§6.2). */
it('answers 401 to the JSON requests of an expired session', function (): void {
    $user = User::factory()->registered()->create();

    $this->actingAs($user);
    session()->put(SessionSecrets::SESSION_KEY, 'not-a-real-secret');
    ageSession(EnforceIdleTimeout::IDLE_LIMIT_SECONDS);

    $this->postJson(route('filament.phr.auth.session-secret'))->assertStatus(401);

    expect(Auth::guard('web')->check())->toBeFalse()
        ->and(session()->get(SessionSecrets::SESSION_KEY))->toBeNull();
});

it('closes nothing while there is activity within the limit', function (): void {
    $user = User::factory()->registered()->create();

    $this->actingAs($user);
    session()->put(SessionSecrets::SESSION_KEY, 'not-a-real-secret');
    ageSession(EnforceIdleTimeout::IDLE_LIMIT_SECONDS - 60);

    $this->get('/phr')->assertOk();

    expect(Auth::guard('web')->check())->toBeTrue()
        ->and(session()->get(SessionSecrets::SESSION_KEY))->toBe('not-a-real-secret');
});

/** Every authenticated request restarts the count: the timeout is idle-based, not absolute. */
it('restarts the count on every authenticated request', function (): void {
    $user = User::factory()->registered()->create();

    $this->actingAs($user);
    ageSession(EnforceIdleTimeout::IDLE_LIMIT_SECONDS - 60);

    $this->get('/phr')->assertOk();

    expect(session()->get(EnforceIdleTimeout::SESSION_KEY))
        ->toBeGreaterThan(time() - 5);
});

/**
 * The client lock is exempt: it is the path that already destroys the session, and a 401 there would
 * leave `lock.js` retrying in a loop against an endpoint that would never say yes.
 */
it('lets the client lock through even when the session has already expired', function (): void {
    $user = User::factory()->registered()->create();

    $this->actingAs($user);
    session()->put(SessionSecrets::SESSION_KEY, 'not-a-real-secret');
    ageSession(EnforceIdleTimeout::IDLE_LIMIT_SECONDS * 4);

    $this->postJson(route('filament.phr.auth.lock'))->assertOk()->assertJson(['locked' => true]);

    expect(Auth::guard('web')->check())->toBeFalse()
        ->and(session()->get(SessionSecrets::SESSION_KEY))->toBeNull();
});

/** The limit is the ADR 0009 one, not Laravel's `session.lifetime`. */
it('keeps the fifteen minute limit and separates it from the session lifetime', function (): void {
    expect(EnforceIdleTimeout::IDLE_LIMIT_SECONDS)->toBe(15 * 60)
        ->and(config('session.lifetime') * 60)->toBeGreaterThanOrEqual(EnforceIdleTimeout::IDLE_LIMIT_SECONDS);
});

it('mounts the timeout in the panel authentication middleware', function (): void {
    $middleware = app('router')->getRoutes()->getByName('filament.phr.pages.dashboard')->gatherMiddleware();

    expect($middleware)->toContain(EnforceIdleTimeout::class);
});
