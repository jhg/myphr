<?php

declare(strict_types=1);

namespace App\Security\Opaque;

/**
 * RFC 9497 OPRF, `ristretto255-SHA512` suite, `modeOPRF = 0x00`
 * (`docs/OPAQUE.md` §8).
 *
 * It covers the server functions (`HashToScalar`, `DeriveKeyPair`,
 * `BlindEvaluate`) and, marked as such, the client ones (`HashToGroup`,
 * `Blind`, `Finalize`), which in production run inside `@serenity-kit/opaque`
 * but which we need here to check the official Appendix A.1.1 vectors and to
 * generate interoperability fixtures.
 *
 * Every input and output is a binary string. We use `strlen()` and
 * `substr()`, never `mb_*`.
 *
 * @see https://www.rfc-editor.org/rfc/rfc9497 RFC 9497
 * @see https://www.rfc-editor.org/rfc/rfc9807 RFC 9807
 */
final class Oprf
{
    /** `modeOPRF` from RFC 9497 §3.1. */
    public const int MODE_OPRF = 0x00;

    /** Suite identifier (RFC 9497 §4.1). */
    public const string SUITE_ID = 'ristretto255-SHA512';

    /** Length of a serialized element `Noe` (RFC 9497 §4.1). */
    public const int ELEMENT_BYTES = 32;

    /** Length of a serialized OPRF key `Nok` (`docs/OPAQUE.md` §2). */
    public const int KEY_BYTES = 32;

    /** Length of a seed `Nseed` (`docs/OPAQUE.md` §2). */
    public const int SEED_BYTES = 32;

    /** OPRF output length, `Nh` = SHA-512 output (RFC 9497 §4.1). */
    public const int OUTPUT_BYTES = 64;

    /** Uniform bytes consumed by `HashToGroup` and `HashToScalar` in this suite. */
    private const int UNIFORM_BYTES = 64;

    /** `DeriveKeyPair` `info` for the server OPRF key (RFC 9807 §5.2.2). */
    public const string OPRF_KEY_INFO = 'OPAQUE-DeriveKeyPair';

    /**
     * `DeriveKeyPair` `info` for the AKE Diffie-Hellman keys
     * (RFC 9807 §6.4.1.1).
     *
     * Do not confuse it with {@see OPRF_KEY_INFO}: they are two different
     * strings and swapping them produces keys incompatible with `opaque-ke`.
     */
    public const string DIFFIE_HELLMAN_KEY_INFO = 'OPAQUE-DeriveDiffieHellmanKeyPair';

    /** Suffix of the per-user Expand `info` (RFC 9807 §5.2.2). */
    private const string OPRF_KEY_LABEL = 'OprfKey';

    /** Limit of the `DeriveKeyPair` counter (RFC 9497 §3.2, step 4). */
    private const int MAX_DERIVE_KEY_PAIR_COUNTER = 255;

    private function __construct() {}

    /**
     * `contextString` from RFC 9497 §3.1:
     * `"OPRFV1-" || I2OSP(mode, 1) || "-" || identifier`.
     *
     * For `modeOPRF` and the `ristretto255-SHA512` suite it is 28 bytes:
     * `OPRFV1-\x00-ristretto255-SHA512`.
     *
     * @return string Binary string (it contains a 0x00 byte).
     */
    public static function contextString(): string
    {
        return 'OPRFV1-'.BinaryCodec::i2osp1(self::MODE_OPRF).'-'.self::SUITE_ID;
    }

    /**
     * `HashToGroup` DST: `"HashToGroup-" || contextString` (RFC 9497 §4.1).
     */
    public static function hashToGroupDomainSeparationTag(): string
    {
        return 'HashToGroup-'.self::contextString();
    }

    /**
     * `HashToScalar` DST: `"HashToScalar-" || contextString` (RFC 9497 §4.1).
     */
    public static function hashToScalarDomainSeparationTag(): string
    {
        return 'HashToScalar-'.self::contextString();
    }

    /**
     * `DeriveKeyPair` DST: `"DeriveKeyPair" || contextString`
     * (RFC 9497 §3.2, step 3).
     *
     * Note there is **no** separating dash here, unlike `HashToGroup-` and
     * `HashToScalar-`.
     */
    public static function deriveKeyPairDomainSeparationTag(): string
    {
        return 'DeriveKeyPair'.self::contextString();
    }

