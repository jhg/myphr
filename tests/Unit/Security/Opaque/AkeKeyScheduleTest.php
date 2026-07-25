<?php

declare(strict_types=1);

use App\Security\Opaque\AkeKeys;
use App\Security\Opaque\AkeKeySchedule;
use App\Security\Opaque\ExpandLabel;
use App\Security\Opaque\HkdfSha512;
use App\Security\Opaque\InvalidMessageException;

it('derives three independent 64 byte keys', function (): void {
    $keys = AkeKeySchedule::deriveKeys(str_repeat("\x01", 96), 'preamble');

    expect(strlen($keys->sessionKey))->toBe(64)
        ->and(strlen($keys->serverMacKey))->toBe(64)
        ->and(strlen($keys->clientMacKey))->toBe(64)
        ->and($keys->sessionKey)->not->toBe($keys->serverMacKey)
        ->and($keys->serverMacKey)->not->toBe($keys->clientMacKey);
});

it('follows the derivation chain of section 11.6 step by step', function (): void {
    $ikm = str_repeat("\x02", 96);
    $preamble = 'a-preamble';

    $prk = HkdfSha512::extract('', $ikm);
    $preambleHash = hash('sha512', $preamble, true);
    $handshakeSecret = ExpandLabel::deriveSecret($prk, 'HandshakeSecret', $preambleHash);

    $keys = AkeKeySchedule::deriveKeys($ikm, $preamble);

    expect($keys->sessionKey)->toBe(ExpandLabel::deriveSecret($prk, 'SessionKey', $preambleHash))
        ->and($keys->serverMacKey)->toBe(ExpandLabel::deriveSecret($handshakeSecret, 'ServerMAC', ''))
        ->and($keys->clientMacKey)->toBe(ExpandLabel::deriveSecret($handshakeSecret, 'ClientMAC', ''));
});

it('is deterministic and sensitive to both inputs', function (): void {
    $keys = AkeKeySchedule::deriveKeys(str_repeat("\x03", 96), 'p');

    expect(AkeKeySchedule::deriveKeys(str_repeat("\x03", 96), 'p')->sessionKey)->toBe($keys->sessionKey)
        ->and(AkeKeySchedule::deriveKeys(str_repeat("\x04", 96), 'p')->sessionKey)->not->toBe($keys->sessionKey)
        ->and(AkeKeySchedule::deriveKeys(str_repeat("\x03", 96), 'q')->sessionKey)->not->toBe($keys->sessionKey);
});

it('computes the server MAC over the hash of the preamble', function (): void {
    $key = str_repeat("\x05", 64);
    $preamble = 'transcript';

    expect(AkeKeySchedule::serverMac($key, $preamble))
        ->toBe(hash_hmac('sha512', hash('sha512', $preamble, true), $key, true))
        ->and(strlen(AkeKeySchedule::serverMac($key, $preamble)))->toBe(64);
});

it('computes the client MAC over the hash of preamble concatenated with the server MAC', function (): void {
    $key = str_repeat("\x06", 64);
    $preamble = 'transcript';
    $serverMac = str_repeat("\x07", 64);

    expect(AkeKeySchedule::clientMac($key, $preamble, $serverMac))
        ->toBe(hash_hmac('sha512', hash('sha512', $preamble.$serverMac, true), $key, true))
        ->and(AkeKeySchedule::clientMac($key, $preamble, $serverMac))
        ->not->toBe(AkeKeySchedule::serverMac($key, $preamble));
});

it('rejects a server MAC of the wrong length when computing the client MAC', function (int $length): void {
    AkeKeySchedule::clientMac(str_repeat("\x06", 64), 'p', str_repeat("\x07", $length));
})->with([0, 32, 63, 65])->throws(InvalidMessageException::class);

it('rejects derived keys of the wrong length', function (): void {
    new AkeKeys(str_repeat("\x01", 64), str_repeat("\x02", 63), str_repeat("\x03", 64));
})->throws(InvalidMessageException::class);
