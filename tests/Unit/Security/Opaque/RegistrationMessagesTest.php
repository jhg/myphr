<?php

declare(strict_types=1);

use App\Security\Opaque\Base64Url;
use App\Security\Opaque\InvalidMessageException;
use App\Security\Opaque\InvalidPointException;
use App\Security\Opaque\OpaqueProfile;
use App\Security\Opaque\Oprf;
use App\Security\Opaque\RegistrationRecord;
use App\Security\Opaque\RegistrationRequest;
use App\Security\Opaque\RegistrationResponse;

/**
 * Mensajes de registro de `docs/OPAQUE.md` §6.1 y casos negativos de §20.6
 * (truncado, bytes de más, punto identidad, punto inválido, base64 no
 * canónico y con padding).
 */

/** Alfabeto base64url, para construir codificaciones no canónicas. */
const REGMSG_BASE64URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** Punto ristretto255 válido y determinista, distinto de la identidad. */
function regmsgPoint(string $label): string
{
    [, $publicKey] = Oprf::deriveDiffieHellmanKeyPair(hash('sha256', $label, true));

    return $publicKey;
}

/** Los 32 bytes cero: elemento identidad del grupo (RFC 9496 §4). */
function regmsgIdentityPoint(): string
{
    return str_repeat("\x00", 32);
}

/** 32 bytes que no son codificación válida de ningún elemento del grupo. */
function regmsgInvalidPoint(): string
{
    return str_repeat("\xff", 32);
}

/**
 * Altera el último carácter de una codificación base64url para dejar bits
 * sobrantes distintos de cero, es decir, una codificación no canónica.
 */
function regmsgNonCanonicalBase64Url(string $encoded): string
{
    $lastCharacter = $encoded[strlen($encoded) - 1];
    $index = strpos(REGMSG_BASE64URL_ALPHABET, $lastCharacter);

    return substr($encoded, 0, -1).REGMSG_BASE64URL_ALPHABET[$index + 1];
}

it('round-trips a registration request', function (): void {
    $blindedMessage = regmsgPoint('blinded');

    $request = RegistrationRequest::parse($blindedMessage);

    expect($request->blindedMessage)->toBe($blindedMessage)
        ->and($request->serialize())->toBe($blindedMessage)
        ->and(strlen($request->serialize()))->toBe(32)
        ->and(strlen($request->toBase64Url()))->toBe(43)
        ->and(RegistrationRequest::fromBase64Url($request->toBase64Url())->blindedMessage)
        ->toBe($blindedMessage);
});

it('rejects a truncated registration request', function (): void {
    RegistrationRequest::parse(substr(regmsgPoint('blinded'), 0, 31));
})->throws(InvalidMessageException::class);

it('rejects a registration request with trailing bytes', function (): void {
    RegistrationRequest::parse(regmsgPoint('blinded')."\x00");
})->throws(InvalidMessageException::class);

it('rejects the identity element as blinded message', function (): void {
    RegistrationRequest::parse(regmsgIdentityPoint());
})->throws(InvalidPointException::class);

it('rejects a non-group element as blinded message', function (): void {
    RegistrationRequest::parse(regmsgInvalidPoint());
})->throws(InvalidPointException::class);

it('rejects padded base64url in a registration request', function (): void {
    RegistrationRequest::fromBase64Url(base64_encode(regmsgPoint('blinded')));
})->throws(InvalidMessageException::class);

it('rejects non-canonical base64url in a registration request', function (): void {
    RegistrationRequest::fromBase64Url(
        regmsgNonCanonicalBase64Url(Base64Url::encode(regmsgPoint('blinded')))
    );
})->throws(InvalidMessageException::class);

