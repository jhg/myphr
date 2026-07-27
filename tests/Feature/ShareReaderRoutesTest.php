<?php

declare(strict_types=1);

use App\Security\Opaque\Base64Url;
use App\Security\Opaque\InvalidConfigurationException;
use App\Sharing\DecoySalt;
use Illuminate\Cookie\Middleware\AddQueuedCookiesToResponse;
use Illuminate\Cookie\Middleware\EncryptCookies;
use Illuminate\Foundation\Http\Middleware\PreventRequestForgery;
use Illuminate\Session\Middleware\StartSession;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\Str;

/**
 * ADR 0011: las tres rutas del lector viven fuera del prefijo del panel y con su propia pila de
 * middleware. Todo lo que se monta bajo `phr` pasa por Filament, que lo envuelve con el grupo `web`
 * y por tanto con sesión y CSRF, incluidas sus rutas sin autenticar.
 */
it('monta las tres rutas del lector fuera del panel', function (string $name, string $uri): void {
    $route = Route::getRoutes()->getByName($name);

    expect($route)->not->toBeNull()
        ->and($route->uri())->toBe($uri)
        ->and(Str::startsWith($route->uri(), 'phr'))->toBeFalse();
})->with([
    'página' => ['share.reader', 's/{link}'],
    'challenge' => ['share.challenge', 's/{link}/challenge'],
    'open' => ['share.open', 's/{link}/open'],
]);

it('quita sesión y CSRF de las rutas del lector', function (string $name): void {
    $middleware = Route::getRoutes()->getByName($name)->gatherMiddleware();

    expect($middleware)->not->toContain(StartSession::class)
        ->not->toContain(PreventRequestForgery::class)
        ->not->toContain(EncryptCookies::class)
        ->not->toContain(AddQueuedCookiesToResponse::class);
})->with(['share.reader', 'share.challenge', 'share.open']);

/** El limitador por IP de la ruta, hermano de los de `OpaqueServiceProvider`. */
it('limita por IP las dos rutas que tocan el servidor', function (string $name, string $limiter): void {
    expect(Route::getRoutes()->getByName($name)->gatherMiddleware())
        ->toContain('throttle:'.$limiter);
})->with([
    ['share.challenge', 'share-challenge'],
    ['share.open', 'share-open'],
]);

/**
 * La sal señuelo tiene que ser estable entre despliegues, así que no puede colgar de `APP_KEY`. Si
 * no hay ninguna clave utilizable, esto falla en voz alta: una derivada de una clave vacía sería la
 * misma en todas las instalaciones del mundo y no protegería nada.
 */
it('exige una clave propia para la sal señuelo', function (): void {
    config()->set('share.decoy_salt_key', null);
    config()->set('opaque.enumeration_key', null);

    expect(fn () => (new DecoySalt)->for((string) Str::uuid()))
        ->toThrow(InvalidConfigurationException::class);
});

/** Si falta la entrada propia, cae en la clave de OPAQUE, que hace el mismo trabajo y es obligatoria. */
it('cae en la clave de enumeración de OPAQUE cuando no hay entrada propia', function (): void {
    $key = Base64Url::encode(random_bytes(32));

    config()->set('share.decoy_salt_key', null);
    config()->set('opaque.enumeration_key', $key);

    $linkId = (string) Str::uuid();
    $expected = substr(hash_hmac('sha256', "myphr/share-decoy-salt/v1\0".$linkId, Base64Url::decode($key), true), 0, 16);

    expect((new DecoySalt)->for($linkId))->toBe($expected);
});
