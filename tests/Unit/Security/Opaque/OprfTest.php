<?php

declare(strict_types=1);

use App\Security\Opaque\ExpandMessageXmdSha512;
use App\Security\Opaque\HkdfSha512;
use App\Security\Opaque\InvalidPointException;
use App\Security\Opaque\Oprf;
use App\Security\Opaque\Ristretto255;

/**
 * Vectores oficiales de RFC 9497, Apéndice A.1.1 «ristretto255-SHA512 /
 * OPRF Mode» (`modeOPRF = 0x00`).
 * Fuente: https://www.rfc-editor.org/rfc/rfc9497.txt
 *
 * Los valores del RFC aparecen partidos en varias líneas por el formato del
 * documento; aquí se reproducen concatenados, sin espacios.
 */

/** Seed del Apéndice A.1.1: 32 bytes 0xa3. */
const RFC9497_A11_SEED_HEX = 'a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3';

/** KeyInfo del Apéndice A.1.1: ASCII "test key". */
const RFC9497_A11_KEY_INFO_HEX = '74657374206b6579';

/** skSm del Apéndice A.1.1 (clave OPRF del servidor, serializada). */
const RFC9497_A11_SKSM_HEX = '5ebcea5ee37023ccb9fc2d2019f9d7737be85591ae8652ffa9ef0f4d37063b0e';

/**
 * Los dos vectores de batch size 1 del Apéndice A.1.1.
 *
 * @var array<string, array{0: array{input: string, blind: string, blindedElement: string, evaluationElement: string, output: string}}>
 */
const RFC9497_A11_VECTORS = [
    'A.1.1.1 Test Vector 1' => [[
        'input' => '00',
        'blind' => '64d37aed22a27f5191de1c1d69fadb899d8862b58eb4220029e036ec4c1f6706',
        'blindedElement' => '609a0ae68c15a3cf6903766461307e5c8bb2f95e7e6550e1ffa2dc99e412803c',
        'evaluationElement' => '7ec6578ae5120958eb2db1745758ff379e77cb64fe77b0b2d8cc917ea0869c7e',
        'output' => '527759c3d9366f277d8c6020418d96bb393ba2afb20ff90df23fb7708264e2f3'
            .'ab9135e3bd69955851de4b1f9fe8a0973396719b7912ba9ee8aa7d0b5e24bcf6',
    ]],
    'A.1.1.2 Test Vector 2' => [[
        'input' => '5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a',
        'blind' => '64d37aed22a27f5191de1c1d69fadb899d8862b58eb4220029e036ec4c1f6706',
        'blindedElement' => 'da27ef466870f5f15296299850aa088629945a17d1f5b7f5ff043f76b3c06418',
        'evaluationElement' => 'b4cbf5a4f1eeda5a63ce7b77c7d23f461db3fcab0dd28e4e17cecb5c90d02c25',
        'output' => 'f4a74c9c592497375e796aa837e907b1a045d34306a749db9f34221f7e750cb4'
            .'f2a6413a6bf6fa5e19ba6348eb673934a722a7ede2e7621306d18951e7cf2c73',
    ]],
];

function oprfBin(string $hex): string
{
    return hex2bin($hex);
}

function oprfServerKey(): string
{
    return oprfBin(RFC9497_A11_SKSM_HEX);
}

describe('contextString', function (): void {
    it('builds the exact RFC 9497 §3.1 context string for modeOPRF', function (): void {
        expect(Oprf::contextString())->toBe("OPRFV1-\x00-ristretto255-SHA512");
        expect(strlen(Oprf::contextString()))->toBe(28);
    });

    it('derives the domain separation tags of RFC 9497 §3.2 and §4.1', function (): void {
        expect(Oprf::hashToGroupDomainSeparationTag())
            ->toBe("HashToGroup-OPRFV1-\x00-ristretto255-SHA512");
        expect(Oprf::hashToScalarDomainSeparationTag())
            ->toBe("HashToScalar-OPRFV1-\x00-ristretto255-SHA512");

        // DeriveKeyPair no lleva guion separador (RFC 9497 §3.2, paso 3).
        expect(Oprf::deriveKeyPairDomainSeparationTag())
            ->toBe("DeriveKeyPairOPRFV1-\x00-ristretto255-SHA512");
    });
});

