<?php

declare(strict_types=1);

use App\Models\OpaqueRegistration;
use App\Models\User;
use App\Models\UserMasterKeyEnvelope;
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

const PC_OLD_PASSWORD = 'CorrectHorseBatteryStaple';
const PC_NEW_PASSWORD = 'TrueRhinoCandleWindow';
const PC_EMAIL = 'Alicia@Example.COM';

beforeEach(function (): void {
    app()->instance(Terminal::class, new FakeTerminal);

    config(['opaque' => opaqueEndpointConfig()]);
});

/** `deriveKey()` de `resources/js/crypto/kdf.js`. */
function pcDeriveKey(string $ikm, string $label, ?string $context = null, string $salt = ''): string
{
    $info = $context === null ? $label : $label."\x00".$context;

    return HkdfSha512::expand(HkdfSha512::extract($salt, $ikm), $info, 32);
}

/** Espejo en PHP de `seal()` de `resources/js/crypto/envelope.js`. */
function pcSeal(string $key, string $plaintext, string $associatedData): string
{
    $salt = random_bytes(32);
    $nonce = random_bytes(24);
    $header = "\x01\x01\x01\x01".str_repeat("\x00", 4).$salt.$nonce;

    $padded = str_pad(pack('N', strlen($plaintext)).$plaintext, 256, "\x00");

    $sealed = sodium_crypto_aead_xchacha20poly1305_ietf_encrypt(
        $padded,
        $header.$associatedData,
        $nonce,
        pcDeriveKey($key, 'myphr/envelope/v1', $associatedData, $salt),
    );

    return 'v1.'.Base64Url::encode($header.$sealed);
}

/**
 * PHP mirror of `open()`: it is what the browser really does when recovering the master key.
 *
 * Without this function the most important test —that the new envelope opens the SAME master key—
 * could not be written, because the server cannot open any envelope.
 */
function pcOpen(string $key, string $envelope, string $associatedData): string
{
    $binary = Base64Url::decode(substr($envelope, 3), 'envelope');
    $header = substr($binary, 0, 64);
    $salt = substr($header, 8, 32);
    $nonce = substr($header, 40, 24);

    $padded = sodium_crypto_aead_xchacha20poly1305_ietf_decrypt(
        substr($binary, 64),
        $header.$associatedData,
        $nonce,
        pcDeriveKey($key, 'myphr/envelope/v1', $associatedData, $salt),
    );

    if ($padded === false) {
        throw new RuntimeException('The envelope does not open with that key.');
    }

    /** @var array{1: int} $length */
    $length = unpack('N', substr($padded, 0, 4));

    return substr($padded, 4, $length[1]);
}

/** Creates the account through the real path and returns the master key in the clear. */
function pcRegister(): string
{
    Artisan::call('phr:issue-registration-link', ['email' => PC_EMAIL, '--name' => 'Alicia']);
    $url = collect(explode("\n", Artisan::output()))
        ->map(fn (string $l): string => trim($l))
        ->first(fn (string $l): bool => str_contains($l, '/phr/set-password#'));
    $token = Str::after((string) $url, '#');

    $started = OpaqueTestClient::startRegistration(PC_OLD_PASSWORD);
    $start = test()->postJson(route('filament.phr.auth.opaque.registration.start'), [
        'registrationRequest' => $started['registrationRequest'],
        'registrationToken' => $token,
    ])->assertOk();

    $finished = OpaqueTestClient::finishRegistration(
        PC_OLD_PASSWORD,
        $started['blind'],
        $start->json('registrationResponse'),
        TEST_SERVER_IDENTITY,
    );

    $user = User::query()->sole();
    $umkContext = strtolower((string) $user->id).'/umk';
    $settingsContext = strtolower((string) $user->id).'/settings';

    $userMasterKey = random_bytes(32);

    test()->postJson(route('filament.phr.auth.opaque.registration.finish'), [
        'registrationId' => $start->json('registrationId'),
        'registrationRecord' => $finished['registrationRecord'],
        'wrappedUserMasterKey' => pcSeal(
            pcDeriveKey($finished['exportKey'], 'myphr/kek/v1'),
            $userMasterKey,
            $umkContext,
        ),
        'encryptedSettings' => pcSeal(
            pcDeriveKey($userMasterKey, 'myphr/settings/v1', $settingsContext),
            '{"v":1}',
            $settingsContext,
        ),
    ])->assertOk();

    return $userMasterKey;
}

