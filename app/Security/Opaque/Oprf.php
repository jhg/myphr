<?php

declare(strict_types=1);

namespace App\Security\Opaque;

/**
 * OPRF de RFC 9497, suite `ristretto255-SHA512`, `modeOPRF = 0x00`
 * (`docs/OPAQUE.md` §8).
 *
 * Cubre las funciones del servidor (`HashToScalar`, `DeriveKeyPair`,
 * `BlindEvaluate`) y, marcadas como tales, las del cliente (`HashToGroup`,
 * `Blind`, `Finalize`), que en producción ejecuta `@serenity-kit/opaque` pero
 * que aquí se necesitan para comprobar los vectores oficiales del Apéndice
 * A.1.1 y para generar fixtures de interoperabilidad.
 *
 * Todas las entradas y salidas son cadenas binarias. Se usan `strlen()` y
 * `substr()`, nunca `mb_*`.
 *
 * @see https://www.rfc-editor.org/rfc/rfc9497 RFC 9497
 * @see https://www.rfc-editor.org/rfc/rfc9807 RFC 9807
 */
final class Oprf
{
    /** `modeOPRF` de RFC 9497 §3.1. */
    public const int MODE_OPRF = 0x00;

    /** Identificador de la suite (RFC 9497 §4.1). */
    public const string SUITE_ID = 'ristretto255-SHA512';

    /** Longitud de un elemento serializado `Noe` (RFC 9497 §4.1). */
    public const int ELEMENT_BYTES = 32;

    /** Longitud de una clave OPRF serializada `Nok` (`docs/OPAQUE.md` §2). */
    public const int KEY_BYTES = 32;

    /** Longitud de una semilla `Nseed` (`docs/OPAQUE.md` §2). */
    public const int SEED_BYTES = 32;

    /** Longitud de la salida del OPRF, `Nh` = salida de SHA-512 (RFC 9497 §4.1). */
    public const int OUTPUT_BYTES = 64;

    /** Bytes uniformes que consumen `HashToGroup` y `HashToScalar` en esta suite. */
    private const int UNIFORM_BYTES = 64;

    /** `info` de `DeriveKeyPair` para la clave OPRF del servidor (RFC 9807 §5.2.2). */
    public const string OPRF_KEY_INFO = 'OPAQUE-DeriveKeyPair';

    /**
     * `info` de `DeriveKeyPair` para las claves Diffie-Hellman del AKE
     * (RFC 9807 §6.4.1.1).
     *
     * No confundir con {@see OPRF_KEY_INFO}: son dos cadenas distintas y
     * usar una por otra produce claves incompatibles con `opaque-ke`.
     */
    public const string DIFFIE_HELLMAN_KEY_INFO = 'OPAQUE-DeriveDiffieHellmanKeyPair';

    /** Sufijo del `info` de la Expand por usuario (RFC 9807 §5.2.2). */
    private const string OPRF_KEY_LABEL = 'OprfKey';

    /** Límite del contador de `DeriveKeyPair` (RFC 9497 §3.2, paso 4). */
    private const int MAX_DERIVE_KEY_PAIR_COUNTER = 255;

    private function __construct() {}

    /**
     * `contextString` de RFC 9497 §3.1:
     * `"OPRFV1-" || I2OSP(mode, 1) || "-" || identifier`.
     *
     * Para `modeOPRF` y la suite `ristretto255-SHA512` son 28 bytes:
     * `OPRFV1-\x00-ristretto255-SHA512`.
     *
     * @return string Cadena binaria (contiene un byte 0x00).
     */
    public static function contextString(): string
    {
        return 'OPRFV1-'.BinaryCodec::i2osp1(self::MODE_OPRF).'-'.self::SUITE_ID;
    }

    /**
     * DST de `HashToGroup`: `"HashToGroup-" || contextString` (RFC 9497 §4.1).
     */
    public static function hashToGroupDomainSeparationTag(): string
    {
        return 'HashToGroup-'.self::contextString();
    }

    /**
     * DST de `HashToScalar`: `"HashToScalar-" || contextString` (RFC 9497 §4.1).
     */
    public static function hashToScalarDomainSeparationTag(): string
    {
        return 'HashToScalar-'.self::contextString();
    }

