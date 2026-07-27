<?php

declare(strict_types=1);

use Filament\Facades\Filament;
use Illuminate\Session\Middleware\StartSession;
use Illuminate\Support\Facades\Route;
use Livewire\Livewire;

/**
 * Does this route start a session?
 *
 * `gatherMiddleware()` returns the `web` group unexpanded and **does not subtract** whatever was
 * removed with `withoutMiddleware()`, so the reader routes would show up as having a session. What
 * decides is the subtraction.
 *
 * @param  Illuminate\Routing\Route  $route
 */
function startsSession($route): bool
{
    $excluded = $route->excludedMiddleware();

    if (in_array(StartSession::class, $excluded, true)) {
        return false;
    }

    return in_array(StartSession::class, $route->gatherMiddleware(), true)
        || in_array('web', $route->gatherMiddleware(), true);
}

/**
 * Scope of the session cookie (ADR 0011).
 *
 * Reading a shared clipping promises that nothing identifies the reader: `routes/web.php` removes
 * `StartSession`, `EncryptCookies` and `AddQueuedCookiesToResponse` from the `/s` routes. That
 * governs what Laravel **reads and writes**, and not what the browser **sends**: with the cookie at
 * `path=/`, a top-level navigation to `/s/{link}` carries it anyway if that person has a session
 * open in the panel, and with it the clipping identifier and the account end up on the same line of
 * any access log, proxy, WAF or CDN in front of the application. That is exactly the correlation the
 * ADR says to avoid.
 *
 * That is why the cookie is scoped to the panel prefix, and why the Livewire endpoint —which by
 * default lives outside `/phr`— is registered inside it. These checks are what stop a future change
 * of the prefix, or a new route with a session hanging off the root, from silently reopening the
 * hole.
 */
test('the session cookie is scoped to the panel prefix', function (): void {
    expect(config('session.path'))->toBe('/'.Filament::getPanel('phr')->getPath());
});

test('the Livewire endpoint hangs off the panel prefix, or the cookie would not reach it', function (): void {
    expect(Livewire::getUpdateUri())->toStartWith('/'.Filament::getPanel('phr')->getPath().'/');
});

/**
 * Every route of ours that starts a session has to fit inside the cookie scope. One that fell
 * outside would not receive the cookie from the browser and would fail silently with a 419, and
 * fixing it by putting `path=/` back would undo the above without anyone connecting the two.
 *
 * Only our own routes are examined: the unused Livewire ones (`upload-file`, `preview-file`) and the
 * Filament download ones still declare `web`, and none of them is called from this application.
 */
test('no route of ours with a session falls outside the cookie scope', function (): void {
    $scope = trim((string) config('session.path'), '/');

    $outside = collect(Route::getRoutes()->getRoutes())
        ->filter(fn ($route): bool => str_starts_with(
            (string) $route->getActionName(),
            'App\\',
        ) || str_contains((string) $route->getName(), 'filament.phr.'))
        ->filter(fn ($route): bool => startsSession($route))
        ->reject(fn ($route): bool => str_starts_with($route->uri(), $scope))
        ->map(fn ($route): string => $route->uri())
        ->values()
        ->all();

    expect($outside)->toBe([]);
});

/**
 * And the other half of the perimeter, which was already there: the reader routes start no session.
 */
test('the reader routes stay without a session', function (): void {
    $readerRoutes = collect(Route::getRoutes()->getRoutes())
        ->filter(fn ($route): bool => str_starts_with($route->uri(), 's/'));

    expect($readerRoutes)->not->toBeEmpty();

    $readerRoutes->each(function ($route): void {
        expect(startsSession($route))->toBeFalse();
    });
});
