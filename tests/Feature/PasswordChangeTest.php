<?php

declare(strict_types=1);

use App\Models\OpaqueRegistration;
use App\Models\User;
use App\Models\UserMasterKeyEnvelope;
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

const PC_IDENTITY = 'myemr.test/opaque-v1';
const PC_OLD_PASSWORD = 'CorrectHorseBatteryStaple';
const PC_NEW_PASSWORD = 'TrueRhinoCandleWindow';
const PC_EMAIL = 'Alicia@Example.COM';

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
        'server_identity' => PC_IDENTITY,
        'enumeration_key' => Base64Url::encode(str_repeat("\x55", 32)),
        'context' => '',
    ]]);
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
 * Espejo en PHP de `open()`: es lo que hace de verdad el navegador al recuperar la clave maestra.
 *
 * Sin esta función el test más importante —que el sobre nuevo abre la MISMA clave maestra— no se
 * podría escribir, porque el servidor no puede abrir ningún sobre.
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
        throw new RuntimeException('El sobre no abre con esa clave.');
    }

    /** @var array{1: int} $length */
    $length = unpack('N', substr($padded, 0, 4));

    return substr($padded, 4, $length[1]);
}

/** Da de alta la cuenta por el camino real y devuelve la clave maestra en claro. */
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
        PC_IDENTITY,
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

/** Login completo por los endpoints reales. */
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
            PC_IDENTITY,
        );
    } catch (RuntimeException) {
        /** El cliente real traduce esto a «contraseña incorrecta» y no llega a llamar a `finish`. */
        return new TestResponse(response()->json(['error' => 'authentication_failed'], 401));
    }

    return test()->postJson(route('filament.phr.auth.opaque.login.finish'), [
        'handshakeId' => $start->json('handshakeId'),
        'finishLoginRequest' => $finished['finishLoginRequest'],
    ]);
}

/**
 * Recorre las fases A y B del cambio de contraseña —hasta justo antes de mandar `password/change`,
 * paso 20— y deja preparado el cuerpo de esa petición final sin enviarla.
 *
 * Es el punto exacto en el que "se cierra el navegador demasiado pronto": todo lo anterior (reauth y
 * segundo Argon2id) ya ocurrió, pero el servidor no ha recibido ni tocado nada de la fase C.
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

    /** Paso 6: primer Argon2id (identidad en el cliente de pruebas). */
    try {
        $reauthenticated = OpaqueTestClient::finishLogin(
            $oldPassword,
            $started,
            $reauthStart->json('loginResponse'),
            PC_IDENTITY,
        );
    } catch (RuntimeException) {
        /** El navegador ni siquiera llega a llamar a `finish`: la contraseña actual no cuadra. */
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

    /** Pasos 8 y 9: la KEK vieja abre el sobre vigente y sale la clave maestra de siempre. */
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
        PC_IDENTITY,
    );

    /** Pasos 16 a 18: la MISMA clave maestra, reenvuelta bajo la KEK nueva y verificada en local. */
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

/** Envía la petición final, paso 20, con el cuerpo que dejó preparado {@see pcPrepareChangePassword()}. */
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
 * Recorre el cambio de contraseña completo por los cuatro endpoints reales, tal y como lo hace
 * `resources/js/auth/changePasswordPage.js`.
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

it('cambia la contraseña y deja el historial legible con la nueva', function (): void {
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

    /** El registro OPAQUE se rehízo: son valores aleatorios frescos (RFC 9807 §8). */
    $user->refresh();
    expect($user->opaque_registration_record)->not->toBe($oldRecord);

    /** El `credential_identifier` NO cambia (`docs/OPAQUE.md` §13.1). */
    $fresh = User::query()->sole();
    expect($fresh->opaque_credential_identifier)->toBe($user->opaque_credential_identifier);

    /** Sobre anterior retirado con su fecha, y no borrado: la tabla es de solo añadir. */
    $retired = UserMasterKeyEnvelope::query()->whereKey($oldEnvelope->id)->first();

    expect($retired)->not->toBeNull()
        ->and($retired->retired_at)->not->toBeNull()
        ->and($retired->envelope)->toBe($oldEnvelope->envelope)
        ->and(UserMasterKeyEnvelope::query()->where('user_id', $user->id)->count())->toBe(2);

    /** Y ahora lo que de verdad importa: la contraseña NUEVA abre la MISMA clave maestra. */
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
        PC_IDENTITY,
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

    /** Y el panel sigue accesible: para la persona, «he entrado». */
    expect(test()->get('/phr')->status())->toBe(200);
});

