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
 * ADR 0011: the three reader routes live outside the panel prefix and with a middleware stack of
 * their own. Everything mounted under `phr` goes through Filament, which wraps it with the `web`
 * group and therefore with session and CSRF, including its unauthenticated routes.
 */
it('mounts the three reader routes outside the panel', function (string $name, string $uri): void {
    $route = Route::getRoutes()->getByName($name);

    expect($route)->not->toBeNull()
        ->and($route->uri())->toBe($uri)
        ->and(Str::startsWith($route->uri(), 'phr'))->toBeFalse();
})->with([
    'page' => ['share.reader', 's/{link}'],
    'challenge' => ['share.challenge', 's/{link}/challenge'],
    'open' => ['share.open', 's/{link}/open'],
]);

it('strips session and CSRF from the reader routes', function (string $name): void {
    $middleware = Route::getRoutes()->getByName($name)->gatherMiddleware();

    expect($middleware)->not->toContain(StartSession::class)
        ->not->toContain(PreventRequestForgery::class)
        ->not->toContain(EncryptCookies::class)
        ->not->toContain(AddQueuedCookiesToResponse::class);
})->with(['share.reader', 'share.challenge', 'share.open']);

/** The per-IP limiter of the route, a sibling of the ones in `OpaqueServiceProvider`. */
it('rate limits by IP the two routes that touch the server', function (string $name, string $limiter): void {
    expect(Route::getRoutes()->getByName($name)->gatherMiddleware())
        ->toContain('throttle:'.$limiter);
})->with([
    ['share.challenge', 'share-challenge'],
    ['share.open', 'share-open'],
]);

/**
 * The decoy salt has to be stable across deployments, so it cannot hang off `APP_KEY`. If there is
 * no usable key, this fails loudly: one derived from an empty key would be the same on every install
 * in the world and would protect nothing.
 */
it('requires a key of its own for the decoy salt', function (): void {
    config()->set('share.decoy_salt_key', null);
    config()->set('opaque.enumeration_key', null);

    expect(fn () => (new DecoySalt)->for((string) Str::uuid()))
        ->toThrow(InvalidConfigurationException::class);
});

/** If the entry of its own is missing, it falls back to the OPAQUE key, which does the same job and is mandatory. */
it('falls back to the OPAQUE enumeration key when there is no entry of its own', function (): void {
    $key = Base64Url::encode(random_bytes(32));

    config()->set('share.decoy_salt_key', null);
    config()->set('opaque.enumeration_key', $key);

    $linkId = (string) Str::uuid();
    $expected = substr(hash_hmac('sha256', "myphr/share-decoy-salt/v1\0".$linkId, Base64Url::decode($key), true), 0, 16);

    expect((new DecoySalt)->for($linkId))->toBe($expected);
});
