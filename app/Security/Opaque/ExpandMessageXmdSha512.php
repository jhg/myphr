<?php

declare(strict_types=1);

namespace App\Security\Opaque;

use InvalidArgumentException;

/**
 * expand_message_xmd instanciado con SHA-512 (RFC 9380 §5.3.1).
 *
 * Parámetros de la instancia:
 * - H = SHA-512
 * - b_in_bytes = 64 (tamaño de salida de H)
 * - s_in_bytes = 128 (tamaño de bloque de entrada de H)
 *
 * Todas las cadenas son binarias. No se usan funciones `mb_*`.
 */
final class ExpandMessageXmdSha512
{
    /** Tamaño de salida de SHA-512 en bytes (b_in_bytes, RFC 9380 §5.3.1). */
    private const int B_IN_BYTES = 64;

    /** Tamaño de bloque de entrada de SHA-512 en bytes (s_in_bytes, RFC 9380 §5.3.1). */
    private const int S_IN_BYTES = 128;

    /** Límite de DST admitido por expand_message_xmd (RFC 9380 §5.3.1, paso 2). */
    private const int MAX_DST_LENGTH = 255;

    /** Límite superior de len_in_bytes (RFC 9380 §5.3.1, paso 2). */
    private const int MAX_LEN_IN_BYTES = 65535;

    /** Límite de bloques ell (RFC 9380 §5.3.1, paso 2). */
    private const int MAX_ELL = 255;

    /** Literal ASCII de 17 bytes para reducir DST sobredimensionados (RFC 9380 §5.3.3). */
    private const string OVERSIZE_DST_PREFIX = 'H2C-OVERSIZE-DST-';

    /**
     * Deriva `len_in_bytes` bytes uniformes a partir de un mensaje y un DST.
     *
     * Algoritmo (RFC 9380 §5.3.1):
     *   DST_prime = DST || I2OSP(len(DST), 1)
     *   Z_pad     = I2OSP(0, 128)
     *   l_i_b_str = I2OSP(len_in_bytes, 2)
     *   msg_prime = Z_pad || msg || l_i_b_str || I2OSP(0, 1) || DST_prime
     *   b_0 = H(msg_prime)
     *   b_1 = H(b_0 || I2OSP(1, 1) || DST_prime)
     *   b_i = H(strxor(b_0, b_(i-1)) || I2OSP(i, 1) || DST_prime)   para i = 2..ell
     *   return substr(b_1 || ... || b_ell, 0, len_in_bytes)
     *
     * Si `len(DST) > 255` el DST se sustituye previamente por
     * `SHA-512("H2C-OVERSIZE-DST-" || DST)` (64 bytes), según RFC 9380 §5.3.3.
     *
     * @param  string  $message  msg: cadena binaria de longitud arbitraria.
     * @param  string  $dst  DST: cadena binaria (domain separation tag).
     * @param  int  $lengthInBytes  len_in_bytes: 0..65535, con ceil(len/64) <= 255.
     * @return string uniform_bytes: exactamente `$lengthInBytes` bytes.
     *
     * @throws InvalidArgumentException si `$lengthInBytes` es negativo, mayor que
     *                                  65535, o si ell > 255.
     */
    public static function expand(string $message, string $dst, int $lengthInBytes): string
    {
        if ($lengthInBytes < 0) {
            throw new InvalidArgumentException('len_in_bytes must not be negative.');
        }

        if ($lengthInBytes > self::MAX_LEN_IN_BYTES) {
            throw new InvalidArgumentException('len_in_bytes must not exceed '.self::MAX_LEN_IN_BYTES.'.');
        }

        $ell = intdiv($lengthInBytes + self::B_IN_BYTES - 1, self::B_IN_BYTES);

        if ($ell > self::MAX_ELL) {
            throw new InvalidArgumentException('ell must not exceed '.self::MAX_ELL.'.');
        }

        if ($ell === 0) {
            return '';
        }

        $dstPrime = self::dstPrime($dst);

        $messagePrime = str_repeat("\x00", self::S_IN_BYTES)
            .$message
            .pack('n', $lengthInBytes)
            .chr(0)
            .$dstPrime;

        $b0 = hash('sha512', $messagePrime, true);

        $previous = hash('sha512', $b0.chr(1).$dstPrime, true);
        $uniformBytes = $previous;

        for ($i = 2; $i <= $ell; $i++) {
            $previous = hash('sha512', self::xor($b0, $previous).chr($i).$dstPrime, true);
            $uniformBytes .= $previous;
        }

        return substr($uniformBytes, 0, $lengthInBytes);
    }

    /**
     * Construye DST_prime = DST || I2OSP(len(DST), 1) (RFC 9380 §5.3.1, paso 3),
     * aplicando antes la reducción obligatoria de RFC 9380 §5.3.3 cuando el DST
     * supera los 255 bytes.
     *
     * @param  string  $dst  DST original, de cualquier longitud.
     * @return string DST_prime, de len(DST) + 1 bytes (máximo 256).
     */
    private static function dstPrime(string $dst): string
    {
        if (strlen($dst) > self::MAX_DST_LENGTH) {
            $dst = hash('sha512', self::OVERSIZE_DST_PREFIX.$dst, true);
        }

        return $dst.chr(strlen($dst));
    }

    /**
     * XOR byte a byte de dos cadenas binarias de la misma longitud
     * (strxor, RFC 9380 §5.3.1, paso 10).
     *
     * @param  string  $left  Cadena binaria.
     * @param  string  $right  Cadena binaria de la misma longitud que `$left`.
     * @return string Resultado de longitud igual a las entradas.
     *
     * @throws InvalidArgumentException si las longitudes difieren.
     */
    private static function xor(string $left, string $right): string
    {
        if (strlen($left) !== strlen($right)) {
            throw new InvalidArgumentException('strxor operands must have equal length.');
        }

        return $left ^ $right;
    }
}
