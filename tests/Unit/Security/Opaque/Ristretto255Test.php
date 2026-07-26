<?php

declare(strict_types=1);

use App\Security\Opaque\InvalidMessageException;
use App\Security\Opaque\InvalidPointException;
use App\Security\Opaque\Ristretto255;

/**
 * Vector RFC 9807 Apéndice C.1.1 (suite ristretto255-SHA512): el escalar
 * privado estático del servidor y su clave pública.
 */
const R255_SERVER_PRIVATE_KEY_HEX = '47451a85372f8b3537e249d7b54188091fb18edde78094b43e2ba42b5eb89f0d';
const R255_SERVER_PUBLIC_KEY_HEX = 'b2fe7af9f48cc502d016729d2fe25cdd433f2c4bc904660b2a382c9b79df1a78';

/** Orden `L` del grupo primo ristretto255, little-endian (RFC 9496 §4). */
const R255_GROUP_ORDER_HEX = 'edd3f55c1a631258d69cf7a2def9de1400000000000000000000000000000010';

function r255Zeroes(int $length): string
{
    return str_repeat("\x00", $length);
}

function r255ServerPrivateKey(): string
{
    return hex2bin(R255_SERVER_PRIVATE_KEY_HEX);
}

function r255ValidPoint(): string
{
    return hex2bin(R255_SERVER_PUBLIC_KEY_HEX);
}

describe('validatePoint', function (): void {
    it('accepts a valid non-identity element', function (): void {
        expect(fn () => Ristretto255::validatePoint(r255ValidPoint()))->not->toThrow(InvalidPointException::class);
    });

    it('rejects the identity element even though libsodium considers it valid', function (): void {
        $identity = r255Zeroes(32);

        // Éste es exactamente el hueco que cubre el wrapper: libsodium acepta los ceros.
        expect(sodium_crypto_core_ristretto255_is_valid_point($identity))->toBeTrue();

        expect(fn () => Ristretto255::validatePoint($identity))
            ->toThrow(InvalidPointException::class, 'identity element');
    });

    it('rejects a non-canonical encoding (high bit set)', function (): void {
        $point = r255ValidPoint();
        $nonCanonical = substr($point, 0, 31).chr(ord($point[31]) | 0x80);

        expect(strlen($nonCanonical))->toBe(32);
        expect(fn () => Ristretto255::validatePoint($nonCanonical))->toThrow(InvalidPointException::class);
    });

    /**
     * Canonicidad completa, no solo el bit alto.
     *
     * Entre `p = 2^255 - 19` y `2^255` hay diecinueve valores con el bit alto a cero que tampoco son
     * codificaciones canónicas. Un chequeo que solo mire ese bit los deja pasar, y esta comprobación
     * existe para que no se pueda sustituir por uno más corto.
     *
     * No se delega en libsodium: `sodium_crypto_core_ristretto255_is_valid_point()` rechaza estas
     * entradas en unas versiones y las acepta en otras, y esta diferencia salió justamente al
     * ejecutar la suite en integración continua.
     */
    it('rejects non-canonical encodings without the high bit set', function (string $description, string $point): void {
        expect(strlen($point))->toBe(32)
            ->and(ord($point[31]) & 0x80)->toBe(0, "$description tiene el bit alto puesto");

        expect(fn () => Ristretto255::validatePoint($point))
            ->toThrow(InvalidPointException::class, 'canonical encoding');
    })->with([
        ['p exacto', "\xed".str_repeat("\xff", 30)."\x7f"],
        ['p + 1', "\xee".str_repeat("\xff", 30)."\x7f"],
        ['2^255 - 1', str_repeat("\xff", 31)."\x7f"],
    ]);

    it('rejects bytes that are not a group element', function (): void {
        expect(fn () => Ristretto255::validatePoint(str_repeat("\xff", 32)))
            ->toThrow(InvalidPointException::class);
    });

    it('rejects wrong lengths', function (int $length): void {
        expect(fn () => Ristretto255::validatePoint(str_repeat("\x01", $length)))
            ->toThrow(InvalidPointException::class, 'exactly 32 bytes');
    })->with([0, 1, 31, 33, 64]);
});

describe('validateScalar', function (): void {
    it('accepts a canonical non-zero scalar', function (): void {
        expect(fn () => Ristretto255::validateScalar(r255ServerPrivateKey()))->not->toThrow(InvalidPointException::class);
    });

    it('rejects the zero scalar', function (): void {
        expect(fn () => Ristretto255::validateScalar(r255Zeroes(32)))
            ->toThrow(InvalidPointException::class, 'is zero');
    });

    it('rejects a non-canonical scalar', function (string $hex): void {
        expect(fn () => Ristretto255::validateScalar(hex2bin($hex)))
            ->toThrow(InvalidPointException::class, 'not canonical');
    })->with([
        'group order L' => R255_GROUP_ORDER_HEX,
        'L + 1' => 'eed3f55c1a631258d69cf7a2def9de1400000000000000000000000000000010',
        'all ones' => 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
    ]);

    it('rejects wrong lengths', function (int $length): void {
        expect(fn () => Ristretto255::validateScalar(str_repeat("\x01", $length)))
            ->toThrow(InvalidPointException::class, 'exactly 32 bytes');
    })->with([0, 31, 33, 64]);
});

