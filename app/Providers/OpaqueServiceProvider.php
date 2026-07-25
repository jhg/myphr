<?php

declare(strict_types=1);

namespace App\Providers;

use App\Security\Opaque\CredentialIdentifier;
use App\Security\Opaque\InvalidConfigurationException;
use App\Security\Opaque\LoginNormalizer;
use App\Security\Opaque\RandomSource;
use App\Security\Opaque\ServerSetup;
use App\Security\Opaque\SystemRandomSource;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;

/**
 * Arranque del subsistema OPAQUE (`docs/OPAQUE.md` §12.2).
 *
 * Registra {@see ServerSetup} como singleton construido desde `config/opaque.php`
 * con la validación estricta de esa clase (base64url canónico, longitudes
 * exactas, canonicidad del escalar y coherencia de la clave pública derivada),
 * y {@see RandomSource} sobre el CSPRNG del sistema.
 *
 * Aquí **no se genera nada**: si falta configuración o no valida, el arranque
 * falla con {@see InvalidConfigurationException}. Producir el material estático
 * es tarea explícita de `php artisan opaque:setup`.
 *
 * La comprobación es anticipada en `boot()`, para que el fallo ocurra al
 * arrancar y no en la primera petición de login, y se limita al arranque HTTP:
 * la consola tiene que poder funcionar antes de que exista el setup
 * (`opaque:setup` es quien lo genera, y `key:generate` o `migrate` corren en
 * una instalación aún sin configurar). Las pruebas también quedan fuera,
 * porque construyen su propia configuración caso a caso.
 */
final class OpaqueServiceProvider extends ServiceProvider
{
    /**
     * Registra el setup del servidor y la fuente de aleatoriedad.
     */
    public function register(): void
    {
        $this->app->singleton(RandomSource::class, SystemRandomSource::class);

        $this->app->singleton(ServerSetup::class, static function (): ServerSetup {
            /** @var array<string, mixed> $config */
            $config = config('opaque', []);

            return ServerSetup::fromConfig($config);
        });

        $this->app->singleton(CredentialIdentifier::class, static function (): CredentialIdentifier {
            /** @var array<string, mixed> $config */
            $config = config('opaque', []);

            return CredentialIdentifier::fromConfig($config);
        });
    }

    /**
     * Fuerza la validación del setup en el arranque HTTP (§12.2).
     *
     * @throws InvalidConfigurationException Si el setup falta o no valida.
     */
    public function boot(): void
    {
        $this->registerRateLimiters();

        if ($this->app->runningInConsole() || $this->app->runningUnitTests()) {
            return;
        }

        $this->app->make(ServerSetup::class);
    }

    /**
     * Limitadores de tasa de las rutas de OPAQUE (Spec 0001 §4.1, §4.3 y §4.4;
     * `docs/OPAQUE.md` §13.3).
     *
     * Las claves son siempre valores derivados: por IP, por **hash** del identificador normalizado y
     * por la combinación de ambos. El login en claro no es nunca una clave de limitación, porque el
     * almacén de caché acabaría conteniendo la lista de emails que alguien ha probado.
     *
     * `login/finish` no recibe el `login`, así que su tercera clave es el `handshakeId`. Usar la
     * misma clave vacía para todas sus peticiones crearía un único cubo compartido que cualquiera
     * podría agotar para dejar sin login a todo el mundo.
     */
    private function registerRateLimiters(): void
    {
        RateLimiter::for('opaque-registration', static function (Request $request): array {
            $ip = self::clientIp($request);
            $token = hash('sha256', self::stringInput($request, 'registrationToken'));

            return [
                Limit::perMinute(30)->by('opaque-registration:ip:'.$ip),
                Limit::perMinute(15)->by('opaque-registration:token:'.$token),
            ];
        });

        RateLimiter::for('opaque-login', static function (Request $request): array {
            $ip = self::clientIp($request);
            $login = hash('sha256', LoginNormalizer::normalize(self::stringInput($request, 'login')));

            return [
                Limit::perMinute(30)->by('opaque-login:ip:'.$ip),
                Limit::perMinute(20)->by('opaque-login:login:'.$login),
                Limit::perMinute(15)->by('opaque-login:ip-login:'.$ip.':'.$login),
            ];
        });

        /**
         * Cambio de contraseña: la clave es el usuario autenticado, que aquí siempre existe, y es
         * más estricto que el login porque cada intento cuesta al servidor un handshake completo y
         * a la persona doce segundos de Argon2id. La IP acompaña para que una cuenta comprometida
         * no sirva de ariete desde muchos sitios a la vez.
         */
        RateLimiter::for('opaque-password-change', static function (Request $request): array {
            $ip = self::clientIp($request);
            $user = (string) ($request->user()?->getAuthIdentifier() ?? 'guest');

            return [
                Limit::perMinute(30)->by('opaque-password-change:ip:'.$ip),
                Limit::perMinute(5)->by('opaque-password-change:user:'.$user),
            ];
        });

        /**
         * `registration/finish` no recibe el `registrationToken` (el cliente solo manda
         * `registrationId`, `registrationRecord`, `wrappedUserMasterKey` y `encryptedSettings`),
         * así que no puede compartir limitador con `registration/start`: la clave por token sería
         * la del hash de la cadena vacía para todo el mundo, un único cubo de 15/min que cualquiera
         * agota desde una IP para dejar sin alta a toda la instalación. Misma forma que
         * `opaque-login-finish`: la IP y el identificador del pendiente, que es lo que sí viaja.
         */
        RateLimiter::for('opaque-registration-finish', static function (Request $request): array {
            $ip = self::clientIp($request);
            $registration = hash('sha256', self::stringInput($request, 'registrationId'));

            return [
                Limit::perMinute(30)->by('opaque-registration-finish:ip:'.$ip),
                Limit::perMinute(5)->by('opaque-registration-finish:registration:'.$registration),
            ];
        });

        RateLimiter::for('opaque-login-finish', static function (Request $request): array {
            $ip = self::clientIp($request);
            $handshake = hash('sha256', self::stringInput($request, 'handshakeId'));

            return [
                Limit::perMinute(30)->by('opaque-login-finish:ip:'.$ip),
                Limit::perMinute(5)->by('opaque-login-finish:handshake:'.$handshake),
            ];
        });
    }

    /**
     * Lee un campo del cuerpo sin dar por hecho que es una cadena.
     *
     * El limitador corre **antes** que la validación del controlador, así que aquí llega el cuerpo
     * tal cual: un `login[]=x` convertiría un `(string)` directo en un error 500.
     */
    private static function stringInput(Request $request, string $key): string
    {
        $value = $request->input($key);

        return is_string($value) ? $value : '';
    }

    private static function clientIp(Request $request): string
    {
        return $request->ip() ?? 'unknown';
    }
}
