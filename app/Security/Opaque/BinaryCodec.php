<?php

declare(strict_types=1);

namespace App\Security\Opaque;

/**
 * Utilidades binarias del protocolo (`docs/OPAQUE.md` §4 y §5).
 *
 * Todos los formatos internos son binarios puros: concatenación de strings
 * con offsets exactos, sin JSON, `serialize()` ni enteros de plataforma.
 * Por eso aquí sólo se usan `strlen()` / `substr()` (nunca `mb_*`), `pack('n')`
 * para uint16 big-endian y `chr()` para uint8, y toda longitud se comprueba
 * antes de cualquier troceado.
 *
 * Los errores derivados de datos remotos son `InvalidMessageException`; los
 * derivados de uso interno incorrecto (valores fuera de rango, anchos no
 * soportados) son `InvalidConfigurationException`, porque no deben colapsarse
 * en la respuesta genérica de autenticación de §18.
 */
final class BinaryCodec
{
    /**
     * Concatenación binaria, `concat(...)` de RFC 9807 §1.2.
     *
     * @param  string  ...$parts  Fragmentos binarios en orden.
     * @return string Concatenación de todos ellos.
     */
    public static function concat(string ...$parts): string
    {
        return implode('', $parts);
    }

    /**
     * `zeroes(n)` de RFC 9807 §1.2.
     *
     * @param  int<0, max>  $length  Número de bytes cero.
     * @return string Cadena de `$length` bytes `0x00`.
     *
     * @throws InvalidConfigurationException Si `$length` es negativo.
     */
    public static function zeroes(int $length): string
    {
        if ($length < 0) {
            throw new InvalidConfigurationException("Zero-fill length must not be negative, got {$length}.");
        }

        return str_repeat("\0", $length);
    }

    /**
     * Exige una longitud binaria exacta.
     *
     * Debe llamarse antes de cualquier troceado de un mensaje recibido
     * (`docs/OPAQUE.md` §4, §5).
     *
     * @param  string  $data  Cadena binaria a comprobar.
     * @param  int<0, max>  $expectedLength  Longitud exigida, en bytes.
     * @param  string  $field  Nombre del campo, sólo para el mensaje de error.
     *
     * @throws InvalidMessageException Si la longitud no coincide.
     */
    public static function ensureLength(string $data, int $expectedLength, string $field = 'value'): void
    {
        $actualLength = strlen($data);

        if ($actualLength !== $expectedLength) {
            throw new InvalidMessageException(
                "Field {$field} must be {$expectedLength} bytes, got {$actualLength}."
            );
        }
    }

    /**
     * Extrae `$length` bytes desde `$offset`, comprobando el rango antes.
     *
     * Implementa los offsets de `docs/OPAQUE.md` §6. Nunca devuelve una
     * cadena más corta de lo pedido: si el mensaje está truncado, lanza.
     *
     * @param  string  $data  Cadena binaria origen.
     * @param  int<0, max>  $offset  Desplazamiento inicial en bytes.
     * @param  int<0, max>  $length  Número de bytes a extraer.
     * @param  string  $field  Nombre del campo, sólo para el mensaje de error.
     * @return string Bytes extraídos, de longitud exactamente `$length`.
     *
     * @throws InvalidMessageException Si el rango excede los datos.
     * @throws InvalidConfigurationException Si `$offset` o `$length` son negativos.
     */
    public static function slice(string $data, int $offset, int $length, string $field = 'value'): string
    {
        if ($offset < 0 || $length < 0) {
            throw new InvalidConfigurationException(
                "Slice bounds must not be negative, got offset {$offset} and length {$length}."
            );
        }

        if ($offset + $length > strlen($data)) {
            throw new InvalidMessageException(
                "Field {$field} is truncated: cannot read {$length} bytes at offset {$offset}."
            );
        }

        return substr($data, $offset, $length);
    }

    /**
     * `I2OSP(value, 1)` — entero sin signo de 8 bits (RFC 8017 §4.1).
     *
     * @param  int<0, 255>  $value  Valor a serializar.
     * @return string Un byte.
     *
     * @throws InvalidConfigurationException Si el valor no cabe en 8 bits.
     */
    public static function i2osp1(int $value): string
    {
        if ($value < 0 || $value > 0xFF) {
            throw new InvalidConfigurationException("Value {$value} does not fit in a uint8.");
        }

        return chr($value);
    }

    /**
     * `I2OSP(value, 2)` — entero sin signo de 16 bits big-endian (RFC 8017 §4.1).
     *
     * Se usa `pack('n')`, que es big-endian por definición y no depende de la
     * plataforma, a diferencia de `pack('L')` o `pack('S')`.
     *
     * @param  int<0, 65535>  $value  Valor a serializar.
     * @return string Dos bytes big-endian.
     *
     * @throws InvalidConfigurationException Si el valor no cabe en 16 bits.
     */
    public static function i2osp2(int $value): string
    {
        if ($value < 0 || $value > 0xFFFF) {
            throw new InvalidConfigurationException("Value {$value} does not fit in a uint16.");
        }

        return pack('n', $value);
    }

    /**
     * Serializa un vector de longitud variable `<1..2^16-1>` del RFC 8446
     * como `uint16_be(len) || bytes`.
     *
     * Lo usan `CleartextCredentials` (RFC 9807 §4), el preamble (§6.4.2.1) y
     * la entrada de `Finalize` del OPRF (RFC 9497 §3.3.1).
     *
     * @param  string  $data  Contenido binario, de 0 a 65535 bytes.
     * @return string `uint16_be(strlen($data)) || $data`.
     *
     * @throws InvalidConfigurationException Si el contenido excede 65535 bytes.
     */
    public static function lengthPrefixed(string $data): string
    {
        return self::i2osp2(strlen($data)).$data;
    }

    /**
     * `xor(a, b)` de RFC 9807 §1.2 — XOR byte a byte.
     *
     * Se usa para el `masked_response` de `CredentialResponse`
     * (`docs/OPAQUE.md` §6.2) y para `expand_message_xmd` (RFC 9380 §5.3.1).
     *
     * @param  string  $a  Primer operando binario.
     * @param  string  $b  Segundo operando binario, de la misma longitud.
     * @return string Resultado, de la misma longitud que los operandos.
     *
     * @throws InvalidMessageException Si las longitudes difieren.
     */
    public static function xorStrings(string $a, string $b): string
    {
        if (strlen($a) !== strlen($b)) {
            throw new InvalidMessageException(
                'XOR operands must have the same length, got '.strlen($a).' and '.strlen($b).'.'
            );
        }

        return $a ^ $b;
    }

    /**
     * `ct_equal(a, b)` de RFC 9807 §1.2 — comparación en tiempo constante
     * (RFC 9807 §9.1).
     *
     * La comprobación previa de longitud no filtra nada secreto: las
     * longitudes del protocolo son públicas y fijas (§6).
     *
     * @param  string  $a  Primer operando binario.
     * @param  string  $b  Segundo operando binario.
     * @return bool `true` si son idénticos en longitud y contenido.
     */
    public static function constantTimeEquals(string $a, string $b): bool
    {
        if (strlen($a) !== strlen($b)) {
            return false;
        }

        return sodium_memcmp($a, $b) === 0;
    }
}
