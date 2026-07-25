<?php

declare(strict_types=1);

use App\Security\Opaque\AkeKeySchedule;
use App\Security\Opaque\AuthenticationFailedException;
use App\Security\Opaque\BinaryCodec;
use App\Security\Opaque\CredentialResponse;
use App\Security\Opaque\HkdfSha512;
use App\Security\Opaque\InvalidMessageException;
use App\Security\Opaque\Ke1;
use App\Security\Opaque\Ke2;
use App\Security\Opaque\Ke3;
use App\Security\Opaque\Oprf;
use App\Security\Opaque\Preamble;
use App\Security\Opaque\RegistrationRecord;
use App\Security\Opaque\Ristretto255;
use App\Security\Opaque\ServerLogin;
use App\Security\Opaque\ServerLoginState;
use Tests\Unit\Security\Opaque\Support\QueuedRandomSource;

/**
 * Escenario de login completo y determinista: claves del servidor, record del
 * usuario y KE1 del cliente, todo derivado de semillas fijas.
 *
 * @return array{
 *     ke1: Ke1,
 *     record: RegistrationRecord,
 *     oprfSeed: string,
 *     credentialIdentifier: string,
 *     serverPrivateKey: string,
 *     serverPublicKey: string,
 *     clientPrivateKey: string,
 *     clientEphemeralPrivateKey: string,
 *     serverIdentity: string,
 *     envelope: string,
 *     maskingKey: string,
 * }
 */
function opaqueLoginScenario(): array
{
    [$serverPrivateKey, $serverPublicKey] = Oprf::deriveDiffieHellmanKeyPair(str_repeat("\x10", 32));
    [$clientPrivateKey, $clientPublicKey] = Oprf::deriveDiffieHellmanKeyPair(str_repeat("\x20", 32));
    [$clientEphemeralPrivateKey, $clientPublicKeyshare] = Oprf::deriveDiffieHellmanKeyPair(str_repeat("\x30", 32));
    [, $blindedMessage] = Oprf::deriveDiffieHellmanKeyPair(str_repeat("\x40", 32));

    $maskingKey = str_repeat("\x51", 64);
    $envelope = str_repeat("\x52", 96);

    return [
        'ke1' => new Ke1($blindedMessage, str_repeat("\x60", 32), $clientPublicKeyshare),
        'record' => new RegistrationRecord($clientPublicKey, $maskingKey, $envelope),
        'oprfSeed' => str_repeat("\x70", 64),
        'credentialIdentifier' => str_repeat("\x80", 32),
        'serverPrivateKey' => $serverPrivateKey,
        'serverPublicKey' => $serverPublicKey,
        'clientPrivateKey' => $clientPrivateKey,
        'clientEphemeralPrivateKey' => $clientEphemeralPrivateKey,
        'serverIdentity' => 'my-application.example/opaque-v1',
        'envelope' => $envelope,
        'maskingKey' => $maskingKey,
    ];
}

it('builds a credential response of 192 bytes with the OPRF evaluation and the masked payload', function (): void {
    $scenario = opaqueLoginScenario();
    $maskingNonce = str_repeat("\x90", 32);

    $login = new ServerLogin(new QueuedRandomSource([$maskingNonce]));

    $response = $login->createCredentialResponse(
        $scenario['ke1'],
        $scenario['record'],
        $scenario['oprfSeed'],
        $scenario['credentialIdentifier'],
        $scenario['serverPublicKey'],
    );

    $oprfKey = Oprf::deriveOprfKey($scenario['oprfSeed'], $scenario['credentialIdentifier']);

    expect(strlen($response->serialize()))->toBe(CredentialResponse::LENGTH)
        ->and($response->evaluatedMessage)->toBe(Oprf::blindEvaluate($oprfKey, $scenario['ke1']->blindedMessage))
        ->and($response->maskingNonce)->toBe($maskingNonce);
});

it('masks the server public key and the envelope with a pad the client can reproduce', function (): void {
    $scenario = opaqueLoginScenario();
    $maskingNonce = str_repeat("\x91", 32);

    $login = new ServerLogin(new QueuedRandomSource([$maskingNonce]));

    $response = $login->createCredentialResponse(
        $scenario['ke1'],
        $scenario['record'],
        $scenario['oprfSeed'],
        $scenario['credentialIdentifier'],
        $scenario['serverPublicKey'],
    );

    $pad = HkdfSha512::expand($scenario['maskingKey'], $maskingNonce.'CredentialResponsePad', 128);
    $unmasked = BinaryCodec::xorStrings($pad, $response->maskedResponse);

    expect(strlen($pad))->toBe(128)
        ->and(substr($unmasked, 0, 32))->toBe($scenario['serverPublicKey'])
        ->and(substr($unmasked, 32, 96))->toBe($scenario['envelope'])
        ->and($response->maskedResponse)->not->toBe($scenario['serverPublicKey'].$scenario['envelope']);
});

