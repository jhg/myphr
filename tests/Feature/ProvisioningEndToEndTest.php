<?php

declare(strict_types=1);

use App\Models\OpaqueRegistration;
use App\Models\User;
use App\Models\UserMasterKeyEnvelope;
use App\Models\UserRegistrationLink;
use App\Security\Opaque\Base64Url;
use App\Security\Opaque\HkdfSha512;
use App\Security\Opaque\OpaqueProfile;
use App\Security\Opaque\Oprf;
use App\Security\Opaque\RegistrationRecord;
use App\Support\Terminal;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Str;
use Tests\Support\FakeTerminal;
use Tests\Support\OpaqueTestClient;

uses(RefreshDatabase::class);

/**
 * Flujo completo de alta, de punta a punta (Spec 0001 §5 y §6.1, criterio de aceptación de §11).
 *
 * Se recorre el camino real y entero: un administrador ejecuta `phr:issue-registration-link`, la
 * persona abre la URL impresa, el navegador ejecuta el registro OPAQUE, hace nacer su UMK, la
 * envuelve bajo la KEK derivada del `exportKey`, sube el sobre y a continuación hace el login
 * inmediato del paso 13. Al final se comprueba lo que exige §11: que la UMK que devuelve el login
 * es exactamente la que nació en el registro.
 *
 * El cliente OPAQUE es {@see OpaqueTestClient}. El sobre se cierra aquí con un espejo en PHP del
 * formato de `resources/js/crypto/envelope.js`; el servidor nunca lo abre, así que su único papel
 * es demostrar que lo que se sube es byte a byte lo que se recupera.
 */
const E2E_SERVER_IDENTITY = 'myemr.test/opaque-v1';

const E2E_PASSWORD = 'CorrectHorseBatteryStaple';

const E2E_EMAIL = 'Alicia@Example.COM';

beforeEach(function (): void {
    app()->instance(Terminal::class, new FakeTerminal);

    [$privateKey] = Oprf::deriveDiffieHellmanKeyPair(str_repeat("\x11", OpaqueProfile::NSEED));
    [, $fakeClientPublicKey] = Oprf::deriveDiffieHellmanKeyPair(str_repeat("\x22", OpaqueProfile::NSEED));

    config(['opaque' => [
        'profile' => OpaqueProfile::NAME,
        'oprf_seed' => Base64Url::encode(str_repeat("\x44", OpaqueProfile::OPRF_SEED_BYTES)),
        'server_private_key' => Base64Url::encode($privateKey),
        'server_public_key' => null,
        'fake_registration_record' => (new RegistrationRecord(
            $fakeClientPublicKey,
            str_repeat("\x33", OpaqueProfile::NH),
            str_repeat("\x00", OpaqueProfile::ENVELOPE_BYTES),
        ))->toBase64Url(),
        'server_identity' => E2E_SERVER_IDENTITY,
        'enumeration_key' => Base64Url::encode(str_repeat("\x55", 32)),
        'context' => '',
    ]]);
});

/**
 * `deriveKey()` de `resources/js/crypto/kdf.js`: `info = label || 0x00 || context`, sin el
 * separador ni el contexto cuando no se pasa ninguno.
 */
function e2eDeriveKey(string $ikm, string $label, ?string $context = null, string $salt = ''): string
{
    $info = $context === null ? $label : $label."\x00".$context;

    return HkdfSha512::expand(HkdfSha512::extract($salt, $ikm), $info, 32);
}

/** Espejo en PHP de `seal()` de `resources/js/crypto/envelope.js` (formato del ADR 0004). */
function e2eSeal(string $key, string $plaintext, string $associatedData): string
{
    $salt = random_bytes(32);
    $nonce = random_bytes(24);
    $header = "\x01\x01\x01\x01".str_repeat("\x00", 4).$salt.$nonce;

    $padded = pack('N', strlen($plaintext)).$plaintext;
    $padded = str_pad($padded, 256, "\x00");

    $sealed = sodium_crypto_aead_xchacha20poly1305_ietf_encrypt(
        $padded,
        $header.$associatedData,
        $nonce,
        e2eDeriveKey($key, 'myphr/envelope/v1', $associatedData, $salt),
    );

    return 'v1.'.Base64Url::encode($header.$sealed);
}

