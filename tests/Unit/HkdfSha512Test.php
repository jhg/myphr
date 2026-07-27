<?php

declare(strict_types=1);

use App\Security\Opaque\HkdfSha512;
use App\Security\Opaque\InvalidConfigurationException;
use App\Security\Opaque\OpaqueException;

/**
 * RFC 5869 only publishes HKDF-SHA-256 and HKDF-SHA-1 vectors, so the official
 * HKDF-SHA-512 vectors come from the Wycheproof project (C2SP), file
 * `testvectors_v1/hkdf_sha512_test.json`:
 * https://github.com/C2SP/wycheproof/blob/main/testvectors_v1/hkdf_sha512_test.json
 *
 * They are complemented with a cross-check against PHP's `hash_hkdf()`, which
 * implements RFC 5869 in the `hash` extension.
 */

/**
 * @return list<array{tcId: int, result: string, comment: string, ikm: string, salt: string, info: string, size: int, okm: string}>
 */
function wycheproofHkdfSha512Vectors(): array
{
    return require __DIR__.'/fixtures/hkdf_sha512_wycheproof.php';
}

/**
 * @return iterable<string, array{array{tcId: int, result: string, comment: string, ikm: string, salt: string, info: string, size: int, okm: string}}>
 */
dataset('wycheproof hkdf-sha512 valid', function (): iterable {
    foreach (wycheproofHkdfSha512Vectors() as $vector) {
        if ($vector['result'] !== 'valid') {
            continue;
        }

        yield 'tcId '.$vector['tcId'].($vector['comment'] === '' ? '' : ' ('.$vector['comment'].')') => [$vector];
    }
});

/**
 * @return iterable<string, array{array{tcId: int, result: string, comment: string, ikm: string, salt: string, info: string, size: int, okm: string}}>
 */
dataset('wycheproof hkdf-sha512 invalid', function (): iterable {
    foreach (wycheproofHkdfSha512Vectors() as $vector) {
        if ($vector['result'] === 'valid') {
            continue;
        }

        yield 'tcId '.$vector['tcId'].' ('.$vector['comment'].')' => [$vector];
    }
});

it('carga los 83 vectores de Wycheproof', function (): void {
    expect(wycheproofHkdfSha512Vectors())->toHaveCount(83);
});

it('reproduces the valid Wycheproof vectors', function (array $vector): void {
    $prk = HkdfSha512::extract(
        hex2bin($vector['salt']),
        hex2bin($vector['ikm']),
    );

    expect(strlen($prk))->toBe(HkdfSha512::HASH_LENGTH);

    $okm = HkdfSha512::expand($prk, hex2bin($vector['info']), $vector['size']);

    expect(strlen($okm))->toBe($vector['size']);
    expect(bin2hex($okm))->toBe($vector['okm']);
})->with('wycheproof hkdf-sha512 valid');

it('rejects the Wycheproof vectors with an excessive output size', function (array $vector): void {
    expect($vector['size'])->toBeGreaterThan(HkdfSha512::MAX_OUTPUT_LENGTH);

    $prk = HkdfSha512::extract(hex2bin($vector['salt']), hex2bin($vector['ikm']));

    expect(fn (): string => HkdfSha512::expand($prk, hex2bin($vector['info']), $vector['size']))
        ->toThrow(InvalidArgumentException::class);
})->with('wycheproof hkdf-sha512 invalid');

it('treats an empty salt as 64 zero bytes, per RFC 5869 §2.2', function (): void {
    $ikm = random_bytes(32);

    expect(HkdfSha512::extract('', $ikm))
        ->toBe(HkdfSha512::extract(str_repeat("\x00", 64), $ikm));
});

it('defines Extract as HMAC-SHA-512 with the salt as key, per RFC 5869 §2.2', function (): void {
    $salt = random_bytes(37);
    $ikm = random_bytes(91);

    expect(HkdfSha512::extract($salt, $ikm))
        ->toBe(hash_hmac('sha512', $ikm, $salt, true));
});

it('coincide con hash_hkdf() de PHP en longitudes y contextos variados', function (): void {
    // Cross-check, not an official vector: `hash_hkdf()` implements RFC 5869.
    foreach ([1, 31, 64, 65, 128, 200, 1024, 4096] as $length) {
        $ikm = random_bytes(32);
        $salt = $length % 2 === 0 ? random_bytes(64) : '';
        $info = $length % 3 === 0 ? '' : random_bytes(17);

        $prk = HkdfSha512::extract($salt, $ikm);

        expect(HkdfSha512::expand($prk, $info, $length))
            ->toBe(hash_hkdf('sha512', $ikm, $length, $info, $salt));
    }
});

it('produces outputs that are prefixes of one another as the length grows', function (): void {
    $prk = HkdfSha512::extract(random_bytes(64), random_bytes(32));
    $info = random_bytes(11);

    $long = HkdfSha512::expand($prk, $info, 320);

    foreach ([1, 63, 64, 65, 192] as $length) {
        expect(HkdfSha512::expand($prk, $info, $length))->toBe(substr($long, 0, $length));
    }
});

it('emits exactly the maximum allowed length', function (): void {
    $prk = HkdfSha512::extract('', random_bytes(32));

    expect(strlen(HkdfSha512::expand($prk, '', HkdfSha512::MAX_OUTPUT_LENGTH)))
        ->toBe(255 * 64);
});

it('rechaza longitudes fuera de rango', function (int $length): void {
    $prk = HkdfSha512::extract('', random_bytes(32));

    expect(fn (): string => HkdfSha512::expand($prk, '', $length))
        ->toThrow(InvalidArgumentException::class);
})->with([0, -1, 255 * 64 + 1, PHP_INT_MAX]);

/**
 * `docs/OPAQUE.md` §18: the subsystem has a single error hierarchy. A short PRK can only come from
 * misconfigured static material, so it is signalled with {@see InvalidConfigurationException} and
 * not with a loose SPL exception the HTTP layer would not know how to collapse.
 */
it('rejects a PRK shorter than HashLen with an exception from the OPAQUE hierarchy', function (): void {
    expect(fn (): string => HkdfSha512::expand(str_repeat("\x01", 63), '', 32))
        ->toThrow(InvalidConfigurationException::class);

    expect(fn (): string => HkdfSha512::expand(str_repeat("\x01", 63), '', 32))
        ->toThrow(OpaqueException::class);
});

it('chains blocks with a one-byte counter, per RFC 5869 §2.3', function (): void {
    $prk = HkdfSha512::extract(random_bytes(64), random_bytes(32));
    $info = random_bytes(9);

    $expected = '';
    $previous = '';

    for ($counter = 1; $counter <= 3; $counter++) {
        $previous = hash_hmac('sha512', $previous.$info.chr($counter), $prk, true);
        $expected .= $previous;
    }

    expect(HkdfSha512::expand($prk, $info, 192))->toBe($expected);
});
