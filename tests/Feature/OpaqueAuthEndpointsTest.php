<?php

declare(strict_types=1);

use App\Auth\SessionSecrets;
use App\Models\OpaqueLoginHandshake;
use App\Models\OpaqueRegistration;
use App\Models\User;
use App\Models\UserMasterKeyEnvelope;
use App\Models\UserRegistrationLink;
use App\Provisioning\RegistrationLinks;
use App\Security\Opaque\Base64Url;
use App\Security\Opaque\CredentialIdentifier;
use App\Security\Opaque\OpaqueProfile;
use App\Support\AuditEvent;
use Filament\Http\Middleware\Authenticate;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Spatie\Activitylog\Models\Activity;
use Tests\Support\OpaqueTestClient;

uses(RefreshDatabase::class);

/**
 * Contrato HTTP de OPAQUE (Spec 0001 §4, §5 y §6; `docs/OPAQUE.md` §13, §15 y §20.8).
 *
 * Los flujos se recorren de extremo a extremo contra el servidor real, con un cliente OPAQUE de
 * pruebas ({@see OpaqueTestClient}): nada de fixtures grabados ni de respuestas simuladas.
 */
const TEST_PASSWORD = 'CorrectHorseBatteryStaple';

beforeEach(function (): void {
    config(['opaque' => opaqueEndpointConfig()]);
});

/**
 * Sobre cifrado del ADR 0004 con un tamaño válido. El servidor no lo abre nunca, así que su
 * contenido es indiferente: lo que se prueba es que acepta la envoltura y la devuelve intacta.
 */
function fakeEnvelope(): string
{
    return 'v1.'.Base64Url::encode(random_bytes(64 + 16 + 256));
}

/** URL de una ruta del panel por su nombre. */
function phrRoute(string $name): string
{
    return route('filament.phr.'.$name);
}

/**
 * Emite un enlace de registro para una cuenta nueva.
 *
 * @return array{0: User, 1: string} La cuenta y el token en claro.
 */
function issuedRegistrationToken(?User $user = null): array
{
    $user ??= User::factory()->create();
    $url = app(RegistrationLinks::class)->issueFor($user);

    return [$user, Str::after($url, '#')];
}

/**
 * Recorre el alta completa (Spec 0001 §5) y devuelve lo necesario para seguir con el login.
 *
 * @return array{user: User, envelope: string, settings: string}
 */
function completeRegistration(?User $user = null, string $password = TEST_PASSWORD): array
{
    [$user, $token] = issuedRegistrationToken($user);

    $started = OpaqueTestClient::startRegistration($password);

    $start = test()->postJson(phrRoute('auth.opaque.registration.start'), [
        'registrationRequest' => $started['registrationRequest'],
        'registrationToken' => $token,
    ]);

    $start->assertOk();

    $finished = OpaqueTestClient::finishRegistration(
        $password,
        $started['blind'],
        $start->json('registrationResponse'),
        TEST_SERVER_IDENTITY,
    );

    $envelope = fakeEnvelope();
    $settings = fakeEnvelope();

    test()->postJson(phrRoute('auth.opaque.registration.finish'), [
        'registrationId' => $start->json('registrationId'),
        'registrationRecord' => $finished['registrationRecord'],
        'wrappedUserMasterKey' => $envelope,
        'encryptedSettings' => $settings,
    ])->assertOk();

    return ['user' => $user->refresh(), 'envelope' => $envelope, 'settings' => $settings];
}

/**
 * Recorre el login completo (Spec 0001 §6.1) y devuelve la respuesta de `login/finish`.
 */
function completeLogin(User $user, string $password = TEST_PASSWORD): TestResponse
{
    $started = OpaqueTestClient::startLogin($password);

    $start = test()->postJson(phrRoute('auth.opaque.login.start'), [
        'login' => $user->email,
        'startLoginRequest' => $started['startLoginRequest'],
    ]);

    $start->assertOk();

    $finished = OpaqueTestClient::finishLogin(
        $password,
        $started,
        $start->json('loginResponse'),
        TEST_SERVER_IDENTITY,
    );

    return test()->postJson(phrRoute('auth.opaque.login.finish'), [
        'handshakeId' => $start->json('handshakeId'),
        'finishLoginRequest' => $finished['finishLoginRequest'],
    ]);
}

