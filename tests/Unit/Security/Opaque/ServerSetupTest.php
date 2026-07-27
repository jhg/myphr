<?php

declare(strict_types=1);

use App\Security\Opaque\Base64Url;
use App\Security\Opaque\InvalidConfigurationException;
use App\Security\Opaque\OpaqueProfile;
use App\Security\Opaque\Oprf;
use App\Security\Opaque\RegistrationRecord;
use App\Security\Opaque\Ristretto255;
use App\Security\Opaque\ServerSetup;

/**
 * Loading and strict validation of the server setup
 * (`docs/OPAQUE.md` §12.2), including the §20.6 negative cases
 * "bad setup" and "non-canonical scalar in the setup".
 */

/** Server static scalar derived deterministically (§12.1). */
function setupPrivateKey(): string
{
    [$privateKey] = Oprf::deriveDiffieHellmanKeyPair(str_repeat("\x07", 32));

    return $privateKey;
}

/** Registro ficticio de §13.2: clave derivada, masking key fija, envelope de ceros. */
function setupFakeRecord(): RegistrationRecord
{
    [, $fakeClientPublicKey] = Oprf::deriveDiffieHellmanKeyPair(str_repeat("\x09", 32));

    return new RegistrationRecord(
        $fakeClientPublicKey,
        str_repeat("\x5a", OpaqueProfile::NH),
        str_repeat("\x00", OpaqueProfile::ENVELOPE_BYTES),
    );
}

/**
 * Valid configuration equivalent to the one in `config/opaque.php`.
 *
 * @param  array<string, mixed>  $overrides
 * @return array<string, mixed>
 */
function setupConfig(array $overrides = []): array
{
    return array_merge([
        'profile' => OpaqueProfile::NAME,
        'oprf_seed' => Base64Url::encode(str_repeat("\x01", OpaqueProfile::OPRF_SEED_BYTES)),
        'server_private_key' => Base64Url::encode(setupPrivateKey()),
        'fake_registration_record' => Base64Url::encode(setupFakeRecord()->serialize()),
        'server_identity' => 'my-application.example/opaque-v1',
        'context' => '',
    ], $overrides);
}

it('loads a valid configuration and derives the public key', function (): void {
    $setup = ServerSetup::fromConfig(setupConfig());

    expect(strlen($setup->oprfSeed))->toBe(64)
        ->and(strlen($setup->serverPrivateKey))->toBe(32)
        ->and($setup->serverPublicKey)->toBe(Ristretto255::scalarMultiplyBase(setupPrivateKey()))
        ->and($setup->fakeRegistrationRecord->serialize())->toBe(setupFakeRecord()->serialize())
        ->and($setup->serverIdentity)->toBe('my-application.example/opaque-v1')
        ->and($setup->context)->toBe('')
        ->and($setup->profile)->toBe(OpaqueProfile::NAME);
});

it('accepts a configured public key that matches the private scalar', function (): void {
    $setup = ServerSetup::fromConfig(setupConfig([
        'server_public_key' => Base64Url::encode(Ristretto255::scalarMultiplyBase(setupPrivateKey())),
    ]));

    expect($setup->serverPublicKey)->toBe(Ristretto255::scalarMultiplyBase(setupPrivateKey()));
});

it('rejects a configured public key that does not match the private scalar', function (): void {
    [, $otherPublicKey] = Oprf::deriveDiffieHellmanKeyPair(str_repeat("\x42", 32));

    ServerSetup::fromConfig(setupConfig([
        'server_public_key' => Base64Url::encode($otherPublicKey),
    ]));
})->throws(InvalidConfigurationException::class);

it('rejects a missing oprf seed instead of generating one', function (): void {
    $config = setupConfig();
    unset($config['oprf_seed']);

    ServerSetup::fromConfig($config);
})->throws(InvalidConfigurationException::class);

it('rejects an oprf seed of the wrong length', function (): void {
    ServerSetup::fromConfig(setupConfig([
        'oprf_seed' => Base64Url::encode(str_repeat("\x01", 32)),
    ]));
})->throws(InvalidConfigurationException::class);

it('rejects non-canonical base64url in the configuration', function (): void {
    $encoded = Base64Url::encode(str_repeat("\x01", OpaqueProfile::OPRF_SEED_BYTES));

    ServerSetup::fromConfig(setupConfig([
        'oprf_seed' => $encoded.'=',
    ]));
})->throws(InvalidConfigurationException::class);

it('rejects standard base64 in the configuration', function (): void {
    ServerSetup::fromConfig(setupConfig([
        'oprf_seed' => base64_encode(str_repeat("\xfb", OpaqueProfile::OPRF_SEED_BYTES)),
    ]));
})->throws(InvalidConfigurationException::class);

it('rejects a non-canonical private scalar', function (): void {
    ServerSetup::fromConfig(setupConfig([
        'server_private_key' => Base64Url::encode(str_repeat("\xff", 32)),
    ]));
})->throws(InvalidConfigurationException::class);

it('rejects the zero private scalar', function (): void {
    ServerSetup::fromConfig(setupConfig([
        'server_private_key' => Base64Url::encode(str_repeat("\x00", 32)),
    ]));
})->throws(InvalidConfigurationException::class);

it('rejects a fake registration record of the wrong length', function (): void {
    ServerSetup::fromConfig(setupConfig([
        'fake_registration_record' => Base64Url::encode(str_repeat("\x00", 191)),
    ]));
})->throws(InvalidConfigurationException::class);

it('rejects a fake registration record with an invalid client public key', function (): void {
    $broken = str_repeat("\x00", OpaqueProfile::NPK)
        .str_repeat("\x5a", OpaqueProfile::NH)
        .str_repeat("\x00", OpaqueProfile::ENVELOPE_BYTES);

    ServerSetup::fromConfig(setupConfig([
        'fake_registration_record' => Base64Url::encode($broken),
    ]));
})->throws(InvalidConfigurationException::class);

it('rejects an unknown profile name', function (): void {
    ServerSetup::fromConfig(setupConfig([
        'profile' => 'OPAQUE-R255-SHA512-A2ID-m19456-t2-p1-ctx0-v1',
    ]));
})->throws(InvalidConfigurationException::class);

it('rejects an empty server identity', function (): void {
    ServerSetup::fromConfig(setupConfig(['server_identity' => '']));
})->throws(InvalidConfigurationException::class);

it('rejects a non-empty context in this profile', function (): void {
    ServerSetup::fromConfig(setupConfig(['context' => 'anything']));
})->throws(InvalidConfigurationException::class);

it('rejects non-string configuration values', function (): void {
    ServerSetup::fromConfig(setupConfig(['server_identity' => 1234]));
})->throws(InvalidConfigurationException::class);

it('rejects a private key that is not the scalar of the public key when built directly', function (): void {
    [, $otherPublicKey] = Oprf::deriveDiffieHellmanKeyPair(str_repeat("\x42", 32));

    new ServerSetup(
        str_repeat("\x01", OpaqueProfile::OPRF_SEED_BYTES),
        setupPrivateKey(),
        $otherPublicKey,
        setupFakeRecord(),
        'my-application.example/opaque-v1',
    );
})->throws(InvalidConfigurationException::class);
