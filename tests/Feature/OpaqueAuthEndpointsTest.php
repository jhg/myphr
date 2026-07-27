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
 * OPAQUE HTTP contract (Spec 0001 §4, §5 and §6; `docs/OPAQUE.md` §13, §15 and §20.8).
 *
 * The flows are walked end to end against the real server, with a test OPAQUE client
 * ({@see OpaqueTestClient}): no recorded fixtures and no simulated responses.
 */
const TEST_PASSWORD = 'CorrectHorseBatteryStaple';

beforeEach(function (): void {
    config(['opaque' => opaqueEndpointConfig()]);
});

/**
 * An ADR 0004 encrypted envelope with a valid size. The server never opens it, so its content does
 * not matter: what is tested is that it accepts the wrapper and returns it intact.
 */
function fakeEnvelope(): string
{
    return 'v1.'.Base64Url::encode(random_bytes(64 + 16 + 256));
}

/** URL of a panel route by its name. */
function phrRoute(string $name): string
{
    return route('filament.phr.'.$name);
}

/**
 * Issues a registration link for a new account.
 *
 * @return array{0: User, 1: string} The account and the plaintext token.
 */
function issuedRegistrationToken(?User $user = null): array
{
    $user ??= User::factory()->create();
    $url = app(RegistrationLinks::class)->issueFor($user);

    return [$user, Str::after($url, '#')];
}

