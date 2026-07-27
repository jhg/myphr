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
 * Bootstrap of the OPAQUE subsystem (`docs/OPAQUE.md` §12.2).
 *
 * It registers {@see ServerSetup} as a singleton built from `config/opaque.php`
 * with that class's strict validation (canonical base64url, exact lengths,
 * canonicity of the scalar and consistency of the derived public key), and
 * {@see RandomSource} on top of the system CSPRNG.
 *
 * **Nothing is generated here**: if configuration is missing or does not
 * validate, boot fails with {@see InvalidConfigurationException}. Producing the
 * static material is the explicit job of `php artisan opaque:setup`.
 *
 * The check is done eagerly in `boot()`, so the failure happens at boot and not
 * on the first login request, and it is limited to the HTTP boot: the console
 * has to work before the setup exists (`opaque:setup` is what generates it, and
 * `key:generate` or `migrate` run on an install that is not configured yet).
 * Tests are also left out, because they build their own configuration case by
 * case.
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
     * Forces validation of the setup during the HTTP boot (§12.2).
     *
     * @throws InvalidConfigurationException If the setup is missing or does not validate.
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
     * Rate limiters for the OPAQUE routes (Spec 0001 §4.1, §4.3 and §4.4;
     * `docs/OPAQUE.md` §13.3).
     *
     * The keys are always derived values: by IP, by **hash** of the normalized identifier and by the
     * combination of both. The plaintext login is never a limiter key, because the cache store would
     * end up holding the list of emails somebody has tried.
     *
     * `login/finish` does not receive the `login`, so its third key is the `handshakeId`. Using the
     * same empty key for all of its requests would create a single shared bucket anyone could drain
     * to lock everybody out of login.
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

        /**
         * Public signup (no invitation): the endpoint creates the account itself, so it is a mass
         * enumeration oracle by design (409 `login_taken` if the email already exists) and there is
         * no token to spread the abuse across buckets, as in `opaque-registration`. The IP is the
         * only possible key, and the limit is stricter than the one for invited registration: every
         * attempt here, on top of checking existence, writes a user row.
         */
        RateLimiter::for('opaque-registration-public', static function (Request $request): array {
            $ip = self::clientIp($request);

            return [
                Limit::perMinute(10)->by('opaque-registration-public:ip:'.$ip),
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
         * Password change: the key is the authenticated user, who always exists here, and it is
         * stricter than login because every attempt costs the server a full handshake and the
         * person twelve seconds of Argon2id. The IP tags along so a compromised account cannot be
         * used as a battering ram from many places at once.
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
         * `registration/finish` does not receive the `registrationToken` (the client only sends
         * `registrationId`, `registrationRecord`, `wrappedUserMasterKey` and `encryptedSettings`),
         * so it cannot share a limiter with `registration/start`: the per-token key would be the
         * hash of the empty string for everybody, a single 15/min bucket anyone can drain from one
         * IP to lock the whole install out of signup. Same shape as `opaque-login-finish`: the IP
         * and the pending row identifier, which is what does travel.
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
     * Reads a body field without assuming it is a string.
     *
     * The limiter runs **before** the controller validation, so the body arrives here as is: a
     * `login[]=x` would turn a plain `(string)` cast into a 500.
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