it('produces a different masked response per masking nonce', function (): void {
    $scenario = opaqueLoginScenario();

    $first = (new ServerLogin(new QueuedRandomSource([str_repeat("\x01", 32)])))->createCredentialResponse(
        $scenario['ke1'], $scenario['record'], $scenario['oprfSeed'], $scenario['credentialIdentifier'], $scenario['serverPublicKey'],
    );
    $second = (new ServerLogin(new QueuedRandomSource([str_repeat("\x02", 32)])))->createCredentialResponse(
        $scenario['ke1'], $scenario['record'], $scenario['oprfSeed'], $scenario['credentialIdentifier'], $scenario['serverPublicKey'],
    );

    expect($first->evaluatedMessage)->toBe($second->evaluatedMessage)
        ->and($first->maskedResponse)->not->toBe($second->maskedResponse);
});

it('rejects a server public key of the wrong length', function (): void {
    $scenario = opaqueLoginScenario();

    (new ServerLogin(new QueuedRandomSource([str_repeat("\x01", 32)])))->createCredentialResponse(
        $scenario['ke1'], $scenario['record'], $scenario['oprfSeed'], $scenario['credentialIdentifier'], str_repeat("\x00", 31),
    );
})->throws(InvalidMessageException::class);

it('answers KE1 with a 320 byte KE2 and a 128 byte state', function (): void {
    $scenario = opaqueLoginScenario();

    $login = new ServerLogin(new QueuedRandomSource([
        str_repeat("\x90", 32),
        str_repeat("\xa0", 32),
        str_repeat("\xb0", 32),
    ]));

    $credentialResponse = $login->createCredentialResponse(
        $scenario['ke1'], $scenario['record'], $scenario['oprfSeed'], $scenario['credentialIdentifier'], $scenario['serverPublicKey'],
    );

    $result = $login->authServerRespond(
        $scenario['ke1'],
        $credentialResponse,
        $scenario['record'],
        $scenario['serverPrivateKey'],
        $scenario['serverIdentity'],
    );

    expect(strlen($result->ke2->serialize()))->toBe(Ke2::LENGTH)
        ->and(strlen($result->state->serialize()))->toBe(ServerLoginState::LENGTH)
        ->and($result->ke2->authResponse->serverNonce)->toBe(str_repeat("\xa0", 32))
        ->and($result->ke2->credentialResponse->serialize())->toBe($credentialResponse->serialize());
});

it('never reuses the ephemeral keyshare between handshakes', function (): void {
    $scenario = opaqueLoginScenario();

    $run = function (string $suffix) use ($scenario) {
        $login = new ServerLogin(new QueuedRandomSource([
            str_repeat("\x90", 32),
            str_repeat($suffix, 32),
            str_repeat($suffix, 32),
        ]));

        $credentialResponse = $login->createCredentialResponse(
            $scenario['ke1'], $scenario['record'], $scenario['oprfSeed'], $scenario['credentialIdentifier'], $scenario['serverPublicKey'],
        );

        return $login->authServerRespond(
            $scenario['ke1'], $credentialResponse, $scenario['record'],
            $scenario['serverPrivateKey'], $scenario['serverIdentity'],
        );
    };

    $first = $run("\xa1");
    $second = $run("\xa2");

    expect($first->ke2->authResponse->serverPublicKeyshare)->not->toBe($second->ke2->authResponse->serverPublicKeyshare)
        ->and($first->state->sessionKey)->not->toBe($second->state->sessionKey);
});

it('agrees with the client mirror of the 3DH exchange', function (): void {
    $scenario = opaqueLoginScenario();

    $login = new ServerLogin(new QueuedRandomSource([
        str_repeat("\x90", 32),
        str_repeat("\xa0", 32),
        str_repeat("\xb0", 32),
    ]));

    $credentialResponse = $login->createCredentialResponse(
        $scenario['ke1'], $scenario['record'], $scenario['oprfSeed'], $scenario['credentialIdentifier'], $scenario['serverPublicKey'],
    );

    $result = $login->authServerRespond(
        $scenario['ke1'], $credentialResponse, $scenario['record'],
        $scenario['serverPrivateKey'], $scenario['serverIdentity'],
    );

    $serverPublicKeyshare = $result->ke2->authResponse->serverPublicKeyshare;

    // Espejo del cliente, RFC 9807 §6.4.3.
    $clientIkm = BinaryCodec::concat(
        Ristretto255::scalarMultiply($scenario['clientEphemeralPrivateKey'], $serverPublicKeyshare),
        Ristretto255::scalarMultiply($scenario['clientEphemeralPrivateKey'], $scenario['serverPublicKey']),
        Ristretto255::scalarMultiply($scenario['clientPrivateKey'], $serverPublicKeyshare),
    );

    $preamble = Preamble::build(
        '',
        $scenario['record']->clientPublicKey,
        $scenario['ke1'],
        $scenario['serverIdentity'],
        $credentialResponse,
        $result->ke2->authResponse->serverNonce,
        $serverPublicKeyshare,
    );

    $clientKeys = AkeKeySchedule::deriveKeys($clientIkm, $preamble);
    $serverMac = AkeKeySchedule::serverMac($clientKeys->serverMacKey, $preamble);

    expect($serverMac)->toBe($result->ke2->authResponse->serverMac)
        ->and($clientKeys->sessionKey)->toBe($result->state->sessionKey)
        ->and(AkeKeySchedule::clientMac($clientKeys->clientMacKey, $preamble, $serverMac))
        ->toBe($result->state->expectedClientMac);
});