/** Full login through the real endpoints. */
function pcLogin(string $password): TestResponse
{
    $started = OpaqueTestClient::startLogin($password);

    $start = test()->postJson(route('filament.phr.auth.opaque.login.start'), [
        'login' => PC_EMAIL,
        'startLoginRequest' => $started['startLoginRequest'],
    ]);

    expect($start->status())->toBe(200);

    try {
        $finished = OpaqueTestClient::finishLogin(
            $password,
            $started,
            $start->json('loginResponse'),
            TEST_SERVER_IDENTITY,
        );
    } catch (RuntimeException) {
        /** The real client turns this into "wrong password" and never gets to call `finish`. */
        return new TestResponse(response()->json(['error' => 'authentication_failed'], 401));
    }

    return test()->postJson(route('filament.phr.auth.opaque.login.finish'), [
        'handshakeId' => $start->json('handshakeId'),
        'finishLoginRequest' => $finished['finishLoginRequest'],
    ]);
}

/**
 * Walks phases A and B of the password change —up to just before sending `password/change`, step
 * 20— and leaves the body of that final request ready without sending it.
 *
 * It is the exact point at which "the browser is closed too early": everything before it (reauth and
 * the second Argon2id) already happened, but the server has neither received nor touched anything
 * from phase C.
 *
 * @return array{
 *     error: false,
 *     registrationId: string,
 *     ticket: string,
 *     registrationRecord: string,
 *     wrappedUserMasterKey: string,
 *     userMasterKey: string,
 * }|array{error: true, status: int, body: array<string, mixed>|null, stage: string}
 */
function pcPrepareChangePassword(string $oldPassword, string $newPassword): array
{
    /** Fase A, pasos 3 y 4. */
    $started = OpaqueTestClient::startLogin($oldPassword);

    $reauthStart = test()->postJson(route('filament.phr.auth.password.reauth.start'), [
        'startLoginRequest' => $started['startLoginRequest'],
    ]);

    if ($reauthStart->status() !== 200) {
        return ['error' => true, 'status' => $reauthStart->status(), 'body' => $reauthStart->json(), 'stage' => 'reauth-start'];
    }

    /** Step 6: the first Argon2id (identity in the test client). */
    try {
        $reauthenticated = OpaqueTestClient::finishLogin(
            $oldPassword,
            $started,
            $reauthStart->json('loginResponse'),
            TEST_SERVER_IDENTITY,
        );
    } catch (RuntimeException) {
        /** The browser does not even get to call `finish`: the current password does not match. */
        return ['error' => true, 'status' => 401, 'body' => ['error' => 'authentication_failed'], 'stage' => 'reauth-client'];
    }

    /** Paso 7. */
    $reauthFinish = test()->postJson(route('filament.phr.auth.password.reauth.finish'), [
        'handshakeId' => $reauthStart->json('handshakeId'),
        'finishLoginRequest' => $reauthenticated['finishLoginRequest'],
    ]);

    if ($reauthFinish->status() !== 200) {
        return ['error' => true, 'status' => $reauthFinish->status(), 'body' => $reauthFinish->json(), 'stage' => 'reauth-finish'];
    }

    $userId = (string) $reauthFinish->json('userId');
    $umkContext = strtolower($userId).'/umk';
    $ticket = (string) $reauthFinish->json('ticket');

    /** Steps 8 and 9: the old KEK opens the current envelope and out comes the same old master key. */
    $userMasterKey = pcOpen(
        pcDeriveKey($reauthenticated['exportKey'], 'myphr/kek/v1'),
        (string) $reauthFinish->json('encryptedUserMasterKey'),
        $umkContext,
    );

    /** Fase B, pasos 12 y 13. */
    $registrationStarted = OpaqueTestClient::startRegistration($newPassword);

    $registrationStart = test()->postJson(route('filament.phr.auth.password.registration.start'), [
        'registrationRequest' => $registrationStarted['registrationRequest'],
        'ticket' => $ticket,
    ]);

    if ($registrationStart->status() !== 200) {
        return [
            'error' => true,
            'status' => $registrationStart->status(),
            'body' => $registrationStart->json(),
            'stage' => 'registration-start',
        ];
    }

    /** Paso 15: segundo Argon2id. */
    $registered = OpaqueTestClient::finishRegistration(
        $newPassword,
        $registrationStarted['blind'],
        $registrationStart->json('registrationResponse'),
        TEST_SERVER_IDENTITY,
    );

    /** Steps 16 to 18: the SAME master key, rewrapped under the new KEK and verified locally. */
    $newKek = pcDeriveKey($registered['exportKey'], 'myphr/kek/v1');
    $wrapped = pcSeal($newKek, $userMasterKey, $umkContext);

    expect(pcOpen($newKek, $wrapped, $umkContext))->toBe($userMasterKey);

    return [
        'error' => false,
        'registrationId' => (string) $registrationStart->json('registrationId'),
        'ticket' => $ticket,
        'registrationRecord' => $registered['registrationRecord'],
        'wrappedUserMasterKey' => $wrapped,
        'userMasterKey' => $userMasterKey,
    ];
}

