<?php

declare(strict_types=1);

use App\Security\Opaque\CredentialResponse;
use App\Security\Opaque\InvalidMessageException;
use App\Security\Opaque\Ke1;
use App\Security\Opaque\Oprf;
use App\Security\Opaque\Preamble;

function preambleKe1(): Ke1
{
    [, $blinded] = Oprf::deriveDiffieHellmanKeyPair(str_repeat("\x21", 32));
    [, $share] = Oprf::deriveDiffieHellmanKeyPair(str_repeat("\x22", 32));

    return new Ke1($blinded, str_repeat("\x23", 32), $share);
}

function preambleCredentialResponse(): CredentialResponse
{
    return new CredentialResponse(
        str_repeat("\x31", 32),
        str_repeat("\x32", 32),
        str_repeat("\x33", 128),
    );
}

it('lays out the preamble byte by byte as section 11.5 requires', function (): void {
    $ke1 = preambleKe1();
    $credentialResponse = preambleCredentialResponse();
    $serverNonce = str_repeat("\x41", 32);
    $serverPublicKeyshare = str_repeat("\x42", 32);

    $preamble = Preamble::build(
        'ctx',
        'client-id',
        $ke1,
        'server-id',
        $credentialResponse,
        $serverNonce,
        $serverPublicKeyshare,
    );

    $expected = 'OPAQUEv1-'
        ."\x00\x03".'ctx'
        ."\x00\x09".'client-id'
        .$ke1->serialize()
        ."\x00\x09".'server-id'
        .$credentialResponse->serialize()
        .$serverNonce
        .$serverPublicKeyshare;

    expect($preamble)->toBe($expected)
        ->and(strlen($preamble))->toBe(9 + 2 + 3 + 2 + 9 + 96 + 2 + 9 + 192 + 32 + 32);
});

it('uses big endian uint16 length prefixes for the three variable fields', function (): void {
    $preamble = Preamble::build(
        '',
        str_repeat('c', 300),
        preambleKe1(),
        str_repeat('s', 257),
        preambleCredentialResponse(),
        str_repeat("\x41", 32),
        str_repeat("\x42", 32),
    );

    expect(substr($preamble, 9, 2))->toBe("\x00\x00")
        ->and(substr($preamble, 11, 2))->toBe("\x01\x2c")
        ->and(substr($preamble, 13 + 300 + 96, 2))->toBe("\x01\x01");
});

it('starts with the OPAQUEv1- prefix', function (): void {
    expect(Preamble::PREFIX)->toBe('OPAQUEv1-')
        ->and(Preamble::build('', '', preambleKe1(), '', preambleCredentialResponse(), str_repeat("\x41", 32), str_repeat("\x42", 32)))
        ->toStartWith("OPAQUEv1-\x00\x00\x00\x00");
});

it('produces a different preamble when any variable field changes', function (): void {
    $ke1 = preambleKe1();
    $credentialResponse = preambleCredentialResponse();
    $nonce = str_repeat("\x41", 32);
    $share = str_repeat("\x42", 32);

    $base = Preamble::build('', 'a', $ke1, 'b', $credentialResponse, $nonce, $share);

    expect(Preamble::build('x', 'a', $ke1, 'b', $credentialResponse, $nonce, $share))->not->toBe($base)
        ->and(Preamble::build('', 'ab', $ke1, '', $credentialResponse, $nonce, $share))->not->toBe($base)
        ->and(Preamble::build('', 'a', $ke1, 'b', $credentialResponse, str_repeat("\x43", 32), $share))->not->toBe($base);
});

it('rejects a server nonce or keyshare of the wrong length', function (string $nonce, string $share): void {
    Preamble::build('', '', preambleKe1(), '', preambleCredentialResponse(), $nonce, $share);
})->with([
    [str_repeat("\x41", 31), str_repeat("\x42", 32)],
    [str_repeat("\x41", 33), str_repeat("\x42", 32)],
    [str_repeat("\x41", 32), str_repeat("\x42", 31)],
    [str_repeat("\x41", 32), ''],
])->throws(InvalidMessageException::class);

it('falls back to the public key when an identity is nil', function (): void {
    $publicKey = str_repeat("\x51", 32);

    expect(Preamble::resolveIdentity(null, $publicKey))->toBe($publicKey)
        ->and(Preamble::resolveIdentity('explicit', $publicKey))->toBe('explicit')
        ->and(Preamble::resolveIdentity('', $publicKey))->toBe('');
});
