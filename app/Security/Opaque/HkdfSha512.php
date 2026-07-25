<?php

declare(strict_types=1);

namespace App\Security\Opaque;

use InvalidArgumentException;

/**
 * HKDF instanciado con HMAC-SHA-512, según RFC 5869.
 *
 * Implementación manual (no se usa `hash_hkdf()`) para que el comportamiento
 * quede fijado por este código y no por la interpretación de la extensión
 * `hash` de PHP. Todas las entradas y salidas son cadenas binarias: nunca se
 * pasa por representaciones hexadecimales ni por funciones `mb_*`.
 *
 * @see https://www.rfc-editor.org/rfc/rfc5869 RFC 5869
 */
final class HkdfSha512
{
    /**
     * HashLen de SHA-512 en bytes (RFC 5869 §2).
     */
    public const int HASH_LENGTH = 64;

    /**
     * Bloque interno de SHA-512 en bytes; tamaño del salt cero por defecto.
     */
    public const int BLOCK_LENGTH = 128;

    /**
     * Longitud máxima de salida de Expand: 255 * HashLen (RFC 5869 §2.3).
     */
    public const int MAX_OUTPUT_LENGTH = 255 * self::HASH_LENGTH;

    private function __construct() {}

    /**
     * HKDF-Extract (RFC 5869 §2.2).
     *
     * PRK = HMAC-SHA-512(key = salt, data = IKM)
     *
     * Si `$salt` es la cadena vacía se sustituye por HashLen (64) bytes cero,
     * tal y como exige RFC 5869 §2.2 ("if not provided, it is set to a string
     * of HashLen zeros").
     *
     * @param  string  $salt  Salt binario, opcionalmente vacío. Longitud arbitraria.
     * @param  string  $ikm  Input Keying Material binario. Longitud arbitraria.
     * @return string PRK binario de exactamente 64 bytes.
     */
    public static function extract(string $salt, string $ikm): string
    {
        if ($salt === '') {
            $salt = str_repeat("\x00", self::HASH_LENGTH);
        }

        return hash_hmac('sha512', $ikm, $salt, true);
    }

    /**
     * HKDF-Expand (RFC 5869 §2.3).
     *
     * T(0) = ""
     * T(i) = HMAC-SHA-512(key = PRK, data = T(i-1) || info || I2OSP(i, 1))
     * OKM  = primeros L bytes de T(1) || T(2) || ... || T(N)
     *
     * El contador `i` ocupa un solo byte, lo que limita N a 255 y por tanto
     * L a 255 * 64 = 16320 bytes.
     *
     * @param  string  $prk  Pseudorandom key binaria. RFC 5869 §2.3 exige al menos
     *                       HashLen (64) bytes.
     * @param  string  $info  Información de contexto binaria, posiblemente vacía.
     * @param  int  $length  L, longitud de salida en bytes. 1 <= L <= 16320.
     * @return string OKM binario de exactamente `$length` bytes.
     *
     * @throws InvalidArgumentException Si `$length` está fuera de rango. Es un
     *                                  error del llamante, nunca alcanzable
     *                                  desde una entrada remota.
     * @throws InvalidConfigurationException Si `$prk` mide menos de HashLen
     *                                       bytes. Un PRK corto solo puede venir
     *                                       de material estático mal configurado
     *                                       (p. ej. `oprf_seed`), así que entra en
     *                                       la jerarquía de `docs/OPAQUE.md` §18
     *                                       para que la capa HTTP lo colapse junto
     *                                       al resto de errores del subsistema.
     */
    public static function expand(string $prk, string $info, int $length): string
    {
        if ($length < 1 || $length > self::MAX_OUTPUT_LENGTH) {
            throw new InvalidArgumentException(
                'HKDF-Expand: la longitud debe estar entre 1 y '.self::MAX_OUTPUT_LENGTH.' bytes, recibida '.$length.'.'
            );
        }

        if (strlen($prk) < self::HASH_LENGTH) {
            throw new InvalidConfigurationException(
                'HKDF-Expand: el PRK debe medir al menos '.self::HASH_LENGTH.' bytes, recibidos '.strlen($prk).'.'
            );
        }

        $blockCount = intdiv($length + self::HASH_LENGTH - 1, self::HASH_LENGTH);

        $okm = '';
        $previousBlock = '';

        for ($counter = 1; $counter <= $blockCount; $counter++) {
            $previousBlock = hash_hmac(
                'sha512',
                $previousBlock.$info.chr($counter),
                $prk,
                true
            );
            $okm .= $previousBlock;
        }

        return substr($okm, 0, $length);
    }
}
