<?php

declare(strict_types=1);

use App\Security\Opaque\BinaryCodec;
use App\Security\Opaque\InvalidConfigurationException;
use App\Security\Opaque\InvalidMessageException;

it('concatenates binary fragments in order', function (): void {
    expect(BinaryCodec::concat("\x00\x01", "\xff", ''))->toBe("\x00\x01\xff")
        ->and(BinaryCodec::concat())->toBe('');
});

it('builds zero fills', function (): void {
    expect(BinaryCodec::zeroes(0))->toBe('')
        ->and(BinaryCodec::zeroes(64))->toBe(str_repeat("\0", 64))
        ->and(strlen(BinaryCodec::zeroes(128)))->toBe(128);
});

it('rejects a negative zero fill length', function (): void {
    BinaryCodec::zeroes(-1);
})->throws(InvalidConfigurationException::class);

it('encodes uint8 with I2OSP', function (int $value, string $expected): void {
    expect(BinaryCodec::i2osp1($value))->toBe($expected)
        ->and(strlen(BinaryCodec::i2osp1($value)))->toBe(1);
})->with([
    [0, "\x00"],
    [1, "\x01"],
    [127, "\x7f"],
    [255, "\xff"],
]);

it('rejects uint8 values out of range', function (int $value): void {
    BinaryCodec::i2osp1($value);
})->with([-1, 256, 65536])->throws(InvalidConfigurationException::class);

it('encodes uint16 as big endian with I2OSP', function (int $value, string $expected): void {
    expect(BinaryCodec::i2osp2($value))->toBe($expected)
        ->and(strlen(BinaryCodec::i2osp2($value)))->toBe(2);
})->with([
    [0, "\x00\x00"],
    [1, "\x00\x01"],
    [255, "\x00\xff"],
    [256, "\x01\x00"],
    [513, "\x02\x01"],
    [65535, "\xff\xff"],
]);

it('rejects uint16 values out of range', function (int $value): void {
    BinaryCodec::i2osp2($value);
})->with([-1, 65536])->throws(InvalidConfigurationException::class);

it('prefixes variable length vectors with a big endian uint16', function (): void {
    expect(BinaryCodec::lengthPrefixed(''))->toBe("\x00\x00")
        ->and(BinaryCodec::lengthPrefixed('abc'))->toBe("\x00\x03abc")
        ->and(BinaryCodec::lengthPrefixed(str_repeat('x', 300)))->toStartWith("\x01\x2c");
});

it('rejects a length prefixed vector longer than 65535 bytes', function (): void {
    BinaryCodec::lengthPrefixed(str_repeat('x', 65536));
})->throws(InvalidConfigurationException::class);

it('slices a KE1 message at the documented offsets', function (): void {
    $blindedMessage = random_bytes(32);
    $clientNonce = random_bytes(32);
    $clientPublicKeyshare = random_bytes(32);
    $ke1 = BinaryCodec::concat($blindedMessage, $clientNonce, $clientPublicKeyshare);

    BinaryCodec::ensureLength($ke1, 96, 'ke1');

    expect(BinaryCodec::slice($ke1, 0, 32, 'blinded_message'))->toBe($blindedMessage)
        ->and(BinaryCodec::slice($ke1, 32, 32, 'client_nonce'))->toBe($clientNonce)
        ->and(BinaryCodec::slice($ke1, 64, 32, 'client_public_keyshare'))->toBe($clientPublicKeyshare);
});

it('rejects a slice that runs past the end of the data', function (): void {
    expect(fn (): string => BinaryCodec::slice(random_bytes(95), 64, 32, 'client_public_keyshare'))
        ->toThrow(InvalidMessageException::class, 'client_public_keyshare is truncated');
});

it('rejects a slice with negative bounds', function (int $offset, int $length): void {
    BinaryCodec::slice(random_bytes(96), $offset, $length);
})->with([
    [-1, 32],
    [0, -32],
])->throws(InvalidConfigurationException::class);

it('allows a zero length slice at the very end', function (): void {
    expect(BinaryCodec::slice('abc', 3, 0))->toBe('');
});

it('enforces exact lengths', function (): void {
    BinaryCodec::ensureLength(random_bytes(64), 64, 'ke3');

    expect(fn () => BinaryCodec::ensureLength(random_bytes(63), 64, 'ke3'))
        ->toThrow(InvalidMessageException::class, 'Field ke3 must be 64 bytes, got 63.');

    expect(fn () => BinaryCodec::ensureLength(random_bytes(65), 64, 'ke3'))
        ->toThrow(InvalidMessageException::class, 'Field ke3 must be 64 bytes, got 65.');
});

it('xors byte strings of equal length', function (): void {
    expect(BinaryCodec::xorStrings("\x00\xff\x0f", "\xff\xff\xf0"))->toBe("\xff\x00\xff")
        ->and(BinaryCodec::xorStrings('', ''))->toBe('');

    $pad = random_bytes(128);
    $plaintext = random_bytes(128);

    expect(BinaryCodec::xorStrings(BinaryCodec::xorStrings($plaintext, $pad), $pad))->toBe($plaintext);
});

it('rejects xor operands of different lengths', function (): void {
    BinaryCodec::xorStrings(random_bytes(128), random_bytes(127));
})->throws(InvalidMessageException::class);

it('compares byte strings in constant time', function (): void {
    $mac = random_bytes(64);

    expect(BinaryCodec::constantTimeEquals($mac, $mac))->toBeTrue()
        ->and(BinaryCodec::constantTimeEquals($mac, substr($mac, 0, 63)))->toBeFalse()
        ->and(BinaryCodec::constantTimeEquals($mac, $mac."\x00"))->toBeFalse()
        ->and(BinaryCodec::constantTimeEquals('', ''))->toBeTrue();

    $tampered = $mac;
    $tampered[0] = chr(ord($mac[0]) ^ 0x01);

    expect(BinaryCodec::constantTimeEquals($mac, $tampered))->toBeFalse();
});
