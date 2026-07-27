<?php

namespace App\Providers;

use App\Console\Commands\ProhibitedMakeFilamentUserCommand;
use App\Livewire\Hooks\EncryptedPayloadGuardHook;
use App\Support\SystemTerminal;
use App\Support\Terminal;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\ServiceProvider;
use Livewire\Livewire;
use Livewire\Mechanisms\HandleRequests\RequireLivewireHeaders;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        $this->app->bind(Terminal::class, SystemTerminal::class);
        $this->registerEncryptedPayloadGuard();
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        $this->registerPanelLivewireUpdateRoute();
        $this->prohibitFilamentUserCommand();
        $this->registerShareRateLimiters();
    }

    /**
     * Livewire's update endpoint, moved down into the panel prefix.
     *
     * Out of the box it lives at `/livewire-<hash>/update`, that is **outside** `/phr`, which forced
     * the session cookie to use `path=/`. With `path=/` the browser also sends it on the top-level
     * navigation to `/s/{link}` and on its subresources: taking `StartSession` off those routes stops
     * Laravel from reading and writing it, but not the cookie from travelling. Any proxy, WAF, CDN or
     * access log in front then sees, on the same line, the identifier of a clipping and the cookie of
     * a specific account, which is exactly the correlation this design says it avoids (ADR 0011).
     *
     * With the route here, **everything that needs a session hangs off `/phr`** and the cookie can be
     * scoped (`SESSION_PATH`, `config/session.php`). `tests/Feature/SessionCookieScopeTest.php` walks
     * the route table and fails if any route with `StartSession` falls outside the prefix.
     *
     * **Why this lives in a provider and not in `routes/web.php`.** With `php artisan optimize` (which
     * the deploy runs) the route files are never executed at runtime, so `setUpdateRoute()` was never
     * called. Livewire's own `HandleRequests::boot()` runs before the compiled routes are loaded,
     * finds no custom route and registers its default one, keeping that default `Route` object as the
     * URI it advertises to the browser in `data-update-uri`. Every Livewire request in production then
     * went to `/livewire-<hash>/update`, which `handleUpdate()` rejects **by design** with a bare 404
     * as soon as a custom route exists — a 404 that never reaches application code and so leaves no
     * trace in the log. A provider boots on every request, cached routes or not.
     * `tests/Feature/LivewireUpdateRouteTest.php` caches the routes in a subprocess and fails if the
     * advertised URI drifts back outside `/phr`.
     *
     * The name ends in `livewire.update` because that is how `HandleRequests::findUpdateRoute()`
     * recognises a custom route and prefers it over its own.
     */
    private function registerPanelLivewireUpdateRoute(): void
    {
        Livewire::setUpdateRoute(fn ($handle) => Route::post('/phr/livewire/update', $handle)
            ->middleware(['web', RequireLivewireHeaders::class])
            ->name('phr.livewire.update'));
    }

    /**
     * Per-IP limiters for the two clipping reading routes (ADR 0011), siblings of the ones in
     * {@see OpaqueServiceProvider}.
     *
     * They do **not** replace the PIN attempt counter, which lives in a database column. They are
     * two different and non-interchangeable brakes: this one lives in cache and an operational
     * `cache:clear` would reset it, so trusting it with brute force on a six-digit PIN would hand
     * back the whole attack with a routine maintenance command. What it does do is bound the noise
     * and the scanning of identifiers from a single IP.
     *
     * The IP goes into the key **hashed**, and not in the clear as in OPAQUE. On this route the IP
     * of whoever downloads reveals the healthcare centre and from there the diagnosis, and the ADR
     * explicitly decides that no layer we operate records it; storing it readable in the cache
     * store, even for a minute, would be recording it.
     *
     * `challenge` is more generous than `open` because it consumes no attempts and returns
     * something public by construction: the salt. `open` is the one to squeeze.
     */
    private function registerShareRateLimiters(): void
    {
        RateLimiter::for('share-challenge', static function (Request $request): array {
            return [
                Limit::perMinute(30)->by('share-challenge:ip:'.self::hashedIp($request)),
            ];
        });

        RateLimiter::for('share-open', static function (Request $request): array {
            $link = hash('sha256', (string) $request->route('link'));

            return [
                Limit::perMinute(15)->by('share-open:ip:'.self::hashedIp($request)),
                Limit::perMinute(10)->by('share-open:link:'.$link),
            ];
        });
    }

    private static function hashedIp(Request $request): string
    {
        return hash('sha256', $request->ip() ?? 'unknown');
    }

    /**
     * Spec 0001 §9: `make:filament-user` and its aliases are disabled.
     *
     * It is registered in `boot()`, after the Filament provider has registered its own in
     * `register()`: the console resolves by name and the last definition wins, so all three names
     * (`make:filament-user`, `filament:make-user`, `filament:user`) end up pointing at the command
     * that aborts with the explanation.
     */
    private function prohibitFilamentUserCommand(): void
    {
        $this->commands([
            ProhibitedMakeFilamentUserCommand::class,
        ]);
    }

    /**
     * Spec 0001 §9 / ADR 0002: the server half of the pair of guardrails against plaintext leaks.
     * It is registered here, not in a provider of its own, because that is the simplest option:
     * there is not more than a couple of Livewire bootstrap pieces in the application today to
     * justify a dedicated provider (our own decision; the spec does not say where to hook it beyond
     * suggesting `AppServiceProvider::boot()` or a provider of its own).
     *
     * It is called from `register()`, not from `boot()`: `LivewireServiceProvider::boot()` freezes
     * the list of component hooks as soon as it starts (`ComponentHookRegistry::boot()`), and
     * Laravel runs the `register()` phase of every provider before the `boot()` phase of any.
     * Registering the hook in `boot()` would leave it out of that list if `AppServiceProvider` boots
     * after the Livewire provider, which is the real order in this application.
     */
    private function registerEncryptedPayloadGuard(): void
    {
        Livewire::componentHook(EncryptedPayloadGuardHook::class);
    }
}
