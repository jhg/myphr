<?php

declare(strict_types=1);

namespace App\Security\Opaque;

use SodiumException;

/**
 * Envoltorio estricto sobre las primitivas ristretto255 de `ext-sodium`
 * (`docs/OPAQUE.md` §7.1).
 *
 * Añade a libsodium las comprobaciones que RFC 9807 §10.7 exige para toda
 * entrada remota y que la extensión no hace por sí sola:
 *
 * - canonicidad de la codificación del elemento: `is_valid_point()` la
 *   comprueba en unas versiones de libsodium y no en otras, de modo que
 *   delegarla haría que la misma aplicación aceptara o rechazara codificaciones
 *   alternativas según con qué biblioteca se compilase PHP;
 * - rechazo explícito del elemento neutro (`is_valid_point()` devuelve `true`
 *   para 32 bytes cero);
 * - rechazo del escalar cero;
 * - canonicidad del escalar (`sodium_crypto_scalarmult_ristretto255_base()`
 *   no reduce su entrada y aceptaría en silencio un escalar mayor o igual que
 *   el orden del grupo).
 *
 * Cualquier `SodiumException` se traduce a {@see InvalidPointException}, que
 * es subtipo de `InvalidMessageException` según `docs/OPAQUE.md` §18.
 */
final class Ristretto255
{
    /** Longitud de un elemento serializado del grupo, en bytes (RFC 9496 §4). */
    public const int ELEMENT_BYTES = 32;

    /** Longitud de un escalar serializado, en bytes (RFC 9496 §4). */
    public const int SCALAR_BYTES = 32;

    /** Longitud de la entrada uniforme de `from_hash` y `scalar_reduce`, en bytes. */
    public const int HASH_BYTES = 64;

    /**
     * Valida un elemento del grupo recibido de una fuente remota
     * (RFC 9807 §10.7; `docs/OPAQUE.md` §7.1).
     *
     * Comprueba, en este orden: longitud exacta de 32 bytes, codificación
     * canónica y pertenencia al grupo mediante
     * `sodium_crypto_core_ristretto255_is_valid_point()`, y por último que no
     * sea el elemento neutro (32 bytes cero), que esa función acepta.
     *
     * @param  string  $point  Elemento serializado, 32 bytes binarios.
     *
     * @throws InvalidPointException Si la longitud no es 32, si la codificación
     *                               no es válida o canónica, o si es la identidad.
     */
    public static function validatePoint(string $point): void
    {
        if (strlen($point) !== self::ELEMENT_BYTES) {
            throw new InvalidPointException('Ristretto255 element must be exactly 32 bytes.');
        }

        /**
         * La canonicidad se comprueba aquí y **no** se delega en libsodium.
         *
         * `sodium_crypto_core_ristretto255_is_valid_point()` no la verifica en todas las versiones
         * de la biblioteca: con libsodium 1.0.20 rechaza una codificación no canónica, y en el
         * runner de integración continua la acepta. Un mismo despliegue, según con qué libsodium se
         * haya compilado PHP, admitiría codificaciones alternativas del mismo elemento, que es
         * justo la propiedad que ristretto255 existe para dar: una y solo una representación por
         * elemento del grupo.
         *
         * Es el mismo criterio que ya se aplicaba al elemento neutro unas líneas más abajo: lo que
         * RFC 9807 §10.7 exige de toda entrada remota se comprueba aquí, no se supone.
         */
        if (! self::isCanonicalEncoding($point)) {
            throw new InvalidPointException('Ristretto255 element is not a canonical encoding.');
        }

        try {
            $isValid = sodium_crypto_core_ristretto255_is_valid_point($point);
        } catch (SodiumException $exception) {
            throw new InvalidPointException('Ristretto255 element rejected.', 0, $exception);
        }

        if ($isValid !== true) {
            throw new InvalidPointException('Ristretto255 element is not a valid canonical encoding.');
        }

        if (self::isIdentityElement($point)) {
            throw new InvalidPointException('Ristretto255 element is the identity element.');
        }
    }

