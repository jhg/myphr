<?php

declare(strict_types=1);

use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;

/**
 * Limitadores de las rutas de OPAQUE (Spec 0001 §4.2 y §4.4).
 *
 * Un limitador que se apoya en un campo que la ruta nunca recibe deja de limitar por petición y
 * pasa a ser un único cubo compartido: quien lo agote deja el endpoint fuera de servicio para todo
 * el mundo. `registration/finish` es exactamente ese caso, porque el cliente solo manda
 * `registrationId`, `registrationRecord`, `wrappedUserMasterKey` y `encryptedSettings`.
 */

/**
 * Cuerpo JSON contra una ruta del panel, con IP fija.
 *
 * @param  array<string, mixed>  $body
 */
function opaqueRequest(string $path, array $body, string $ip = '203.0.113.9'): Request
{
    $request = Request::create(
        $path,
        'POST',
        [],
        [],
        [],
        ['REMOTE_ADDR' => $ip, 'CONTENT_TYPE' => 'application/json'],
        json_encode($body, JSON_THROW_ON_ERROR),
    );

    return $request;
}

/**
 * Claves de los cubos que un limitador aplica a una petición.
 *
 * @return list<string>
 */
function rateLimitKeys(string $limiter, Request $request): array
{
    $resolver = RateLimiter::limiter($limiter);

    expect($resolver)->not->toBeNull();

    $limits = $resolver($request);
    $limits = is_array($limits) ? $limits : [$limits];

    return array_values(array_map(
        static fn (Limit $limit): string => (string) $limit->key,
        $limits,
    ));
}

it('separa por registro cada petición de registration/finish', function (): void {
    $first = rateLimitKeys('opaque-registration-finish', opaqueRequest(
        '/phr/auth/opaque/registration/finish',
        ['registrationId' => '11111111-1111-4111-8111-111111111111'],
    ));

    $second = rateLimitKeys('opaque-registration-finish', opaqueRequest(
        '/phr/auth/opaque/registration/finish',
        ['registrationId' => '22222222-2222-4222-8222-222222222222'],
    ));

    expect($first)->not->toBe($second)
        ->and(array_diff($first, $second))->not->toBeEmpty();

    /** Y el login en claro nunca es clave: aquí ni siquiera hay un campo que lo sea. */
    foreach ([...$first, ...$second] as $key) {
        expect($key)->not->toContain('@');
    }
});

/**
 * El defecto que este fichero persigue: `opaque-registration` construye su segunda clave con
 * `registrationToken`, que `registration/finish` no envía nunca. Todas sus peticiones caerían en el
 * mismo cubo de 15/min, así que esa ruta no puede usar ese limitador.
 */
it('no monta registration/finish sobre un limitador que no distingue sus peticiones', function (): void {
    $first = rateLimitKeys('opaque-registration', opaqueRequest(
        '/phr/auth/opaque/registration/finish',
        ['registrationId' => '11111111-1111-4111-8111-111111111111'],
    ));

    $second = rateLimitKeys('opaque-registration', opaqueRequest(
        '/phr/auth/opaque/registration/finish',
        ['registrationId' => '22222222-2222-4222-8222-222222222222'],
    ));

    expect($first)->toBe($second);

    $middleware = collect(app('router')->getRoutes()->getByName('filament.phr.auth.opaque.registration.finish')->gatherMiddleware());

    expect($middleware)->toContain('throttle:opaque-registration-finish')
        ->and($middleware)->not->toContain('throttle:opaque-registration');
});

it('sigue separando por token las peticiones de registration/start', function (): void {
    $first = rateLimitKeys('opaque-registration', opaqueRequest(
        '/phr/auth/opaque/registration/start',
        ['registrationToken' => 'token-uno'],
    ));

    $second = rateLimitKeys('opaque-registration', opaqueRequest(
        '/phr/auth/opaque/registration/start',
        ['registrationToken' => 'token-dos'],
    ));

    expect($first)->not->toBe($second);

    $middleware = app('router')->getRoutes()->getByName('filament.phr.auth.opaque.registration.start')->gatherMiddleware();

    expect($middleware)->toContain('throttle:opaque-registration');
});