describe('scalarMultiplyBase', function (): void {
    it('derives the RFC 9807 C.1.1 server public key from its private scalar', function (): void {
        expect(bin2hex(Ristretto255::scalarMultiplyBase(r255ServerPrivateKey())))
            ->toBe(R255_SERVER_PUBLIC_KEY_HEX);
    });

    it('rejects the zero scalar', function (): void {
        expect(fn () => Ristretto255::scalarMultiplyBase(r255Zeroes(32)))
            ->toThrow(InvalidPointException::class);
    });

    it('rejects a non-canonical scalar that libsodium would silently accept', function (): void {
        $nonCanonical = str_repeat("\xff", 32);

        // libsodium no reduce la entrada: devuelve un punto sin protestar.
        expect(strlen(sodium_crypto_scalarmult_ristretto255_base($nonCanonical)))->toBe(32);

        expect(fn () => Ristretto255::scalarMultiplyBase($nonCanonical))
            ->toThrow(InvalidPointException::class, 'not canonical');
    });

    it('rejects wrong lengths', function (): void {
        expect(fn () => Ristretto255::scalarMultiplyBase(str_repeat("\x01", 31)))
            ->toThrow(InvalidPointException::class);
    });
});

describe('scalarMultiply', function (): void {
    it('is commutative, as the 3DH key agreement requires', function (): void {
        $a = Ristretto255::scalarReduce(str_repeat("\x11", 64));
        $b = Ristretto255::scalarReduce(str_repeat("\x22", 64));

        $left = Ristretto255::scalarMultiply($a, Ristretto255::scalarMultiplyBase($b));
        $right = Ristretto255::scalarMultiply($b, Ristretto255::scalarMultiplyBase($a));

        expect(bin2hex($left))->toBe(bin2hex($right));
    });

    it('rejects the identity element as input point', function (): void {
        expect(fn () => Ristretto255::scalarMultiply(r255ServerPrivateKey(), r255Zeroes(32)))
            ->toThrow(InvalidPointException::class, 'identity element');
    });

    it('rejects an invalid point', function (): void {
        expect(fn () => Ristretto255::scalarMultiply(r255ServerPrivateKey(), str_repeat("\xff", 32)))
            ->toThrow(InvalidPointException::class);
    });

    it('rejects an invalid scalar', function (): void {
        expect(fn () => Ristretto255::scalarMultiply(r255Zeroes(32), r255ValidPoint()))
            ->toThrow(InvalidPointException::class);
    });

    it('rejects wrong lengths on either argument', function (): void {
        expect(fn () => Ristretto255::scalarMultiply(str_repeat("\x01", 31), r255ValidPoint()))
            ->toThrow(InvalidPointException::class, 'exactly 32 bytes');

        expect(fn () => Ristretto255::scalarMultiply(r255ServerPrivateKey(), str_repeat("\x01", 33)))
            ->toThrow(InvalidPointException::class, 'exactly 32 bytes');
    });
});

describe('scalarReduce', function (): void {
    it('leaves a canonical scalar unchanged', function (): void {
        expect(bin2hex(Ristretto255::scalarReduce(r255ServerPrivateKey().r255Zeroes(32))))
            ->toBe(R255_SERVER_PRIVATE_KEY_HEX);
    });

    it('reduces the group order to zero', function (): void {
        expect(bin2hex(Ristretto255::scalarReduce(hex2bin(R255_GROUP_ORDER_HEX).r255Zeroes(32))))
            ->toBe(bin2hex(r255Zeroes(32)));
    });

    it('returns 32 bytes for uniform 64-byte input', function (): void {
        expect(strlen(Ristretto255::scalarReduce(str_repeat("\x5a", 64))))->toBe(32);
    });

    it('rejects input that is not 64 bytes', function (int $length): void {
        expect(fn () => Ristretto255::scalarReduce(str_repeat("\x01", $length)))
            ->toThrow(InvalidPointException::class, 'exactly 64 bytes');
    })->with([0, 32, 63, 65, 128]);
});

describe('scalarInvert', function (): void {
    it('undoes a scalar multiplication, as the OPRF unblinding does', function (): void {
        $blind = Ristretto255::scalarReduce(str_repeat("\x37", 64));
        $point = r255ValidPoint();

        $blinded = Ristretto255::scalarMultiply($blind, $point);
        $unblinded = Ristretto255::scalarMultiply(Ristretto255::scalarInvert($blind), $blinded);

        expect(bin2hex($unblinded))->toBe(bin2hex($point));
    });

    it('rejects the zero scalar', function (): void {
        expect(fn () => Ristretto255::scalarInvert(r255Zeroes(32)))
            ->toThrow(InvalidPointException::class, 'is zero');
    });

    it('rejects a non-canonical scalar', function (): void {
        expect(fn () => Ristretto255::scalarInvert(str_repeat("\xff", 32)))
            ->toThrow(InvalidPointException::class, 'not canonical');
    });

    it('rejects wrong lengths', function (): void {
        expect(fn () => Ristretto255::scalarInvert(str_repeat("\x01", 33)))
            ->toThrow(InvalidPointException::class, 'exactly 32 bytes');
    });
});

describe('pointFromHash', function (): void {
    it('maps uniform bytes to a valid non-identity element deterministically', function (): void {
        $uniform = str_repeat("\x01", 64);

        $point = Ristretto255::pointFromHash($uniform);

        expect(strlen($point))->toBe(32);
        expect(bin2hex(Ristretto255::pointFromHash($uniform)))->toBe(bin2hex($point));
        expect(fn () => Ristretto255::validatePoint($point))->not->toThrow(InvalidPointException::class);
    });

    it('rejects input that is not 64 bytes', function (int $length): void {
        expect(fn () => Ristretto255::pointFromHash(str_repeat("\x01", $length)))
            ->toThrow(InvalidPointException::class, 'exactly 64 bytes');
    })->with([0, 32, 63, 65]);
});

it('reports point and scalar rejections as invalid protocol messages', function (): void {
    expect(fn () => Ristretto255::validatePoint(r255Zeroes(32)))
        ->toThrow(InvalidMessageException::class);
});