    /**
     * ¿Son estos 32 bytes la codificación canónica de un elemento del cuerpo (RFC 9496 §4.1)?
     *
     * Es decir: interpretados en little-endian, ¿valen menos que `p = 2^255 - 19`? Eso descarta de
     * una vez el bit alto puesto (todo lo que llega a `2^255`) y el hueco de diecinueve valores
     * entre `p` y `2^255`, que es el caso que se cuela cuando solo se mira el bit alto.
     *
     * La comparación es en tiempo constante, sin salidas anticipadas. El elemento es público, así
     * que el tiempo no filtra ningún secreto, pero un bucle que corta en el primer byte distinto
     * invita a copiarse a un sitio donde sí importe.
     */
    private static function isCanonicalEncoding(string $point): bool
    {
        /** `p = 2^255 - 19` en little-endian: 0xED, treinta 0xFF y 0x7F. */
        $prime = "\xed".str_repeat("\xff", 30)."\x7f";

        $borrow = 0;
        $stillEqual = 1;

        for ($i = self::ELEMENT_BYTES - 1; $i >= 0; $i--) {
            $difference = ord($point[$i]) - ord($prime[$i]);

            /** `>> 8` deja todo unos si la resta fue negativa, es decir si este byte es menor. */
            $borrow |= ($difference >> 8) & $stillEqual;
            $stillEqual &= (((ord($point[$i]) ^ ord($prime[$i])) - 1) >> 8) & 1;
        }

        return ($borrow & 1) === 1;
    }

    /**
     * Valida un escalar (`docs/OPAQUE.md` §7.1).
     *
     * Comprueba longitud exacta de 32 bytes, que no sea cero y que sea
     * canónico, es decir, menor que el orden `L` del grupo primo. La
     * canonicidad se verifica exigiendo que reducir el escalar módulo `L`
     * devuelva el mismo valor.
     *
     * @param  string  $scalar  Escalar serializado en little-endian, 32 bytes binarios.
     *
     * @throws InvalidPointException Si la longitud no es 32, si es cero o si no es canónico.
     */
    public static function validateScalar(string $scalar): void
    {
        if (strlen($scalar) !== self::SCALAR_BYTES) {
            throw new InvalidPointException('Ristretto255 scalar must be exactly 32 bytes.');
        }

        if (self::isZeroScalar($scalar)) {
            throw new InvalidPointException('Ristretto255 scalar is zero.');
        }

        $reduced = self::scalarReduce($scalar.str_repeat("\x00", self::SCALAR_BYTES));

        if (! hash_equals($reduced, $scalar)) {
            throw new InvalidPointException('Ristretto255 scalar is not canonical (>= group order).');
        }
    }

    /**
     * Multiplicación escalar sobre un elemento arbitrario del grupo
     * (`sodium_crypto_scalarmult_ristretto255`).
     *
     * Valida escalar y elemento antes de operar. libsodium lanza excepción si
     * el resultado es el elemento neutro, lo que cubre el requisito de
     * RFC 9807 §10.7 de que el secreto DH compartido no sea la identidad; ese
     * caso se traduce también a {@see InvalidPointException}.
     *
     * @param  string  $scalar  Escalar canónico distinto de cero, 32 bytes.
     * @param  string  $point  Elemento válido distinto de la identidad, 32 bytes.
     * @return string Elemento resultante, 32 bytes.
     *
     * @throws InvalidPointException Si alguna entrada no valida o si el resultado es la identidad.
     */
    public static function scalarMultiply(string $scalar, string $point): string
    {
        self::validateScalar($scalar);
        self::validatePoint($point);

        try {
            $result = sodium_crypto_scalarmult_ristretto255($scalar, $point);
        } catch (SodiumException $exception) {
            throw new InvalidPointException('Ristretto255 scalar multiplication failed.', 0, $exception);
        }

        if (self::isIdentityElement($result)) {
            throw new InvalidPointException('Ristretto255 scalar multiplication yielded the identity element.');
        }

        return $result;
    }

    /**
     * Multiplicación del escalar por el generador
     * (`sodium_crypto_scalarmult_ristretto255_base`).
     *
     * La función de libsodium **no reduce** su entrada, por lo que la
     * validación de canonicidad previa es obligatoria: un escalar no canónico
     * produciría una clave pública que `curve25519-dalek` rechaza.
     *
     * @param  string  $scalar  Escalar canónico distinto de cero, 32 bytes.
     * @return string Elemento resultante, 32 bytes.
     *
     * @throws InvalidPointException Si el escalar no valida o si el resultado es la identidad.
     */
    public static function scalarMultiplyBase(string $scalar): string
    {
        self::validateScalar($scalar);

        try {
            $result = sodium_crypto_scalarmult_ristretto255_base($scalar);
        } catch (SodiumException $exception) {
            throw new InvalidPointException('Ristretto255 base scalar multiplication failed.', 0, $exception);
        }

        if (self::isIdentityElement($result)) {
            throw new InvalidPointException('Ristretto255 base scalar multiplication yielded the identity element.');
        }

        return $result;
    }