/** Spec 0001 §4: las rutas cuelgan del panel y viven fuera y dentro del middleware de autenticación. */
it('monta las rutas bajo el prefijo del panel', function (string $name, string $uri, string $method): void {
    $route = Route::getRoutes()->getByName('filament.phr.'.$name);

    expect($route)->not->toBeNull()
        ->and($route->uri())->toBe($uri)
        ->and($route->methods())->toContain($method);
})->with([
    ['auth.opaque.registration.start', 'phr/auth/opaque/registration/start', 'POST'],
    ['auth.opaque.registration.finish', 'phr/auth/opaque/registration/finish', 'POST'],
    ['auth.opaque.login.start', 'phr/auth/opaque/login/start', 'POST'],
    ['auth.opaque.login.finish', 'phr/auth/opaque/login/finish', 'POST'],
    ['auth.set-password', 'phr/set-password', 'GET'],
    ['auth.session-secret', 'phr/auth/session-secret', 'POST'],
    ['auth.lock', 'phr/auth/lock', 'POST'],
]);

/** §4.5: `session-secret` y `lock` exigen sesión autenticada. */
it('deja las rutas de sesión detrás del middleware de autenticación y las de OPAQUE fuera', function (): void {
    $authenticated = Route::getRoutes()->getByName('filament.phr.auth.session-secret')->gatherMiddleware();
    $unauthenticated = Route::getRoutes()->getByName('filament.phr.auth.opaque.login.start')->gatherMiddleware();

    expect($authenticated)->toContain(Authenticate::class)
        ->and($unauthenticated)->not->toContain(Authenticate::class);
});

/** Spec 0001 §5, pasos 4 y 12: el alta completa, en dos peticiones y con el enlace consumido al final. */
it('completa el alta de una cuenta y deja el enlace consumido y el sobre vigente', function (): void {
    $result = completeRegistration();
    $user = $result['user'];

    expect($user->opaque_registered_at)->not->toBeNull()
        ->and($user->opaque_profile)->toBe(OpaqueProfile::NAME)
        ->and(strlen((string) $user->opaque_registration_record))->toBe(192)
        ->and(strlen((string) $user->opaque_credential_identifier))->toBe(32)
        ->and($user->encrypted_settings)->toBe($result['settings'])
        ->and($user->currentMasterKeyEnvelope?->envelope)->toBe($result['envelope'])
        ->and(OpaqueRegistration::query()->count())->toBe(0)
        ->and(UserRegistrationLink::query()->whereNull('consumed_at')->count())->toBe(0);
});

/** §13.1: el identificador es el HMAC del login normalizado, no un valor aleatorio por registro. */
it('deriva el identificador de credencial del login normalizado', function (): void {
    $user = completeRegistration()['user'];

    expect($user->opaque_credential_identifier)
        ->toBe(app(CredentialIdentifier::class)->for((string) $user->email));
});

/** §4.1: el cliente necesita `userId` antes de cifrar, y `serverPublicKey` para el pinning del §5. */
it('devuelve userId, perfil y clave pública del servidor en registration/start', function (): void {
    [, $token] = issuedRegistrationToken();
    $started = OpaqueTestClient::startRegistration(TEST_PASSWORD);

    $response = test()->postJson(phrRoute('auth.opaque.registration.start'), [
        'registrationRequest' => $started['registrationRequest'],
        'registrationToken' => $token,
    ]);

    $response->assertOk()
        ->assertJsonStructure(['registrationId', 'registrationResponse', 'serverPublicKey', 'userId', 'profile'])
        ->assertJsonPath('profile', OpaqueProfile::NAME);

    expect(strlen(Base64Url::decode($response->json('registrationResponse'))))->toBe(64)
        ->and(strlen(Base64Url::decode($response->json('serverPublicKey'))))->toBe(32)
        ->and(UserRegistrationLink::query()->whereNull('consumed_at')->count())->toBe(1);
});

