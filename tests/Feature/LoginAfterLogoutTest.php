<?php

declare(strict_types=1);

use App\Models\User;
use App\Security\Opaque\Base64Url;
use App\Security\Opaque\HkdfSha512;
use App\Security\Opaque\OpaqueProfile;
use App\Security\Opaque\Oprf;
use App\Security\Opaque\RegistrationRecord;
use App\Support\Terminal;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Tests\Support\FakeTerminal;
use Tests\Support\OpaqueTestClient;

uses(RefreshDatabase::class);

const LAL_IDENTITY = 'myemr.test/opaque-v1';
const LAL_PASSWORD = 'CorrectHorseBatteryStaple';
const LAL_EMAIL = 'Alicia@Example.COM';

beforeEach(function (): void {
    app()->instance(Terminal::class, new FakeTerminal);

    [$privateKey] = Oprf::deriveDiffieHellmanKeyPair(str_repeat("\x11", OpaqueProfile::NSEED));
    [, $fakePk] = Oprf::deriveDiffieHellmanKeyPair(str_repeat("\x22", OpaqueProfile::NSEED));

    config(['opaque' => [
        'profile' => OpaqueProfile::NAME,
        'oprf_seed' => Base64Url::encode(str_repeat("\x44", OpaqueProfile::OPRF_SEED_BYTES)),
        'server_private_key' => Base64Url::encode($privateKey),
        'server_public_key' => null,
        'fake_registration_record' => (new RegistrationRecord(
            $fakePk,
            str_repeat("\x33", OpaqueProfile::NH),
            str_repeat("\x00", OpaqueProfile::ENVELOPE_BYTES),
        ))->toBase64Url(),
        'server_identity' => LAL_IDENTITY,
        'enumeration_key' => Base64Url::encode(str_repeat("\x55", 32)),
        'context' => '',
    ]]);
});

/** `deriveKey()` de `resources/js/crypto/kdf.js`. */
function lalDeriveKey(string $ikm, string $label, ?string $context = null, string $salt = ''): string
{
    $info = $context === null ? $label : $label."\x00".$context;

    return HkdfSha512::expand(HkdfSha512::extract($salt, $ikm), $info, 32);
}

/** Espejo en PHP de `seal()` de `resources/js/crypto/envelope.js`. */
function lalSeal(string $key, string $plaintext, string $associatedData): string
{
    $salt = random_bytes(32);
    $nonce = random_bytes(24);
    $header = "\x01\x01\x01\x01".str_repeat("\x00", 4).$salt.$nonce;

    $padded = str_pad(pack('N', strlen($plaintext)).$plaintext, 256, "\x00");

    $sealed = sodium_crypto_aead_xchacha20poly1305_ietf_encrypt(
        $padded,
        $header.$associatedData,
        $nonce,
        lalDeriveKey($key, 'myphr/envelope/v1', $associatedData, $salt),
    );

    return 'v1.'.Base64Url::encode($header.$sealed);
}

/** Ejecuta un login completo y devuelve la respuesta de `login/finish`. */
function lalLogin(): TestResponse
{
    $started = OpaqueTestClient::startLogin(LAL_PASSWORD);

    $start = test()->postJson(route('filament.phr.auth.opaque.login.start'), [
        'login' => LAL_EMAIL,
        'startLoginRequest' => $started['startLoginRequest'],
    ]);

    expect($start->status())->toBe(200);

    $finished = OpaqueTestClient::finishLogin(
        LAL_PASSWORD,
        $started,
        $start->json('loginResponse'),
        LAL_IDENTITY,
    );

    return test()->postJson(route('filament.phr.auth.opaque.login.finish'), [
        'handshakeId' => $start->json('handshakeId'),
        'finishLoginRequest' => $finished['finishLoginRequest'],
    ]);
}

it('permite volver a entrar despues de cerrar sesion', function (): void {
    // Alta por el comando y registro completo, igual que hace una persona real.
    Artisan::call('phr:issue-registration-link', ['email' => LAL_EMAIL, '--name' => 'Alicia']);
    $url = collect(explode("\n", Artisan::output()))
        ->map(fn (string $l): string => trim($l))
        ->first(fn (string $l): bool => str_contains($l, '/phr/set-password#'));
    $token = Str::after((string) $url, '#');

    $started = OpaqueTestClient::startRegistration(LAL_PASSWORD);
    $start = test()->postJson(route('filament.phr.auth.opaque.registration.start'), [
        'registrationRequest' => $started['registrationRequest'],
        'registrationToken' => $token,
    ])->assertOk();

    $finished = OpaqueTestClient::finishRegistration(
        LAL_PASSWORD,
        $started['blind'],
        $start->json('registrationResponse'),
        LAL_IDENTITY,
    );

    $user = User::query()->sole();
    $umkContext = strtolower((string) $user->id).'/umk';
    $settingsContext = strtolower((string) $user->id).'/settings';

    $kek = lalDeriveKey($finished['exportKey'], 'myphr/kek/v1');
    $userMasterKey = random_bytes(32);

    test()->postJson(route('filament.phr.auth.opaque.registration.finish'), [
        'registrationId' => $start->json('registrationId'),
        'registrationRecord' => $finished['registrationRecord'],
        'wrappedUserMasterKey' => lalSeal($kek, $userMasterKey, $umkContext),
        'encryptedSettings' => lalSeal(
            lalDeriveKey($userMasterKey, 'myphr/settings/v1', $settingsContext),
            '{"v":1}',
            $settingsContext,
        ),
    ])->assertOk();

    // Primer login (el inmediato del registro): funciona y da acceso al panel.
    expect(lalLogin()->status())->toBe(200);
    expect(auth()->id())->not->toBeNull();

    $panelPrimero = test()->get('/phr');
    expect($panelPrimero->status())->toBe(200);

    // Cierre de sesion, como hace la persona.
    test()->post('/phr/logout');
    test()->flushSession();
    auth()->forgetGuards();

    expect(auth()->check())->toBeFalse();

    // Y ahora el login fresco: esto es lo que el usuario dice que falla.
    $second = lalLogin();

    expect($second->status())->toBe(200)
        ->and(auth()->id())->toBe(User::query()->sole()->id);

    // El cliente necesita el `userId` para construir el dato asociado del sobre de la clave
    // maestra: sin el, `unwrapMasterKey` de `loginPage.js` lanza y el login no llega a navegar.
    expect($second->json('userId'))->toBe(User::query()->sole()->id);

    // Y sobre todo: que pueda entrar al panel, que es lo que la persona percibe como "entrar".
    $panelSegundo = test()->get('/phr');

    expect($panelSegundo->status())->toBe(200);
});