it('deja de admitir la contraseña vieja despues del cambio', function (): void {
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

it('no cambia nada si la contraseña actual es incorrecta', function (): void {
    $userMasterKey = pcRegister();
    pcLogin(PC_OLD_PASSWORD);

    $user = User::query()->sole();
    $record = $user->opaque_registration_record;
    $envelopeId = $user->currentMasterKeyEnvelope->id;

    $result = pcChangePassword('EstaNoEsLaContrasena', PC_NEW_PASSWORD);

    expect($result['status'])->toBe(401);

    /** Ni registro nuevo, ni sobre nuevo, ni sobre retirado. */
    $user->refresh();

    expect($user->opaque_registration_record)->toBe($record)
        ->and($user->currentMasterKeyEnvelope->id)->toBe($envelopeId)
        ->and($user->currentMasterKeyEnvelope->retired_at)->toBeNull()
        ->and(UserMasterKeyEnvelope::query()->where('user_id', $user->id)->count())->toBe(1);

    /** Y la contraseña de siempre sigue entrando y abriendo la misma clave maestra. */
    test()->post('/phr/logout');
    test()->flushSession();
    auth()->forgetGuards();

    $session = pcLogin(PC_OLD_PASSWORD);

    expect($session->status())->toBe(200);

    $started = OpaqueTestClient::startLogin(PC_OLD_PASSWORD);
    expect($started)->toBeArray();

    /** El sobre vigente sigue siendo el de siempre y sigue guardando la misma clave. */
    expect($session->json('encryptedUserMasterKey'))
        ->toBe(UserMasterKeyEnvelope::query()->whereKey($envelopeId)->sole()->envelope)
        ->and(strlen($userMasterKey))->toBe(32);
});

it('rechaza la reautenticacion sin sesion', function (): void {
    pcRegister();

    $started = OpaqueTestClient::startLogin(PC_OLD_PASSWORD);

    test()->postJson(route('filament.phr.auth.password.reauth.start'), [
        'startLoginRequest' => $started['startLoginRequest'],
    ])->assertUnauthorized();
});

it('no acepta un ticket de otra sesion ni un handshake de login normal', function (): void {
    pcRegister();
    pcLogin(PC_OLD_PASSWORD);

    /** Un handshake nacido en `login/start` no se canjea por un ticket de cambio de contraseña. */
    $started = OpaqueTestClient::startLogin(PC_OLD_PASSWORD);
    $loginStart = test()->postJson(route('filament.phr.auth.opaque.login.start'), [
        'login' => PC_EMAIL,
        'startLoginRequest' => $started['startLoginRequest'],
    ])->assertOk();

    $finished = OpaqueTestClient::finishLogin(
        PC_OLD_PASSWORD,
        $started,
        $loginStart->json('loginResponse'),
        PC_IDENTITY,
    );

    test()->postJson(route('filament.phr.auth.password.reauth.finish'), [
        'handshakeId' => $loginStart->json('handshakeId'),
        'finishLoginRequest' => $finished['finishLoginRequest'],
    ])->assertStatus(401);

    /** Y un ticket inventado no abre el re-registro. */
    $registration = OpaqueTestClient::startRegistration(PC_NEW_PASSWORD);

    test()->postJson(route('filament.phr.auth.password.registration.start'), [
        'registrationRequest' => $registration['registrationRequest'],
        'ticket' => Base64Url::encode(random_bytes(32)),
    ])->assertStatus(409)
        ->assertJson(['error' => 'password_change_expired']);
});

it('rechaza un sobre mal formado sin tocar nada', function (): void {
    pcRegister();
    pcLogin(PC_OLD_PASSWORD);

    $user = User::query()->sole();
    $record = $user->opaque_registration_record;

    /** Fase A completa, para llegar con ticket bueno hasta el commit. */
    $started = OpaqueTestClient::startLogin(PC_OLD_PASSWORD);
    $reauthStart = test()->postJson(route('filament.phr.auth.password.reauth.start'), [
        'startLoginRequest' => $started['startLoginRequest'],
    ])->assertOk();

    $reauthenticated = OpaqueTestClient::finishLogin(
        PC_OLD_PASSWORD,
        $started,
        $reauthStart->json('loginResponse'),
        PC_IDENTITY,
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
        PC_IDENTITY,
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

it('si el navegador se cierra antes de la peticion final, todo sigue funcionando con la contraseña vieja', function (): void {
    pcRegister();
    pcLogin(PC_OLD_PASSWORD);

    $user = User::query()->sole();
    $record = $user->opaque_registration_record;
    $envelope = $user->currentMasterKeyEnvelope;

    /** Fases A y B completas —reauth y segundo Argon2id—, pero el navegador se cierra aquí. */
    $prepared = pcPrepareChangePassword(PC_OLD_PASSWORD, PC_NEW_PASSWORD);

    expect($prepared['error'])->toBeFalse();

    /** El servidor no ha recibido nada de la fase C: ni registro nuevo, ni sobre nuevo. */
    $user->refresh();

    expect($user->opaque_registration_record)->toBe($record)
        ->and($user->currentMasterKeyEnvelope->id)->toBe($envelope->id)
        ->and($user->currentMasterKeyEnvelope->envelope)->toBe($envelope->envelope)
        ->and($user->currentMasterKeyEnvelope->retired_at)->toBeNull()
        ->and(UserMasterKeyEnvelope::query()->where('user_id', $user->id)->count())->toBe(1);

    /** La contraseña vieja sigue entrando. */
    test()->post('/phr/logout');
    test()->flushSession();
    auth()->forgetGuards();

    expect(pcLogin(PC_OLD_PASSWORD)->status())->toBe(200);

    /** Y la nueva, que nunca llegó a confirmarse, no. */
    test()->post('/phr/logout');
    test()->flushSession();
    auth()->forgetGuards();

    expect(pcLogin(PC_NEW_PASSWORD)->status())->toBe(401)
        ->and(auth()->check())->toBeFalse();
});

it('si el navegador se cierra justo al recibir la confirmacion, todo sigue funcionando con la nueva y el historial sigue legible', function (): void {
    $userMasterKey = pcRegister();
    pcLogin(PC_OLD_PASSWORD);

    $user = User::query()->sole();
    $eventsContext = strtolower((string) $user->id).'/events/1';

    /** Un evento cifrado que ya existía antes del cambio, bajo una clave derivada de la clave maestra. */
    $eventPlaintext = '{"tipo":"nota","texto":"visita 2026-01-01"}';
    $eventCiphertext = pcSeal(
        pcDeriveKey($userMasterKey, 'myphr/settings/v1', $eventsContext),
        $eventPlaintext,
        $eventsContext,
    );

    /** El cambio se completa del todo; el navegador se cierra justo al recibir la respuesta 200, que
     *  aquí simplemente se ignora: lo único que importa es que el servidor ya confirmó. */
    $result = pcChangePassword(PC_OLD_PASSWORD, PC_NEW_PASSWORD);

    expect($result['status'])->toBe(200)
        ->and($result['body']['changed'])->toBeTrue();

    /** La contraseña nueva entra, la vieja ya no. */
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
        PC_IDENTITY,
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

    /** Lo que de verdad importa: el evento cifrado ANTES del cambio sigue siendo legible con la
     *  clave maestra recuperada bajo la contraseña NUEVA, porque es la misma de siempre. */
    $recoveredEvent = pcOpen(
        pcDeriveKey($recoveredMasterKey, 'myphr/settings/v1', $eventsContext),
        $eventCiphertext,
        $eventsContext,
    );

    expect($recoveredEvent)->toBe($eventPlaintext);
});

it('reintentar la misma peticion de cambio ya confirmada responde exito idempotente sin duplicar el sobre', function (): void {
    pcRegister();
    pcLogin(PC_OLD_PASSWORD);

    $prepared = pcPrepareChangePassword(PC_OLD_PASSWORD, PC_NEW_PASSWORD);
    expect($prepared['error'])->toBeFalse();

    /** Primer envío: el que de verdad confirma el cambio. */
    $first = pcSendChangeRequest($prepared);
    $first->assertOk();
    expect($first->json('changed'))->toBeTrue();

    $user = User::query()->sole();
    $recordAfterFirst = $user->opaque_registration_record;
    $envelopeIdAfterFirst = $user->currentMasterKeyEnvelope->id;

    expect(UserMasterKeyEnvelope::query()->where('user_id', $user->id)->count())->toBe(2);

    /** Reintento: mismo `registrationId`, mismo cuerpo, como quien recarga tras un corte de red. */
    $retry = pcSendChangeRequest($prepared);

    $retry->assertOk();
    expect($retry->json('changed'))->toBeTrue()
        ->and($retry->json('userId'))->toBe($user->id)
        ->and($retry->json())->not->toHaveKey('error');

    /** Ni segundo registro OPAQUE, ni segundo sobre: la rama idempotente no vuelve a escribir nada. */
    $user->refresh();

    expect($user->opaque_registration_record)->toBe($recordAfterFirst)
        ->and($user->currentMasterKeyEnvelope->id)->toBe($envelopeIdAfterFirst)
        ->and(UserMasterKeyEnvelope::query()->where('user_id', $user->id)->count())->toBe(2);

    /** Y la cuenta sigue funcionando con la contraseña nueva. */
    test()->post('/phr/logout');
    test()->flushSession();
    auth()->forgetGuards();

    expect(pcLogin(PC_NEW_PASSWORD)->status())->toBe(200)
        ->and(pcLogin(PC_OLD_PASSWORD)->status())->toBe(401);
});

/**
 * Este es el test que da valor a todos los anteriores: demuestra que la escritura partida —registro
 * OPAQUE nuevo con sobre vigente todavía viejo, o al revés— no es posible, forzando un fallo real
 * *dentro* de la misma transacción que la envuelve, después de la primera escritura (el sobre) y antes
 * de la segunda (el registro OPAQUE del usuario). Si la transacción no fuese atómica de verdad, el
 * sobre nuevo quedaría persistido con el registro viejo: justo la escritura partida que el diseño dice
 * evitar.
 */
it('una escritura partida es imposible: si falla justo despues de crear el sobre nuevo, no persiste ni el sobre ni el registro', function (): void {
    $userMasterKey = pcRegister();
    pcLogin(PC_OLD_PASSWORD);

    $user = User::query()->sole();
    $record = $user->opaque_registration_record;
    $envelope = $user->currentMasterKeyEnvelope;

    $prepared = pcPrepareChangePassword(PC_OLD_PASSWORD, PC_NEW_PASSWORD);
    expect($prepared['error'])->toBeFalse();

    $pendingBefore = OpaqueRegistration::query()->whereKey($prepared['registrationId'])->sole();

    /**
     * Fallo forzado dentro de la transacción: justo cuando el controlador intenta guardar el
     * registro OPAQUE nuevo (`$user->forceFill([...])->save()`, línea posterior a la creación del
     * sobre nuevo), lanzamos una excepción real. `DB::transaction()` no la atrapa —solo reintenta
     * en caso de deadlock— así que se propaga y deshace toda la transacción: el `delete()` del
     * pendiente, el `retire()` del sobre viejo y el `create()` del sobre nuevo.
     */
    User::saving(function (User $model): void {
        if ($model->isDirty('opaque_registration_record')) {
            throw new RuntimeException('interrupción simulada dentro de la transacción');
        }
    });

    pcSendChangeRequest($prepared)->assertStatus(500);

    $user->refresh();

    /** Ni el registro OPAQUE cambió, ni el sobre nuevo quedó persistido: nunca los dos a la vez, ni
     *  siquiera uno de los dos. */
    expect($user->opaque_registration_record)->toBe($record)
        ->and($user->currentMasterKeyEnvelope->id)->toBe($envelope->id)
        ->and($user->currentMasterKeyEnvelope->envelope)->toBe($envelope->envelope)
        ->and($user->currentMasterKeyEnvelope->retired_at)->toBeNull()
        ->and(UserMasterKeyEnvelope::query()->where('user_id', $user->id)->count())->toBe(1);

    /** El `delete()` del pendiente también se deshizo: la transacción es una unidad, no dos. */
    expect(OpaqueRegistration::query()->whereKey($prepared['registrationId'])->first())
        ->not->toBeNull();

    /** Y la cuenta sigue funcionando con la contraseña vieja, como si la fase C nunca hubiera
     *  ocurrido. */
    test()->post('/phr/logout');
    test()->flushSession();
    auth()->forgetGuards();

    expect(pcLogin(PC_OLD_PASSWORD)->status())->toBe(200)
        ->and(strlen($userMasterKey))->toBe(32)
        ->and($pendingBefore->id)->toBe($prepared['registrationId']);
});