/** §4.1 y §7: token inexistente, caducado y consumido comparten error. */
it('responde con el mismo error genérico para cualquier token no utilizable', function (string $case): void {
    $token = match ($case) {
        'inexistente' => Str::random(43),
        'caducado' => (function (): string {
            [$user, $token] = issuedRegistrationToken();
            $user->registrationLinks()->update(['expires_at' => now()->subMinute()]);

            return $token;
        })(),
        'consumido' => (function (): string {
            [$user, $token] = issuedRegistrationToken();
            $user->registrationLinks()->update(['consumed_at' => now()]);

            return $token;
        })(),
    };

    $started = OpaqueTestClient::startRegistration(TEST_PASSWORD);

    test()->postJson(phrRoute('auth.opaque.registration.start'), [
        'registrationRequest' => $started['registrationRequest'],
        'registrationToken' => $token,
    ])->assertStatus(422)->assertExactJson(['error' => 'invalid_registration']);
})->with(['inexistente', 'caducado', 'consumido']);

/** §4.2 y §7: reintentar tras perder la respuesta no falla ni duplica filas. */
it('es idempotente en registration/finish', function (): void {
    [$user, $token] = issuedRegistrationToken();
    $started = OpaqueTestClient::startRegistration(TEST_PASSWORD);

    $start = test()->postJson(phrRoute('auth.opaque.registration.start'), [
        'registrationRequest' => $started['registrationRequest'],
        'registrationToken' => $token,
    ]);

    $finished = OpaqueTestClient::finishRegistration(
        TEST_PASSWORD,
        $started['blind'],
        $start->json('registrationResponse'),
        TEST_SERVER_IDENTITY,
    );

    $payload = [
        'registrationId' => $start->json('registrationId'),
        'registrationRecord' => $finished['registrationRecord'],
        'wrappedUserMasterKey' => fakeEnvelope(),
        'encryptedSettings' => fakeEnvelope(),
    ];

    $first = test()->postJson(phrRoute('auth.opaque.registration.finish'), $payload)->assertOk();
    $second = test()->postJson(phrRoute('auth.opaque.registration.finish'), $payload)->assertOk();

    expect($second->json('userId'))->toBe($first->json('userId'))
        ->and(UserMasterKeyEnvelope::query()->where('user_id', $user->id)->count())->toBe(1)
        ->and($user->refresh()->encrypted_settings)->toBe($payload['encryptedSettings']);
});

/** §4.2: un sobre que no cumple la envoltura del ADR 0004 no se almacena. */
it('rechaza un sobre sin prefijo v1. o con un tamaño que no es de los permitidos', function (string $envelope): void {
    [, $token] = issuedRegistrationToken();
    $started = OpaqueTestClient::startRegistration(TEST_PASSWORD);

    $start = test()->postJson(phrRoute('auth.opaque.registration.start'), [
        'registrationRequest' => $started['registrationRequest'],
        'registrationToken' => $token,
    ]);

    $finished = OpaqueTestClient::finishRegistration(
        TEST_PASSWORD,
        $started['blind'],
        $start->json('registrationResponse'),
        TEST_SERVER_IDENTITY,
    );

    test()->postJson(phrRoute('auth.opaque.registration.finish'), [
        'registrationId' => $start->json('registrationId'),
        'registrationRecord' => $finished['registrationRecord'],
        'wrappedUserMasterKey' => $envelope,
        'encryptedSettings' => fakeEnvelope(),
    ])->assertStatus(422);

    expect(UserMasterKeyEnvelope::query()->count())->toBe(0);
})->with([
    'sin prefijo' => [fn (): string => Base64Url::encode(random_bytes(336))],
    'tamaño no permitido' => [fn (): string => 'v1.'.Base64Url::encode(random_bytes(337))],
    'base64url no canónico' => [fn (): string => 'v1.'.str_repeat('A', 447).'='],
]);