    /**
     * DST de `DeriveKeyPair`: `"DeriveKeyPair" || contextString`
     * (RFC 9497 §3.2, paso 3).
     *
     * Nótese que aquí **no** hay guion separador, a diferencia de
     * `HashToGroup-` y `HashToScalar-`.
     */
    public static function deriveKeyPairDomainSeparationTag(): string
    {
        return 'DeriveKeyPair'.self::contextString();
    }

    /**
     * `HashToScalar(msg)` para ristretto255-SHA512 (RFC 9497 §4.1).
     *
     * ```
     * uniform_bytes = expand_message_xmd(msg, DST, 64)
     * scalar        = OS2IP(uniform_bytes) mod L        // little-endian
     * ```
     *
     * RFC 9497 §4.1 especifica para esta suite que los 64 bytes uniformes se
     * interpretan como entero **little-endian** antes de reducir módulo el
     * orden `L` del grupo primo.
     * `sodium_crypto_core_ristretto255_scalar_reduce()` interpreta su entrada
     * exactamente así, en little-endian, de modo que el mapeo es directo: **no
     * hay que invertir ni reordenar nada**. Se deja escrito porque invertir el
     * orden de los bytes "para arreglar el endianismo" rompería todos los
     * vectores y la interoperabilidad con `opaque-ke`.
     *
     * El DST se recibe como parámetro explícito porque `DeriveKeyPair` usa uno
     * distinto del de `HashToScalar` genérico.
     *
     * @param  string  $message  msg, cadena binaria de longitud arbitraria.
     * @param  string  $dst  Domain separation tag, cadena binaria no vacía.
     * @return string Escalar canónico de 32 bytes little-endian; puede ser cero.
     *
     * @throws InvalidPointException Si la reducción falla en libsodium.
     */
    public static function hashToScalar(string $message, string $dst): string
    {
        $uniformBytes = ExpandMessageXmdSha512::expand($message, $dst, self::UNIFORM_BYTES);

        return Ristretto255::scalarReduce($uniformBytes);
    }

    /**
     * `HashToGroup(msg)` para ristretto255-SHA512 (RFC 9497 §4.1): función del
     * **cliente**, incluida para vectores de test e interoperabilidad
     * (`docs/OPAQUE.md` §8.1).
     *
     * ```
     * uniform_bytes = expand_message_xmd(msg, "HashToGroup-" || contextString, 64)
     * element       = hash_to_ristretto255(uniform_bytes)   // RFC 9380 §B / RFC 9496 §4.3.4
     * ```
     *
     * @param  string  $input  Cadena binaria de longitud arbitraria.
     * @return string Elemento serializado de 32 bytes.
     *
     * @throws InvalidPointException Si el mapeo produce el elemento neutro.
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
     * `DeriveKeyPair(seed, info)` de RFC 9497 §3.2.
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
     * @param  string  $seed  Semilla binaria; el protocolo usa `Nseed` = 32 bytes,
     *                        pero RFC 9497 no fija la longitud aquí.
     * @param  string  $info  Cadena de contexto, de 0 a 65535 bytes.
     * @return array{0: string, 1: string} `[skS, pkS]`, ambos de 32 bytes.
     *
     * @throws InvalidConfigurationException Si `$info` no cabe en un uint16.
     * @throws OpaqueException `DeriveKeyPairError`: 256 intentos consecutivos han
     *                         producido el escalar cero (fallo interno fatal).
     * @throws InvalidPointException Si la multiplicación por el generador falla.
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
     * `DeriveDiffieHellmanKeyPair(seed)` de RFC 9807 §6.4.1.1.
     *
     * Es `DeriveKeyPair(seed, "OPAQUE-DeriveDiffieHellmanKeyPair")`. Se usa
     * para las claves DH del AKE: la estática del cliente derivada del
     * `envelope`, las efímeras de ambos lados y la clave estática del servidor.
     *
     * La clave **OPRF** no se deriva con esta función, sino con
     * `DeriveKeyPair(seed, "OPAQUE-DeriveKeyPair")` (véase
     * {@see deriveOprfKey()}). Intercambiar los dos `info` produce claves
     * silenciosamente incompatibles con `opaque-ke`.
     *
     * @param  string  $seed  Semilla binaria de `Nseed` = 32 bytes.
     * @return array{0: string, 1: string} `[skS, pkS]`, ambos de 32 bytes.
     *
     * @throws OpaqueException Si `DeriveKeyPair` agota el contador.
     */
    public static function deriveDiffieHellmanKeyPair(string $seed): array
    {
        return self::deriveKeyPair($seed, self::DIFFIE_HELLMAN_KEY_INFO);
    }