describe('DeriveKeyPair', function (): void {
    it('reproduces skSm from the RFC 9497 A.1.1 seed and key info', function (): void {
        [$privateKey, $publicKey] = Oprf::deriveKeyPair(
            oprfBin(RFC9497_A11_SEED_HEX),
            oprfBin(RFC9497_A11_KEY_INFO_HEX)
        );

        expect(bin2hex($privateKey))->toBe(RFC9497_A11_SKSM_HEX);
        expect(strlen($privateKey))->toBe(32);
        expect(strlen($publicKey))->toBe(32);
    });

    it('returns the public key matching the private scalar', function (): void {
        [$privateKey, $publicKey] = Oprf::deriveKeyPair(
            oprfBin(RFC9497_A11_SEED_HEX),
            oprfBin(RFC9497_A11_KEY_INFO_HEX)
        );

        expect($publicKey)->toBe(Ristretto255::scalarMultiplyBase($privateKey));
    });

    it('is deterministic and separates seeds and info strings', function (): void {
        $seed = str_repeat("\x11", 32);

        [$a] = Oprf::deriveKeyPair($seed, 'info');
        [$b] = Oprf::deriveKeyPair($seed, 'info');
        [$c] = Oprf::deriveKeyPair($seed, 'inf');
        [$d] = Oprf::deriveKeyPair(str_repeat("\x12", 32), 'info');

        expect($a)->toBe($b)
            ->and($a)->not->toBe($c)
            ->and($a)->not->toBe($d);
    });

    it('length-prefixes info so that boundary shifts change the key', function (): void {
        $seed = str_repeat("\x11", 32);

        [$a] = Oprf::deriveKeyPair($seed, 'ab');
        [$b] = Oprf::deriveKeyPair($seed.'a', 'b');

        expect($a)->not->toBe($b);
    });
});

describe('DeriveDiffieHellmanKeyPair', function (): void {
    it('uses the OPAQUE-DeriveDiffieHellmanKeyPair info string', function (): void {
        $seed = str_repeat("\x2a", 32);

        expect(Oprf::deriveDiffieHellmanKeyPair($seed))
            ->toBe(Oprf::deriveKeyPair($seed, 'OPAQUE-DeriveDiffieHellmanKeyPair'));
    });

    it('never coincides with the OPRF key derivation for the same seed', function (): void {
        $seed = str_repeat("\x2a", 32);

        [$dhPrivateKey] = Oprf::deriveDiffieHellmanKeyPair($seed);
        [$oprfPrivateKey] = Oprf::deriveKeyPair($seed, 'OPAQUE-DeriveKeyPair');

        expect($dhPrivateKey)->not->toBe($oprfPrivateKey);
    });

    it('exposes the two info strings as distinct constants', function (): void {
        expect(Oprf::OPRF_KEY_INFO)->toBe('OPAQUE-DeriveKeyPair')
            ->and(Oprf::DIFFIE_HELLMAN_KEY_INFO)->toBe('OPAQUE-DeriveDiffieHellmanKeyPair');
    });
});

describe('deriveOprfKey', function (): void {
    it('expands the oprf_seed directly, without a previous Extract', function (): void {
        $oprfSeed = str_repeat("\x07", 64);
        $credentialIdentifier = str_repeat("\x5b", 32);

        $seed = HkdfSha512::expand($oprfSeed, $credentialIdentifier.'OprfKey', 32);
        [$expected] = Oprf::deriveKeyPair($seed, 'OPAQUE-DeriveKeyPair');

        expect(Oprf::deriveOprfKey($oprfSeed, $credentialIdentifier))->toBe($expected);
        expect(strlen($expected))->toBe(32);
    });

    it('yields a usable, distinct key per credential identifier', function (): void {
        $oprfSeed = str_repeat("\x07", 64);

        $first = Oprf::deriveOprfKey($oprfSeed, str_repeat("\x01", 32));
        $second = Oprf::deriveOprfKey($oprfSeed, str_repeat("\x02", 32));

        expect($first)->not->toBe($second);
        expect(fn () => Ristretto255::validateScalar($first))->not->toThrow(InvalidPointException::class);
    });
});