/** Spec 0001 §5 y §6.1 encadenadas: alta y login posterior contra el servidor real. */
it('completa el login de una cuenta recién dada de alta', function (): void {
    $result = completeRegistration();

    $response = completeLogin($result['user']);

    $response->assertOk()
        ->assertJsonStructure(['redirect', 'csrf', 'sessionSecret', 'encryptedUserMasterKey', 'encryptedSettings'])
        ->assertJsonPath('encryptedUserMasterKey', $result['envelope'])
        ->assertJsonPath('encryptedSettings', $result['settings']);

    expect(auth()->id())->toBe($result['user']->id)
        ->and(strlen(Base64Url::decode($response->json('sessionSecret'))))->toBe(32)
        ->and(session(SessionSecrets::SESSION_KEY))->toBe($response->json('sessionSecret'))
        ->and($response->json('redirect'))->toBe(Filament\Facades\Filament::getPanel('phr')->getUrl())
        ->and(OpaqueLoginHandshake::query()->count())->toBe(0);
});

/** §4.4: el destino guardado por `redirect()->guest()` no se pierde. */
it('devuelve el destino guardado en url.intended', function (): void {
    $result = completeRegistration();

    test()->withSession(['url.intended' => 'http://localhost/phr/algo-profundo']);

    completeLogin($result['user'])
        ->assertOk()
        ->assertJsonPath('redirect', 'http://localhost/phr/algo-profundo');
});

/** §4.4: contraseña incorrecta produce el error genérico y ninguna sesión. */
it('rechaza una contraseña incorrecta con el error genérico', function (): void {
    $result = completeRegistration();

    $started = OpaqueTestClient::startLogin('otra-contraseña');

    $start = test()->postJson(phrRoute('auth.opaque.login.start'), [
        'login' => $result['user']->email,
        'startLoginRequest' => $started['startLoginRequest'],
    ])->assertOk();

    /** El cliente real ni siquiera llega a `login/finish`: `server_mac` no verifica. */
    expect(fn () => OpaqueTestClient::finishLogin(
        'otra-contraseña',
        $started,
        $start->json('loginResponse'),
        TEST_SERVER_IDENTITY,
    ))->toThrow(RuntimeException::class);

    test()->postJson(phrRoute('auth.opaque.login.finish'), [
        'handshakeId' => $start->json('handshakeId'),
        'finishLoginRequest' => Base64Url::encode(random_bytes(64)),
    ])->assertStatus(401)->assertExactJson(['error' => 'authentication_failed']);

    expect(auth()->check())->toBeFalse();
});

/** §4.4 y `docs/OPAQUE.md` §14.3: el handshake se consume antes de validar el MAC y es de un solo uso. */
it('consume el handshake de un solo uso, incluso cuando el MAC no cuadra', function (): void {
    $result = completeRegistration();
    $started = OpaqueTestClient::startLogin(TEST_PASSWORD);

    $start = test()->postJson(phrRoute('auth.opaque.login.start'), [
        'login' => $result['user']->email,
        'startLoginRequest' => $started['startLoginRequest'],
    ])->assertOk();

    $handshakeId = $start->json('handshakeId');

    test()->postJson(phrRoute('auth.opaque.login.finish'), [
        'handshakeId' => $handshakeId,
        'finishLoginRequest' => Base64Url::encode(random_bytes(64)),
    ])->assertStatus(401);

    expect(OpaqueLoginHandshake::query()->whereKey($handshakeId)->exists())->toBeFalse();

    $finished = OpaqueTestClient::finishLogin(
        TEST_PASSWORD,
        $started,
        $start->json('loginResponse'),
        TEST_SERVER_IDENTITY,
    );

    /** El MAC correcto ya no sirve: el handshake se consumió en el intento anterior. */
    test()->postJson(phrRoute('auth.opaque.login.finish'), [
        'handshakeId' => $handshakeId,
        'finishLoginRequest' => $finished['finishLoginRequest'],
    ])->assertStatus(401)->assertExactJson(['error' => 'authentication_failed']);

    expect(auth()->check())->toBeFalse();
});

/** §4.4: un handshake correcto tampoco vale dos veces. */
it('no acepta el mismo handshake dos veces con el MAC correcto', function (): void {
    $result = completeRegistration();
    $started = OpaqueTestClient::startLogin(TEST_PASSWORD);

    $start = test()->postJson(phrRoute('auth.opaque.login.start'), [
        'login' => $result['user']->email,
        'startLoginRequest' => $started['startLoginRequest'],
    ])->assertOk();

    $finished = OpaqueTestClient::finishLogin(
        TEST_PASSWORD,
        $started,
        $start->json('loginResponse'),
        TEST_SERVER_IDENTITY,
    );

    $payload = [
        'handshakeId' => $start->json('handshakeId'),
        'finishLoginRequest' => $finished['finishLoginRequest'],
    ];

    test()->postJson(phrRoute('auth.opaque.login.finish'), $payload)->assertOk();
    test()->postJson(phrRoute('auth.opaque.login.finish'), $payload)->assertStatus(401);
});