/** Espejo en PHP de `open()`. Devuelve el contenido sin relleno. */
function e2eOpen(string $key, string $envelope, string $associatedData): string
{
    $bytes = Base64Url::decode(substr($envelope, 3), 'envelope');
    $header = substr($bytes, 0, 64);

    $padded = sodium_crypto_aead_xchacha20poly1305_ietf_decrypt(
        substr($bytes, 64),
        $header.$associatedData,
        substr($header, 40, 24),
        e2eDeriveKey($key, 'myphr/envelope/v1', $associatedData, substr($header, 8, 32)),
    );

    expect($padded)->not->toBeFalse();

    /** @var array{1: int} $length */
    $length = unpack('N', (string) $padded);

    return substr((string) $padded, 4, $length[1]);
}

it('lleva a una cuenta desde el comando que emite el enlace hasta su UMK recuperable', function (): void {
    // §10: el administrador emite el enlace. La URL solo existe en la salida del comando.
    Artisan::call('phr:issue-registration-link', ['email' => E2E_EMAIL, '--name' => 'Alicia']);

    // No usar `trim(...)` aquí: Collection::map() invoca el callback con
    // ($valor, $clave), y el segundo parámetro de trim() es la lista de
    // caracteres a eliminar, así que se comería caracteres del final de la
    // URL según el índice de la línea. Se usa una closure explícita de un
    // solo argumento para evitarlo.
    $url = collect(explode("\n", Artisan::output()))
        ->map(fn (string $line): string => trim($line))
        ->first(fn (string $line): bool => str_contains($line, '/phr/set-password#'));

    expect($url)->not->toBeNull();

    $user = User::query()->sole();

    expect($user->email)->toBe('alicia@example.com')
        ->and($user->opaque_registered_at)->toBeNull()
        ->and($user->currentMasterKeyEnvelope)->toBeNull();

    // §4.1: la persona abre el enlace. La página es genérica y el token se queda en el fragmento.
    $token = Str::after((string) $url, '#');

    $this->get(Str::before((string) $url, '#'))
        ->assertOk()
        ->assertSee('data-phr-page="set-password"', escape: false)
        ->assertDontSee($token);

    // §5, pasos 2 y 3: la contraseña no sale del navegador; solo viaja el punto cegado.
    $started = OpaqueTestClient::startRegistration(E2E_PASSWORD);

    $start = $this->postJson(route('filament.phr.auth.opaque.registration.start'), [
        'registrationRequest' => $started['registrationRequest'],
        'registrationToken' => $token,
    ])->assertOk();

    // §5, paso 5: el cliente ancla perfil y clave pública antes de derivar nada.
    expect($start->json('profile'))->toBe(OpaqueProfile::NAME)
        ->and($start->json('userId'))->toBe($user->id);

    // §5, paso 4: el enlace sigue sin consumirse mientras corre el KSF en el navegador.
    expect(UserRegistrationLink::query()->whereNull('consumed_at')->count())->toBe(1)
        ->and(OpaqueRegistration::query()->count())->toBe(1);

    // §5, paso 6.
    $finished = OpaqueTestClient::finishRegistration(
        E2E_PASSWORD,
        $started['blind'],
        $start->json('registrationResponse'),
        E2E_SERVER_IDENTITY,
    );

    expect($finished['serverPublicKey'])->toBe(Base64Url::decode($start->json('serverPublicKey'), 'spk'));

    // §5, pasos 7 a 10: KEK del exportKey, UMK aleatoria, sobre y configuración vacía.
    $umkContext = strtolower((string) $user->id).'/umk';
    $settingsContext = strtolower((string) $user->id).'/settings';

    $kek = e2eDeriveKey($finished['exportKey'], 'myphr/kek/v1');
    $userMasterKey = random_bytes(32);

    $wrappedUserMasterKey = e2eSeal($kek, $userMasterKey, $umkContext);
    $encryptedSettings = e2eSeal(
        e2eDeriveKey($userMasterKey, 'myphr/settings/v1', $settingsContext),
        '{"v":1}',
        $settingsContext,
    );

    // §5, paso 12: una única petición transaccional.
    $this->postJson(route('filament.phr.auth.opaque.registration.finish'), [
        'registrationId' => $start->json('registrationId'),
        'registrationRecord' => $finished['registrationRecord'],
        'wrappedUserMasterKey' => $wrappedUserMasterKey,
        'encryptedSettings' => $encryptedSettings,
    ])->assertOk();

    $user->refresh();

    expect($user->opaque_registered_at)->not->toBeNull()
        ->and($user->opaque_profile)->toBe(OpaqueProfile::NAME)
        ->and(strlen((string) $user->opaque_registration_record))->toBe(192)
        ->and(strlen((string) $user->opaque_credential_identifier))->toBe(32)
        ->and($user->encrypted_settings)->toBe($encryptedSettings)
        ->and($user->password)->toBeNull()
        ->and(OpaqueRegistration::query()->count())->toBe(0)
        ->and(UserRegistrationLink::query()->whereNull('consumed_at')->count())->toBe(0);

    $envelopeRow = UserMasterKeyEnvelope::query()->sole();

    expect($envelopeRow->user_id)->toBe($user->id)
        ->and($envelopeRow->envelope)->toBe($wrappedUserMasterKey)
        ->and($envelopeRow->retired_at)->toBeNull();

    // §5, paso 13: login inmediato con la misma contraseña, por el camino de un login normal.
    $startedLogin = OpaqueTestClient::startLogin(E2E_PASSWORD);

    $loginStart = $this->postJson(route('filament.phr.auth.opaque.login.start'), [
        'login' => E2E_EMAIL,
        'startLoginRequest' => $startedLogin['startLoginRequest'],
    ])->assertOk();

    $finishedLogin = OpaqueTestClient::finishLogin(
        E2E_PASSWORD,
        $startedLogin,
        $loginStart->json('loginResponse'),
        E2E_SERVER_IDENTITY,
    );

    $session = $this->postJson(route('filament.phr.auth.opaque.login.finish'), [
        'handshakeId' => $loginStart->json('handshakeId'),
        'finishLoginRequest' => $finishedLogin['finishLoginRequest'],
    ])->assertOk();

    expect(auth()->id())->toBe($user->id)
        ->and($session->json('encryptedUserMasterKey'))->toBe($wrappedUserMasterKey)
        ->and($session->json('encryptedSettings'))->toBe($encryptedSettings);

    // §5, pasos 15 y 16: la UMK que vuelve es la que nació en el registro.
    $recovered = e2eOpen(
        e2eDeriveKey($finishedLogin['exportKey'], 'myphr/kek/v1'),
        (string) $session->json('encryptedUserMasterKey'),
        $umkContext,
    );

    expect($recovered)->toBe($userMasterKey);

    // §6.2: y la configuración se abre con la clave derivada de esa misma UMK.
    expect(e2eOpen(
        e2eDeriveKey($recovered, 'myphr/settings/v1', $settingsContext),
        (string) $session->json('encryptedSettings'),
        $settingsContext,
    ))->toBe('{"v":1}');

    // §6.2: tras una recarga, el secreto de sesión devuelve la UMK sin pedir la contraseña.
    $this->postJson(route('filament.phr.auth.session-secret'))
        ->assertOk()
        ->assertJsonPath('sessionSecret', $session->json('sessionSecret'))
        ->assertJsonPath('encryptedSettings', $encryptedSettings);
});
