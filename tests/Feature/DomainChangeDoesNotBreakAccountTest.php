<?php

declare(strict_types=1);

use App\Filament\Pages\Meals;
use App\Models\User;
use App\Security\Opaque\Base64Url;
use App\Security\Opaque\HkdfSha512;
use App\Support\Terminal;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Livewire\Livewire;
use Tests\Support\FakeTerminal;
use Tests\Support\OpaqueTestClient;

uses(RefreshDatabase::class);

/**
 * `server_identity` no puede depender del dominio: es un identificador de despliegue fijo (ver
 * `tests/Feature/OpaqueServerIdentityIsDomainIndependentTest.php`). Por eso este test usa la
 * `TEST_SERVER_IDENTITY` compartida de `tests/Pest.php` y no la recalcula al cambiar `app.url`.
 */
const DC_PASSWORD = 'CorrectHorseBatteryStaple';
const DC_EMAIL = 'Alicia@Example.COM';

beforeEach(function (): void {
    app()->instance(Terminal::class, new FakeTerminal);

    config(['opaque' => opaqueEndpointConfig()]);

    // Dominio de partida: lo cambiaremos a mitad del test, y `server_identity` de arriba no debe
    // moverse cuando eso pase.
    config(['app.url' => 'http://localhost:8888']);
});

/** `deriveKey()` de `resources/js/crypto/kdf.js`. */
function dcDeriveKey(string $ikm, string $label, ?string $context = null, string $salt = ''): string
{
    $info = $context === null ? $label : $label."\x00".$context;

    return HkdfSha512::expand(HkdfSha512::extract($salt, $ikm), $info, 32);
}

/** Espejo en PHP de `seal()` de `resources/js/crypto/envelope.js`. */
function dcSeal(string $key, string $plaintext, string $associatedData): string
{
    $salt = random_bytes(32);
    $nonce = random_bytes(24);
    $header = "\x01\x01\x01\x01".str_repeat("\x00", 4).$salt.$nonce;

    $padded = str_pad(pack('N', strlen($plaintext)).$plaintext, 256, "\x00");

    $sealed = sodium_crypto_aead_xchacha20poly1305_ietf_encrypt(
        $padded,
        $header.$associatedData,
        $nonce,
        dcDeriveKey($key, 'myphr/envelope/v1', $associatedData, $salt),
    );

    return 'v1.'.Base64Url::encode($header.$sealed);
}

/** Espejo en PHP de `open()`: lo que hace de verdad el navegador al recuperar un sobre. */
function dcOpen(string $key, string $envelope, string $associatedData): string
{
    $binary = Base64Url::decode(substr($envelope, 3), 'envelope');
    $header = substr($binary, 0, 64);
    $salt = substr($header, 8, 32);
    $nonce = substr($header, 40, 24);

    $padded = sodium_crypto_aead_xchacha20poly1305_ietf_decrypt(
        substr($binary, 64),
        $header.$associatedData,
        $nonce,
        dcDeriveKey($key, 'myphr/envelope/v1', $associatedData, $salt),
    );

    if ($padded === false) {
        throw new RuntimeException('El sobre no abre con esa clave.');
    }

    /** @var array{1: int} $length */
    $length = unpack('N', substr($padded, 0, 4));

    return substr($padded, 4, $length[1]);
}

/** `eventContext()` de `resources/js/auth/context.js`: solo `user_id` y la fecha canónica. */
function dcEventContext(string $userId, string $occurredAt): string
{
    return strtolower($userId).'/event/'.$occurredAt;
}

/** Login completo por los endpoints reales. */
function dcLogin(): TestResponse
{
    $started = OpaqueTestClient::startLogin(DC_PASSWORD);

    $start = test()->postJson(route('filament.phr.auth.opaque.login.start'), [
        'login' => DC_EMAIL,
        'startLoginRequest' => $started['startLoginRequest'],
    ]);

    expect($start->status())->toBe(200);

    $finished = OpaqueTestClient::finishLogin(
        DC_PASSWORD,
        $started,
        $start->json('loginResponse'),
        TEST_SERVER_IDENTITY,
    );

    return test()->postJson(route('filament.phr.auth.opaque.login.finish'), [
        'handshakeId' => $start->json('handshakeId'),
        'finishLoginRequest' => $finished['finishLoginRequest'],
    ]);
}

/**
 * Cambiar `APP_URL` de dominio a mitad de vida de una cuenta no puede tirar nada: ni el login, ni
 * el sobre de la clave maestra, ni el histórico cifrado ya guardado. Recorre el flujo real —enlace,
 * alta con contraseña, evento cifrado— antes del cambio de dominio, y todo lo que depende de la
 * cuenta después.
 */