/** Sends the final request, step 20, with the body {@see pcPrepareChangePassword()} left ready. */
function pcSendChangeRequest(array $prepared): TestResponse
{
    return test()->postJson(route('filament.phr.auth.password.change'), [
        'registrationId' => $prepared['registrationId'],
        'ticket' => $prepared['ticket'],
        'registrationRecord' => $prepared['registrationRecord'],
        'wrappedUserMasterKey' => $prepared['wrappedUserMasterKey'],
    ]);
}

/**
 * Walks the full password change through the four real endpoints, exactly as
 * `resources/js/auth/changePasswordPage.js` does.
 *
 * @return array{status: int, body: array<string, mixed>|null, stage: string}
 */
function pcChangePassword(string $oldPassword, string $newPassword): array
{
    $prepared = pcPrepareChangePassword($oldPassword, $newPassword);

    if ($prepared['error']) {
        return ['status' => $prepared['status'], 'body' => $prepared['body'], 'stage' => $prepared['stage']];
    }

    $change = pcSendChangeRequest($prepared);

    return ['status' => $change->status(), 'body' => $change->json(), 'stage' => 'change'];
}

it('changes the password and leaves the history readable with the new one', function (): void {
    $userMasterKey = pcRegister();

    expect(pcLogin(PC_OLD_PASSWORD)->status())->toBe(200);

    $user = User::query()->sole();
    $oldRecord = $user->opaque_registration_record;
    $oldEnvelope = $user->currentMasterKeyEnvelope;

    $result = pcChangePassword(PC_OLD_PASSWORD, PC_NEW_PASSWORD);

    expect($result['status'])->toBe(200)
        ->and($result['body']['changed'])->toBeTrue()
        ->and($result['body']['userId'])->toBe($user->id)
        ->and($result['body']['sessionSecret'])->toBeString()
        ->and($result['body']['csrf'])->toBeString();

    /** The OPAQUE registration was redone: they are fresh random values (RFC 9807 §8). */
    $user->refresh();
    expect($user->opaque_registration_record)->not->toBe($oldRecord);

    /** The `credential_identifier` does NOT change (`docs/OPAQUE.md` §13.1). */
    $fresh = User::query()->sole();
    expect($fresh->opaque_credential_identifier)->toBe($user->opaque_credential_identifier);

    /** The previous envelope retired with its date, and not deleted: the table is append-only. */
    $retired = UserMasterKeyEnvelope::query()->whereKey($oldEnvelope->id)->first();

    expect($retired)->not->toBeNull()
        ->and($retired->retired_at)->not->toBeNull()
        ->and($retired->envelope)->toBe($oldEnvelope->envelope)
        ->and(UserMasterKeyEnvelope::query()->where('user_id', $user->id)->count())->toBe(2);

    /** And now what really matters: the NEW password opens the SAME master key. */
    test()->post('/phr/logout');
    test()->flushSession();
    auth()->forgetGuards();

    $startedAgain = OpaqueTestClient::startLogin(PC_NEW_PASSWORD);
    $startAgain = test()->postJson(route('filament.phr.auth.opaque.login.start'), [
        'login' => PC_EMAIL,
        'startLoginRequest' => $startedAgain['startLoginRequest'],
    ])->assertOk();

    $finishedAgain = OpaqueTestClient::finishLogin(
        PC_NEW_PASSWORD,
        $startedAgain,
        $startAgain->json('loginResponse'),
        TEST_SERVER_IDENTITY,
    );

    $session = test()->postJson(route('filament.phr.auth.opaque.login.finish'), [
        'handshakeId' => $startAgain->json('handshakeId'),
        'finishLoginRequest' => $finishedAgain['finishLoginRequest'],
    ])->assertOk();

    $recovered = pcOpen(
        pcDeriveKey($finishedAgain['exportKey'], 'myphr/kek/v1'),
        (string) $session->json('encryptedUserMasterKey'),
        strtolower((string) $user->id).'/umk',
    );

    expect($recovered)->toBe($userMasterKey);

    /** And the panel is still reachable: for the person, "I am in". */
    expect(test()->get('/phr')->status())->toBe(200);
});

