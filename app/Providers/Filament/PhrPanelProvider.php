<?php

namespace App\Providers\Filament;

use App\Filament\Auth\Login;
use App\Filament\Pages\Dashboard;
use App\Filament\Pages\Profile;
use App\Http\Controllers\Auth\Opaque\LockController;
use App\Http\Controllers\Auth\Opaque\LoginFinishController;
use App\Http\Controllers\Auth\Opaque\LoginStartController;
use App\Http\Controllers\Auth\Opaque\PasswordChangeController;
use App\Http\Controllers\Auth\Opaque\PasswordChangeReauthFinishController;
use App\Http\Controllers\Auth\Opaque\PasswordChangeReauthStartController;
use App\Http\Controllers\Auth\Opaque\PasswordChangeRegistrationStartController;
use App\Http\Controllers\Auth\Opaque\RegistrationFinishController;
use App\Http\Controllers\Auth\Opaque\RegistrationStartController;
use App\Http\Controllers\Auth\Opaque\SessionSecretController;
use App\Http\Controllers\Auth\Opaque\SetPasswordController;
use App\Http\Controllers\Settings\UpdateSettingsController;
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
             * Ancho completo por defecto en todo el panel.
             *
             * Las pantallas de seguimiento son listados largos y gráficas: con el ancho acotado por
             * defecto de Filament, la gráfica se estrecha y caben menos registros en pantalla sin
             * desplazarse, que es justo lo contrario de lo que pide un diario de mediciones.
             */
            ->maxContentWidth(Width::Full)
            /**
             * Modo oscuro **activado**, con conmutador (DESIGN.md § Dark Mode).
             *
             * No hace falta ninguna llamada: Filament v5 ya trae `$hasDarkMode = true`,
             * `$hasThemeSwitcher = true` y `defaultThemeMode = ThemeMode::System`
             * (vendor/filament/filament/src/Panel/Concerns/HasDarkMode.php:9-13 y
             * HasTheme.php:22). Se deja tal cual a propósito: DESIGN.md § Dark Mode define ya la
             * paleta oscura completa —superficies, tintas, bordes, elevación y anillo de foco—,
             * derivada de la clara con una regla explícita, y `theme.css` la materializa en un
             * único bloque `:root.dark`. Como el modo por defecto es «system», quien tenga el
             * sistema operativo en oscuro entra directamente en esa paleta sin tocar nada, así
             * que apagarlo escondería el problema en vez de resolverlo.
             */
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
             *
             * `/phr/auth/*` ya cubre las cuatro rutas nuevas del cambio de contraseña
             * (`/phr/auth/password/…`), que cuelgan de ese mismo prefijo. `PUT /phr/settings` no
             * cuelga de él —los ajustes no son autenticación— y también responde JSON, así que se
             * añade aparte. La página de perfil (`GET /phr/profile`) sirve HTML y se queda fuera de
             * la lista: es una pantalla más del panel y debe navegarse como SPA.
             */
            ->spaUrlExceptions(fn (): array => [
                url('/phr/auth/*'),
                url('/phr/logout'),
                url('/phr/settings'),
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
            /**
             * Fuentes autoalojadas del sistema de diseño (DESIGN.md § Typography).
             *
             * `Vite::fonts()` emite las etiquetas `<link rel="preload">` y el `<style>` con los
             * `@font-face` y las variables `--font-figtree`, `--font-open-sans` y
             * `--font-ibm-plex-mono` que consume el tema. Los ficheros los descarga Vite en el
             * build y se sirven desde `public/build`, así que no hay ninguna petición a un
             * tercero: en un PHR de conocimiento cero, cada carga del panel se queda en casa.
             *
             * Hace falta el render hook porque Filament nunca llama a `@fonts`: su layout base
             * solo pinta `getFontHtml()` / `getMonoFontHtml()`.
             */
            ->renderHook(
                PanelsRenderHook::HEAD_START,
                fn (): Htmlable => Vite::fonts(['figtree', 'open-sans', 'ibm-plex-mono']),
            )
            /**
             * Familias del panel: Open Sans para el cuerpo e IBM Plex Mono para códigos y
             * valores (DESIGN.md § Typography y Do's #7). Filament las vuelca en `--font-family`
             * y `--mono-font-family`, de donde salen `--font-sans` y `--font-mono`.
             *
             * `LocalFontProvider` es explícito y obligatorio: sin `$provider`, Filament recurre a
             * `BunnyFontProvider`, que añadiría un `<link>` a fonts.bunny.net en cada carga del
             * panel clínico. Sin `$url`, `LocalFontProvider` no imprime nada —las fuentes ya
             * llegan por el hook de arriba— y solo deja fijado el nombre de la familia.
             *
             * Figtree, la familia de titulares, no cabe aquí: Filament solo tiene ranuras para
             * cuerpo, monoespaciada y serif. Va como token `--font-display` en theme.css.
             */
            ->font('Open Sans', provider: LocalFontProvider::class)
            ->monoFont('IBM Plex Mono', provider: LocalFontProvider::class)
            /**
             * Paleta MediCare+ (DESIGN.md § Colors). Esta es la única fuente de las rampas: el
             * panel las imprime en `:root` como `--primary-50…950` y el CSS del vendor ya las
             * mapea a las utilidades `bg-*`, `text-*` y `ring-*`.
             *
             * Se pasan los once tonos a mano en lugar de un hexadecimal suelto porque
             * `Color::generatePalette()` solo hereda el matiz y fija la luminosidad de cada tono
             * con constantes propias: con `'primary' => '#0077B6'`, el Med Blue exacto no
             * aparecería en ningún tono de la rampa resultante.
             *
             * El tono que manda es el **600**: es el que DESIGN.md § Buttons · Primary usa como
             * relleno sólido (#0077B6 con texto blanco, 4.87:1 sobre blanco, por encima del 4.5:1
             * de Do's #1).
             *
             * Aviso, porque no es lo que uno esperaría: el mapa de color de botones de Filament
             * (`ButtonComponentColorMap`) NO se queda con ese par. Resuelve el tono por contraste
             * y solo acepta un candidato cuyo mejor texto sea claro; para el 600 el mejor texto
             * calculado es el 950, que es oscuro, así que descarta el candidato y en tema claro
             * rellena el botón con el **400** (#48CAE4) y texto oscuro. Por eso el relleno sólido
             * no se deja en manos de ese mapa: lo fija la capa de componentes del tema
             * (`resources/css/filament/phr/components/controls.css`) contra § Buttons y
             * § Components — Dark. Esta rampa es la paleta, no la decisión de qué tono usa cada
             * componente.
             *
             * Los once tonos de cada rampa, incluidos los que § Colors no nombra, están
             * publicados en DESIGN.md § Color Ramps junto con la regla que los deriva
             * (interpolación en OKLCH entre tonos nombrados, sin girar el matiz, y con los tonos
             * interpolados marcados como decorativos). Esa sección es la fuente; aquí solo se
             * transcribe.
             */
            ->colors([
                'primary' => [
                    50 => '#F0F7FF',  // hover de botón secundario, fantasma, chip y lista
                    100 => '#E0EFFF', // active de esos mismos
                    200 => '#BBE6FC', // interpolado entre 100 y 300
                    300 => '#90E0EF', // Tertiary · Pale Cyan
                    400 => '#48CAE4', // Secondary · Light Blue
                    500 => '#1BA1CF', // interpolado entre 400 y 600
                    600 => '#0077B6', // Primary · Med Blue
                    700 => '#006399', // hover del botón primario
                    800 => '#005280', // active del botón primario
                    900 => '#004168', // extrapolado siguiendo el paso 700→800
                    950 => '#003250', // extrapolado con ese mismo paso
                ],
                // DESIGN.md § Colors: Info es el mismo #0077B6 que Primary.
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
                 * Los grises que DESIGN.md usa en inputs, tarjetas, listas y estados
                 * deshabilitados (#0F172A, #475569, #94A3B8, #CBD5E1, #E2E8F0, #F8FAFC) son la
                 * rampa Slate de Tailwind v3. No se puede usar `Color::Slate`, que es la de
                 * Tailwind v4 y no coincide (su 300 es #cad5e2, no #CBD5E1).
                 */
                'gray' => [
                    // DESIGN.md § Color Ramps · Gray. En oscuro esta misma rampa se repunta por
                    // papel en `:root.dark` (theme.css), según § Ramp Mapping — Dark.
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
                // Error #DC2626 con el hover (#B91C1C) y el active (#991B1B) del botón
                // destructivo, y el chip de error (#FEF2F2 fondo, #FECACA borde).
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
                // Success #059669 y su chip de estado (#ECFDF5 fondo, #A7F3D0 borde).
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
                // Warning #D97706 y su chip de estado (#FFFBEB fondo, #FDE68A borde).
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
             * Entrada del menú de usuario que lleva a la página de perfil.
             *
             * La clave literal `'profile'` es reservada: `HasUserMenu::registerUserMenuItems()`
             * la usa para **sustituir** el item que Filament inyecta de serie, en vez de añadir uno
             * nuevo al lado. Importa hacerlo así porque ese item por defecto se construye con
             * `->url(Filament::getProfileUrl())`, que devuelve `null` mientras el panel no llame a
             * `->profile()`: hoy el menú muestra el nombre de la persona y no lleva a ninguna parte.
             *
             * La clase es `Filament\Actions\Action`; `Filament\Navigation\MenuItem` sigue
             * aceptándose pero está `@deprecated` en v5.
             *
             * La URL sale de `Profile::getUrl()` y no de `Filament::getProfileUrl()` porque
             * {@see Profile} es una página normal del panel, descubierta por `discoverPages()`, no
             * la página de perfil de Filament: no hereda de `Filament\Auth\Pages\EditProfile`, que
             * da por hecho una columna `password` y un formulario de contraseña actual que enviaría
             * la contraseña en claro al servidor. En un cierre diferido, para que la resolución de
             * la ruta no ocurra mientras se construye el panel.
             */
            ->userMenuItems([
                'profile' => Action::make('profile')
                    ->label(__('My profile'))
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
                 * Detrás de `StartSession` porque lee la preferencia de la cuenta, y por delante de
                 * `authMiddleware` para que la pantalla de acceso, que se pinta sin sesión, también
                 * salga en el idioma que pide el navegador (ADR 0007).
                 */
                SetLocale::class,
            ])
            ->authMiddleware([
                Authenticate::class,
                /**
                 * Caducidad por inactividad contada en servidor (Spec 0001 §8; ADR 0009). Va detrás
                 * de `Authenticate` porque solo tiene sentido sobre una sesión ya autenticada, y
                 * cubre también las rutas de `authenticatedRoutes()`, que es donde viven el secreto
                 * de sesión y los ajustes cifrados.
                 */
                EnforceIdleTimeout::class,
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

                /**
                 * Cambio de contraseña de quien recuerda la actual.
                 *
                 * Son cuatro pasos de un mismo flujo y van aquí, autenticadas y con CSRF, porque el
                 * usuario sale siempre de la sesión y nunca de un campo del cuerpo: aceptarlo del
                 * cuerpo convertiría estas rutas en un oráculo de login arbitrario.
                 *
                 * `reauth/*` es un login OPAQUE completo contra el registro almacenado —la única
                 * forma de obtener el `export_key` viejo con el que se abre el sobre de la clave
                 * maestra— y `registration/start` + `change` rehacen el registro con la contraseña
                 * nueva. La clave maestra no cambia: solo se reenvuelve.
                 *
                 * El limitador `opaque-password-change` (5/min por usuario, 30/min por IP) ya está
                 * declarado en `OpaqueServiceProvider`.
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
         * Guardado de los ajustes cifrados (ADR 0007).
         *
         * Fuera del grupo `auth/` de arriba a propósito: los ajustes no son autenticación. `PUT` y
         * no `POST` porque la escritura es siempre un reemplazo completo del documento —el servidor
         * no puede parchear lo que no puede descifrar— y así reintentar tras un fallo de red es
         * seguro. Del cuerpo solo se valida la envoltura del sobre.
         */
        Route::middleware(NoStore::class)
            ->put('settings', UpdateSettingsController::class)
            ->name('settings.update');
    }
}
