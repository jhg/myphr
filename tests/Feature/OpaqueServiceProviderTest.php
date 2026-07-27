<?php

declare(strict_types=1);

use App\Security\Opaque\Base64Url;
use App\Security\Opaque\InvalidConfigurationException;
use App\Security\Opaque\OpaqueProfile;
use App\Security\Opaque\Oprf;
use App\Security\Opaque\RandomSource;
use App\Security\Opaque\RegistrationRecord;
use App\Security\Opaque\ServerSetup;
use App\Security\Opaque\SystemRandomSource;

/**
 * Bootstrap of the OPAQUE subsystem (`docs/OPAQUE.md` §12.2): the container
 * hands over a validated {@see ServerSetup} or fails with an explicit error, and
 * never generates secrets on its own.
 */

/**
 * Valid configuration equivalent to the one `opaque:setup` produces.
 *
 * @param  array<string, mixed>  $overrides
 * @return array<string, mixed>
 */
function validOpaqueConfig(array $overrides = []): array
{
    [$privateKey] = Oprf::deriveDiffieHellmanKeyPair(str_repeat("\x07", OpaqueProfile::NSEED));
    [, $fakeClientPublicKey] = Oprf::deriveDiffieHellmanKeyPair(str_repeat("\x09", OpaqueProfile::NSEED));

    $fakeRecord = new RegistrationRecord(
        $fakeClientPublicKey,
        str_repeat("\x5a", OpaqueProfile::NH),
        str_repeat("\x00", OpaqueProfile::ENVELOPE_BYTES),
    );

    return array_merge([
        'profile' => OpaqueProfile::NAME,
        'oprf_seed' => Base64Url::encode(str_repeat("\x01", OpaqueProfile::OPRF_SEED_BYTES)),
        'server_private_key' => Base64Url::encode($privateKey),
        'server_public_key' => null,
        'fake_registration_record' => $fakeRecord->toBase64Url(),
        'server_identity' => 'my-application.example/opaque-v1',
        'enumeration_key' => Base64Url::encode(str_repeat("\x0e", 32)),
        'context' => '',
    ], $overrides);
}

it('resolves a validated server setup as a singleton', function (): void {
    config(['opaque' => validOpaqueConfig()]);

    $setup = app(ServerSetup::class);

    expect($setup)->toBeInstanceOf(ServerSetup::class)
        ->and(strlen($setup->oprfSeed))->toBe(64)
        ->and(strlen($setup->serverPublicKey))->toBe(32)
        ->and($setup->profile)->toBe(OpaqueProfile::NAME)
        ->and(app(ServerSetup::class))->toBe($setup);
});

it('binds the system CSPRNG as the random source', function (): void {
    expect(app(RandomSource::class))->toBeInstanceOf(SystemRandomSource::class)
        ->and(app(RandomSource::class))->toBe(app(RandomSource::class));
});

it('fails explicitly instead of generating anything when the setup is missing or invalid', function (array $config): void {
    config(['opaque' => $config]);

    expect(fn () => app(ServerSetup::class))->toThrow(InvalidConfigurationException::class);
})->with([
    'no configuration' => [[]],
    'sin oprf_seed' => [validOpaqueConfig(['oprf_seed' => null])],
    'oprf_seed corto' => [validOpaqueConfig(['oprf_seed' => Base64Url::encode(str_repeat("\x01", 32))])],
    'non-canonical base64url' => [validOpaqueConfig(['oprf_seed' => str_repeat('A', 86).'='])],
    'escalar cero' => [validOpaqueConfig(['server_private_key' => Base64Url::encode(str_repeat("\x00", 32))])],
    'public key that does not match' => [validOpaqueConfig(['server_public_key' => Base64Url::encode(str_repeat("\x02", 32))])],
    'registro ficticio corto' => [validOpaqueConfig(['fake_registration_record' => Base64Url::encode(str_repeat("\x00", 191))])],
    'empty identity' => [validOpaqueConfig(['server_identity' => ''])],
    'perfil desconocido' => [validOpaqueConfig(['profile' => 'OPAQUE-otra-cosa'])],
    'non-empty context' => [validOpaqueConfig(['context' => 'phr'])],
]);