    /**
     * Deriva la clave OPRF de un usuario a partir del `oprf_seed` del servidor
     * (RFC 9807 §5.2.2 y §6.3.2.2; `docs/OPAQUE.md` §8.3).
     *
     * ```
     * seed = Expand(oprf_seed, concat(credential_identifier, "OprfKey"), Nok)
     * (oprf_key, _) = DeriveKeyPair(seed, "OPAQUE-DeriveKeyPair")
     * ```
     *
     * Se llama a `HKDF-Expand` **directamente sobre `oprf_seed`**, sin
     * `Extract` previo: el `oprf_seed` ya es una PRK de 64 bytes.
     *
     * El RFC concatena `credential_identifier || "OprfKey"` sin prefijo de
     * longitud, por lo que el identificador debe tener longitud fija en todo
     * el sistema (32 bytes según `docs/OPAQUE.md` §13.1); esta función no
     * puede comprobarlo por sí sola y no lo impone.
     *
     * @param  string  $oprfSeed  PRK del servidor, al menos 64 bytes (`Nx`).
     * @param  string  $credentialIdentifier  Identificador binario de longitud fija.
     * @return string Clave OPRF de 32 bytes (`Nok`).
     *
     * @throws InvalidConfigurationException Si `$oprfSeed` mide menos de 64 bytes.
     * @throws OpaqueException Si `DeriveKeyPair` agota el contador.
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
     * `BlindEvaluate(skS, blindedElement)` de RFC 9497 §3.3.1.
     *
     * ```
     * evaluatedElement = skS * blindedElement
     * ```
     *
     * El elemento recibido se valida antes de operar (longitud, codificación
     * canónica, pertenencia al grupo y rechazo de la identidad), tal como
     * exige RFC 9807 §10.7 para toda entrada remota.
     *
     * @param  string  $oprfKey  Escalar canónico distinto de cero, 32 bytes.
     * @param  string  $blindedElement  Elemento recibido del cliente, 32 bytes.
     * @return string `evaluatedElement` serializado, 32 bytes.
     *
     * @throws InvalidPointException Si la clave o el elemento no validan, o si
     *                               el resultado es la identidad.
     */
    public static function blindEvaluate(string $oprfKey, string $blindedElement): string
    {
        Ristretto255::validatePoint($blindedElement);

        return Ristretto255::scalarMultiply($oprfKey, $blindedElement);
    }

    /**
     * `Blind(input)` de RFC 9497 §3.3.1 con el escalar de cegado dado: función
     * del **cliente**, incluida para vectores de test e interoperabilidad
     * (`docs/OPAQUE.md` §8.1).
     *
     * El escalar se recibe como parámetro en lugar de generarse aquí para poder
     * reproducir los vectores oficiales; el cliente real lo sortea al azar.
     *
     * ```
     * inputElement = HashToGroup(input)
     * if inputElement == Identity: raise InvalidInputError
     * blindedElement = blind * inputElement
     * ```
     *
     * @param  string  $input  Entrada binaria (en OPAQUE, la contraseña).
     * @param  string  $blind  Escalar canónico distinto de cero, 32 bytes.
     * @return string `blindedElement` serializado, 32 bytes.
     *
     * @throws InvalidPointException Si el escalar no valida o si `HashToGroup`
     *                               devuelve la identidad.
     */
    public static function blind(string $input, string $blind): string
    {
        return Ristretto255::scalarMultiply($blind, self::hashToGroup($input));
    }

    /**
     * `Finalize(input, blind, evaluatedElement)` de RFC 9497 §3.3.1: función
     * del **cliente**, incluida para vectores de test e interoperabilidad
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
     * @param  string  $input  La misma entrada que se pasó a `Blind`, de 0 a 65535 bytes.
     * @param  string  $blind  El mismo escalar de cegado, 32 bytes.
     * @param  string  $evaluatedElement  Elemento devuelto por el servidor, 32 bytes.
     * @return string Salida del OPRF, 64 bytes.
     *
     * @throws InvalidPointException Si el escalar o el elemento no validan.
     * @throws InvalidConfigurationException Si `$input` excede 65535 bytes.
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