/** §13.3: cuenta inexistente y cuenta real dan la misma forma, el mismo código y el mismo tamaño. */
it('responde a un usuario inexistente con una respuesta estructuralmente idéntica', function (): void {
    $result = completeRegistration();

    $real = test()->postJson(phrRoute('auth.opaque.login.start'), [
        'login' => $result['user']->email,
        'startLoginRequest' => OpaqueTestClient::startLogin(TEST_PASSWORD)['startLoginRequest'],
    ]);

    $fake = test()->postJson(phrRoute('auth.opaque.login.start'), [
        'login' => 'nadie@example.test',
        'startLoginRequest' => OpaqueTestClient::startLogin(TEST_PASSWORD)['startLoginRequest'],
    ]);

    expect($fake->status())->toBe($real->status())
        ->and(array_keys($fake->json()))->toBe(array_keys($real->json()))
        ->and(strlen($fake->json('loginResponse')))->toBe(strlen($real->json('loginResponse')))
        ->and(strlen(Base64Url::decode($fake->json('loginResponse'))))->toBe(320)
        ->and($fake->json('profile'))->toBe($real->json('profile'))
        ->and(strlen($fake->content()))->toBe(strlen($real->content()));

    /** La rama falsa deja su fila de handshake, sin `user_id`, igual que la real. */
    expect(OpaqueLoginHandshake::query()->whereNull('user_id')->count())->toBe(1)
        ->and(OpaqueLoginHandshake::query()->whereNotNull('user_id')->count())->toBe(1);
});

/**
 * `docs/OPAQUE.md` §20.8: con el mismo mensaje cegado y el mismo login, la respuesta debe ser
 * indistinguible antes y después de registrar la cuenta.
 *
 * La igualdad byte a byte se comprueba sobre el `evaluated_message`, que es la parte determinista:
 * es exactamente lo que RFC 9807 §10.9 señala como el oráculo a cerrar. El resto de `KE2` lleva
 * nonces frescos y no puede repetirse, así que de él se comprueban forma y tamaño.
 */
it('devuelve el mismo evaluated_message para el mismo punto cegado antes y después del alta', function (): void {
    $user = User::factory()->create();
    $started = OpaqueTestClient::startLogin(TEST_PASSWORD);

    $before = test()->postJson(phrRoute('auth.opaque.login.start'), [
        'login' => $user->email,
        'startLoginRequest' => $started['startLoginRequest'],
    ])->assertOk();

    completeRegistration($user);

    $after = test()->postJson(phrRoute('auth.opaque.login.start'), [
        'login' => $user->email,
        'startLoginRequest' => $started['startLoginRequest'],
    ])->assertOk();

    $evaluated = fn (string $loginResponse): string => substr(Base64Url::decode($loginResponse), 0, 32);

    expect($evaluated($after->json('loginResponse')))->toBe($evaluated($before->json('loginResponse')))
        ->and($after->status())->toBe($before->status())
        ->and(array_keys($after->json()))->toBe(array_keys($before->json()))
        ->and(strlen($after->content()))->toBe(strlen($before->content()));
});

/** §13.3: la rama falsa se recorre también con el registro presente pero el perfil desajustado. */
it('recorre la rama falsa cuando el perfil almacenado no es el vigente', function (): void {
    $result = completeRegistration();

    $result['user']->forceFill(['opaque_profile' => 'OPAQUE-R255-SHA512-A2ID-m16384-t1-p1-ctx0-v0'])->save();

    $started = OpaqueTestClient::startLogin(TEST_PASSWORD);

    $response = test()->postJson(phrRoute('auth.opaque.login.start'), [
        'login' => $result['user']->email,
        'startLoginRequest' => $started['startLoginRequest'],
    ])->assertOk();

    expect(OpaqueLoginHandshake::query()->whereNull('user_id')->count())->toBe(1);

    /** El cliente no puede terminar: el envelope enmascarado no es el suyo. */
    expect(fn () => OpaqueTestClient::finishLogin(
        TEST_PASSWORD,
        $started,
        $response->json('loginResponse'),
        TEST_SERVER_IDENTITY,
    ))->toThrow(RuntimeException::class);
});