it('round-trips a registration response by exact offsets', function (): void {
    $evaluatedMessage = regmsgPoint('evaluated');
    $serverPublicKey = regmsgPoint('server');

    $response = RegistrationResponse::parse($evaluatedMessage.$serverPublicKey);

    expect($response->evaluatedMessage)->toBe($evaluatedMessage)
        ->and($response->serverPublicKey)->toBe($serverPublicKey)
        ->and(strlen($response->serialize()))->toBe(64)
        ->and(strlen($response->toBase64Url()))->toBe(86)
        ->and(substr($response->serialize(), 0, 32))->toBe($evaluatedMessage)
        ->and(substr($response->serialize(), 32, 32))->toBe($serverPublicKey);
});

it('rejects a truncated registration response', function (): void {
    RegistrationResponse::parse(substr(regmsgPoint('a').regmsgPoint('b'), 0, 63));
})->throws(InvalidMessageException::class);

it('rejects a registration response with trailing bytes', function (): void {
    RegistrationResponse::parse(regmsgPoint('a').regmsgPoint('b')."\x00");
})->throws(InvalidMessageException::class);

it('rejects the identity element inside a registration response', function (): void {
    RegistrationResponse::parse(regmsgIdentityPoint().regmsgPoint('server'));
})->throws(InvalidPointException::class);

it('rejects an invalid server public key inside a registration response', function (): void {
    RegistrationResponse::parse(regmsgPoint('evaluated').regmsgInvalidPoint());
})->throws(InvalidPointException::class);

it('round-trips a registration record by exact offsets', function (): void {
    $clientPublicKey = regmsgPoint('client');
    $maskingKey = str_repeat("\x11", OpaqueProfile::NH);
    $envelope = str_repeat("\x22", OpaqueProfile::ENVELOPE_BYTES);

    $record = RegistrationRecord::parse($clientPublicKey.$maskingKey.$envelope);

    expect($record->clientPublicKey)->toBe($clientPublicKey)
        ->and($record->maskingKey)->toBe($maskingKey)
        ->and($record->envelope)->toBe($envelope)
        ->and(strlen($record->serialize()))->toBe(192)
        ->and(strlen($record->toBase64Url()))->toBe(256)
        ->and(RegistrationRecord::fromBase64Url($record->toBase64Url())->serialize())
        ->toBe($record->serialize());
});

it('accepts the all-zero envelope of the fake registration record', function (): void {
    $record = new RegistrationRecord(
        regmsgPoint('fake'),
        str_repeat("\x33", OpaqueProfile::NH),
        str_repeat("\x00", OpaqueProfile::ENVELOPE_BYTES),
    );

    expect(strlen($record->serialize()))->toBe(192);
});

it('rejects a truncated registration record', function (): void {
    RegistrationRecord::parse(str_repeat("\x00", 191));
})->throws(InvalidMessageException::class);

it('rejects a registration record with trailing bytes', function (): void {
    $binary = regmsgPoint('client')
        .str_repeat("\x11", OpaqueProfile::NH)
        .str_repeat("\x22", OpaqueProfile::ENVELOPE_BYTES);

    RegistrationRecord::parse($binary."\x00");
})->throws(InvalidMessageException::class);

it('rejects a registration record whose client public key is the identity', function (): void {
    RegistrationRecord::parse(
        regmsgIdentityPoint()
            .str_repeat("\x11", OpaqueProfile::NH)
            .str_repeat("\x22", OpaqueProfile::ENVELOPE_BYTES)
    );
})->throws(InvalidPointException::class);

it('rejects a registration record whose client public key is not a group element', function (): void {
    RegistrationRecord::parse(
        regmsgInvalidPoint()
            .str_repeat("\x11", OpaqueProfile::NH)
            .str_repeat("\x22", OpaqueProfile::ENVELOPE_BYTES)
    );
})->throws(InvalidPointException::class);

it('rejects wrong field sizes in the registration record constructor', function (): void {
    new RegistrationRecord(
        regmsgPoint('client'),
        str_repeat("\x11", OpaqueProfile::NH - 1),
        str_repeat("\x22", OpaqueProfile::ENVELOPE_BYTES),
    );
})->throws(InvalidMessageException::class);
