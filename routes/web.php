<?php

declare(strict_types=1);

use App\Http\Controllers\Sharing\ShareChallengeController;
use App\Http\Controllers\Sharing\ShareOpenController;
use App\Http\Controllers\Sharing\ShareReaderPageController;
use App\Http\Middleware\NoStore;
use App\Http\Middleware\WithoutLivewireAssets;
use App\Providers\AppServiceProvider;
use Illuminate\Cookie\Middleware\AddQueuedCookiesToResponse;
use Illuminate\Cookie\Middleware\EncryptCookies;
use Illuminate\Foundation\Http\Middleware\PreventRequestForgery;
use Illuminate\Session\Middleware\StartSession;
use Illuminate\Support\Facades\Route;
use Illuminate\View\Middleware\ShareErrorsFromSession;

/**
 * The site root sends you to the panel, which is the whole application.
 *
 * It used to serve `resources/views/welcome.blade.php`, Laravel's stock welcome page: English text
 * without `__()` —the only URL in the project not translated into any of the three languages— and
 * dozens of ramp steps (`text-gray-900`, `bg-gray-200`, `text-white`) that DESIGN.md forbids and
 * that polluted any token audit. Nothing linked to it.
 *
 * It goes to the panel and not straight to the login screen: if there is a session, Filament takes
 * you home, and if there is none, it redirects to `/phr/login` itself. That way the decision of
 * where a visit without a session goes lives in a single place.
 */
Route::redirect('/', '/phr')->name('home');

/**
 * Livewire's update endpoint is **not** declared here: it lives in
 * {@see AppServiceProvider::registerPanelLivewireUpdateRoute()}, which explains why.
 * The short version: route files do not run when routes are cached, and a Livewire update route that
 * is only declared here silently reverts to its default path on any deploy that runs
 * `php artisan optimize`.
 */

/**
 * Reading a clipping shared with a professional (ADR 0011).
 *
 * The three routes live here and not under `phr` because the panel prefix belongs to Filament
 * (`PhrPanelProvider::path('phr')`) and everything mounted there goes through `routes()`, which
 * Filament wraps with the `web` group and therefore with session and CSRF, including its own
 * unauthenticated routes. This stack is the opposite: no session cookie, no CSRF and nothing that
 * identifies the reader.
 *
 * The prefix is `/s`, short because it ends up in a QR code —every character is more modules in the
 * code— and mute because the URL is shown during a consultation and stored in the history of
 * someone else's device: `/share-medical-history/…` would say what it is about before anyone opens
 * it. The domain already gives away enough through Certificate Transparency.
 *
 * Five middlewares from the `web` group are removed, one by one and explicitly:
 *
 * * `StartSession`, `EncryptCookies` and `AddQueuedCookiesToResponse`, so the response carries no
 *   cookie at all. A session cookie here would be a stable identifier for a professional in their
 *   practice, correlatable across the clippings of two different patients.
 * * `PreventRequestForgery`, because there is no session to forge and requiring a token would mean
 *   painting it on the page, which is as good as not requiring it.
 * * `ShareErrorsFromSession`, which blows up without a session.
 *
 * `WithoutLivewireAssets` turns off the automatic injection of the Livewire runtime, which sneaks
 * into any 200 HTML response without the template asking for it: the why is in the middleware
 * itself.
 *
 * `NoStore` is applied: it sets `Cache-Control: no-store`, `Pragma: no-cache` and
 * `Referrer-Policy: no-referrer`, the last one especially relevant here, because the URL carries `S`
 * in the fragment and the rest of the URL must never travel as `Referer` to any external resource.
 *
 * The per-IP limiters are siblings of the ones in `OpaqueServiceProvider` and are declared in
 * `AppServiceProvider`. They do not replace the attempt counter, which lives in a column: they are
 * two different brakes, one against noise and one against brute force on the PIN.
 */
Route::prefix('s')
    ->name('share.')
    ->middleware([NoStore::class, WithoutLivewireAssets::class])
    ->withoutMiddleware([
        EncryptCookies::class,
        AddQueuedCookiesToResponse::class,
        StartSession::class,
        ShareErrorsFromSession::class,
        PreventRequestForgery::class,
    ])
    ->group(function (): void {
        Route::get('{link}', ShareReaderPageController::class)->name('reader');

        Route::post('{link}/challenge', ShareChallengeController::class)
            ->middleware('throttle:share-challenge')
            ->name('challenge');

        Route::post('{link}/open', ShareOpenController::class)
            ->middleware('throttle:share-open')
            ->name('open');
    });
