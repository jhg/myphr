<?php

namespace App\Providers;

use App\Console\Commands\ProhibitedMakeFilamentUserCommand;
use App\Livewire\Hooks\EncryptedPayloadGuardHook;
use App\Support\SystemTerminal;
use App\Support\Terminal;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;
use Livewire\Livewire;

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
        $this->prohibitFilamentUserCommand();
        $this->registerShareRateLimiters();
    }

    /**
     * Limitadores por IP de las dos rutas de lectura de un recorte (ADR 0011), hermanos de los de
     * {@see OpaqueServiceProvider}.
     *
     * **No** sustituyen al contador de intentos del PIN, que vive en columna de base de datos. Son
     * dos frenos distintos y no intercambiables: este vive en caché y un `cache:clear` operativo lo
     * reiniciaría, así que confiarle la fuerza bruta sobre un PIN de seis dígitos sería devolver el
     * ataque completo con un comando de mantenimiento rutinario. Lo que sí hace es acotar el ruido y
     * el rastreo de identificadores desde una misma IP.
     *
     * La IP entra **hasheada** en la clave, y no en claro como en OPAQUE. En esta ruta la IP de
     * quien descarga revela el centro sanitario y de ahí el diagnóstico, y el ADR decide de forma
     * explícita que ninguna capa que operemos la registre; guardarla legible en el almacén de caché,
     * aunque sea un minuto, sería registrarla.
     *
     * `challenge` es más generoso que `open` porque no consume intentos y devuelve algo público por
     * construcción: la sal. `open` es el que hay que apretar.
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
     * Spec 0001 §9: `make:filament-user` y sus alias quedan deshabilitados.
     *
     * Se registra en `boot()`, después de que el proveedor de Filament haya registrado el suyo en
     * `register()`: la consola resuelve por nombre y la última definición gana, así que los tres
     * nombres (`make:filament-user`, `filament:make-user`, `filament:user`) acaban apuntando al
     * comando que aborta con la explicación.
     */
    private function prohibitFilamentUserCommand(): void
    {
        $this->commands([
            ProhibitedMakeFilamentUserCommand::class,
        ]);
    }

    /**
     * Spec 0001 §9 / ADR 0002: mitad de servidor del par de guardarraíles contra fugas de dato en
     * claro. Se registra aquí, no en un proveedor propio, porque es la opción más simple: no hay hoy
     * más de un par de piezas de arranque de Livewire en la aplicación que justifiquen un proveedor
     * dedicado (decisión propia, la spec no concreta dónde engancharlo más allá de sugerir
     * `AppServiceProvider::boot()` o un proveedor propio).
     *
     * Se llama desde `register()`, no desde `boot()`: `LivewireServiceProvider::boot()` congela la
     * lista de hooks de componente en cuanto arranca (`ComponentHookRegistry::boot()`), y Laravel
     * ejecuta la fase `register()` de todos los proveedores antes que la fase `boot()` de ninguno.
     * Registrar el hook en `boot()` lo dejaría fuera de esa lista si `AppServiceProvider` arranca
     * después que el proveedor de Livewire, que es el orden real en esta aplicación.
     */
    private function registerEncryptedPayloadGuard(): void
    {
        Livewire::componentHook(EncryptedPayloadGuardHook::class);
    }
}
