<?php

declare(strict_types=1);

use App\Models\User;
use App\Security\Opaque\Base64Url;
use App\Security\Opaque\HkdfSha512;
use App\Support\Terminal;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Tests\Support\FakeTerminal;
use Tests\Support\OpaqueTestClient;

uses(RefreshDatabase::class);

const LAL_PASSWORD = 'CorrectHorseBatteryStaple';
const LAL_EMAIL = 'Alicia@Example.COM';

beforeEach(function (): void {
    app()->instance(Terminal::class, new FakeTerminal);

    config(['opaque' => opaqueEndpointConfig()]);
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

/** Runs a full login and returns the `login/finish` response. */
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
        TEST_SERVER_IDENTITY,
    );

    return test()->postJson(route('filament.phr.auth.opaque.login.finish'), [
        'handshakeId' => $start->json('handshakeId'),
        'finishLoginRequest' => $finished['finishLoginRequest'],
    ]);
}

it('allows logging in again after logging out', function (): void {
    // Signup through the command and full registration, just like a real person does.
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
        TEST_SERVER_IDENTITY,
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

    // First login (the immediate post-registration one): it works and gives access to the panel.
    expect(lalLogin()->status())->toBe(200);
    expect(auth()->id())->not->toBeNull();

    $panelPrimero = test()->get('/phr');
    expect($panelPrimero->status())->toBe(200);

    // Logout, as the person does.
    test()->post('/phr/logout');
    test()->flushSession();
    auth()->forgetGuards();

    expect(auth()->check())->toBeFalse();

    // And now the fresh login: this is what the user reports as failing.
    $second = lalLogin();

    expect($second->status())->toBe(200)
        ->and(auth()->id())->toBe(User::query()->sole()->id);

    // The client needs the `userId` to build the associated data of the master key envelope:
    // without it, `unwrapMasterKey` in `loginPage.js` throws and the login never navigates.
    expect($second->json('userId'))->toBe(User::query()->sole()->id);

    // And above all: that they can enter the panel, which is what the person perceives as "getting in".
    $panelSegundo = test()->get('/phr');

    expect($panelSegundo->status())->toBe(200);
});