    /**
     * `HashToScalar(msg)` for ristretto255-SHA512 (RFC 9497 §4.1).
     *
     * ```
     * uniform_bytes = expand_message_xmd(msg, DST, 64)
     * scalar        = OS2IP(uniform_bytes) mod L        // little-endian
     * ```
     *
     * RFC 9497 §4.1 specifies for this suite that the 64 uniform bytes are
     * read as a **little-endian** integer before reducing modulo the prime
     * group order `L`.
     * `sodium_crypto_core_ristretto255_scalar_reduce()` reads its input exactly
     * that way, little-endian, so the mapping is direct: **nothing has to be
     * reversed or reordered**. This is written down because flipping the byte
     * order "to fix the endianness" would break every vector and
     * interoperability with `opaque-ke`.
     *
     * The DST is taken as an explicit parameter because `DeriveKeyPair` uses a
     * different one from the generic `HashToScalar`.
     *
     * @param  string  $message  msg, binary string of arbitrary length.
     * @param  string  $dst  Domain separation tag, non-empty binary string.
     * @return string Canonical 32-byte little-endian scalar; it may be zero.
     *
     * @throws InvalidPointException If the reduction fails in libsodium.
     */
    public static function hashToScalar(string $message, string $dst): string
    {
        $uniformBytes = ExpandMessageXmdSha512::expand($message, $dst, self::UNIFORM_BYTES);

        return Ristretto255::scalarReduce($uniformBytes);
    }

    /**
     * `HashToGroup(msg)` for ristretto255-SHA512 (RFC 9497 §4.1): a **client**
     * function, included for test vectors and interoperability
     * (`docs/OPAQUE.md` §8.1).
     *
     * ```
     * uniform_bytes = expand_message_xmd(msg, "HashToGroup-" || contextString, 64)
     * element       = hash_to_ristretto255(uniform_bytes)   // RFC 9380 §B / RFC 9496 §4.3.4
     * ```
     *
     * @param  string  $input  Binary string of arbitrary length.
     * @return string Serialized element of 32 bytes.
     *
     * @throws InvalidPointException If the mapping yields the neutral element.
     */
    public static function hashToGroup(string $input): string
    {
        $uniformBytes = ExpandMessageXmdSha512::expand(
            $input,
            self::hashToGroupDomainSeparationTag(),
            self::UNIFORM_BYTES
        );

        return Ristretto255::pointFromHash($uniformBytes);
    }

    /**
     * `DeriveKeyPair(seed, info)` from RFC 9497 §3.2.
     *
     * ```
     * deriveInput = seed || I2OSP(len(info), 2) || info
     * counter = 0
     * skS = 0
     * while skS == 0:
     *   if counter > 255: raise DeriveKeyPairError
     *   skS = HashToScalar(deriveInput || I2OSP(counter, 1),
     *                      DST = "DeriveKeyPair" || contextString)
     *   counter += 1
     * pkS = ScalarBaseMult(skS)
     * ```
     *
     * @param  string  $seed  Binary seed; the protocol uses `Nseed` = 32 bytes,
     *                        but RFC 9497 does not fix the length here.
     * @param  string  $info  Context string, 0 to 65535 bytes.
     * @return array{0: string, 1: string} `[skS, pkS]`, both 32 bytes.
     *
     * @throws InvalidConfigurationException If `$info` does not fit in a uint16.
     * @throws OpaqueException `DeriveKeyPairError`: 256 consecutive attempts have
     *                         produced the zero scalar (fatal internal failure).
     * @throws InvalidPointException If multiplying by the generator fails.
     */
    public static function deriveKeyPair(string $seed, string $info): array
    {
        $deriveInput = $seed.BinaryCodec::lengthPrefixed($info);
        $dst = self::deriveKeyPairDomainSeparationTag();

        for ($counter = 0; $counter <= self::MAX_DERIVE_KEY_PAIR_COUNTER; $counter++) {
            $privateKey = self::hashToScalar($deriveInput.BinaryCodec::i2osp1($counter), $dst);

            if (! hash_equals(BinaryCodec::zeroes(Ristretto255::SCALAR_BYTES), $privateKey)) {
                return [$privateKey, Ristretto255::scalarMultiplyBase($privateKey)];
            }
        }

        throw new OpaqueException('DeriveKeyPairError: no non-zero scalar found within 256 counter values.');
    }

    /**
     * `DeriveDiffieHellmanKeyPair(seed)` from RFC 9807 §6.4.1.1.
     *
     * It is `DeriveKeyPair(seed, "OPAQUE-DeriveDiffieHellmanKeyPair")`. It is
     * used for the AKE DH keys: the client static key derived from the
     * `envelope`, the ephemeral keys on both sides and the server static key.
     *
     * The **OPRF** key is not derived with this function but with
     * `DeriveKeyPair(seed, "OPAQUE-DeriveKeyPair")` (see
     * {@see deriveOprfKey()}). Swapping the two `info` strings produces keys
     * silently incompatible with `opaque-ke`.
     *
     * @param  string  $seed  Binary seed of `Nseed` = 32 bytes.
     * @return array{0: string, 1: string} `[skS, pkS]`, both 32 bytes.
     *
     * @throws OpaqueException If `DeriveKeyPair` exhausts the counter.
     */
    public static function deriveDiffieHellmanKeyPair(string $seed): array
    {
        return self::deriveKeyPair($seed, self::DIFFIE_HELLMAN_KEY_INFO);
    }

