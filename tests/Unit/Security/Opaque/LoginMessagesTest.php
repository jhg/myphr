<?php

declare(strict_types=1);

use App\Security\Opaque\AuthResponse;
use App\Security\Opaque\CredentialResponse;
use App\Security\Opaque\InvalidMessageException;
use App\Security\Opaque\InvalidPointException;
use App\Security\Opaque\Ke1;
use App\Security\Opaque\Ke2;
use App\Security\Opaque\Ke3;
use App\Security\Opaque\Oprf;
use App\Security\Opaque\ServerLoginState;

/**
 * Devuelve un elemento ristretto255 válido y distinto de la identidad.
 */
function opaqueTestPoint(string $seed): string
{
    [, $publicKey] = Oprf::deriveDiffieHellmanKeyPair(str_pad($seed, 32, "\x01"));

    return $publicKey;
}

it('parses KE1 with the exact offsets of section 6.2', function (): void {
    $blindedMessage = opaqueTestPoint('ke1-blind');
    $clientNonce = str_repeat("\x11", 32);
    $clientPublicKeyshare = opaqueTestPoint('ke1-share');

    $bytes = $blindedMessage.$clientNonce.$clientPublicKeyshare;

    $ke1 = Ke1::parse($bytes);

    expect(strlen($bytes))->toBe(Ke1::LENGTH)
        ->and($ke1->blindedMessage)->toBe($blindedMessage)
        ->and($ke1->clientNonce)->toBe($clientNonce)
        ->and($ke1->clientPublicKeyshare)->toBe($clientPublicKeyshare)
        ->and($ke1->serialize())->toBe($bytes);
});

it('round-trips KE1 through base64url', function (): void {
    $ke1 = new Ke1(opaqueTestPoint('a'), str_repeat("\x22", 32), opaqueTestPoint('b'));

    expect(strlen($ke1->toBase64Url()))->toBe(128)
        ->and(Ke1::fromBase64Url($ke1->toBase64Url())->serialize())->toBe($ke1->serialize());
});

it('rejects a KE1 of the wrong length', function (int $length): void {
    Ke1::parse(str_repeat("\x00", $length));
})->with([0, 32, 95, 97, 128])->throws(InvalidMessageException::class);

it('rejects a KE1 whose blinded message is not a valid point', function (): void {
    Ke1::parse(str_repeat("\xff", 32).str_repeat("\x11", 32).opaqueTestPoint('ok'));
})->throws(InvalidPointException::class);

it('rejects a KE1 whose client keyshare is not a valid point', function (): void {
    Ke1::parse(opaqueTestPoint('ok').str_repeat("\x11", 32).str_repeat("\xff", 32));
})->throws(InvalidPointException::class);

it('rejects a KE1 carrying the identity element', function (): void {
    Ke1::parse(str_repeat("\x00", 32).str_repeat("\x11", 32).opaqueTestPoint('ok'));
})->throws(InvalidPointException::class);

it('parses CredentialResponse with the exact offsets of section 6.2', function (): void {
    $evaluatedMessage = str_repeat("\x01", 32);
    $maskingNonce = str_repeat("\x02", 32);
    $maskedResponse = str_repeat("\x03", 128);

    $bytes = $evaluatedMessage.$maskingNonce.$maskedResponse;
    $response = CredentialResponse::parse($bytes);

    expect(strlen($bytes))->toBe(CredentialResponse::LENGTH)
        ->and($response->evaluatedMessage)->toBe($evaluatedMessage)
        ->and($response->maskingNonce)->toBe($maskingNonce)
        ->and($response->maskedResponse)->toBe($maskedResponse)
        ->and($response->serialize())->toBe($bytes);
});

it('rejects a CredentialResponse of the wrong length', function (int $length): void {
    CredentialResponse::parse(str_repeat("\x00", $length));
})->with([0, 191, 193, 320])->throws(InvalidMessageException::class);

