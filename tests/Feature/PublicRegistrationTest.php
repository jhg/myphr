<?php

declare(strict_types=1);

use App\Models\OpaqueRegistration;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Testing\TestResponse;
use Tests\Support\OpaqueTestClient;

uses(RefreshDatabase::class);

/**
 * `POST /phr/auth/opaque/registration/public/start` — public signup, no invitation.
 */
const PUBREG_PASSWORD = 'CorrectHorseBatteryStaple';

beforeEach(function (): void {
    config(['opaque' => opaqueEndpointConfig()]);
});

/**
 * Exercises `registration/public/start` + `registration/finish`, exactly as the browser would.
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
        TEST_SERVER_IDENTITY,
    );

    $finish = test()->postJson(route('filament.phr.auth.opaque.registration.finish'), [
        'registrationId' => $start->json('registrationId'),
        'registrationRecord' => $finished['registrationRecord'],
        'wrappedUserMasterKey' => envelopeCipherText(),
        'encryptedSettings' => envelopeCipherText(),
    ]);

    return ['start' => $start, 'finish' => $finish];
}

/** Full OPAQUE login against the freshly created account. */
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
        TEST_SERVER_IDENTITY,
    );

    return test()->postJson(route('filament.phr.auth.opaque.login.finish'), [
        'handshakeId' => $start->json('handshakeId'),
        'finishLoginRequest' => $finished['finishLoginRequest'],
    ]);
}

it('allows signing up without an invitation and logging in afterwards with the chosen password', function (): void {
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

it('answers 409 login_taken if the email already has an account, and creates no row and touches no existing one', function (): void {
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

it('normalizes the login: capitals and whitespace produce the same account and collide the same way', function (): void {
    $result = pubregRegister('  Alicia@Example.COM  ');

    $result['start']->assertOk();
    $result['finish']->assertOk();

    $user = User::query()->sole();
    expect($user->email)->toBe('alicia@example.com');

    // A second attempt with another capitalization/whitespace variation hits the same account.
    $started = OpaqueTestClient::startRegistration(PUBREG_PASSWORD);

    $second = test()->postJson(route('filament.phr.auth.opaque.registration.public-start'), [
        'name' => 'Alicia Dos',
        'login' => 'ALICIA@example.com',
        'registrationRequest' => $started['registrationRequest'],
    ]);

    $second->assertStatus(409)->assertJson(['error' => 'login_taken']);
    expect(User::query()->count())->toBe(1);
});

it('cuts public signup off once the per-IP attempt limit is exceeded', function (): void {
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
