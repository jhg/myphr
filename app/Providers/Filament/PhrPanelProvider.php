<?php

namespace App\Providers\Filament;

use App\Filament\Auth\Login;
use App\Filament\Pages\Dashboard;
use App\Http\Controllers\Auth\Opaque\LockController;
use App\Http\Controllers\Auth\Opaque\LoginFinishController;
use App\Http\Controllers\Auth\Opaque\LoginStartController;
use App\Http\Controllers\Auth\Opaque\RegistrationFinishController;
use App\Http\Controllers\Auth\Opaque\RegistrationStartController;
use App\Http\Controllers\Auth\Opaque\SessionSecretController;
use App\Http\Controllers\Auth\Opaque\SetPasswordController;
use App\Http\Middleware\NoStore;
use App\Provisioning\RegistrationLinks;
use Filament\Http\Middleware\Authenticate;
use Filament\Http\Middleware\AuthenticateSession;
use Filament\Http\Middleware\DisableBladeIconComponents;
use Filament\Http\Middleware\DispatchServingFilamentEvent;
use Filament\Panel;
use Filament\PanelProvider;
use Filament\Support\Colors\Color;
use Filament\View\PanelsRenderHook;
use Filament\Widgets\AccountWidget;
use Filament\Widgets\FilamentInfoWidget;
use Illuminate\Contracts\View\View;
use Illuminate\Cookie\Middleware\AddQueuedCookiesToResponse;
use Illuminate\Cookie\Middleware\EncryptCookies;
use Illuminate\Foundation\Http\Middleware\PreventRequestForgery;
use Illuminate\Routing\Middleware\SubstituteBindings;
use Illuminate\Session\Middleware\StartSession;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\Str;
use Illuminate\View\Middleware\ShareErrorsFromSession;

class PhrPanelProvider extends PanelProvider
{
    public function panel(Panel $panel): Panel
    {
        return $panel
            ->default()
            ->id('phr')
            ->path('phr')
            ->login(Login::class)
            /**
             * SPA **sin prefetching** (Spec 0001 §10).
             *
             * El prefetching de Filament pide la página al pasar el ratón por encima de un enlace.
             * Cada una de esas peticiones es un acceso a datos clínicos que nadie solicitó, y queda
             * en el registro de auditoría como si la persona hubiera abierto la pantalla. El
             * segundo argumento es `false` por defecto en Filament; se pasa explícito para que un
             * cambio de ese valor por defecto no lo active en silencio.
             */
            ->spa(hasPrefetching: false)
            /**
             * URLs que no sirven HTML y que, por tanto, no puede tomar el enrutador de Alpine
             * (`Alpine.navigate` insertaría un JSON en el `<body>`): los endpoints de OPAQUE y de
             * sesión, que responden JSON, y el `POST /phr/logout`, que responde una redirección.
             */
            ->spaUrlExceptions(fn (): array => [
                url('/phr/auth/*'),
                url('/phr/logout'),
            ])
            /**
             * Buscador global desactivado (Spec 0001 §10).
             *
             * Resuelve en servidor sobre datos que aquí están cifrados: no podría encontrar nada, y
             * lo único que conseguiría es enviar al servidor lo que la persona teclea.
             */
            ->globalSearch(false)
            ->renderHook(
                PanelsRenderHook::HEAD_END,
                fn (): View => view('phr.partials.crypto-head'),
            )
            ->colors([
                'primary' => Color::Amber,
            ])
            ->discoverResources(in: app_path('Filament/Resources'), for: 'App\Filament\Resources')
            ->discoverPages(in: app_path('Filament/Pages'), for: 'App\Filament\Pages')
            ->pages([
                Dashboard::class,
            ])
            ->discoverWidgets(in: app_path('Filament/Widgets'), for: 'App\Filament\Widgets')
            ->widgets([
                AccountWidget::class,
                FilamentInfoWidget::class,
            ])
            ->routes($this->unauthenticatedRoutes(...))
            ->authenticatedRoutes($this->sessionRoutes(...))
            ->middleware([
                EncryptCookies::class,
                AddQueuedCookiesToResponse::class,
                StartSession::class,
                AuthenticateSession::class,
                ShareErrorsFromSession::class,
                PreventRequestForgery::class,
                SubstituteBindings::class,
                DisableBladeIconComponents::class,
                DispatchServingFilamentEvent::class,
            ])
            ->authMiddleware([
                Authenticate::class,
            ]);
    }

    /**
     * Rutas de OPAQUE y página del enlace (Spec 0001 §4).
     *
     * Van en `routes()`, que Filament monta con el prefijo del panel y con la sesión y el CSRF del
     * grupo `web`, pero **fuera** del grupo de `getAuthMiddleware()`: quien las usa todavía no está
     * autenticado. No pueden ir en un grupo `api`, que no incluye `StartSession` ni la protección
     * contra CSRF: `session()->regenerate()` lanzaría `RuntimeException: Session store not set on
     * request` y `Auth::guard('web')->login()` no persistiría nada (`docs/OPAQUE.md` §15).
     */
    protected function unauthenticatedRoutes(Panel $panel): void
    {
        Route::middleware(NoStore::class)->group(function (): void {
            Route::get(Str::afterLast(RegistrationLinks::SET_PASSWORD_PATH, '/'), SetPasswordController::class)
                ->name('auth.set-password');

            Route::prefix('auth/opaque')
                ->name('auth.opaque.')
                ->group(function (): void {
                    Route::post('registration/start', RegistrationStartController::class)
                        ->middleware('throttle:opaque-registration')
                        ->name('registration.start');

                    Route::post('registration/finish', RegistrationFinishController::class)
                        ->middleware('throttle:opaque-registration')
                        ->name('registration.finish');

                    Route::post('login/start', LoginStartController::class)
                        ->middleware('throttle:opaque-login')
                        ->name('login.start');

                    Route::post('login/finish', LoginFinishController::class)
                        ->middleware('throttle:opaque-login-finish')
                        ->name('login.finish');
                });
        });
    }

    /**
     * Rutas que exigen una sesión ya autenticada (Spec 0001 §4.5 y §4.6).
     *
     * `authenticatedRoutes()` es el único punto de montaje del panel que corre **dentro** del grupo
     * de `getAuthMiddleware()`.
     */
    protected function sessionRoutes(Panel $panel): void
    {
        Route::middleware(NoStore::class)
            ->prefix('auth')
            ->name('auth.')
            ->group(function (): void {
                Route::post('session-secret', SessionSecretController::class)->name('session-secret');
                Route::post('lock', LockController::class)->name('lock');
            });
    }
}