it('parses AuthResponse with the exact offsets of section 6.2', function (): void {
    $serverNonce = str_repeat("\x04", 32);
    $serverPublicKeyshare = opaqueTestPoint('auth');
    $serverMac = str_repeat("\x05", 64);

    $bytes = $serverNonce.$serverPublicKeyshare.$serverMac;
    $response = AuthResponse::parse($bytes);

    expect(strlen($bytes))->toBe(AuthResponse::LENGTH)
        ->and($response->serverNonce)->toBe($serverNonce)
        ->and($response->serverPublicKeyshare)->toBe($serverPublicKeyshare)
        ->and($response->serverMac)->toBe($serverMac)
        ->and($response->serialize())->toBe($bytes);
});

it('rejects an AuthResponse of the wrong length', function (int $length): void {
    AuthResponse::parse(str_repeat("\x00", $length));
})->with([0, 127, 129])->throws(InvalidMessageException::class);

it('rejects an AuthResponse whose server keyshare is not a valid point', function (): void {
    AuthResponse::parse(str_repeat("\x04", 32).str_repeat("\xff", 32).str_repeat("\x05", 64));
})->throws(InvalidPointException::class);

it('splits KE2 into credential response and auth response', function (): void {
    $credentialResponse = new CredentialResponse(
        str_repeat("\x01", 32),
        str_repeat("\x02", 32),
        str_repeat("\x03", 128),
    );
    $authResponse = new AuthResponse(str_repeat("\x04", 32), opaqueTestPoint('ke2'), str_repeat("\x05", 64));

    $ke2 = new Ke2($credentialResponse, $authResponse);
    $bytes = $ke2->serialize();

    expect(strlen($bytes))->toBe(Ke2::LENGTH)
        ->and(substr($bytes, 0, 192))->toBe($credentialResponse->serialize())
        ->and(substr($bytes, 192, 128))->toBe($authResponse->serialize())
        ->and(Ke2::parse($bytes)->serialize())->toBe($bytes)
        ->and(strlen($ke2->toBase64Url()))->toBe(427)
        ->and(Ke2::fromBase64Url($ke2->toBase64Url())->serialize())->toBe($bytes);
});

it('rejects a KE2 of the wrong length', function (int $length): void {
    Ke2::parse(str_repeat("\x00", $length));
})->with([0, 192, 319, 321])->throws(InvalidMessageException::class);

it('carries only the client MAC in KE3', function (): void {
    $clientMac = str_repeat("\x06", 64);
    $ke3 = Ke3::parse($clientMac);

    expect($ke3->clientMac)->toBe($clientMac)
        ->and($ke3->serialize())->toBe($clientMac)
        ->and(strlen($ke3->toBase64Url()))->toBe(86)
        ->and(Ke3::fromBase64Url($ke3->toBase64Url())->clientMac)->toBe($clientMac);
});

it('rejects a KE3 of the wrong length', function (int $length): void {
    Ke3::parse(str_repeat("\x00", $length));
})->with([0, 32, 63, 65, 128])->throws(InvalidMessageException::class);

it('parses ServerLoginState with the exact offsets of section 6.3', function (): void {
    $expectedClientMac = str_repeat("\x07", 64);
    $sessionKey = str_repeat("\x08", 64);

    $bytes = $expectedClientMac.$sessionKey;
    $state = ServerLoginState::parse($bytes);

    expect(strlen($bytes))->toBe(ServerLoginState::LENGTH)
        ->and($state->expectedClientMac)->toBe($expectedClientMac)
        ->and($state->sessionKey)->toBe($sessionKey)
        ->and($state->serialize())->toBe($bytes);
});

it('rejects a ServerLoginState of the wrong length', function (int $length): void {
    ServerLoginState::parse(str_repeat("\x00", $length));
})->with([0, 64, 127, 129])->throws(InvalidMessageException::class);