/** §13.3: sin registro OPAQUE, la cuenta es indistinguible de una inexistente. */
it('recorre la rama falsa cuando la cuenta existe pero no tiene registro OPAQUE', function (): void {
    $user = User::factory()->create();

    test()->postJson(phrRoute('auth.opaque.login.start'), [
        'login' => $user->email,
        'startLoginRequest' => OpaqueTestClient::startLogin(TEST_PASSWORD)['startLoginRequest'],
    ])->assertOk();

    expect(OpaqueLoginHandshake::query()->whereNull('user_id')->count())->toBe(1);
});

/** §6.2: la recuperación tras recarga no vuelve a pedir la contraseña. */
it('devuelve el mismo secreto de sesión y la configuración cifrada en session-secret', function (): void {
    $result = completeRegistration();
    $login = completeLogin($result['user'])->assertOk();

    $response = test()->postJson(phrRoute('auth.session-secret'));

    $response->assertOk()
        ->assertJsonPath('sessionSecret', $login->json('sessionSecret'))
        ->assertJsonPath('encryptedSettings', $result['settings']);

    expect($response->headers->get('Vary'))->toContain('Cookie');
});

/** §4.5: sin sesión no hay secreto, y la ruta ni siquiera llega al controlador. */
it('no entrega el secreto de sesión sin sesión autenticada', function (): void {
    test()->postJson(phrRoute('auth.session-secret'))->assertStatus(401);
});

/** §4.5: sesión viva cuyo secreto ya no está. */
it('responde 410 cuando la sesión sigue viva pero el secreto ya no está', function (): void {
    $result = completeRegistration();
    completeLogin($result['user'])->assertOk();

    $store = app('session.store');
    app(SessionSecrets::class)->destroy($store);
    $store->save();

    test()->postJson(phrRoute('auth.session-secret'))
        ->assertStatus(410)
        ->assertExactJson(['error' => 'session_secret_unavailable']);
});

/** §8: el bloqueo cierra la sesión entera, no solo el secreto. */
it('cierra la sesión completa al bloquear', function (): void {
    $result = completeRegistration();
    completeLogin($result['user'])->assertOk();

    test()->postJson(phrRoute('auth.lock'))->assertOk()->assertExactJson(['locked' => true]);

    expect(auth()->check())->toBeFalse()
        ->and(session(SessionSecrets::SESSION_KEY))->toBeNull();

    /**
     * Divergencia con la Spec 0001 §11: la spec espera 410 aquí, pero `session-secret` vive en
     * `authenticatedRoutes()` y el bloqueo destruye la sesión, así que el middleware de
     * autenticación corta antes con 401. Las dos respuestas llevan al mismo sitio: la pantalla de
     * login.
     */
    test()->postJson(phrRoute('auth.session-secret'))->assertStatus(401);
});

/** §4: ninguna respuesta de este grupo puede quedar en una caché. */
it('marca todas las respuestas como no almacenables', function (string $name, string $method): void {
    $response = test()->json($method, phrRoute($name), []);

    expect($response->headers->get('Cache-Control'))->toContain('no-store');
})->with([
    ['auth.set-password', 'GET'],
    ['auth.opaque.registration.start', 'POST'],
    ['auth.opaque.registration.finish', 'POST'],
    ['auth.opaque.login.start', 'POST'],
    ['auth.opaque.login.finish', 'POST'],
    ['auth.session-secret', 'POST'],
    ['auth.lock', 'POST'],
]);

/** §4.1 y §7: la página del enlace se sirve genérica, sin token en el path y sin consultar nada. */
it('sirve la página de establecimiento de contraseña sin validar ningún token', function (): void {
    test()->get(phrRoute('auth.set-password'))->assertOk()->assertSee('set-password', escape: false);

    expect(phrRoute('auth.set-password'))->toBe(url(RegistrationLinks::SET_PASSWORD_PATH));
});