    /**
     * Reduce 64 bytes uniformes módulo el orden `L` del grupo
     * (`sodium_crypto_core_ristretto255_scalar_reduce`).
     *
     * Es la operación usada por `HashToScalar` (RFC 9497 §4.1) y por
     * `DeriveKeyPair`; el resultado puede ser cero, cosa que esta función no
     * comprueba porque también se usa para verificar canonicidad en
     * {@see validateScalar()}.
     *
     * @param  string  $wideScalar  Entrada uniforme, exactamente 64 bytes binarios.
     * @return string Escalar canónico, 32 bytes.
     *
     * @throws InvalidPointException Si la longitud no es 64 o si libsodium falla.
     */
    public static function scalarReduce(string $wideScalar): string
    {
        if (strlen($wideScalar) !== self::HASH_BYTES) {
            throw new InvalidPointException('Ristretto255 wide scalar must be exactly 64 bytes.');
        }

        try {
            return sodium_crypto_core_ristretto255_scalar_reduce($wideScalar);
        } catch (SodiumException $exception) {
            throw new InvalidPointException('Ristretto255 scalar reduction failed.', 0, $exception);
        }
    }

    /**
     * Inverso multiplicativo del escalar módulo `L`
     * (`sodium_crypto_core_ristretto255_scalar_invert`).
     *
     * Usado por el cliente OPRF para desenmascarar (RFC 9497 §3.3.1). El
     * escalar debe validar previamente: el cero no tiene inverso.
     *
     * @param  string  $scalar  Escalar canónico distinto de cero, 32 bytes.
     * @return string Escalar inverso, 32 bytes.
     *
     * @throws InvalidPointException Si el escalar no valida o si libsodium falla.
     */
    public static function scalarInvert(string $scalar): string
    {
        self::validateScalar($scalar);

        try {
            return sodium_crypto_core_ristretto255_scalar_invert($scalar);
        } catch (SodiumException $exception) {
            throw new InvalidPointException('Ristretto255 scalar inversion failed.', 0, $exception);
        }
    }

    /**
     * Mapea 64 bytes uniformes a un elemento del grupo
     * (`sodium_crypto_core_ristretto255_from_hash`), es decir, el
     * `hash_to_ristretto255` de RFC 9380 §B / RFC 9496 §4.3.4 empleado por
     * `HashToGroup` de RFC 9497 §4.1.
     *
     * @param  string  $uniformBytes  Entrada uniforme, exactamente 64 bytes binarios.
     * @return string Elemento del grupo, 32 bytes; nunca la identidad.
     *
     * @throws InvalidPointException Si la longitud no es 64, si libsodium falla
     *                               o si el resultado es la identidad.
     */
    public static function pointFromHash(string $uniformBytes): string
    {
        if (strlen($uniformBytes) !== self::HASH_BYTES) {
            throw new InvalidPointException('Ristretto255 uniform input must be exactly 64 bytes.');
        }

        try {
            $point = sodium_crypto_core_ristretto255_from_hash($uniformBytes);
        } catch (SodiumException $exception) {
            throw new InvalidPointException('Ristretto255 hash-to-group failed.', 0, $exception);
        }

        if (self::isIdentityElement($point)) {
            throw new InvalidPointException('Ristretto255 hash-to-group yielded the identity element.');
        }

        return $point;
    }

    /**
     * Compara en tiempo constante contra 32 bytes cero, la codificación del
     * elemento neutro, que `is_valid_point()` acepta como válido.
     *
     * @param  string  $point  Elemento serializado de 32 bytes.
     */
    private static function isIdentityElement(string $point): bool
    {
        return strlen($point) === self::ELEMENT_BYTES
            && hash_equals(str_repeat("\x00", self::ELEMENT_BYTES), $point);
    }

    /**
     * Compara en tiempo constante contra el escalar cero.
     *
     * @param  string  $scalar  Escalar serializado de 32 bytes.
     */
    private static function isZeroScalar(string $scalar): bool
    {
        return strlen($scalar) === self::SCALAR_BYTES
            && hash_equals(str_repeat("\x00", self::SCALAR_BYTES), $scalar);
    }
}