it('stops accepting the old password after the change', function (): void {
    pcRegister();
    pcLogin(PC_OLD_PASSWORD);

    expect(pcChangePassword(PC_OLD_PASSWORD, PC_NEW_PASSWORD)['status'])->toBe(200);

    test()->post('/phr/logout');
    test()->flushSession();
    auth()->forgetGuards();

    expect(pcLogin(PC_OLD_PASSWORD)->status())->toBe(401)
        ->and(auth()->check())->toBeFalse();

    expect(pcLogin(PC_NEW_PASSWORD)->status())->toBe(200);
});

it('changes nothing if the current password is wrong', function (): void {
    $userMasterKey = pcRegister();
    pcLogin(PC_OLD_PASSWORD);

    $user = User::query()->sole();
    $record = $user->opaque_registration_record;
    $envelopeId = $user->currentMasterKeyEnvelope->id;

    $result = pcChangePassword('EstaNoEsLaContrasena', PC_NEW_PASSWORD);

    expect($result['status'])->toBe(401);

    /** No new registration, no new envelope, no retired envelope. */
    $user->refresh();

    expect($user->opaque_registration_record)->toBe($record)
        ->and($user->currentMasterKeyEnvelope->id)->toBe($envelopeId)
        ->and($user->currentMasterKeyEnvelope->retired_at)->toBeNull()
        ->and(UserMasterKeyEnvelope::query()->where('user_id', $user->id)->count())->toBe(1);

    /** And the same old password still logs in and opens the same master key. */
    test()->post('/phr/logout');
    test()->flushSession();
    auth()->forgetGuards();

    $session = pcLogin(PC_OLD_PASSWORD);

    expect($session->status())->toBe(200);

    $started = OpaqueTestClient::startLogin(PC_OLD_PASSWORD);
    expect($started)->toBeArray();

    /** The current envelope is still the same one and still holds the same key. */
    expect($session->json('encryptedUserMasterKey'))
        ->toBe(UserMasterKeyEnvelope::query()->whereKey($envelopeId)->sole()->envelope)
        ->and(strlen($userMasterKey))->toBe(32);
});

it('rejects the reauthentication without a session', function (): void {
    pcRegister();

    $started = OpaqueTestClient::startLogin(PC_OLD_PASSWORD);

    test()->postJson(route('filament.phr.auth.password.reauth.start'), [
        'startLoginRequest' => $started['startLoginRequest'],
    ])->assertUnauthorized();
});

