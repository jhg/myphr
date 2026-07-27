<?php

namespace App\Providers\Filament;

use App\Filament\Auth\Login;
use App\Filament\Pages\Dashboard;
use App\Filament\Pages\Profile;
use App\Http\Controllers\Auth\Opaque\InvitedRegistrationStartController;
use App\Http\Controllers\Auth\Opaque\LockController;
use App\Http\Controllers\Auth\Opaque\LoginFinishController;
use App\Http\Controllers\Auth\Opaque\LoginStartController;
use App\Http\Controllers\Auth\Opaque\PasswordChangeController;
use App\Http\Controllers\Auth\Opaque\PasswordChangeReauthFinishController;
use App\Http\Controllers\Auth\Opaque\PasswordChangeReauthStartController;
use App\Http\Controllers\Auth\Opaque\PasswordChangeRegistrationStartController;
use App\Http\Controllers\Auth\Opaque\RegistrationFinishController;
use App\Http\Controllers\Auth\Opaque\RegistrationPublicStartController;
use App\Http\Controllers\Auth\Opaque\SessionSecretController;
use App\Http\Controllers\Auth\RegisterPageController;
use App\Http\Controllers\Auth\SetPasswordPageController;
use App\Http\Controllers\Settings\UpdateSettingsController;
use App\Http\Controllers\Sharing\IssueShareLinkController;
use App\Http\Controllers\Sharing\ListSharesController;
use App\Http\Controllers\Sharing\RevokeShareController;
use App\Http\Controllers\Sharing\StoreShareController;
use App\Http\Middleware\EnforceIdleTimeout;
use App\Http\Middleware\NoStore;
use App\Http\Middleware\SetLocale;
use App\Provisioning\RegistrationLinks;
use Filament\Actions\Action;
use Filament\FontProviders\LocalFontProvider;
use Filament\Http\Middleware\Authenticate;
use Filament\Http\Middleware\AuthenticateSession;
use Filament\Http\Middleware\DisableBladeIconComponents;
use Filament\Http\Middleware\DispatchServingFilamentEvent;
use Filament\Panel;
use Filament\PanelProvider;
use Filament\Support\Enums\Width;
use Filament\Support\Icons\Heroicon;
use Filament\View\PanelsRenderHook;
use Filament\Widgets\AccountWidget;
use Filament\Widgets\FilamentInfoWidget;
use Illuminate\Contracts\Support\Htmlable;
use Illuminate\Contracts\View\View;
use Illuminate\Cookie\Middleware\AddQueuedCookiesToResponse;
use Illuminate\Cookie\Middleware\EncryptCookies;
use Illuminate\Foundation\Http\Middleware\PreventRequestForgery;
use Illuminate\Routing\Middleware\SubstituteBindings;
use Illuminate\Session\Middleware\StartSession;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\Facades\Vite;
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
            ->viteTheme('resources/css/filament/phr/theme.css')
            /**
             * Full width by default across the whole panel.
             *
             * The tracking screens are long listings and charts: with Filament's default bounded
             * width, the chart narrows and fewer records fit on screen without scrolling, which is
             * the exact opposite of what a measurement diary needs.
             */
            ->maxContentWidth(Width::Full)
            /**
             * Dark mode **on**, with a switcher (DESIGN.md § Dark Mode).
             *
             * No call is needed: Filament v5 already ships `$hasDarkMode = true`,
             * `$hasThemeSwitcher = true` and `defaultThemeMode = ThemeMode::System`
             * (vendor/filament/filament/src/Panel/Concerns/HasDarkMode.php:9-13 and
             * HasTheme.php:22). It is left as is on purpose: DESIGN.md § Dark Mode already defines
             * the full dark palette —surfaces, inks, borders, elevation and focus ring—, derived
             * from the light one with an explicit rule, and `theme.css` materializes it in a single
             * `:root.dark` block. Since the default mode is "system", anyone whose operating system
             * is in dark mode lands straight in that palette without touching anything, so turning
             * it off would hide the problem instead of solving it.
             */
            ->login(Login::class)
            /**
             * SPA **without prefetching** (Spec 0001 §10).
             *
             * Filament's prefetching requests the page when you hover over a link. Each of those
             * requests is an access to clinical data nobody asked for, and it lands in the audit log
             * as if the person had opened the screen. The second argument is `false` by default in
             * Filament; it is passed explicitly so a change in that default does not switch it on
             * silently.
             */
            ->spa(hasPrefetching: false)
            /**
             * URLs that do not serve HTML and that therefore cannot be taken over by Alpine's
             * router (`Alpine.navigate` would insert JSON into the `<body>`): the OPAQUE and session
             * endpoints, which answer JSON, and `POST /phr/logout`, which answers a redirect.
             *
             * `/phr/auth/*` already covers the four new password change routes
             * (`/phr/auth/password/…`), which hang off that same prefix. `PUT /phr/settings` does
             * not hang off it —settings are not authentication— and also answers JSON, so it is
             * added separately. The profile page (`GET /phr/profile`) serves HTML and stays off the
             * list: it is one more panel screen and must be navigated as a SPA.
             */
            ->spaUrlExceptions(fn (): array => [
                url('/phr/auth/*'),
                url('/phr/logout'),
                url('/phr/settings'),
                url('/phr/shares'),
                url('/phr/shares/*'),
            ])
            /**
             * Global search disabled (Spec 0001 §10).
             *
             * It resolves on the server over data that is encrypted here: it could not find
             * anything, and all it would achieve is sending whatever the person types to the server.
             */
            ->globalSearch(false)
            /**
             * The PWA icon doubles as the panel brand, so the top bar and the home screen icon are
             * the same thing. In a `Closure` because `brandLogo()` accepts `Htmlable` and this way
             * the view resolves when painting, not when building the panel.
             */
            ->brandLogo(fn (): View => view('phr.partials.brand'))
            /**
             * Browser tab icon.
             *
             * It deliberately reuses the same PNG the PWA manifest already declares
             * (`public/manifest.webmanifest`) instead of generating a separate set: with two sets,
             * the day the brand changes one gets updated and the other forgotten, and the tab ends
             * up showing a different icon from the installed application. The 192 is the smaller of
             * the manifest's two and is more than enough for the 16/32 px of a tab.
             *
             * An absolute path and **no domain**, like the rest of the `pwa-head` tags: the project
             * guarantees that changing domain breaks nothing (ADR 0003), and Filament prints this
             * string verbatim into the `href` of the `<link rel="icon">`.
             *
             * With this there is no need for `public/favicon.ico`: the browser only falls back to
             * that path by convention when the page declares no icon.
             */
            ->favicon('/icons/icon-192.png')
            ->renderHook(
                PanelsRenderHook::HEAD_END,
                fn (): View => view('phr.partials.crypto-head'),
            )
            /**
             * Installable on the home screen (manifest, icons and the `apple-*` tags, which iOS
             * needs because it does not read the manifest). The service worker that goes with this
             * caches nothing; the why is written in `public/sw.js`.
             */
            ->renderHook(
                PanelsRenderHook::HEAD_END,
                fn (): View => view('phr.partials.pwa-head'),
            )
            /**
             * "Install app" button, in the top bar and to the left of the user menu.
             *
             * It goes in as a render hook with its own template, and not as a `->userMenuItems()`
             * entry, because the decision to show it is not the server's: on Chromium it depends on
             * `beforeinstallprompt` arriving after painting, on iOS that event does not exist and
             * the button can only explain the manual "Share" gesture, and if the application is
             * already installed nothing should appear. A menu item built in PHP would always be
             * painted, including in browsers where pressing it can do nothing.
             */
            ->renderHook(
                PanelsRenderHook::USER_MENU_BEFORE,
                fn (): View => view('phr.partials.install-button'),
            )
            /**
             * Request language, on the `<body>` and not only on the `<html>`, because Livewire
             * navigation replaces the former and not the attributes of the latter. The full why is
             * in the template itself.
             */
            ->renderHook(
                PanelsRenderHook::BODY_START,
                fn (): View => view('phr.partials.locale-marker'),
            )
            /**
             * Self-hosted design system fonts (DESIGN.md § Typography).
             *
             * `Vite::fonts()` emits the `<link rel="preload">` tags and the `<style>` with the
             * `@font-face` rules and the `--font-figtree`, `--font-open-sans` and
             * `--font-ibm-plex-mono` variables the theme consumes. Vite downloads the files at
             * build time and they are served from `public/build`, so there is no request to a third
             * party: in a zero-knowledge PHR, every panel load stays at home.
             *
             * The render hook is needed because Filament never calls `@fonts`: its base layout only
             * paints `getFontHtml()` / `getMonoFontHtml()`.
             */
            ->renderHook(
                PanelsRenderHook::HEAD_START,
                fn (): Htmlable => Vite::fonts(['figtree', 'open-sans', 'ibm-plex-mono']),
            )
            /**
             * Panel families: Open Sans for body text and IBM Plex Mono for codes and values
             * (DESIGN.md § Typography and Do's #7). Filament dumps them into `--font-family` and
             * `--mono-font-family`, which is where `--font-sans` and `--font-mono` come from.
             *
             * `LocalFontProvider` is explicit and mandatory: without `$provider`, Filament falls
             * back to `BunnyFontProvider`, which would add a `<link>` to fonts.bunny.net on every
             * load of the clinical panel. Without `$url`, `LocalFontProvider` prints nothing —the
             * fonts already arrive through the hook above— and only pins the family name.
             *
             * Figtree, the display family, does not fit here: Filament only has slots for body,
             * monospace and serif. It goes in as the `--font-display` token in theme.css.
             */
            ->font('Open Sans', provider: LocalFontProvider::class)
            ->monoFont('IBM Plex Mono', provider: LocalFontProvider::class)
            /**
             * MediCare+ palette (DESIGN.md § Colors). This is the single source of the ramps: the
             * panel prints them into `:root` as `--primary-50…950` and the vendor CSS already maps
             * them to the `bg-*`, `text-*` and `ring-*` utilities.
             *
             * The eleven shades are passed by hand instead of a single hex value because
             * `Color::generatePalette()` only inherits the hue and fixes the lightness of each shade
             * with constants of its own: with `'primary' => '#0077B6'`, the exact Med Blue would not
             * appear in any shade of the resulting ramp.
             *
             * The shade that rules is the **600**: it is the one DESIGN.md § Buttons · Primary uses
             * as a solid fill (#0077B6 with white text, 4.87:1 on white, above the 4.5:1 in Do's
             * #1).
             *
             * A warning, because it is not what you would expect: Filament's button colour map
             * (`ButtonComponentColorMap`) does NOT keep that pair. It resolves the shade by contrast
             * and only accepts a candidate whose best text is light; for the 600 the computed best
             * text is the 950, which is dark, so it discards the candidate and in light theme fills
             * the button with the **400** (#48CAE4) and dark text. That is why the solid fill is not
             * left to that map: the theme's component layer
             * (`resources/css/filament/phr/components/controls.css`) pins it against § Buttons and
             * § Components — Dark. This ramp is the palette, not the decision of which shade each
             * component uses.
             *
             * The eleven shades of each ramp, including the ones § Colors does not name, are
             * published in DESIGN.md § Color Ramps together with the rule that derives them (OKLCH
             * interpolation between named shades, without rotating the hue, and with the
             * interpolated shades marked as decorative). That section is the source; this is only a
             * transcription.
             */
            ->colors([
                'primary' => [
                    50 => '#F0F7FF',  // hover for secondary, ghost, chip and list
                    100 => '#E0EFFF', // active for those same ones
                    200 => '#BBE6FC', // interpolated between 100 and 300
                    300 => '#90E0EF', // Tertiary · Pale Cyan
                    400 => '#48CAE4', // Secondary · Light Blue
                    500 => '#1BA1CF', // interpolated between 400 and 600
                    600 => '#0077B6', // Primary · Med Blue
                    700 => '#006399', // primary button hover
                    800 => '#005280', // primary button active
                    900 => '#004168', // extrapolated following the 700→800 step
                    950 => '#003250', // extrapolated with that same step
                ],
                // DESIGN.md § Colors: Info is the same #0077B6 as Primary.
                'info' => [
                    50 => '#F0F7FF',
                    100 => '#E0EFFF',
                    200 => '#BBE6FC',
                    300 => '#90E0EF',
                    400 => '#48CAE4',
                    500 => '#1BA1CF',
                    600 => '#0077B6',
                    700 => '#006399',
                    800 => '#005280',
                    900 => '#004168',
                    950 => '#003250',
                ],
                /**
                 * The greys DESIGN.md uses in inputs, cards, lists and disabled states (#0F172A,
                 * #475569, #94A3B8, #CBD5E1, #E2E8F0, #F8FAFC) are the Tailwind v3 Slate ramp.
                 * `Color::Slate` cannot be used: it is the Tailwind v4 one and does not match (its
                 * 300 is #cad5e2, not #CBD5E1).
                 */
                'gray' => [
                    // DESIGN.md § Color Ramps · Gray. In dark mode this same ramp is re-pointed by
                    // role in `:root.dark` (theme.css), per § Ramp Mapping — Dark.
                    50 => '#F8FAFC',
                    100 => '#F1F5F9',
                    200 => '#E2E8F0',
                    300 => '#CBD5E1',
                    400 => '#94A3B8',
                    500 => '#64748B',
                    600 => '#475569',
                    700 => '#334155',
                    800 => '#1E293B',
                    900 => '#0F172A',
                    950 => '#020617',
                ],
                // Error #DC2626 with the hover (#B91C1C) and active (#991B1B) of the destructive
                // button, and the error chip (#FEF2F2 background, #FECACA border).
                'danger' => [
                    50 => '#FEF2F2',
                    100 => '#FEE2E2',
                    200 => '#FECACA',
                    300 => '#FCA5A5',
                    400 => '#F87171',
                    500 => '#EF4444',
                    600 => '#DC2626',
                    700 => '#B91C1C',
                    800 => '#991B1B',
                    900 => '#7F1D1D',
                    950 => '#450A0A',
                ],
                // Success #059669 and its status chip (#ECFDF5 background, #A7F3D0 border).
                'success' => [
                    50 => '#ECFDF5',
                    100 => '#D1FAE5',
                    200 => '#A7F3D0',
                    300 => '#6EE7B7',
                    400 => '#34D399',
                    500 => '#10B981',
                    600 => '#059669',
                    700 => '#047857',
                    800 => '#065F46',
                    900 => '#064E3B',
                    950 => '#022C22',
                ],
                // Warning #D97706 and its status chip (#FFFBEB background, #FDE68A border).
                'warning' => [
                    50 => '#FFFBEB',
                    100 => '#FEF3C7',
                    200 => '#FDE68A',
                    300 => '#FCD34D',
                    400 => '#FBBF24',
                    500 => '#F59E0B',
                    600 => '#D97706',
                    700 => '#B45309',
                    800 => '#92400E',
                    900 => '#78350F',
                    950 => '#451A03',
                ],
            ])
            ->discoverResources(in: app_path('Filament/Resources'), for: 'App\Filament\Resources')
            ->discoverPages(in: app_path('Filament/Pages'), for: 'App\Filament\Pages')
            ->pages([
                Dashboard::class,
            ])
            /**
             * User menu entry that leads to the profile page.
             *
             * The literal key `'profile'` is reserved: `HasUserMenu::registerUserMenuItems()` uses
             * it to **replace** the item Filament injects by default, instead of adding a new one
             * beside it. Doing it this way matters because that default item is built with
             * `->url(Filament::getProfileUrl())`, which returns `null` while the panel does not call
             * `->profile()`: today the menu shows the person's name and leads nowhere.
             *
             * The class is `Filament\Actions\Action`; `Filament\Navigation\MenuItem` is still
             * accepted but is `@deprecated` in v5.
             *
             * The URL comes from `Profile::getUrl()` and not from `Filament::getProfileUrl()`
             * because {@see Profile} is an ordinary panel page, discovered by `discoverPages()`, not
             * Filament's profile page: it does not extend `Filament\Auth\Pages\EditProfile`, which
             * assumes a `password` column and a current-password form that would send the password
             * in the clear to the server. In a deferred closure, so route resolution does not happen
             * while the panel is being built.
             */
            ->userMenuItems([
                'profile' => Action::make('profile')
                    /**
                     * The label goes in a `Closure` and not as a string: this method builds the
                     * panel once, when registering it, and `SetLocale` has not run at that point. A
                     * `__()` evaluated then keeps the default language forever, even if the account
                     * has another one. It is the same reason page titles are resolved by method and
                     * not as a static property.
                     */
                    ->label(fn (): string => __('My profile'))
                    ->icon(Heroicon::UserCircle)
                    ->url(fn (): string => Profile::getUrl()),
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
                /**
                 * Behind `StartSession` because it reads the account preference, and ahead of
                 * `authMiddleware` so the login screen, which is painted without a session, also
                 * comes out in the language the browser asks for (ADR 0007).
                 */
                SetLocale::class,
            ])
            ->authMiddleware([
                Authenticate::class,
                /**
                 * Idle timeout counted on the server (Spec 0001 §8; ADR 0009). It goes behind
                 * `Authenticate` because it only makes sense on an already authenticated session,
                 * and it also covers the `authenticatedRoutes()` routes, which is where the session
                 * secret and the encrypted settings live.
                 */
                EnforceIdleTimeout::class,
            ]);
    }

    /**
     * OPAQUE routes and the link page (Spec 0001 §4).
     *
     * They go in `routes()`, which Filament mounts with the panel prefix and with the session and
     * CSRF of the `web` group, but **outside** the `getAuthMiddleware()` group: whoever uses them is
     * not authenticated yet. They cannot go in an `api` group, which includes neither `StartSession`
     * nor CSRF protection: `session()->regenerate()` would throw `RuntimeException: Session store
     * not set on request` and `Auth::guard('web')->login()` would persist nothing
     * (`docs/OPAQUE.md` §15).
     */
    protected function unauthenticatedRoutes(Panel $panel): void
    {
        Route::middleware(NoStore::class)->group(function (): void {
            Route::get(Str::afterLast(RegistrationLinks::SET_PASSWORD_PATH, '/'), SetPasswordPageController::class)
                ->name('auth.set-password');

            /**
             * Public signup (ADR 0009). Unauthenticated and without an invitation: it is the screen
             * the link on the login form leads to.
             */
            Route::get('register', RegisterPageController::class)
                ->name('auth.register');

            Route::prefix('auth/opaque')
                ->name('auth.opaque.')
                ->group(function (): void {
                    Route::post('registration/start', InvitedRegistrationStartController::class)
                        ->middleware('throttle:opaque-registration')
                        ->name('registration.start');

                    /**
                     * Public signup, with no invitation link. Its name and limiter are separate from
                     * `registration.start`: there is no token here to bound abuse naturally, so the
                     * per-IP limit has to be the only brake and, for that reason, stricter.
                     */
                    Route::post('registration/public/start', RegistrationPublicStartController::class)
                        ->middleware('throttle:opaque-registration-public')
                        ->name('registration.public-start');

                    Route::post('registration/finish', RegistrationFinishController::class)
                        ->middleware('throttle:opaque-registration-finish')
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
     * Routes that require an already authenticated session (Spec 0001 §4.5 and §4.6).
     *
     * `authenticatedRoutes()` is the only mount point of the panel that runs **inside** the
     * `getAuthMiddleware()` group.
     */
    protected function sessionRoutes(Panel $panel): void
    {
        Route::middleware(NoStore::class)
            ->prefix('auth')
            ->name('auth.')
            ->group(function (): void {
                Route::post('session-secret', SessionSecretController::class)->name('session-secret');
                Route::post('lock', LockController::class)->name('lock');

                /**
                 * Password change for someone who remembers the current one.
                 *
                 * These are four steps of one flow and they go here, authenticated and with CSRF,
                 * because the user always comes from the session and never from a body field:
                 * accepting it from the body would turn these routes into an arbitrary login oracle.
                 *
                 * `reauth/*` is a full OPAQUE login against the stored registration —the only way
                 * to obtain the old `export_key` that opens the master key envelope— and
                 * `registration/start` + `change` redo the registration with the new password. The
                 * master key does not change: it is only rewrapped.
                 *
                 * The `opaque-password-change` limiter (5/min per user, 30/min per IP) is already
                 * declared in `OpaqueServiceProvider`.
                 */
                Route::prefix('password')
                    ->name('password.')
                    ->middleware('throttle:opaque-password-change')
                    ->group(function (): void {
                        Route::post('reauth/start', PasswordChangeReauthStartController::class)
                            ->name('reauth.start');

                        Route::post('reauth/finish', PasswordChangeReauthFinishController::class)
                            ->name('reauth.finish');

                        Route::post('registration/start', PasswordChangeRegistrationStartController::class)
                            ->name('registration.start');

                        Route::post('change', PasswordChangeController::class)->name('change');
                    });
            });

        /**
         * Saving the encrypted settings (ADR 0007).
         *
         * Deliberately outside the `auth/` group above: settings are not authentication. `PUT` and
         * not `POST` because the write is always a full replacement of the document —the server
         * cannot patch what it cannot decrypt— and that way retrying after a network failure is
         * safe. Of the body, only the envelope wrapper is validated.
         */
        Route::middleware(NoStore::class)
            ->put('settings', UpdateSettingsController::class)
            ->name('settings.update');

        /**
         * Clipping sharing (ADR 0011), on the side of whoever owns the data.
         *
         * These go in `authenticatedRoutes()`, with session, CSRF and idle timeout: creating,
         * listing and revoking are operations of the owner. The other half of the flow —the
         * professional's page, `challenge` and `open`— lives in `routes/web.php` with the opposite
         * stack, no session and no CSRF, because whoever uses it has no account.
         *
         * The package is uploaded through here, an HTTP endpoint of its own, and **not** through
         * Livewire: it carries the `s1.` prefix and the two ADR 0002 guardrails abort on any long
         * string that does not start with `v1.`. They are not touched; we use the route ADR 0002
         * itself reserves for large blobs.
         */
        Route::middleware(NoStore::class)
            ->prefix('shares')
            ->name('shares.')
            ->group(function (): void {
                Route::get('/', ListSharesController::class)->name('index');
                Route::post('/', StoreShareController::class)->name('store');
                Route::post('{share}/links', IssueShareLinkController::class)->name('links.store');
                Route::delete('{share}', RevokeShareController::class)->name('destroy');
            });
    }
}
