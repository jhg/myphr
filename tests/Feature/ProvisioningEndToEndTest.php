<?php

declare(strict_types=1);

use App\Models\OpaqueRegistration;
use App\Models\User;
use App\Models\UserMasterKeyEnvelope;
use App\Models\UserRegistrationLink;
use App\Security\Opaque\Base64Url;
use App\Security\Opaque\HkdfSha512;
use App\Security\Opaque\OpaqueProfile;
use App\Support\Terminal;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Str;
use Tests\Support\FakeTerminal;
use Tests\Support\OpaqueTestClient;

uses(RefreshDatabase::class);

/**
 * The full signup flow, end to end (Spec 0001 §5 and §6.1, acceptance criterion of §11).
 *
 * It walks the real path in full: an administrator runs `phr:issue-registration-link`, the person
 * opens the printed URL, the browser runs the OPAQUE registration, gives birth to its UMK, wraps it
 * under the KEK derived from the `exportKey`, uploads the envelope and then does the immediate login
 * of step 13. At the end we check what §11 requires: that the UMK the login returns is exactly the
 * one born during registration.
 *
 * The OPAQUE client is {@see OpaqueTestClient}. The envelope is sealed here with a PHP mirror of the
 * `resources/js/crypto/envelope.js` format; the server never opens it, so its only role is to show
 * that what goes up is byte for byte what comes back.
 */
const E2E_PASSWORD = 'CorrectHorseBatteryStaple';

const E2E_EMAIL = 'Alicia@Example.COM';

beforeEach(function (): void {
    app()->instance(Terminal::class, new FakeTerminal);

    config(['opaque' => opaqueEndpointConfig()]);
});

/**
 * `deriveKey()` from `resources/js/crypto/kdf.js`: `info = label || 0x00 || context`, without the
 * separator and without the context when none is passed.
 */
function e2eDeriveKey(string $ikm, string $label, ?string $context = null, string $salt = ''): string
{
    $info = $context === null ? $label : $label."\x00".$context;

    return HkdfSha512::expand(HkdfSha512::extract($salt, $ikm), $info, 32);
}

/** PHP mirror of `seal()` from `resources/js/crypto/envelope.js` (ADR 0004 format). */
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

/** PHP mirror of `open()`. Returns the content without padding. */
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

it('takes an account from the command that issues the link all the way to a recoverable UMK', function (): void {
    // §10: the administrator issues the link. The URL only exists in the command output.
    Artisan::call('phr:issue-registration-link', ['email' => E2E_EMAIL, '--name' => 'Alicia']);

    // Do not use `trim(...)` here: Collection::map() calls the callback with
    // ($value, $key), and the second parameter of trim() is the list of
    // characters to strip, so it would eat characters off the end of the URL
    // depending on the line index. An explicit single-argument closure is used
    // to avoid that.
    $url = collect(explode("\n", Artisan::output()))
        ->map(fn (string $line): string => trim($line))
        ->first(fn (string $line): bool => str_contains($line, '/phr/set-password#'));

    expect($url)->not->toBeNull();

    $user = User::query()->sole();

    expect($user->email)->toBe('alicia@example.com')
        ->and($user->opaque_registered_at)->toBeNull()
        ->and($user->currentMasterKeyEnvelope)->toBeNull();

    // §4.1: the person opens the link. The page is generic and the token stays in the fragment.
    $token = Str::after((string) $url, '#');

    $this->get(Str::before((string) $url, '#'))
        ->assertOk()
        ->assertSee('data-phr-page="set-password"', escape: false)
        ->assertDontSee($token);

    // §5, steps 2 and 3: the password never leaves the browser; only the blinded point travels.
    $started = OpaqueTestClient::startRegistration(E2E_PASSWORD);

    $start = $this->postJson(route('filament.phr.auth.opaque.registration.start'), [
        'registrationRequest' => $started['registrationRequest'],
        'registrationToken' => $token,
    ])->assertOk();

    // §5, step 5: the client pins the profile and the public key before deriving anything.
    expect($start->json('profile'))->toBe(OpaqueProfile::NAME)
        ->and($start->json('userId'))->toBe($user->id);

    // §5, step 4: the link is still unconsumed while the KSF runs in the browser.
    expect(UserRegistrationLink::query()->whereNull('consumed_at')->count())->toBe(1)
        ->and(OpaqueRegistration::query()->count())->toBe(1);

    // §5, step 6.
    $finished = OpaqueTestClient::finishRegistration(
        E2E_PASSWORD,
        $started['blind'],
        $start->json('registrationResponse'),
        TEST_SERVER_IDENTITY,
    );

    expect($finished['serverPublicKey'])->toBe(Base64Url::decode($start->json('serverPublicKey'), 'spk'));

    // §5, steps 7 to 10: KEK from the exportKey, random UMK, envelope and empty settings.
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

    // §5, step 12: a single transactional request.
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
        ->and(OpaqueRegistration::query()->count())->toBe(0)
        ->and(UserRegistrationLink::query()->whereNull('consumed_at')->count())->toBe(0);

    $envelopeRow = UserMasterKeyEnvelope::query()->sole();

    expect($envelopeRow->user_id)->toBe($user->id)
        ->and($envelopeRow->envelope)->toBe($wrappedUserMasterKey)
        ->and($envelopeRow->retired_at)->toBeNull();

    // §5, step 13: immediate login with the same password, through the ordinary login path.
    $startedLogin = OpaqueTestClient::startLogin(E2E_PASSWORD);

    $loginStart = $this->postJson(route('filament.phr.auth.opaque.login.start'), [
        'login' => E2E_EMAIL,
        'startLoginRequest' => $startedLogin['startLoginRequest'],
    ])->assertOk();

    $finishedLogin = OpaqueTestClient::finishLogin(
        E2E_PASSWORD,
        $startedLogin,
        $loginStart->json('loginResponse'),
        TEST_SERVER_IDENTITY,
    );

    $session = $this->postJson(route('filament.phr.auth.opaque.login.finish'), [
        'handshakeId' => $loginStart->json('handshakeId'),
        'finishLoginRequest' => $finishedLogin['finishLoginRequest'],
    ])->assertOk();

    expect(auth()->id())->toBe($user->id)
        ->and($session->json('encryptedUserMasterKey'))->toBe($wrappedUserMasterKey)
        ->and($session->json('encryptedSettings'))->toBe($encryptedSettings);

    // §5, steps 15 and 16: the UMK that comes back is the one born during registration.
    $recovered = e2eOpen(
        e2eDeriveKey($finishedLogin['exportKey'], 'myphr/kek/v1'),
        (string) $session->json('encryptedUserMasterKey'),
        $umkContext,
    );

    expect($recovered)->toBe($userMasterKey);

    // §6.2: and the settings open with the key derived from that same UMK.
    expect(e2eOpen(
        e2eDeriveKey($recovered, 'myphr/settings/v1', $settingsContext),
        (string) $session->json('encryptedSettings'),
        $settingsContext,
    ))->toBe('{"v":1}');

    // §6.2: after a reload, the session secret returns the UMK without asking for the password.
    $this->postJson(route('filament.phr.auth.session-secret'))
        ->assertOk()
        ->assertJsonPath('sessionSecret', $session->json('sessionSecret'))
        ->assertJsonPath('encryptedSettings', $encryptedSettings);
});