describe('hashToScalar', function (): void {
    it('reduces the 64 uniform bytes little-endian, as sodium already does', function (): void {
        $message = 'hash-to-scalar';
        $dst = Oprf::hashToScalarDomainSeparationTag();

        $uniformBytes = ExpandMessageXmdSha512::expand($message, $dst, 64);

        expect(Oprf::hashToScalar($message, $dst))
            ->toBe(sodium_crypto_core_ristretto255_scalar_reduce($uniformBytes));
    });

    it('honours the explicit DST parameter', function (): void {
        expect(Oprf::hashToScalar('msg', 'DST-A'))->not->toBe(Oprf::hashToScalar('msg', 'DST-B'));
    });
});

describe('RFC 9497 A.1.1 end to end', function (): void {
    it('reproduces BlindedElement from Blind', function (array $vector): void {
        expect(bin2hex(Oprf::blind(oprfBin($vector['input']), oprfBin($vector['blind']))))
            ->toBe($vector['blindedElement']);
    })->with(RFC9497_A11_VECTORS);

    it('reproduces EvaluationElement from BlindEvaluate', function (array $vector): void {
        expect(bin2hex(Oprf::blindEvaluate(oprfServerKey(), oprfBin($vector['blindedElement']))))
            ->toBe($vector['evaluationElement']);
    })->with(RFC9497_A11_VECTORS);

    it('reproduces Output from Finalize', function (array $vector): void {
        expect(bin2hex(Oprf::finalize(
            oprfBin($vector['input']),
            oprfBin($vector['blind']),
            oprfBin($vector['evaluationElement'])
        )))->toBe($vector['output']);
    })->with(RFC9497_A11_VECTORS);

    it('runs the full Blind -> BlindEvaluate -> Finalize chain', function (array $vector): void {
        $input = oprfBin($vector['input']);
        $blind = oprfBin($vector['blind']);

        [$oprfKey] = Oprf::deriveKeyPair(
            oprfBin(RFC9497_A11_SEED_HEX),
            oprfBin(RFC9497_A11_KEY_INFO_HEX)
        );

        $blindedElement = Oprf::blind($input, $blind);
        $evaluationElement = Oprf::blindEvaluate($oprfKey, $blindedElement);
        $output = Oprf::finalize($input, $blind, $evaluationElement);

        expect(bin2hex($blindedElement))->toBe($vector['blindedElement'])
            ->and(bin2hex($evaluationElement))->toBe($vector['evaluationElement'])
            ->and(bin2hex($output))->toBe($vector['output']);
    })->with(RFC9497_A11_VECTORS);

    it('serializes elements and outputs with the sizes of the suite', function (array $vector): void {
        expect(strlen(oprfBin($vector['blindedElement'])))->toBe(Oprf::ELEMENT_BYTES)
            ->and(strlen(oprfBin($vector['evaluationElement'])))->toBe(Oprf::ELEMENT_BYTES)
            ->and(strlen(oprfBin($vector['output'])))->toBe(Oprf::OUTPUT_BYTES);
    })->with(RFC9497_A11_VECTORS);
});

describe('BlindEvaluate input validation', function (): void {
    it('rejects the identity element before operating', function (): void {
        expect(fn () => Oprf::blindEvaluate(oprfServerKey(), str_repeat("\x00", 32)))
            ->toThrow(InvalidPointException::class);
    });

    it('rejects an element of the wrong length', function (): void {
        expect(fn () => Oprf::blindEvaluate(oprfServerKey(), str_repeat("\x01", 31)))
            ->toThrow(InvalidPointException::class, '32 bytes');
    });

    it('rejects bytes that are not a group element', function (): void {
        expect(fn () => Oprf::blindEvaluate(oprfServerKey(), str_repeat("\xff", 32)))
            ->toThrow(InvalidPointException::class);
    });

    it('rejects a zero OPRF key', function (): void {
        $blindedElement = Oprf::blind('x', oprfServerKey());

        expect(fn () => Oprf::blindEvaluate(str_repeat("\x00", 32), $blindedElement))
            ->toThrow(InvalidPointException::class);
    });
});

describe('Finalize input validation', function (): void {
    it('rejects an evaluated element that is not a valid point', function (): void {
        expect(fn () => Oprf::finalize('x', oprfServerKey(), str_repeat("\xff", 32)))
            ->toThrow(InvalidPointException::class);
    });

    it('rejects a zero blind', function (): void {
        $vector = RFC9497_A11_VECTORS['A.1.1.1 Test Vector 1'][0];

        expect(fn () => Oprf::finalize('x', str_repeat("\x00", 32), oprfBin($vector['evaluationElement'])))
            ->toThrow(InvalidPointException::class);
    });
});