it('accepts neither a ticket from another session nor an ordinary login handshake', function (): void {
    pcRegister();
    pcLogin(PC_OLD_PASSWORD);

    /** A handshake born in `login/start` is not traded for a password change ticket. */
    $started = OpaqueTestClient::startLogin(PC_OLD_PASSWORD);
    $loginStart = test()->postJson(route('filament.phr.auth.opaque.login.start'), [
        'login' => PC_EMAIL,
        'startLoginRequest' => $started['startLoginRequest'],
    ])->assertOk();

    $finished = OpaqueTestClient::finishLogin(
        PC_OLD_PASSWORD,
        $started,
        $loginStart->json('loginResponse'),
        TEST_SERVER_IDENTITY,
    );

    test()->postJson(route('filament.phr.auth.password.reauth.finish'), [
        'handshakeId' => $loginStart->json('handshakeId'),
        'finishLoginRequest' => $finished['finishLoginRequest'],
    ])->assertStatus(401);

    /** And a made-up ticket does not open the re-registration. */
    $registration = OpaqueTestClient::startRegistration(PC_NEW_PASSWORD);

    test()->postJson(route('filament.phr.auth.password.registration.start'), [
        'registrationRequest' => $registration['registrationRequest'],
        'ticket' => Base64Url::encode(random_bytes(32)),
    ])->assertStatus(409)
        ->assertJson(['error' => 'password_change_expired']);
});

it('rejects a malformed envelope without touching anything', function (): void {
    pcRegister();
    pcLogin(PC_OLD_PASSWORD);

    $user = User::query()->sole();
    $record = $user->opaque_registration_record;

    /** Phase A complete, so we arrive at the commit with a good ticket. */
    $started = OpaqueTestClient::startLogin(PC_OLD_PASSWORD);
    $reauthStart = test()->postJson(route('filament.phr.auth.password.reauth.start'), [
        'startLoginRequest' => $started['startLoginRequest'],
    ])->assertOk();

    $reauthenticated = OpaqueTestClient::finishLogin(
        PC_OLD_PASSWORD,
        $started,
        $reauthStart->json('loginResponse'),
        TEST_SERVER_IDENTITY,
    );

    $reauthFinish = test()->postJson(route('filament.phr.auth.password.reauth.finish'), [
        'handshakeId' => $reauthStart->json('handshakeId'),
        'finishLoginRequest' => $reauthenticated['finishLoginRequest'],
    ])->assertOk();

    $registrationStarted = OpaqueTestClient::startRegistration(PC_NEW_PASSWORD);
    $registrationStart = test()->postJson(route('filament.phr.auth.password.registration.start'), [
        'registrationRequest' => $registrationStarted['registrationRequest'],
        'ticket' => $reauthFinish->json('ticket'),
    ])->assertOk();

    $registered = OpaqueTestClient::finishRegistration(
        PC_NEW_PASSWORD,
        $registrationStarted['blind'],
        $registrationStart->json('registrationResponse'),
        TEST_SERVER_IDENTITY,
    );

    test()->postJson(route('filament.phr.auth.password.change'), [
        'registrationId' => $registrationStart->json('registrationId'),
        'ticket' => $reauthFinish->json('ticket'),
        'registrationRecord' => $registered['registrationRecord'],
        'wrappedUserMasterKey' => 'v1.'.Base64Url::encode(random_bytes(100)),
    ])->assertStatus(422)->assertJson(['error' => 'invalid_registration']);

    $user->refresh();

    expect($user->opaque_registration_record)->toBe($record)
        ->and(UserMasterKeyEnvelope::query()->where('user_id', $user->id)->count())->toBe(1);
});

it('if the browser closes before the final request, everything still works with the old password', function (): void {
    pcRegister();
    pcLogin(PC_OLD_PASSWORD);

    $user = User::query()->sole();
    $record = $user->opaque_registration_record;
    $envelope = $user->currentMasterKeyEnvelope;

    /** Phases A and B complete —reauth and the second Argon2id— but the browser closes here. */
    $prepared = pcPrepareChangePassword(PC_OLD_PASSWORD, PC_NEW_PASSWORD);

    expect($prepared['error'])->toBeFalse();

    /** The server has received nothing from phase C: no new registration, no new envelope. */
    $user->refresh();

    expect($user->opaque_registration_record)->toBe($record)
        ->and($user->currentMasterKeyEnvelope->id)->toBe($envelope->id)
        ->and($user->currentMasterKeyEnvelope->envelope)->toBe($envelope->envelope)
        ->and($user->currentMasterKeyEnvelope->retired_at)->toBeNull()
        ->and(UserMasterKeyEnvelope::query()->where('user_id', $user->id)->count())->toBe(1);

    /** The old password still logs in. */
    test()->post('/phr/logout');
    test()->flushSession();
    auth()->forgetGuards();

    expect(pcLogin(PC_OLD_PASSWORD)->status())->toBe(200);

    /** And the new one, which was never confirmed, does not. */
    test()->post('/phr/logout');
    test()->flushSession();
    auth()->forgetGuards();

    expect(pcLogin(PC_NEW_PASSWORD)->status())->toBe(401)
        ->and(auth()->check())->toBeFalse();
});

