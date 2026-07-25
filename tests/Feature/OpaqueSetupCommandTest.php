<?php

declare(strict_types=1);

use App\Security\Opaque\Base64Url;
use App\Security\Opaque\OpaqueProfile;
use App\Security\Opaque\Oprf;
use App\Security\Opaque\RandomSource;
use App\Security\Opaque\RegistrationRecord;
use App\Security\Opaque\Ristretto255;
use Tests\Unit\Security\Opaque\Support\QueuedRandomSource;

/**
 * `php artisan opaque:setup` (`docs/OPAQUE.md` §12.1).
 *
 * La fuente de aleatoriedad se sustituye por una determinista que comprueba
 * además el tamaño de cada petición: si el comando pidiera un número de bytes
 * distinto del que exige el perfil, la fuente falla antes que la aserción.
 */

/**
 * Registra la fuente determinista y devuelve sus bloques, en el orden en que
 * el comando los consume: `oprf_seed`, semilla estática, semilla del registro
 * ficticio, `masking_key` falsa y clave de enumeración.
 *
 * @return list<string>
 */
function bindDeterministicRandomSource(): array
{
    $chunks = [
        str_repeat("\x11", 64),
        str_repeat("\x22", 32),
        str_repeat("\x33", 32),
        str_repeat("\x44", 64),
        str_repeat("\x55", 32),
    ];

    app()->instance(RandomSource::class, new QueuedRandomSource($chunks));

    return $chunks;
}

/**
 * Valores que el comando debe imprimir para esa cola determinista.
 *
 * @return array<string, string>
 */
function expectedSetupEnvironment(): array
{
    [$oprfSeed, $staticSeed, $fakeSeed, $fakeMaskingKey, $enumerationKey] = bindDeterministicRandomSource();

    [$serverPrivateKey, $serverPublicKey] = Oprf::deriveDiffieHellmanKeyPair($staticSeed);
    [, $fakeClientPublicKey] = Oprf::deriveDiffieHellmanKeyPair($fakeSeed);

    $fakeRecord = new RegistrationRecord(
        $fakeClientPublicKey,
        $fakeMaskingKey,
        str_repeat("\x00", OpaqueProfile::ENVELOPE_BYTES),
    );

    return [
        'OPAQUE_PROFILE' => OpaqueProfile::NAME,
        'OPAQUE_OPRF_SEED' => Base64Url::encode($oprfSeed),
        'OPAQUE_SERVER_PRIVATE_KEY' => Base64Url::encode($serverPrivateKey),
        'OPAQUE_SERVER_PUBLIC_KEY' => Base64Url::encode($serverPublicKey),
        'OPAQUE_FAKE_REGISTRATION_RECORD' => $fakeRecord->toBase64Url(),
        'OPAQUE_ENUMERATION_KEY' => Base64Url::encode($enumerationKey),
    ];
}

it('prints every variable of section 12.2 with its exact length', function (): void {
    $expected = expectedSetupEnvironment();

    $printedInOrder = [
        'OPAQUE_PROFILE='.$expected['OPAQUE_PROFILE'],
        'OPAQUE_OPRF_SEED='.$expected['OPAQUE_OPRF_SEED'],
        'OPAQUE_SERVER_PRIVATE_KEY='.$expected['OPAQUE_SERVER_PRIVATE_KEY'],
        'OPAQUE_SERVER_PUBLIC_KEY='.$expected['OPAQUE_SERVER_PUBLIC_KEY'],
        'OPAQUE_FAKE_REGISTRATION_RECORD='.$expected['OPAQUE_FAKE_REGISTRATION_RECORD'],
        'OPAQUE_SERVER_IDENTITY=',
        'OPAQUE_ENUMERATION_KEY='.$expected['OPAQUE_ENUMERATION_KEY'],
        'OPAQUE_CONTEXT=',
    ];

    $command = $this->artisan('opaque:setup')
        ->expectsConfirmation('¿Generar un setup OPAQUE nuevo?', 'yes');

    foreach ($printedInOrder as $line) {
        $command->expectsOutput($line);
    }

    $command->assertSuccessful()->run();

    expect(strlen(Base64Url::decode($expected['OPAQUE_OPRF_SEED'])))->toBe(64)
        ->and(strlen(Base64Url::decode($expected['OPAQUE_SERVER_PRIVATE_KEY'])))->toBe(32)
        ->and(strlen(Base64Url::decode($expected['OPAQUE_SERVER_PUBLIC_KEY'])))->toBe(32)
        ->and(strlen(Base64Url::decode($expected['OPAQUE_ENUMERATION_KEY'])))->toBe(32)
        ->and(strlen(Base64Url::decode($expected['OPAQUE_FAKE_REGISTRATION_RECORD'])))->toBe(192);
});

it('derives the static key pair instead of using raw random bytes', function (): void {
    $expected = expectedSetupEnvironment();

    $privateKey = Base64Url::decode($expected['OPAQUE_SERVER_PRIVATE_KEY']);
    $publicKey = Base64Url::decode($expected['OPAQUE_SERVER_PUBLIC_KEY']);

    Ristretto255::validateScalar($privateKey);

    expect($privateKey)->not->toBe(str_repeat("\x22", 32))
        ->and(Ristretto255::scalarMultiplyBase($privateKey))->toBe($publicKey);
});

it('builds a fake registration record of 192 bytes with a zeroed envelope', function (): void {
    $expected = expectedSetupEnvironment();

    $bytes = Base64Url::decode($expected['OPAQUE_FAKE_REGISTRATION_RECORD']);
    $record = RegistrationRecord::parse($bytes);

    expect(strlen($bytes))->toBe(192)
        ->and($record->envelope)->toBe(str_repeat("\x00", 96))
        ->and(strlen($record->maskingKey))->toBe(64)
        ->and($record->clientPublicKey)->not->toBe(str_repeat("\x33", 32));

    Ristretto255::validatePoint($record->clientPublicKey);
});

it('warns that a new setup invalidates every existing registration', function (): void {
    bindDeterministicRandomSource();

    $this->artisan('opaque:setup')
        ->expectsOutput('Perder o cambiar el setup inutiliza todos los registros.')
        ->expectsOutput('Los usuarios ya registrados quedan fuera sin error visible:')
        ->expectsConfirmation('¿Generar un setup OPAQUE nuevo?', 'yes')
        ->assertSuccessful();
});

it('generates nothing when the confirmation is declined', function (): void {
    bindDeterministicRandomSource();

    $this->artisan('opaque:setup')
        ->expectsConfirmation('¿Generar un setup OPAQUE nuevo?', 'no')
        ->doesntExpectOutputToContain('OPAQUE_OPRF_SEED=')
        ->assertFailed();
});

it('never writes the environment file', function (): void {
    bindDeterministicRandomSource();

    $environmentFiles = ['.env', '.env.example'];
    $before = array_map(
        static fn (string $file): string|false => @file_get_contents(base_path($file)),
        $environmentFiles
    );

    $this->artisan('opaque:setup')
        ->expectsConfirmation('¿Generar un setup OPAQUE nuevo?', 'yes')
        ->assertSuccessful()
        ->run();

    $after = array_map(
        static fn (string $file): string|false => @file_get_contents(base_path($file)),
        $environmentFiles
    );

    expect($after)->toBe($before);
});