/** §4.3: un mensaje estructuralmente inválido no llega a la criptografía. */
it('rechaza un KE1 mal formado sin crear handshake', function (): void {
    test()->postJson(phrRoute('auth.opaque.login.start'), [
        'login' => 'quien@example.test',
        'startLoginRequest' => Base64Url::encode(random_bytes(95)),
    ])->assertStatus(422)->assertExactJson(['error' => 'invalid_request']);

    expect(OpaqueLoginHandshake::query()->count())->toBe(0);
});

/**
 * Spec 0001 §3.4: reemitir un enlace sobre una cuenta con acceso no sobrescribe el sobre anterior.
 *
 * El sobre viejo queda retirado con su contenido intacto, para que una contraseña que alguien
 * todavía recuerde siga abriendo lo que abría.
 */
it('añade un sobre nuevo y retira el anterior al registrarse otra vez', function (): void {
    $first = completeRegistration();
    $user = $first['user'];

    $url = app(RegistrationLinks::class)->issueFor($user, confirmation: (string) $user->email);
    $token = Str::after($url, '#');

    $started = OpaqueTestClient::startRegistration('otra-contraseña-distinta');

    $start = test()->postJson(phrRoute('auth.opaque.registration.start'), [
        'registrationRequest' => $started['registrationRequest'],
        'registrationToken' => $token,
    ])->assertOk();

    $finished = OpaqueTestClient::finishRegistration(
        'otra-contraseña-distinta',
        $started['blind'],
        $start->json('registrationResponse'),
        TEST_SERVER_IDENTITY,
    );

    $secondEnvelope = fakeEnvelope();

    test()->postJson(phrRoute('auth.opaque.registration.finish'), [
        'registrationId' => $start->json('registrationId'),
        'registrationRecord' => $finished['registrationRecord'],
        'wrappedUserMasterKey' => $secondEnvelope,
        'encryptedSettings' => fakeEnvelope(),
    ])->assertOk();

    $envelopes = UserMasterKeyEnvelope::query()->where('user_id', $user->id)->get();
    $retired = $envelopes->firstWhere('envelope', $first['envelope']);
    $current = $envelopes->firstWhere('envelope', $secondEnvelope);

    expect($envelopes)->toHaveCount(2)
        ->and($retired?->retired_at)->not->toBeNull()
        ->and($current?->retired_at)->toBeNull()
        ->and($user->refresh()->currentMasterKeyEnvelope?->envelope)->toBe($secondEnvelope);

    /** El identificador de credencial se reutiliza, no se regenera (§13.1). */
    expect($user->opaque_credential_identifier)
        ->toBe($first['user']->opaque_credential_identifier);
});

/**
 * Rastro de actividad del ciclo de vida de una cuenta.
 *
 * Vive aquí y no en `ActivityLogTest` porque el alta y el login exigen recorrer el protocolo OPAQUE
 * entero, y los ayudantes que lo hacen son los de este fichero. Lo que se comprueba es la secuencia
 * y que ninguna fila lleve propiedades: el servidor anota el verbo y la fecha, nunca el contenido.
 */
it('deja un rastro del alta y del login sin propiedades', function (): void {
    ['user' => $user] = completeRegistration();

    expect(activityLogEvents())->toBe([
        AuditEvent::RegistrationLinkIssued->value,
        AuditEvent::RegistrationCompleted->value,
    ]);

    completeLogin($user)->assertOk();

    expect(activityLogEvents())->toBe([
        AuditEvent::RegistrationLinkIssued->value,
        AuditEvent::RegistrationCompleted->value,
        AuditEvent::LoggedIn->value,
    ]);

    $activities = Activity::query()->where('log_name', AuditEvent::LOG_NAME)->get();

    foreach ($activities as $activity) {
        expect($activity->properties->toArray())->toBe([])
            ->and($activity->subject_id)->toBe($user->getKey());
    }
});

/**
 * @return array<int, string>
 */
function activityLogEvents(): array
{
    return Activity::query()
        ->where('log_name', AuditEvent::LOG_NAME)
        ->orderBy('id')
        ->pluck('event')
        ->all();
}