it('if the browser closes just as the confirmation arrives, everything still works with the new one and the history stays readable', function (): void {
    $userMasterKey = pcRegister();
    pcLogin(PC_OLD_PASSWORD);

    $user = User::query()->sole();
    $eventsContext = strtolower((string) $user->id).'/events/1';

    /** An encrypted event that already existed before the change, under a key derived from the master key. */
    $eventPlaintext = '{"tipo":"nota","texto":"visita 2026-01-01"}';
    $eventCiphertext = pcSeal(
        pcDeriveKey($userMasterKey, 'myphr/settings/v1', $eventsContext),
        $eventPlaintext,
        $eventsContext,
    );

    /** The change completes in full; the browser closes just as the 200 response arrives, which is
     *  simply ignored here: all that matters is that the server already confirmed. */
    $result = pcChangePassword(PC_OLD_PASSWORD, PC_NEW_PASSWORD);

    expect($result['status'])->toBe(200)
        ->and($result['body']['changed'])->toBeTrue();

    /** The new password logs in, the old one no longer does. */
    test()->post('/phr/logout');
    test()->flushSession();
    auth()->forgetGuards();

    expect(pcLogin(PC_OLD_PASSWORD)->status())->toBe(401);

    $startedAgain = OpaqueTestClient::startLogin(PC_NEW_PASSWORD);
    $startAgain = test()->postJson(route('filament.phr.auth.opaque.login.start'), [
        'login' => PC_EMAIL,
        'startLoginRequest' => $startedAgain['startLoginRequest'],
    ])->assertOk();

    $finishedAgain = OpaqueTestClient::finishLogin(
        PC_NEW_PASSWORD,
        $startedAgain,
        $startAgain->json('loginResponse'),
        TEST_SERVER_IDENTITY,
    );

    $session = test()->postJson(route('filament.phr.auth.opaque.login.finish'), [
        'handshakeId' => $startAgain->json('handshakeId'),
        'finishLoginRequest' => $finishedAgain['finishLoginRequest'],
    ])->assertOk();

    $recoveredMasterKey = pcOpen(
        pcDeriveKey($finishedAgain['exportKey'], 'myphr/kek/v1'),
        (string) $session->json('encryptedUserMasterKey'),
        strtolower((string) $user->id).'/umk',
    );

    expect($recoveredMasterKey)->toBe($userMasterKey);

    /** What really matters: the event encrypted BEFORE the change is still readable with the master
     *  key recovered under the NEW password, because it is the same one as always. */
    $recoveredEvent = pcOpen(
        pcDeriveKey($recoveredMasterKey, 'myphr/settings/v1', $eventsContext),
        $eventCiphertext,
        $eventsContext,
    );

    expect($recoveredEvent)->toBe($eventPlaintext);
});

