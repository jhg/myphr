<?php

declare(strict_types=1);

use App\Security\Opaque\InvalidConfigurationException;
use App\Security\Opaque\InvalidPointException;
use App\Security\Opaque\OpaqueProfile;
use App\Security\Opaque\Oprf;
use App\Security\Opaque\RegistrationRecord;
use App\Security\Opaque\RegistrationRequest;
use App\Security\Opaque\RegistrationServer;
use App\Security\Opaque\Ristretto255;
use App\Security\Opaque\ServerSetup;

/**
 * `CreateRegistrationResponse` de RFC 9807 §5.2.2 (`docs/OPAQUE.md` §10.2).
 */

/** Deterministic setup for the tests. */
function registrationSetup(): ServerSetup
{
    [$serverPrivateKey] = Oprf::deriveDiffieHellmanKeyPair(str_repeat("\x07", 32));
    [, $fakeClientPublicKey] = Oprf::deriveDiffieHellmanKeyPair(str_repeat("\x09", 32));

    return new ServerSetup(
        str_repeat("\x01", OpaqueProfile::OPRF_SEED_BYTES),
        $serverPrivateKey,
        Ristretto255::scalarMultiplyBase($serverPrivateKey),
        new RegistrationRecord(
            $fakeClientPublicKey,
            str_repeat("\x5a", OpaqueProfile::NH),
            str_repeat("\x00", OpaqueProfile::ENVELOPE_BYTES),
        ),
        'my-application.example/opaque-v1',
    );
}

/** A 32-byte `credential_identifier`, as §13.1 requires. */
function registrationCredentialIdentifier(string $login = 'alice@example.test'): string
{
    return hash_hmac('sha256', $login, str_repeat("\x2b", 32), true);
}

/** `blinded_message` produced by the client with a fixed `blind`. */
function registrationBlindedMessage(string $password = 'correct horse battery staple'): string
{
    return Oprf::blind($password, Ristretto255::scalarReduce(str_repeat("\x03", 64)));
}

it('creates a 64 byte registration response ending in the server public key', function (): void {
    $setup = registrationSetup();
    $server = new RegistrationServer($setup);

    $response = $server->createRegistrationResponse(
        RegistrationRequest::parse(registrationBlindedMessage()),
        registrationCredentialIdentifier(),
    );

    expect(strlen($response->serialize()))->toBe(64)
        ->and($response->serverPublicKey)->toBe($setup->serverPublicKey)
        ->and(substr($response->serialize(), 32, 32))->toBe($setup->serverPublicKey);
});

it('evaluates the OPRF with the per-user key derived from the oprf seed', function (): void {
    $setup = registrationSetup();
    $credentialIdentifier = registrationCredentialIdentifier();
    $blindedMessage = registrationBlindedMessage();

    $response = (new RegistrationServer($setup))->createRegistrationResponse(
        RegistrationRequest::parse($blindedMessage),
        $credentialIdentifier,
    );

    $expected = Ristretto255::scalarMultiply(
        Oprf::deriveOprfKey($setup->oprfSeed, $credentialIdentifier),
        $blindedMessage,
    );

    expect($response->evaluatedMessage)->toBe($expected);
});

it('is deterministic for the same credential identifier and blinded message', function (): void {
    $server = new RegistrationServer(registrationSetup());
    $request = RegistrationRequest::parse(registrationBlindedMessage());
    $credentialIdentifier = registrationCredentialIdentifier();

    expect($server->createRegistrationResponse($request, $credentialIdentifier)->serialize())
        ->toBe($server->createRegistrationResponse($request, $credentialIdentifier)->serialize());
});

it('produces a different evaluated message for a different credential identifier', function (): void {
    $server = new RegistrationServer(registrationSetup());
    $request = RegistrationRequest::parse(registrationBlindedMessage());

    expect($server->createRegistrationResponse($request, registrationCredentialIdentifier('alice@example.test'))->evaluatedMessage)
        ->not->toBe($server->createRegistrationResponse($request, registrationCredentialIdentifier('bob@example.test'))->evaluatedMessage);
});

it('lets the client unblind the response to the OPRF output of its password', function (): void {
    $setup = registrationSetup();
    $password = 'correct horse battery staple';
    $blind = Ristretto255::scalarReduce(str_repeat("\x03", 64));
    $credentialIdentifier = registrationCredentialIdentifier();

    $response = (new RegistrationServer($setup))->createRegistrationResponse(
        RegistrationRequest::parse(Oprf::blind($password, $blind)),
        $credentialIdentifier,
    );

    $clientOutput = Oprf::finalize($password, $blind, $response->evaluatedMessage);

    expect(strlen($clientOutput))->toBe(64)
        ->and($clientOutput)->not->toBe(Oprf::finalize('otra contraseña', $blind, $response->evaluatedMessage));
});

it('rejects a credential identifier that is not 32 bytes', function (): void {
    (new RegistrationServer(registrationSetup()))->createRegistrationResponse(
        RegistrationRequest::parse(registrationBlindedMessage()),
        'short',
    );
})->throws(InvalidConfigurationException::class);

it('never evaluates the identity element, which the request already rejects', function (): void {
    RegistrationRequest::parse(str_repeat("\x00", 32));
})->throws(InvalidPointException::class);