it('cambiar el dominio de la app no rompe el login, el sobre de la clave maestra ni el histórico cifrado', function (): void {
    expect(config('app.url'))->toBe('http://localhost:8888');

    // Alta por el comando y registro completo, igual que hace una persona real.
    Artisan::call('phr:issue-registration-link', ['email' => DC_EMAIL, '--name' => 'Alicia']);
    $url = collect(explode("\n", Artisan::output()))
        ->map(fn (string $l): string => trim($l))
        ->first(fn (string $l): bool => str_contains($l, '/phr/set-password#'));
    $token = Str::after((string) $url, '#');

    $started = OpaqueTestClient::startRegistration(DC_PASSWORD);
    $start = test()->postJson(route('filament.phr.auth.opaque.registration.start'), [
        'registrationRequest' => $started['registrationRequest'],
        'registrationToken' => $token,
    ])->assertOk();

    $finished = OpaqueTestClient::finishRegistration(
        DC_PASSWORD,
        $started['blind'],
        $start->json('registrationResponse'),
        TEST_SERVER_IDENTITY,
    );

    $user = User::query()->sole();
    $umkContext = strtolower((string) $user->id).'/umk';
    $settingsContext = strtolower((string) $user->id).'/settings';

    $kek = dcDeriveKey($finished['exportKey'], 'myphr/kek/v1');
    $userMasterKey = random_bytes(32);

    test()->postJson(route('filament.phr.auth.opaque.registration.finish'), [
        'registrationId' => $start->json('registrationId'),
        'registrationRecord' => $finished['registrationRecord'],
        'wrappedUserMasterKey' => dcSeal($kek, $userMasterKey, $umkContext),
        'encryptedSettings' => dcSeal(
            dcDeriveKey($userMasterKey, 'myphr/settings/v1', $settingsContext),
            '{"v":1}',
            $settingsContext,
        ),
    ])->assertOk();

    // Login inmediato del registro, en el dominio de partida.
    expect(dcLogin()->status())->toBe(200);
    expect(auth()->id())->toBe($user->id);
    expect(test()->get('/phr')->status())->toBe(200);

    // Un evento cifrado guardado ANTES del cambio de dominio, bajo `KDF_LABELS.RECORD` y el
    // contexto de `eventContext()` (`user_id` + fecha canónica, nunca el tipo clínico).
    $occurredAt = canonicalOccurredAtNow();
    $eventContext = dcEventContext((string) $user->id, $occurredAt);
    $eventPlaintext = '{"type":"meal","grams":120}';
    $eventCiphertext = dcSeal(
        dcDeriveKey($userMasterKey, 'myphr/record/v1', $eventContext),
        $eventPlaintext,
        $eventContext,
    );

    $stored = Livewire::test(Meals::class)
        ->instance()
        ->storeEvent($eventCiphertext, $occurredAt);

    test()->assertDatabaseHas('events', [
        'id' => $stored['id'],
        'user_id' => $user->id,
        'payload' => $eventCiphertext,
    ]);

    // Cierre de sesión y CAMBIO DE DOMINIO: de `localhost` a un dominio de producción distinto.
    // Nada de lo anterior debe depender de este valor.
    test()->post('/phr/logout');
    test()->flushSession();
    auth()->forgetGuards();

    config(['app.url' => 'https://phr.ejemplo.org']);
    expect(config('app.url'))->toBe('https://phr.ejemplo.org');

    // El login, con la MISMA contraseña, sigue funcionando en el dominio nuevo. Se repite el
    // intercambio OPAQUE aquí en lugar de usar `dcLogin()` porque hace falta el `exportKey` local
    // para derivar la KEK y abrir el sobre, y ese valor no viaja por la red ni sale de la función.
    $startedAfter = OpaqueTestClient::startLogin(DC_PASSWORD);
    $startAfter = test()->postJson(route('filament.phr.auth.opaque.login.start'), [
        'login' => DC_EMAIL,
        'startLoginRequest' => $startedAfter['startLoginRequest'],
    ]);

    expect($startAfter->status())->toBe(200);

    $finishedAfter = OpaqueTestClient::finishLogin(
        DC_PASSWORD,
        $startedAfter,
        $startAfter->json('loginResponse'),
        TEST_SERVER_IDENTITY,
    );

    $sessionAfter = test()->postJson(route('filament.phr.auth.opaque.login.finish'), [
        'handshakeId' => $startAfter->json('handshakeId'),
        'finishLoginRequest' => $finishedAfter['finishLoginRequest'],
    ]);

    expect($sessionAfter->status())->toBe(200)
        ->and(auth()->id())->toBe($user->id)
        ->and($sessionAfter->json('userId'))->toBe($user->id);

    // El sobre de la clave maestra sigue abriendo la MISMA clave.
    $recoveredMasterKey = dcOpen(
        dcDeriveKey($finishedAfter['exportKey'], 'myphr/kek/v1'),
        (string) $sessionAfter->json('encryptedUserMasterKey'),
        $umkContext,
    );

    expect($recoveredMasterKey)->toBe($userMasterKey);

    // Y el evento cifrado guardado ANTES del cambio de dominio sigue siendo legible con la MISMA
    // clave maestra recuperada DESPUÉS del cambio.
    $recoveredEvent = dcOpen(
        dcDeriveKey($recoveredMasterKey, 'myphr/record/v1', $eventContext),
        $eventCiphertext,
        $eventContext,
    );

    expect($recoveredEvent)->toBe($eventPlaintext);

    // Y el panel sigue accesible: para la persona, «he entrado», en el dominio nuevo.
    expect(test()->get('/phr')->status())->toBe(200);

    // Guardarraíl explícito: la identidad del servidor no se movió con el dominio.
    expect(config('opaque.server_identity'))->toBe(TEST_SERVER_IDENTITY);
});
