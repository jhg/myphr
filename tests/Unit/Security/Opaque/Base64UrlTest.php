<?php

declare(strict_types=1);

use App\Security\Opaque\Base64Url;
use App\Security\Opaque\InvalidMessageException;

/**
 * Alfabeto base64url (RFC 4648 §5) en orden de índice.
 */
const B64URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/**
 * Devuelve una variante NO canónica de `$encoded`: la misma cadena con el
 * último carácter sustituido por otro que decodifica a los mismos bytes
 * porque sólo difiere en los bits sobrantes.
 */
function nonCanonicalVariant(string $encoded, int $unusedBits): string
{
    $lastIndex = strlen($encoded) - 1;
    $value = strpos(B64URL_ALPHABET, $encoded[$lastIndex]);

    expect($value)->toBeInt();

    /** @var int $value */
    $variant = $value ^ (1 << ($unusedBits - 1));

    return substr($encoded, 0, $lastIndex).B64URL_ALPHABET[$variant];
}

it('encodes without padding and only with the url-safe alphabet', function (): void {
    $binary = "\xff\xfe\xfd\xfc\xfb\xfa";

    $encoded = Base64Url::encode($binary);

    expect($encoded)->toBe('__79_Pv6')
        ->and($encoded)->not->toContain('=')
        ->and($encoded)->not->toContain('+')
        ->and($encoded)->not->toContain('/');
});

it('round-trips every length from 0 to 512 bytes', function (): void {
    foreach (range(0, 512) as $length) {
        $binary = $length === 0 ? '' : random_bytes($length);

        expect(Base64Url::decode(Base64Url::encode($binary)))->toBe($binary);
    }
});

it('round-trips the exact message sizes of the profile', function (int $bytes, int $characters): void {
    $binary = random_bytes($bytes);
    $encoded = Base64Url::encode($binary);

    expect(strlen($encoded))->toBe($characters)
        ->and(Base64Url::decodeExactly($encoded, $bytes))->toBe($binary);
})->with([
    'RegistrationRequest' => [32, 43],
    'RegistrationResponse' => [64, 86],
    'RegistrationRecord' => [192, 256],
    'KE1' => [96, 128],
    'KE2' => [320, 427],
    'KE3' => [64, 86],
    'ServerLoginState' => [128, 171],
]);

it('rejects padding', function (string $padded): void {
    Base64Url::decode($padded);
})->with([
    'one pad character' => ['QUJD1A=='],
    'two pad characters' => ['QUJDRA=='],
    'trailing pad on a 32 byte message' => [Base64Url::encode(str_repeat("\x01", 32)).'='],
])->throws(InvalidMessageException::class);

it('rejects the standard base64 alphabet', function (string $standard): void {
    Base64Url::decode($standard);
})->with([
    'plus' => ['++79'],
    'slash' => ['//79'],
    'standard encoding of 0xfffefd' => [base64_encode("\xff\xfe\xfd")],
])->throws(InvalidMessageException::class);

it('rejects whitespace and control characters', function (string $input): void {
    Base64Url::decode($input);
})->with([
    'leading space' => [' QUJD'],
    'trailing space' => ['QUJD '],
    'inner space' => ['QU JD'],
    'newline' => ["QUJD\n"],
    'carriage return' => ["QUJD\r"],
    'tab' => ["QUJD\t"],
    'null byte' => ["QUJD\0"],
])->throws(InvalidMessageException::class);

it('rejects lengths that are impossible in base64', function (string $input): void {
    Base64Url::decode($input);
})->with([
    'one character' => ['A'],
    'five characters' => ['QUJDR'],
    'forty-one characters' => [str_repeat('A', 41)],
])->throws(InvalidMessageException::class);

it('rejects other alphabets entirely', function (string $input): void {
    Base64Url::decode($input);
})->with([
    'dot' => ['QU.D'],
    'percent encoded' => ['QU%3D'],
    'accented letter' => ['QUJÑ'],
    'emoji' => ['QUJ🙂'],
])->throws(InvalidMessageException::class);