    /**
     * Derives a user's OPRF key from the server `oprf_seed`
     * (RFC 9807 §5.2.2 and §6.3.2.2; `docs/OPAQUE.md` §8.3).
     *
     * ```
     * seed = Expand(oprf_seed, concat(credential_identifier, "OprfKey"), Nok)
     * (oprf_key, _) = DeriveKeyPair(seed, "OPAQUE-DeriveKeyPair")
     * ```
     *
     * `HKDF-Expand` is called **directly on `oprf_seed`**, with no prior
     * `Extract`: the `oprf_seed` is already a 64-byte PRK.
     *
     * The RFC concatenates `credential_identifier || "OprfKey"` without a
     * length prefix, so the identifier must be fixed length across the whole
     * system (32 bytes per `docs/OPAQUE.md` §13.1); this function cannot check
     * that on its own and does not enforce it.
     *
     * @param  string  $oprfSeed  Server PRK, at least 64 bytes (`Nx`).
     * @param  string  $credentialIdentifier  Fixed-length binary identifier.
     * @return string 32-byte OPRF key (`Nok`).
     *
     * @throws InvalidConfigurationException If `$oprfSeed` is shorter than 64 bytes.
     * @throws OpaqueException If `DeriveKeyPair` exhausts the counter.
     */
    public static function deriveOprfKey(string $oprfSeed, string $credentialIdentifier): string
    {
        $seed = HkdfSha512::expand(
            $oprfSeed,
            $credentialIdentifier.self::OPRF_KEY_LABEL,
            self::KEY_BYTES
        );

        [$oprfKey] = self::deriveKeyPair($seed, self::OPRF_KEY_INFO);

        return $oprfKey;
    }

    /**
     * `BlindEvaluate(skS, blindedElement)` from RFC 9497 §3.3.1.
     *
     * ```
     * evaluatedElement = skS * blindedElement
     * ```
     *
     * The received element is validated before operating (length, canonical
     * encoding, group membership and rejection of the identity), exactly as
     * RFC 9807 §10.7 requires for any remote input.
     *
     * @param  string  $oprfKey  Canonical non-zero scalar, 32 bytes.
     * @param  string  $blindedElement  Element received from the client, 32 bytes.
     * @return string Serialized `evaluatedElement`, 32 bytes.
     *
     * @throws InvalidPointException If the key or the element do not validate, or
     *                               if the result is the identity.
     */
    public static function blindEvaluate(string $oprfKey, string $blindedElement): string
    {
        Ristretto255::validatePoint($blindedElement);

        return Ristretto255::scalarMultiply($oprfKey, $blindedElement);
    }

    /**
     * `Blind(input)` from RFC 9497 §3.3.1 with the given blinding scalar: a
     * **client** function, included for test vectors and interoperability
     * (`docs/OPAQUE.md` §8.1).
     *
     * The scalar is taken as a parameter instead of being generated here so we
     * can reproduce the official vectors; the real client draws it at random.
     *
     * ```
     * inputElement = HashToGroup(input)
     * if inputElement == Identity: raise InvalidInputError
     * blindedElement = blind * inputElement
     * ```
     *
     * @param  string  $input  Binary input (in OPAQUE, the password).
     * @param  string  $blind  Canonical non-zero scalar, 32 bytes.
     * @return string Serialized `blindedElement`, 32 bytes.
     *
     * @throws InvalidPointException If the scalar does not validate or if `HashToGroup`
     *                               returns the identity.
     */
    public static function blind(string $input, string $blind): string
    {
        return Ristretto255::scalarMultiply($blind, self::hashToGroup($input));
    }

    /**
     * `Finalize(input, blind, evaluatedElement)` from RFC 9497 §3.3.1: a
     * **client** function, included for test vectors and interoperability
     * (`docs/OPAQUE.md` §8.1).
     *
     * ```
     * N = blind^-1 * evaluatedElement
     * unblindedElement = SerializeElement(N)
     * return Hash(I2OSP(len(input), 2) || input ||
     *             I2OSP(len(unblindedElement), 2) || unblindedElement ||
     *             "Finalize")
     * ```
     *
     * @param  string  $input  The same input passed to `Blind`, 0 to 65535 bytes.
     * @param  string  $blind  The same blinding scalar, 32 bytes.
     * @param  string  $evaluatedElement  Element returned by the server, 32 bytes.
     * @return string OPRF output, 64 bytes.
     *
     * @throws InvalidPointException If the scalar or the element do not validate.
     * @throws InvalidConfigurationException If `$input` exceeds 65535 bytes.
     */
    public static function finalize(string $input, string $blind, string $evaluatedElement): string
    {
        Ristretto255::validatePoint($evaluatedElement);

        $unblindedElement = Ristretto255::scalarMultiply(
            Ristretto255::scalarInvert($blind),
            $evaluatedElement
        );

        return hash(
            'sha512',
            BinaryCodec::lengthPrefixed($input)
                .BinaryCodec::lengthPrefixed($unblindedElement)
                .'Finalize',
            true
        );
    }
}
