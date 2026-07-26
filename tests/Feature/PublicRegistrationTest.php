<?php

declare(strict_types=1);

use App\Models\OpaqueRegistration;
use App\Models\User;
use App\Security\Opaque\Base64Url;
use App\Security\Opaque\OpaqueProfile;
use App\Security\Opaque\Oprf;
use App\Security\Opaque\RegistrationRecord;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Testing\TestResponse;
use Tests\Support\OpaqueTestClient;

uses(RefreshDatabase::class);

/**
 * `POST /phr/auth/opaque/registration/public/start` — alta pública, sin invitación.
 */
const PUBREG_IDENTITY = 'myemr.test/opaque-v1';

const PUBREG_PASSWORD = 'CorrectHorseBatteryStaple';

beforeEach(function (): void {
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
        'server_identity' => PUBREG_IDENTITY,
        'enumeration_key' => Base64Url::encode(str_repeat("\x55", 32)),
        'context' => '',
    ]]);
});

/**
 * Ejercita `registration/public/start` + `registration/finish`, tal cual haría el navegador.
 *
 * @return array{start: TestResponse, finish: TestResponse}
 */
function pubregRegister(string $login, string $name = 'Alicia'): array
{
    $started = OpaqueTestClient::startRegistration(PUBREG_PASSWORD);

    $start = test()->postJson(route('filament.phr.auth.opaque.registration.public-start'), [
        'name' => $name,
        'login' => $login,
        'registrationRequest' => $started['registrationRequest'],
    ]);

    if ($start->status() !== 200) {
        return ['start' => $start, 'finish' => $start];
    }

    $finished = OpaqueTestClient::finishRegistration(
        PUBREG_PASSWORD,
        $started['blind'],
        $start->json('registrationResponse'),
        PUBREG_IDENTITY,
    );

    $finish = test()->postJson(route('filament.phr.auth.opaque.registration.finish'), [
        'registrationId' => $start->json('registrationId'),
        'registrationRecord' => $finished['registrationRecord'],
        'wrappedUserMasterKey' => envelopeCipherText(),
        'encryptedSettings' => envelopeCipherText(),
    ]);

    return ['start' => $start, 'finish' => $finish];
}

/** Login OPAQUE completo contra la cuenta recién dada de alta. */
function pubregLogin(string $login): TestResponse
{
    $started = OpaqueTestClient::startLogin(PUBREG_PASSWORD);

    $start = test()->postJson(route('filament.phr.auth.opaque.login.start'), [
        'login' => $login,
        'startLoginRequest' => $started['startLoginRequest'],
    ])->assertOk();

    $finished = OpaqueTestClient::finishLogin(
        PUBREG_PASSWORD,
        $started,
        $start->json('loginResponse'),
        PUBREG_IDENTITY,
    );

    return test()->postJson(route('filament.phr.auth.opaque.login.finish'), [
        'handshakeId' => $start->json('handshakeId'),
        'finishLoginRequest' => $finished['finishLoginRequest'],
    ]);
}

it('permite darse de alta sin invitacion y entrar despues con la contraseña elegida', function (): void {
    $result = pubregRegister('alicia@example.com');

    $result['start']->assertOk();
    $result['finish']->assertOk();

    $user = User::query()->sole();

    expect($user->email)->toBe('alicia@example.com')
        ->and($user->name)->toBe('Alicia')
        ->and($user->hasCompletedOpaqueRegistration())->toBeTrue()
        ->and($result['start']->json('userId'))->toBe($user->id);

    $login = pubregLogin('alicia@example.com');

    expect($login->status())->toBe(200)
        ->and($login->json('userId'))->toBe($user->id);
});

it('responde 409 login_taken si el correo ya tiene cuenta, y no crea fila ni toca la existente', function (): void {
    $existing = User::factory()->create(['email' => 'ocupado@example.com'])->refresh();
    $before = $existing->getAttributes();
    ksort($before);

    $started = OpaqueTestClient::startRegistration(PUBREG_PASSWORD);

    $response = test()->postJson(route('filament.phr.auth.opaque.registration.public-start'), [
        'name' => 'Otra Persona',
        'login' => 'ocupado@example.com',
        'registrationRequest' => $started['registrationRequest'],
    ]);

    $response->assertStatus(409)->assertJson(['error' => 'login_taken']);

    $after = $existing->refresh()->getAttributes();
    ksort($after);

    expect(User::query()->count())->toBe(1)
        ->and(OpaqueRegistration::query()->count())->toBe(0)
        ->and($after)->toBe($before);
});

it('normaliza el login: mayusculas y espacios producen la misma cuenta y colisionan igual', function (): void {
    $result = pubregRegister('  Alicia@Example.COM  ');

    $result['start']->assertOk();
    $result['finish']->assertOk();

    $user = User::query()->sole();
    expect($user->email)->toBe('alicia@example.com');

    // Un segundo intento con otra variación de mayúsculas/espacios choca con la misma cuenta.
    $started = OpaqueTestClient::startRegistration(PUBREG_PASSWORD);

    $second = test()->postJson(route('filament.phr.auth.opaque.registration.public-start'), [
        'name' => 'Alicia Dos',
        'login' => 'ALICIA@example.com',
        'registrationRequest' => $started['registrationRequest'],
    ]);

    $second->assertStatus(409)->assertJson(['error' => 'login_taken']);
    expect(User::query()->count())->toBe(1);
});

it('corta la alta pública tras superar el límite de intentos por IP', function (): void {
    for ($i = 0; $i < 10; $i++) {
        $started = OpaqueTestClient::startRegistration(PUBREG_PASSWORD);

        test()->postJson(route('filament.phr.auth.opaque.registration.public-start'), [
            'name' => 'Persona '.$i,
            'login' => "persona{$i}@example.com",
            'registrationRequest' => $started['registrationRequest'],
        ])->assertOk();
    }

    $started = OpaqueTestClient::startRegistration(PUBREG_PASSWORD);

    test()->postJson(route('filament.phr.auth.opaque.registration.public-start'), [
        'name' => 'Persona Once',
        'login' => 'persona-once@example.com',
        'registrationRequest' => $started['registrationRequest'],
    ])->assertStatus(429);
});