/**
 * El caso importante de §20.6: dos cadenas distintas que decodifican a los
 * mismos bytes. Sólo la canónica se acepta.
 */
it('accepts only the canonical spelling when two strings decode to the same bytes', function (): void {
    $canonical = 'QQ';       // 0x41, bits sobrantes a cero
    $nonCanonical = 'QR';    // mismos bytes, bits sobrantes a uno

    expect(base64_decode($canonical, true))->toBe(base64_decode($nonCanonical, true))
        ->and(base64_decode($canonical, true))->toBe('A')
        ->and($canonical)->not->toBe($nonCanonical);

    expect(Base64Url::decode($canonical))->toBe('A');

    expect(fn (): string => Base64Url::decode($nonCanonical))
        ->toThrow(InvalidMessageException::class);
});

it('rejects every non-canonical variant of a one byte value', function (): void {
    $canonical = Base64Url::encode("\x41");
    $accepted = 0;

    foreach (str_split(B64URL_ALPHABET) as $lastCharacter) {
        $candidate = $canonical[0].$lastCharacter;

        if (base64_decode(strtr($candidate, '-_', '+/'), true) !== "\x41") {
            continue;
        }

        try {
            Base64Url::decode($candidate);
            $accepted++;

            expect($candidate)->toBe($canonical);
        } catch (InvalidMessageException) {
            expect($candidate)->not->toBe($canonical);
        }
    }

    expect($accepted)->toBe(1);
});

it('rejects leftover bits in the last character of a 32 byte message', function (): void {
    $binary = random_bytes(32);
    $canonical = Base64Url::encode($binary);

    // 43 caracteres * 6 bits = 258 bits para 256 bits de datos: 2 bits sobrantes.
    $nonCanonical = nonCanonicalVariant($canonical, unusedBits: 2);

    expect(base64_decode(strtr($nonCanonical, '-_', '+/'), true))->toBe($binary)
        ->and($nonCanonical)->not->toBe($canonical);

    expect(Base64Url::decode($canonical))->toBe($binary);
    expect(fn (): string => Base64Url::decode($nonCanonical))
        ->toThrow(InvalidMessageException::class);
});

it('rejects leftover bits in the last character of a 64 byte message', function (): void {
    $binary = random_bytes(64);
    $canonical = Base64Url::encode($binary);

    // 86 caracteres * 6 bits = 516 bits para 512 bits de datos: 4 bits sobrantes.
    $nonCanonical = nonCanonicalVariant($canonical, unusedBits: 4);

    expect(base64_decode(strtr($nonCanonical, '-_', '+/'), true))->toBe($binary);

    expect(fn (): string => Base64Url::decode($nonCanonical))
        ->toThrow(InvalidMessageException::class);
});

it('accepts the empty string as the encoding of no bytes', function (): void {
    expect(Base64Url::encode(''))->toBe('')
        ->and(Base64Url::decode(''))->toBe('');
});

it('rejects a truncated message before touching cryptography', function (): void {
    $encoded = Base64Url::encode(random_bytes(31));

    expect(fn (): string => Base64Url::decodeExactly($encoded, 32, 'blinded_message'))
        ->toThrow(InvalidMessageException::class, 'must be 32 bytes, got 31');
});

it('rejects extra bytes beyond the expected message size', function (): void {
    $encoded = Base64Url::encode(random_bytes(33));

    expect(fn (): string => Base64Url::decodeExactly($encoded, 32, 'blinded_message'))
        ->toThrow(InvalidMessageException::class, 'must be 32 bytes, got 33');
});

it('never throws anything but a protocol exception on arbitrary input', function (): void {
    foreach (range(1, 400) as $ignored) {
        $length = random_int(0, 512);
        $input = $length === 0 ? '' : random_bytes($length);

        try {
            $decoded = Base64Url::decode($input);
            expect(Base64Url::encode($decoded))->toBe($input);
        } catch (InvalidMessageException) {
            // Único resultado aceptable para una entrada que no es canónica.
        }
    }

    expect(true)->toBeTrue();
});