it('breaks the MAC when the server identity differs by one byte', function (): void {
    $scenario = opaqueLoginScenario();

    $run = function (string $serverIdentity) use ($scenario) {
        $login = new ServerLogin(new QueuedRandomSource([
            str_repeat("\x90", 32),
            str_repeat("\xa0", 32),
            str_repeat("\xb0", 32),
        ]));

        $credentialResponse = $login->createCredentialResponse(
            $scenario['ke1'], $scenario['record'], $scenario['oprfSeed'], $scenario['credentialIdentifier'], $scenario['serverPublicKey'],
        );

        return $login->authServerRespond(
            $scenario['ke1'], $credentialResponse, $scenario['record'],
            $scenario['serverPrivateKey'], $serverIdentity,
        );
    };

    expect($run('server-a')->ke2->authResponse->serverMac)->not->toBe($run('server-b')->ke2->authResponse->serverMac);
});

it('rejects a server private key of the wrong length', function (): void {
    $scenario = opaqueLoginScenario();

    $login = new ServerLogin(new QueuedRandomSource([str_repeat("\x90", 32)]));

    $credentialResponse = $login->createCredentialResponse(
        $scenario['ke1'], $scenario['record'], $scenario['oprfSeed'], $scenario['credentialIdentifier'], $scenario['serverPublicKey'],
    );

    $login->authServerRespond(
        $scenario['ke1'], $credentialResponse, $scenario['record'],
        str_repeat("\x00", 31), $scenario['serverIdentity'],
    );
})->throws(InvalidMessageException::class);

it('returns the session key when the client MAC matches', function (): void {
    $sessionKey = str_repeat("\x0a", 64);
    $clientMac = str_repeat("\x0b", 64);

    $state = new ServerLoginState($clientMac, $sessionKey);

    expect(ServerLogin::serverFinish(new Ke3($clientMac), $state))->toBe($sessionKey);
});

it('refuses to return the session key when the client MAC is wrong', function (string $clientMac): void {
    $state = new ServerLoginState(str_repeat("\x0b", 64), str_repeat("\x0a", 64));

    ServerLogin::serverFinish(new Ke3($clientMac), $state);
})->with([
    str_repeat("\x0c", 64),
    str_repeat("\x0b", 63)."\x0c",
    "\x0c".str_repeat("\x0b", 63),
    str_repeat("\x00", 64),
])->throws(AuthenticationFailedException::class);

it('does not leak the session key in the authentication failure', function (): void {
    $sessionKey = str_repeat("\x0a", 64);
    $state = new ServerLoginState(str_repeat("\x0b", 64), $sessionKey);

    try {
        ServerLogin::serverFinish(new Ke3(str_repeat("\x0c", 64)), $state);
        $failure = null;
    } catch (AuthenticationFailedException $exception) {
        $failure = $exception;
    }

    expect($failure)->not->toBeNull()
        ->and($failure->getMessage())->not->toContain($sessionKey);
});

it('completes the round trip from KE1 to a shared session key', function (): void {
    $scenario = opaqueLoginScenario();

    $login = new ServerLogin(new QueuedRandomSource([
        str_repeat("\x90", 32),
        str_repeat("\xa0", 32),
        str_repeat("\xb0", 32),
    ]));

    $credentialResponse = $login->createCredentialResponse(
        $scenario['ke1'], $scenario['record'], $scenario['oprfSeed'], $scenario['credentialIdentifier'], $scenario['serverPublicKey'],
    );

    $result = $login->authServerRespond(
        $scenario['ke1'], $credentialResponse, $scenario['record'],
        $scenario['serverPrivateKey'], $scenario['serverIdentity'],
    );

    $ke3 = new Ke3($result->state->expectedClientMac);

    expect(ServerLogin::serverFinish($ke3, $result->state))->toBe($result->state->sessionKey)
        ->and(strlen(ServerLogin::serverFinish($ke3, $result->state)))->toBe(64);
});