/**
 * Walks the full signup (Spec 0001 §5) and returns what is needed to continue with the login.
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
 * Walks the full login (Spec 0001 §6.1) and returns the `login/finish` response.
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

/** Spec 0001 §4: the routes hang off the panel and live both outside and inside the auth middleware. */
it('mounts the routes under the panel prefix', function (string $name, string $uri, string $method): void {
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

/** §4.5: `session-secret` and `lock` require an authenticated session. */
it('leaves the session routes behind the authentication middleware and the OPAQUE ones outside', function (): void {
    $authenticated = Route::getRoutes()->getByName('filament.phr.auth.session-secret')->gatherMiddleware();
    $unauthenticated = Route::getRoutes()->getByName('filament.phr.auth.opaque.login.start')->gatherMiddleware();

    expect($authenticated)->toContain(Authenticate::class)
        ->and($unauthenticated)->not->toContain(Authenticate::class);
});

/** Spec 0001 §5, steps 4 and 12: the full signup, in two requests and with the link consumed at the end. */
it('completes an account signup and leaves the link consumed and the envelope current', function (): void {
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

/** §13.1: the identifier is the HMAC of the normalized login, not a random value per registration. */
it('derives the credential identifier from the normalized login', function (): void {
    $user = completeRegistration()['user'];

    expect($user->opaque_credential_identifier)
        ->toBe(app(CredentialIdentifier::class)->for((string) $user->email));
});

/** §4.1: the client needs `userId` before encrypting, and `serverPublicKey` for the §5 pinning. */
it('returns userId, profile and server public key in registration/start', function (): void {
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
it('answers with the same generic error for any unusable token', function (string $case): void {
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

/** §4.2 and §7: retrying after losing the response neither fails nor duplicates rows. */
it('is idempotent in registration/finish', function (): void {
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

/** §4.2: an envelope that does not satisfy the ADR 0004 wrapper is not stored. */
it('rejects an envelope without the v1. prefix or with a size that is not allowed', function (string $envelope): void {
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
    'size not allowed' => [fn (): string => 'v1.'.Base64Url::encode(random_bytes(337))],
    'non-canonical base64url' => [fn (): string => 'v1.'.str_repeat('A', 447).'='],
]);

/** Spec 0001 §5 and §6.1 chained: signup and the login that follows, against the real server. */
it('completes the login of a freshly created account', function (): void {
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

/** §4.4: the destination stored by `redirect()->guest()` is not lost. */
it('returns the destination stored in url.intended', function (): void {
    $result = completeRegistration();

    test()->withSession(['url.intended' => 'http://localhost/phr/algo-profundo']);

    completeLogin($result['user'])
        ->assertOk()
        ->assertJsonPath('redirect', 'http://localhost/phr/algo-profundo');
});

/** §4.4: a wrong password produces the generic error and no session. */
it('rejects a wrong password with the generic error', function (): void {
    $result = completeRegistration();

    $started = OpaqueTestClient::startLogin('otra-contraseña');

    $start = test()->postJson(phrRoute('auth.opaque.login.start'), [
        'login' => $result['user']->email,
        'startLoginRequest' => $started['startLoginRequest'],
    ])->assertOk();

    /** The real client does not even reach `login/finish`: `server_mac` does not verify. */
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

/** §4.4 and `docs/OPAQUE.md` §14.3: the handshake is consumed before validating the MAC and is single use. */
it('consumes the single-use handshake, even when the MAC does not match', function (): void {
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

    /** The correct MAC is no longer enough: the handshake was consumed in the previous attempt. */
    test()->postJson(phrRoute('auth.opaque.login.finish'), [
        'handshakeId' => $handshakeId,
        'finishLoginRequest' => $finished['finishLoginRequest'],
    ])->assertStatus(401)->assertExactJson(['error' => 'authentication_failed']);

    expect(auth()->check())->toBeFalse();
});

/** §4.4: a correct handshake is not good twice either. */
it('does not accept the same handshake twice with the correct MAC', function (): void {
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

/** §13.3: a non-existent account and a real one give the same shape, the same status and the same size. */
it('answers a non-existent user with a structurally identical response', function (): void {
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

    /** The fake branch leaves its handshake row, with no `user_id`, just like the real one. */
    expect(OpaqueLoginHandshake::query()->whereNull('user_id')->count())->toBe(1)
        ->and(OpaqueLoginHandshake::query()->whereNotNull('user_id')->count())->toBe(1);
});

/**
 * `docs/OPAQUE.md` §20.8: with the same blinded message and the same login, the answer must be
 * indistinguishable before and after registering the account.
 *
 * Byte-for-byte equality is checked on the `evaluated_message`, which is the deterministic part: it
 * is exactly what RFC 9807 §10.9 points at as the oracle to close. The rest of `KE2` carries fresh
 * nonces and cannot repeat, so only its shape and size are checked.
 */
it('returns the same evaluated_message for the same blinded point before and after signup', function (): void {
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

/** §13.3: the fake branch is also taken with the record present but the profile mismatched. */
it('takes the fake branch when the stored profile is not the current one', function (): void {
    $result = completeRegistration();

    $result['user']->forceFill(['opaque_profile' => 'OPAQUE-R255-SHA512-A2ID-m16384-t1-p1-ctx0-v0'])->save();

    $started = OpaqueTestClient::startLogin(TEST_PASSWORD);

    $response = test()->postJson(phrRoute('auth.opaque.login.start'), [
        'login' => $result['user']->email,
        'startLoginRequest' => $started['startLoginRequest'],
    ])->assertOk();

    expect(OpaqueLoginHandshake::query()->whereNull('user_id')->count())->toBe(1);

    /** The client cannot finish: the masked envelope is not its own. */
    expect(fn () => OpaqueTestClient::finishLogin(
        TEST_PASSWORD,
        $started,
        $response->json('loginResponse'),
        TEST_SERVER_IDENTITY,
    ))->toThrow(RuntimeException::class);
});

/** §13.3: with no OPAQUE registration, the account is indistinguishable from a non-existent one. */
it('takes the fake branch when the account exists but has no OPAQUE registration', function (): void {
    $user = User::factory()->create();

    test()->postJson(phrRoute('auth.opaque.login.start'), [
        'login' => $user->email,
        'startLoginRequest' => OpaqueTestClient::startLogin(TEST_PASSWORD)['startLoginRequest'],
    ])->assertOk();

    expect(OpaqueLoginHandshake::query()->whereNull('user_id')->count())->toBe(1);
});

/** §6.2: recovery after a reload does not ask for the password again. */
it('returns the same session secret and the encrypted settings in session-secret', function (): void {
    $result = completeRegistration();
    $login = completeLogin($result['user'])->assertOk();

    $response = test()->postJson(phrRoute('auth.session-secret'));

    $response->assertOk()
        ->assertJsonPath('sessionSecret', $login->json('sessionSecret'))
        ->assertJsonPath('encryptedSettings', $result['settings']);

    expect($response->headers->get('Vary'))->toContain('Cookie');
});

/** §4.5: no session, no secret, and the route does not even reach the controller. */
it('does not hand out the session secret without an authenticated session', function (): void {
    test()->postJson(phrRoute('auth.session-secret'))->assertStatus(401);
});

/** §4.5: a live session whose secret is gone. */
it('answers 410 when the session is still alive but the secret is gone', function (): void {
    $result = completeRegistration();
    completeLogin($result['user'])->assertOk();

    $store = app('session.store');
    app(SessionSecrets::class)->destroy($store);
    $store->save();

    test()->postJson(phrRoute('auth.session-secret'))
        ->assertStatus(410)
        ->assertExactJson(['error' => 'session_secret_unavailable']);
});

/** §8: locking closes the whole session, not just the secret. */
it('closes the whole session on lock', function (): void {
    $result = completeRegistration();
    completeLogin($result['user'])->assertOk();

    test()->postJson(phrRoute('auth.lock'))->assertOk()->assertExactJson(['locked' => true]);

    expect(auth()->check())->toBeFalse()
        ->and(session(SessionSecrets::SESSION_KEY))->toBeNull();

    /**
     * A divergence from Spec 0001 §11: the spec expects 410 here, but `session-secret` lives in
     * `authenticatedRoutes()` and locking destroys the session, so the authentication middleware
     * cuts in first with 401. Both responses lead to the same place: the login screen.
     */
    test()->postJson(phrRoute('auth.session-secret'))->assertStatus(401);
});

/** §4: no response in this group may end up in a cache. */
it('marks every response as non-storable', function (string $name, string $method): void {
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

/** §4.1 and §7: the link page is served generic, with no token in the path and querying nothing. */
it('serves the set-password page without validating any token', function (): void {
    test()->get(phrRoute('auth.set-password'))->assertOk()->assertSee('set-password', escape: false);

    expect(phrRoute('auth.set-password'))->toBe(url(RegistrationLinks::SET_PASSWORD_PATH));
});

/** §4.3: a structurally invalid message never reaches the cryptography. */
it('rejects a malformed KE1 without creating a handshake', function (): void {
    test()->postJson(phrRoute('auth.opaque.login.start'), [
        'login' => 'quien@example.test',
        'startLoginRequest' => Base64Url::encode(random_bytes(95)),
    ])->assertStatus(422)->assertExactJson(['error' => 'invalid_request']);

    expect(OpaqueLoginHandshake::query()->count())->toBe(0);
});

/**
 * Spec 0001 §3.4: reissuing a link on an account with access does not overwrite the previous
 * envelope.
 *
 * The old envelope is retired with its content intact, so a password somebody still remembers keeps
 * opening what it used to open.
 */
it('adds a new envelope and retires the previous one when registering again', function (): void {
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

    /** The credential identifier is reused, not regenerated (§13.1). */
    expect($user->opaque_credential_identifier)
        ->toBe($first['user']->opaque_credential_identifier);
});

/**
 * Activity trail of an account's lifecycle.
 *
 * It lives here and not in `ActivityLogTest` because signup and login require walking the whole
 * OPAQUE protocol, and the helpers that do so are the ones in this file. What is checked is the
 * sequence and that no row carries properties: the server records the verb and the date, never the
 * content.
 */
it('leaves a trail of the signup and the login with no properties', function (): void {
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
