<?php

declare(strict_types=1);

use App\Auth\SessionSecrets;
use App\Http\Middleware\EnforceIdleTimeout;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Auth;

uses(RefreshDatabase::class);

/**
 * Caducidad por inactividad contada en el servidor (Spec 0001 §8; ADR 0009).
 *
 * El temporizador de `lock.js` no cuenta: no se ejecuta en una pestaña descartada por memoria, ni
 * en un portátil cerrado, ni sin JavaScript, ni si la llamada de cierre no llega a salir. Estos
 * tests simulan justo eso, un navegador que nunca llamó a `POST /phr/auth/lock`, y comprueban que
 * la sesión muere igual.
 */

/** Deja la última actividad tantos segundos atrás como se pida. */
function ageSession(int $secondsAgo): void
{
    session()->put(EnforceIdleTimeout::SESSION_KEY, time() - $secondsAgo);
}

it('cierra la sesión entera tras quince minutos sin ninguna petición', function (): void {
    $user = User::factory()->registered()->create();

    $this->actingAs($user);
    session()->put(SessionSecrets::SESSION_KEY, 'not-a-real-secret');
    ageSession(EnforceIdleTimeout::IDLE_LIMIT_SECONDS + 1);

    $this->get('/phr')->assertRedirect(route('filament.phr.auth.login'));

    expect(Auth::guard('web')->check())->toBeFalse()
        ->and(session()->get(SessionSecrets::SESSION_KEY))->toBeNull();
});

/** `recovery.js` ya sabe llevar un 401 a la pantalla de acceso (§6.2). */
it('responde 401 a las peticiones JSON de una sesión caducada', function (): void {
    $user = User::factory()->registered()->create();

    $this->actingAs($user);
    session()->put(SessionSecrets::SESSION_KEY, 'not-a-real-secret');
    ageSession(EnforceIdleTimeout::IDLE_LIMIT_SECONDS);

    $this->postJson(route('filament.phr.auth.session-secret'))->assertStatus(401);

    expect(Auth::guard('web')->check())->toBeFalse()
        ->and(session()->get(SessionSecrets::SESSION_KEY))->toBeNull();
});

it('no cierra nada mientras haya actividad dentro del límite', function (): void {
    $user = User::factory()->registered()->create();

    $this->actingAs($user);
    session()->put(SessionSecrets::SESSION_KEY, 'not-a-real-secret');
    ageSession(EnforceIdleTimeout::IDLE_LIMIT_SECONDS - 60);

    $this->get('/phr')->assertOk();

    expect(Auth::guard('web')->check())->toBeTrue()
        ->and(session()->get(SessionSecrets::SESSION_KEY))->toBe('not-a-real-secret');
});

/** Cada petición autenticada reinicia la cuenta: la caducidad es por inactividad, no absoluta. */
it('reinicia la cuenta en cada petición autenticada', function (): void {
    $user = User::factory()->registered()->create();

    $this->actingAs($user);
    ageSession(EnforceIdleTimeout::IDLE_LIMIT_SECONDS - 60);

    $this->get('/phr')->assertOk();

    expect(session()->get(EnforceIdleTimeout::SESSION_KEY))
        ->toBeGreaterThan(time() - 5);
});

/**
 * El bloqueo del cliente queda exento: es el camino que ya destruye la sesión, y un 401 ahí dejaría
 * a `lock.js` reintentando en bucle contra un endpoint que nunca le respondería que sí.
 */
it('deja pasar el bloqueo del cliente aunque la sesión ya haya caducado', function (): void {
    $user = User::factory()->registered()->create();

    $this->actingAs($user);
    session()->put(SessionSecrets::SESSION_KEY, 'not-a-real-secret');
    ageSession(EnforceIdleTimeout::IDLE_LIMIT_SECONDS * 4);

    $this->postJson(route('filament.phr.auth.lock'))->assertOk()->assertJson(['locked' => true]);

    expect(Auth::guard('web')->check())->toBeFalse()
        ->and(session()->get(SessionSecrets::SESSION_KEY))->toBeNull();
});

/** El límite es el del ADR 0009, no el `session.lifetime` de Laravel. */
it('mantiene el límite de quince minutos y lo separa del lifetime de la sesión', function (): void {
    expect(EnforceIdleTimeout::IDLE_LIMIT_SECONDS)->toBe(15 * 60)
        ->and(config('session.lifetime') * 60)->toBeGreaterThanOrEqual(EnforceIdleTimeout::IDLE_LIMIT_SECONDS);
});

it('monta la caducidad en el middleware de autenticación del panel', function (): void {
    $middleware = app('router')->getRoutes()->getByName('filament.phr.pages.dashboard')->gatherMiddleware();

    expect($middleware)->toContain(EnforceIdleTimeout::class);
});