it('retrying the same already confirmed change request answers idempotent success without duplicating the envelope', function (): void {
    pcRegister();
    pcLogin(PC_OLD_PASSWORD);

    $prepared = pcPrepareChangePassword(PC_OLD_PASSWORD, PC_NEW_PASSWORD);
    expect($prepared['error'])->toBeFalse();

    /** First send: the one that really confirms the change. */
    $first = pcSendChangeRequest($prepared);
    $first->assertOk();
    expect($first->json('changed'))->toBeTrue();

    $user = User::query()->sole();
    $recordAfterFirst = $user->opaque_registration_record;
    $envelopeIdAfterFirst = $user->currentMasterKeyEnvelope->id;

    expect(UserMasterKeyEnvelope::query()->where('user_id', $user->id)->count())->toBe(2);

    /** Retry: same `registrationId`, same body, like somebody reloading after a network drop. */
    $retry = pcSendChangeRequest($prepared);

    $retry->assertOk();
    expect($retry->json('changed'))->toBeTrue()
        ->and($retry->json('userId'))->toBe($user->id)
        ->and($retry->json())->not->toHaveKey('error');

    /** No second OPAQUE registration and no second envelope: the idempotent branch writes nothing again. */
    $user->refresh();

    expect($user->opaque_registration_record)->toBe($recordAfterFirst)
        ->and($user->currentMasterKeyEnvelope->id)->toBe($envelopeIdAfterFirst)
        ->and(UserMasterKeyEnvelope::query()->where('user_id', $user->id)->count())->toBe(2);

    /** And the account keeps working with the new password. */
    test()->post('/phr/logout');
    test()->flushSession();
    auth()->forgetGuards();

    expect(pcLogin(PC_NEW_PASSWORD)->status())->toBe(200)
        ->and(pcLogin(PC_OLD_PASSWORD)->status())->toBe(401);
});

/**
 * This is the test that gives value to all the previous ones: it shows that a split write —a new
 * OPAQUE registration with a still-old current envelope, or the other way round— is impossible, by
 * forcing a real failure *inside* the same transaction that wraps it, after the first write (the
 * envelope) and before the second (the user's OPAQUE registration). If the transaction were not
 * genuinely atomic, the new envelope would stay persisted with the old registration: exactly the
 * split write the design says to avoid.
 */
it('a split write is impossible: if it fails right after creating the new envelope, neither the envelope nor the registration persists', function (): void {
    $userMasterKey = pcRegister();
    pcLogin(PC_OLD_PASSWORD);

    $user = User::query()->sole();
    $record = $user->opaque_registration_record;
    $envelope = $user->currentMasterKeyEnvelope;

    $prepared = pcPrepareChangePassword(PC_OLD_PASSWORD, PC_NEW_PASSWORD);
    expect($prepared['error'])->toBeFalse();

    $pendingBefore = OpaqueRegistration::query()->whereKey($prepared['registrationId'])->sole();

    /**
     * A failure forced inside the transaction: right when the controller tries to store the new
     * OPAQUE registration (`$user->forceFill([...])->save()`, the line after creating the new
     * envelope), we throw a real exception. `DB::transaction()` does not catch it —it only retries
     * on deadlock— so it propagates and rolls the whole transaction back: the `delete()` of the
     * pending row, the `retire()` of the old envelope and the `create()` of the new one.
     */
    User::saving(function (User $model): void {
        if ($model->isDirty('opaque_registration_record')) {
            throw new RuntimeException('simulated interruption inside the transaction');
        }
    });

    pcSendChangeRequest($prepared)->assertStatus(500);

    $user->refresh();

    /** Neither the OPAQUE registration changed, nor the new envelope stayed persisted: never both at
     *  once, and not even one of the two. */
    expect($user->opaque_registration_record)->toBe($record)
        ->and($user->currentMasterKeyEnvelope->id)->toBe($envelope->id)
        ->and($user->currentMasterKeyEnvelope->envelope)->toBe($envelope->envelope)
        ->and($user->currentMasterKeyEnvelope->retired_at)->toBeNull()
        ->and(UserMasterKeyEnvelope::query()->where('user_id', $user->id)->count())->toBe(1);

    /** The `delete()` of the pending row was rolled back too: the transaction is one unit, not two. */
    expect(OpaqueRegistration::query()->whereKey($prepared['registrationId'])->first())
        ->not->toBeNull();

    /** And the account keeps working with the old password, as if phase C had never happened. */
    test()->post('/phr/logout');
    test()->flushSession();
    auth()->forgetGuards();

    expect(pcLogin(PC_OLD_PASSWORD)->status())->toBe(200)
        ->and(strlen($userMasterKey))->toBe(32)
        ->and($pendingBefore->id)->toBe($prepared['registrationId']);
});
