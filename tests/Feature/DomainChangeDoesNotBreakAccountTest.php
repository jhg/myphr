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
 * `server_identity` cannot depend on the domain: it is a fixed deployment identifier (see
 * `tests/Feature/OpaqueServerIdentityIsDomainIndependentTest.php`). That is why this test uses the
 * shared `TEST_SERVER_IDENTITY` from `tests/Pest.php` and does not recompute it when `app.url`
 * changes.
 */
const DC_PASSWORD = 'CorrectHorseBatteryStaple';
const DC_EMAIL = 'Alicia@Example.COM';

beforeEach(function (): void {
    app()->instance(Terminal::class, new FakeTerminal);

    config(['opaque' => opaqueEndpointConfig()]);

    // Starting domain: we will change it halfway through the test, and the `server_identity` above
    // must not move when that happens.
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

/** PHP mirror of `open()`: what the browser really does when recovering an envelope. */
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
        throw new RuntimeException('The envelope does not open with that key.');
    }

    /** @var array{1: int} $length */
    $length = unpack('N', substr($padded, 0, 4));

    return substr($padded, 4, $length[1]);
}

/** `eventContext()` from `resources/js/auth/context.js`: only `user_id` and the canonical date. */
function dcEventContext(string $userId, string $occurredAt): string
{
    return strtolower($userId).'/event/'.$occurredAt;
}

/** Full login through the real endpoints. */
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
 * Changing `APP_URL` to another domain halfway through an account's life must break nothing: not
 * login, not the master key envelope, not the encrypted history already stored. It walks the real
 * flow —link, signup with a password, encrypted event— before the domain change, and everything that
 * depends on the account afterwards.
 */
it('changing the app domain breaks neither login, nor the master key envelope, nor the encrypted history', function (): void {
    expect(config('app.url'))->toBe('http://localhost:8888');

    // Signup through the command and full registration, just like a real person does.
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

    // Immediate post-registration login, on the starting domain.
    expect(dcLogin()->status())->toBe(200);
    expect(auth()->id())->toBe($user->id);
    expect(test()->get('/phr')->status())->toBe(200);

    // An encrypted event stored BEFORE the domain change, under `KDF_LABELS.RECORD` and the
    // `eventContext()` context (`user_id` + canonical date, never the clinical type).
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

    // Logout and DOMAIN CHANGE: from `localhost` to a different production domain.
    // None of the above may depend on this value.
    test()->post('/phr/logout');
    test()->flushSession();
    auth()->forgetGuards();

    config(['app.url' => 'https://phr.ejemplo.org']);
    expect(config('app.url'))->toBe('https://phr.ejemplo.org');

    // The login, with the SAME password, still works on the new domain. The OPAQUE exchange is
    // repeated here instead of using `dcLogin()` because the local `exportKey` is needed to derive
    // the KEK and open the envelope, and that value never travels the network or leaves the function.
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

    // The master key envelope still opens the SAME key.
    $recoveredMasterKey = dcOpen(
        dcDeriveKey($finishedAfter['exportKey'], 'myphr/kek/v1'),
        (string) $sessionAfter->json('encryptedUserMasterKey'),
        $umkContext,
    );

    expect($recoveredMasterKey)->toBe($userMasterKey);

    // And the encrypted event stored BEFORE the domain change is still readable with the SAME
    // master key recovered AFTER the change.
    $recoveredEvent = dcOpen(
        dcDeriveKey($recoveredMasterKey, 'myphr/record/v1', $eventContext),
        $eventCiphertext,
        $eventContext,
    );

    expect($recoveredEvent)->toBe($eventPlaintext);

    // And the panel is still reachable: for the person, "I am in", on the new domain.
    expect(test()->get('/phr')->status())->toBe(200);

    // Explicit guardrail: the server identity did not move with the domain.
    expect(config('opaque.server_identity'))->toBe(TEST_SERVER_IDENTITY);
});
